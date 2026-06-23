# Face Recognition Attendance

Marks attendance from your webcam using **ArcFace (ResNet-100)** via InsightFace.
Reference photos live in `images/`, named by registration number
(e.g. `2020331051.png`). Matches are recorded in `attendance.csv`.

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

The first run downloads the `buffalo_l` model (~300 MB) into `~/.insightface`.

## Run

```bash
source venv/bin/activate
CAMERA_INDEX=1 python attendance.py
```

`CAMERA_INDEX=1` selects the real webcam (index 0 is often a dead node).

### Manual mode (default)

A webcam window opens:

- **SPACE** or **c** — capture the current frame and mark **everyone** recognised
- **q** or **ESC** — quit

Each person is marked at most once per day.

### Auto mode (hands-free)

```bash
AUTO=1 CAMERA_INDEX=1 python attendance.py            # scan every 15s
AUTO=1 INTERVAL=10 CAMERA_INDEX=1 python attendance.py # custom interval
```

Scans automatically every `INTERVAL` seconds (default 15) and writes a row for
**every** recognised person each cycle — so the CSV records who was present at
each scan time. No keypress needed; press **q** to quit.

### CCTV / IP camera

```bash
CAMERA_SOURCE="rtsp://user:pass@192.168.1.64:554/Streaming/Channels/101" \
  AUTO=1 python attendance.py
```

All recognition output goes to `attendance.csv` (`regno, date, time`).

## Adding people

Create a sub-folder per student, named by registration number, and drop one or
more clear photos of them inside:

```
images/
  2020331070/
    1.png
    2.png
    ...
  2020331072/
    a.jpg
    b.jpg
```

More photos per student (different angles/lighting) = more reliable recognition.
A face is matched to a student if it's similar to *any* of their photos. One
face per photo is best. File extensions don't matter (images are read by
content), but one image = one face. Restart the app after adding people.

## Tuning

`MATCH_THRESHOLD` in `recognizer.py` (default `0.40`) is the cosine-similarity
cutoff. Raise it to reduce false matches, lower it if real faces are rejected.
