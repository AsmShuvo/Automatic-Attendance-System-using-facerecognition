"""Multi-camera attendance capture (one process, one thread per camera).

Covers a whole classroom with several cameras at once. Each camera runs face
recognition independently; results are merged by registration number in a single
shared CSV (a student seen by any camera is marked present). Scans are staggered
so 4-5 cameras spread their CPU load across the interval instead of spiking
together. All feeds are shown as tiles in one window — press q to quit.

Cameras are configured in cameras.json (see cameras.example.json):
    [ { "name": "front-left", "source": "rtsp://user:pass@ip:554/..." },
      { "name": "lab-webcam", "source": 1 } ]

Run directly:
    source venv/bin/activate
    python multicam_attendance.py
(usually it's launched for you by backend/server.py when cameras.json exists)
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import math
import os
import threading
import time

import cv2

from recognizer import FaceRecognizer

ROOT = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(ROOT, "attendance.csv")
CSV_HEADER = ["regno", "date", "time", "camera"]
CONFIG_PATH = os.environ.get("CAMERAS_CONFIG", os.path.join(ROOT, "cameras.json"))

INTERVAL = float(os.environ.get("INTERVAL", "15"))  # seconds between scans
TILE_W, TILE_H = 480, 360

stop_event = threading.Event()


def open_source(source):
    """Open an int webcam index or a URL/RTSP/HTTP stream. Returns cap or None."""
    if isinstance(source, int) or (isinstance(source, str) and source.isdigit()):
        cap = cv2.VideoCapture(int(source), cv2.CAP_V4L2)
        if not cap.isOpened():
            cap.release()
            return None
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 2000)
        for _ in range(5):
            if cap.read()[0]:
                return cap
        cap.release()
        return None
    cap = cv2.VideoCapture(str(source), cv2.CAP_FFMPEG)  # RTSP / HTTP / file
    return cap if cap.isOpened() else None


class SharedLogger:
    """One CSV writer shared by all cameras, with a per-student cooldown so a
    student visible in two cameras isn't logged twice in the same cycle."""

    def __init__(self, cooldown: float):
        self.lock = threading.Lock()
        self.last: dict[str, float] = {}
        self.cooldown = cooldown
        with open(CSV_PATH, "w", newline="") as f:
            csv.writer(f).writerow(CSV_HEADER)

    def mark(self, regno: str, camera: str) -> bool:
        now = time.monotonic()
        with self.lock:
            if regno in self.last and now - self.last[regno] < self.cooldown:
                return False
            self.last[regno] = now
            t = dt.datetime.now()
            with open(CSV_PATH, "a", newline="") as f:
                csv.writer(f).writerow(
                    [regno, t.strftime("%Y-%m-%d"), t.strftime("%H:%M:%S"), camera]
                )
        return True


class CameraWorker(threading.Thread):
    def __init__(self, cam, recognizer, rec_lock, logger, offset, frames):
        super().__init__(daemon=True)
        self.cam_name = cam["name"]
        self.source = cam["source"]
        self.recognizer = recognizer
        self.rec_lock = rec_lock
        self.logger = logger
        self.offset = offset          # stagger: delay this camera's first scan
        self.frames = frames          # shared dict: name -> latest annotated tile
        self.online = False

    def run(self):
        cap = open_source(self.source)
        if cap is None:
            print(f"[{self.cam_name}] could not open source: {self.source}")
            self.frames[self.cam_name] = self._offline_tile()
            return
        self.online = True
        print(f"[{self.cam_name}] online")

        # Stagger first scan so cameras don't all hit the CPU at once.
        last_scan = time.monotonic() - INTERVAL + self.offset
        last_results = []
        while not stop_event.is_set():
            ok, frame = cap.read()
            if not ok:
                time.sleep(0.05)
                continue

            now = time.monotonic()
            if now - last_scan >= INTERVAL:
                # Serialize the model across threads (CPU runs one at a time anyway).
                with self.rec_lock:
                    last_results = self.recognizer.identify_all(frame)
                marked = []
                for _, m in last_results:
                    if m.regno and self.logger.mark(m.regno, self.cam_name):
                        marked.append(m.regno)
                if marked:
                    print(f"[{self.cam_name}] marked: {', '.join(marked)}")
                last_scan = now

            self.frames[self.cam_name] = self._annotate(frame, last_results)

        cap.release()

    def _annotate(self, frame, results):
        for face, match in results:
            x1, y1, x2, y2 = [int(v) for v in face.bbox]
            if match.regno:
                color, label = (0, 255, 0), f"{match.regno} {match.score:.2f}"
            else:
                color, label = (0, 0, 255), "unknown"
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, label, (x1, max(y1 - 8, 12)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2, cv2.LINE_AA)
        tile = cv2.resize(frame, (TILE_W, TILE_H))
        cv2.putText(tile, self.cam_name, (10, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2, cv2.LINE_AA)
        return tile

    def _offline_tile(self):
        import numpy as np
        tile = np.zeros((TILE_H, TILE_W, 3), dtype="uint8")
        cv2.putText(tile, f"{self.cam_name}: OFFLINE", (20, TILE_H // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2, cv2.LINE_AA)
        return tile


def compose_grid(frames, order):
    import numpy as np
    n = len(order)
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    blank = np.zeros((TILE_H, TILE_W, 3), dtype="uint8")
    tiles = [frames.get(name, blank) for name in order]
    while len(tiles) < rows * cols:
        tiles.append(blank)
    grid_rows = [np.hstack(tiles[r * cols:(r + 1) * cols]) for r in range(rows)]
    return np.vstack(grid_rows)


def main():
    if not os.path.exists(CONFIG_PATH):
        print(f"No camera config at {CONFIG_PATH}")
        return
    with open(CONFIG_PATH) as f:
        cams = json.load(f)
    if not cams:
        print("cameras.json is empty.")
        return

    print(f"Loading ArcFace model for {len(cams)} camera(s)...")
    recognizer = FaceRecognizer()
    loaded = recognizer.load_known_faces()
    if not loaded:
        print("No known students loaded from images/.")
        return
    print(f"Loaded {len(loaded)} students: {', '.join(loaded)}")

    rec_lock = threading.Lock()
    logger = SharedLogger(cooldown=INTERVAL * 0.9)
    frames: dict = {}
    order = [c["name"] for c in cams]

    workers = []
    for i, cam in enumerate(cams):
        offset = i * (INTERVAL / len(cams))  # spread scans across the interval
        w = CameraWorker(cam, recognizer, rec_lock, logger, offset, frames)
        w.start()
        workers.append(w)

    win = "Multi-Camera Attendance - q to quit"
    try:
        while not stop_event.is_set():
            if frames:
                cv2.imshow(win, compose_grid(frames, order))
            key = cv2.waitKey(30) & 0xFF
            if key in (ord("q"), 27):
                break
            if all(not w.is_alive() for w in workers):
                break
    finally:
        stop_event.set()
        time.sleep(0.2)
        cv2.destroyAllWindows()
        print("Multi-camera capture stopped.")


if __name__ == "__main__":
    main()
