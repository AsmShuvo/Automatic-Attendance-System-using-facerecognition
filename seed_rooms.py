"""Seed / manage room camera configs in MongoDB.

Usage:
    python seed_rooms.py            # insert the default rooms below
    python seed_rooms.py --list     # show what's currently stored

Edit ROOMS to add your own rooms, then run this once. The backend reads these
when a teacher picks a room.
"""
from __future__ import annotations

import sys

from backend import db

# room -> cameras (name + RTSP/HTTP source).
# Add a room here (with its cameras) and re-run this script to register it.
ROOMS = {
    "G1": [
        {"name": "hikvision", "source": "rtsp://admin:sarwarR45@10.100.32.123:554/Streaming/Channels/101"},
    ],
    "G2": [
        {"name": "gtech", "source": "rtsp://admin:chonchol72@10.100.32.124:554/user=admin&password=chonchol72&channel=1&stream=0.sdp?"},
    ],
    # DroidCam on a phone over Wi-Fi (MJPEG stream at /video).
    "Lab": [
        {"name": "droidcam", "source": "http://192.168.201.45:4747/video"},
    ],
}


def main() -> None:
    if not db.is_up():
        print(f"Cannot reach MongoDB at {db.MONGO_URI}. Is mongod running?")
        sys.exit(1)

    if "--list" in sys.argv:
        for room in (db.list_rooms() or []):
            cams = db.get_room_cameras(room) or []
            print(f"{room}: {[c['name'] for c in cams]}")
        return

    for room, cameras in ROOMS.items():
        ok = db.upsert_room(room, cameras)
        names = [c["name"] for c in cameras]
        print(f"{'✓' if ok else '✗'} {room}: {names}")
    print("\nStored. The backend will now use MongoDB for these rooms.")


if __name__ == "__main__":
    main()
