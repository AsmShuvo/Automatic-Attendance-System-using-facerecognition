"""Flask backend for the Smart Attendance frontend.

The frontend does NOT show the camera. Instead, "Start Attendance" launches the
existing attendance.py in AUTO mode as a subprocess, which opens the familiar
OpenCV capture window on this machine's desktop and writes attendance.csv.
"Stop Attendance" terminates that process and hands the session CSV back.

Endpoints (consumed by frontend/shared/api.js):
    POST /api/attendance/start   { course, room }  -> open capture window
    POST /api/attendance/stop                      -> close window, return CSV
    GET  /api/attendance/csv                        -> latest attendance CSV text
    GET  /api/attendance/status                     -> { running, course, room }
    POST /api/report/save        <report json>     -> append to db/db.json
    GET  /api/reports                              -> all saved session reports
    GET  /api/report/latest                        -> most recent session report

Run (from your desktop session, so the window can appear):
    source venv/bin/activate
    CAMERA_INDEX=1 python backend/server.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys

from flask import Flask, jsonify, request
from flask_cors import CORS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "attendance.csv")
ATTENDANCE_SCRIPT = os.path.join(ROOT, "attendance.py")
MULTICAM_SCRIPT = os.path.join(ROOT, "multicam_attendance.py")
CAMERAS_CONFIG = os.path.join(ROOT, "cameras.json")
# Local stand-in for the future MongoDB Atlas collection (requirement.md §3).
DB_PATH = os.path.join(ROOT, "db", "db.json")

INTERVAL = os.environ.get("INTERVAL", "5")           # seconds between scans
CAMERA_INDEX = os.environ.get("CAMERA_INDEX", "1")   # real webcam node
CAMERA_SOURCE = os.environ.get("CAMERA_SOURCE")      # optional CCTV/RTSP url

app = Flask(__name__)
CORS(app)  # allow the static frontend (any origin) to call this API

# Module-level handle to the running capture process (None when idle).
proc: subprocess.Popen | None = None
started_at: str | None = None
session = {"course": None, "room": None}

def is_running() -> bool:
    return proc is not None and proc.poll() is None


@app.route("/api/attendance/start", methods=["POST"])
def start():
    global proc, started_at, session
    if is_running():
        return jsonify({"ok": True, "already_running": True})

    data = request.get_json(silent=True) or {}
    session = {"course": data.get("course"), "room": data.get("room")}

    # Fresh CSV per session so the report reflects only this class.
    if os.path.exists(CSV_PATH):
        os.remove(CSV_PATH)

    # Launch attendance.py in AUTO mode -> opens the OpenCV capture window.
    env = dict(os.environ)
    env["AUTO"] = "1"
    env["INTERVAL"] = str(INTERVAL)
    env["CAMERA_INDEX"] = str(CAMERA_INDEX)
    if CAMERA_SOURCE:
        env["CAMERA_SOURCE"] = CAMERA_SOURCE
    env.setdefault("DISPLAY", ":0")  # ensure the window has a display

    # Multi-camera (cameras.json present) or single-camera capture.
    script = MULTICAM_SCRIPT if os.path.exists(CAMERAS_CONFIG) else ATTENDANCE_SCRIPT
    log = open(os.path.join(ROOT, "capture.log"), "w")
    try:
        proc = subprocess.Popen(
            [sys.executable, script],
            cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    started_at = dt.datetime.now().isoformat()
    return jsonify({"ok": True, **session})


@app.route("/api/attendance/stop", methods=["POST"])
def stop():
    global proc
    if is_running():
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    proc = None

    csv_text = ""
    if os.path.exists(CSV_PATH):
        with open(CSV_PATH) as f:
            csv_text = f.read()
    return jsonify({"ok": True, "csv": csv_text})


@app.route("/api/attendance/csv", methods=["GET"])
def get_csv():
    if not os.path.exists(CSV_PATH):
        return "regno,date,time\n", 200, {"Content-Type": "text/csv"}
    with open(CSV_PATH) as f:
        return f.read(), 200, {"Content-Type": "text/csv"}


@app.route("/api/attendance/status", methods=["GET"])
def status():
    return jsonify({
        "running": is_running(),
        "started_at": started_at,
        **session,
    })


@app.route("/api/report/save", methods=["POST"])
def save_report():
    """Append an aggregated session report to db/db.json.

    db.json holds a JSON array of session reports (stand-in for the MongoDB
    Atlas collection). Each report matches requirement.md §3:
        { classid, courseName, room, savedAt, attendance: [...] }
    """
    report = request.get_json(silent=True)
    if not report or "attendance" not in report:
        return jsonify({"ok": False, "error": "invalid report payload"}), 400

    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    # Load existing collection (tolerate empty/missing/corrupt file).
    sessions = []
    if os.path.exists(DB_PATH) and os.path.getsize(DB_PATH) > 0:
        try:
            with open(DB_PATH) as f:
                existing = json.load(f)
            sessions = existing if isinstance(existing, list) else [existing]
        except (json.JSONDecodeError, OSError):
            sessions = []

    # Upsert by classid so re-saving the same session overwrites it.
    classid = report.get("classid")
    sessions = [s for s in sessions if s.get("classid") != classid]
    sessions.append(report)

    with open(DB_PATH, "w") as f:
        json.dump(sessions, f, indent=2)

    return jsonify({"ok": True, "classid": classid, "total_sessions": len(sessions)})


def _load_sessions() -> list:
    if os.path.exists(DB_PATH) and os.path.getsize(DB_PATH) > 0:
        try:
            with open(DB_PATH) as f:
                data = json.load(f)
            return data if isinstance(data, list) else [data]
        except (json.JSONDecodeError, OSError):
            return []
    return []


@app.route("/api/reports", methods=["GET"])
def list_reports():
    """All saved session reports (the db.json collection)."""
    return jsonify(_load_sessions())


@app.route("/api/report/latest", methods=["GET"])
def latest_report():
    """The most recently saved session report (for the student view)."""
    sessions = _load_sessions()
    return jsonify(sessions[-1] if sessions else None)


if __name__ == "__main__":
    print("Smart Attendance backend on http://localhost:8000")
    app.run(host="0.0.0.0", port=8000, threaded=True)
