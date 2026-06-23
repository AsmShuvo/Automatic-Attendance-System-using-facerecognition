"""Webcam attendance app.

Opens your webcam in a window, runs ArcFace (ResNet-50) recognition against the
reference photos in images/, and marks attendance in attendance.csv.

Two modes:
  MANUAL (default) - press SPACE to capture; each person marked once per day.
  AUTO             - scans automatically every INTERVAL seconds and logs every
                     recognised person each cycle (a fresh row per scan). Only q
                     quits. Enable with:  AUTO=1 python attendance.py
                     Change the cycle with: AUTO=1 INTERVAL=15 python attendance.py

Controls:
    SPACE / c : (manual mode) capture the current frame and mark attendance
    q / ESC   : quit
"""
from __future__ import annotations

import csv
import datetime as dt
import os
import sys
import time

import cv2

from recognizer import FaceRecognizer

CSV_PATH = os.path.join(os.path.dirname(__file__), "attendance.csv")
CSV_HEADER = ["regno", "date", "time"]

# AUTO=1 turns on hands-free scanning; INTERVAL is the seconds between scans.
AUTO = os.environ.get("AUTO", "0").lower() not in ("0", "", "false", "no")
INTERVAL = float(os.environ.get("INTERVAL", "15"))

# Camera source. Three ways to choose one (first match wins):
#   - a USB webcam index:   CAMERA_INDEX=1 python attendance.py
#   - a CCTV / IP stream:   CAMERA_SOURCE="rtsp://user:pass@192.168.1.64:554/..." python attendance.py
#   - pass either as arg1:  python attendance.py 1
#                           python attendance.py rtsp://...
# A USB webcam may expose several /dev/videoN nodes where only one delivers
# frames; with no override we auto-detect the working one.


def open_camera():
    # A URL/path source (CCTV, RTSP, HTTP, video file) is opened directly.
    source = os.environ.get("CAMERA_SOURCE")
    if len(sys.argv) > 1 and not sys.argv[1].isdigit():
        source = sys.argv[1]
    if source:
        # FFMPEG backend handles RTSP/HTTP streams.
        cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
        if cap.isOpened():
            for _ in range(15):  # streams take a moment to buffer
                ok, _frame = cap.read()
                if ok:
                    print(f"Using camera stream: {source}")
                    return cap
        cap.release()
        print(f"Could not read from stream: {source}")
        return None

    preferred = os.environ.get("CAMERA_INDEX")
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        preferred = sys.argv[1]
    candidates = ([int(preferred)] if preferred is not None else []) + list(range(6))
    tried = set()
    for idx in candidates:
        if idx in tried:
            continue
        tried.add(idx)
        cap = cv2.VideoCapture(idx, cv2.CAP_V4L2)
        if not cap.isOpened():
            cap.release()
            continue
        # Fail fast on dead nodes: some /dev/videoN block ~10s per read.
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 2000)
        for _ in range(5):  # warm-up: a real camera drops only the first frames
            ok, _frame = cap.read()
            if ok:
                print(f"Using camera index {idx}")
                return cap
        cap.release()
    return None


def already_marked_today(regno: str, today: str) -> bool:
    if not os.path.exists(CSV_PATH):
        return False
    with open(CSV_PATH, newline="") as f:
        for row in csv.DictReader(f):
            if row["regno"] == regno and row["date"] == today:
                return True
    return False


def mark_attendance(regno: str, allow_repeat: bool = False) -> str:
    """Append an attendance row.

    With allow_repeat=False (manual mode) a person is logged at most once per
    day. With allow_repeat=True (auto mode) every call writes a new row, so the
    CSV records the person at each scan cycle's timestamp.
    """
    now = dt.datetime.now()
    today = now.strftime("%Y-%m-%d")
    if not allow_repeat and already_marked_today(regno, today):
        return f"{regno}: already marked today"

    new_file = not os.path.exists(CSV_PATH)
    with open(CSV_PATH, "a", newline="") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(CSV_HEADER)
        w.writerow([regno, today, now.strftime("%H:%M:%S")])
    return f"{regno}: marked at {now.strftime('%H:%M:%S')}"


def main() -> None:
    print("Loading ArcFace model (first run downloads ~300MB, please wait)...")
    rec = FaceRecognizer()
    loaded = rec.load_known_faces()
    if not loaded:
        print("No reference faces loaded from images/. Add <regno>.png files.")
        return
    print(f"Loaded {len(loaded)} known faces: {', '.join(loaded)}")

    cap = open_camera()
    if cap is None:
        print("Could not open any webcam. Try: CAMERA_INDEX=1 python attendance.py")
        return

    if AUTO:
        status = f"AUTO mode: scanning every {INTERVAL:g}s | press q to quit"
        win = "Attendance (AUTO) - q to quit"
    else:
        status = "Press SPACE to mark attendance, q to quit"
        win = "Attendance - SPACE to mark, q to quit"
    print("Webcam open. " + status)

    dropped = 0
    # Scan immediately on the first frame, then every INTERVAL seconds.
    last_scan = time.monotonic() - INTERVAL
    while True:
        ok, frame = cap.read()
        if not ok:
            dropped += 1
            if dropped > 30:  # tolerate transient drops, bail if persistent
                print("Webcam stopped delivering frames.")
                break
            cv2.waitKey(30)
            continue
        dropped = 0

        # Identify every face live so each one gets a labelled box.
        results = rec.identify_all(frame)
        for face, match in results:
            x1, y1, x2, y2 = [int(v) for v in face.bbox]
            if match.regno is not None:
                color, label = (0, 255, 0), f"{match.regno} {match.score:.2f}"
            else:
                color, label = (0, 0, 255), "unknown"
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(
                frame, label, (x1, max(y1 - 8, 12)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2, cv2.LINE_AA,
            )

        # AUTO: log everyone recognised once the interval elapses.
        if AUTO:
            remaining = INTERVAL - (time.monotonic() - last_scan)
            if remaining <= 0:
                recognised = [m for _, m in results if m.regno is not None]
                if recognised:
                    for m in recognised:
                        print(mark_attendance(m.regno, allow_repeat=True))
                    status = (
                        f"Logged {len(recognised)}: "
                        + ", ".join(m.regno for m in recognised)
                    )
                else:
                    status = "Scan: no known face in view"
                    print(status)
                last_scan = time.monotonic()
            else:
                status = f"Next scan in {remaining:0.0f}s | q to quit"

        cv2.putText(
            frame, status, (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
            0.6, (0, 255, 255), 2, cv2.LINE_AA,
        )
        cv2.imshow(win, frame)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):  # q or ESC
            break
        if not AUTO and key in (ord(" "), ord("c")):
            recognised = [m for _, m in results if m.regno is not None]
            if not results:
                status = "No face detected - face the camera"
            elif not recognised:
                status = f"{len(results)} face(s) seen, none recognised"
            else:
                # Mark every recognised person in the frame at once.
                for m in recognised:
                    print(mark_attendance(m.regno))
                status = f"Marked {len(recognised)} person(s): " + ", ".join(
                    m.regno for m in recognised
                )
            print(status)

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
