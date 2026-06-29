# How the Smart Attendance System Works

A plain-language walkthrough of what happens, when, and why — from the camera
all the way to the final attendance report.

---

## The big picture

```
 Camera (Hikvision RTSP)
        │  reads frames ~20×/sec (smooth live video)
        ▼
 multicam_attendance.py ──── every 5 seconds ──▶ run face recognition
        │                                          │
        │                                          ├─ detect every face in the frame
        │                                          ├─ turn each face into a 512-number "faceprint"
        │                                          └─ compare each faceprint to enrolled students
        ▼
 attendance.csv   (one row per recognized student, per 5-second scan)
        │
        │  teacher clicks "Save Attendance"
        ▼
 aggregate → one row per student (startTime = first seen, endTime = last seen)
        ▼
 db/db.json   (the saved session report)
```

There are **two completely different rates** at play, and this is the key idea:

| What | How often | Why |
|------|-----------|-----|
| **Reading frames** from the camera | ~20 times per second | keeps the live video smooth |
| **Running face recognition** | once every **5 seconds** (`INTERVAL`) | detecting + recognizing is expensive, so it's done periodically |

So the video looks live, but recognition (the green boxes + CSV logging) only
happens every 5 seconds. Between scans the boxes sit still — that's normal.

---

## 1. The camera

- A **Hikvision IP camera** streams over the wired network using **RTSP**
  (`rtsp://…@10.100.32.123:554/Streaming/Channels/101`), configured in
  `cameras.json`.
- The stream is opened with OpenCV, forced over **TCP** (more reliable than the
  default UDP on a busy/wired link) with a connect timeout.
- If the camera is briefly unreachable when a class starts, the code **retries
  and auto-reconnects** instead of giving up — the window shows an
  `offline — retrying` tile until the stream comes back.
- Multiple cameras are supported: one background thread per camera, all sharing
  the same recognition model. Right now there's one camera (the Hikvision).

> Code: `open_source()` and `CameraWorker.run()` in `multicam_attendance.py`.

---

## 2. When embeddings are made

An **embedding** (a.k.a. faceprint) is a list of 512 numbers that represents a
face. Two photos of the same person produce nearby embeddings; different people
produce far-apart ones. Embeddings are created in **two places**:

### a) Reference photos — once, at startup
- `images/<regno>/` holds one folder per student (named by registration number)
  with one or more photos each.
- On startup, every photo is turned into an embedding. These are the "known"
  faces to match against.
- This is the slow step (~1.6 s per photo), so the results are **cached to disk**
  in `.embeddings_cache.pkl`. After the first run, startup is near-instant —
  only new or edited photos get re-embedded (the cache is keyed by each file's
  path + modified-time + size).

### b) Live faces — every 5 seconds, during class
- At each scan, every face the camera currently sees is detected and embedded on
  the spot, so it can be compared to the known students.

> Code: `FaceRecognizer.load_known_faces()` / `_embed_file()` (reference photos,
> cached) and `identify_all()` (live faces) in `recognizer.py`.

---

## 3. When comparison happens (recognition)

Every **5 seconds**, for the current frame:

1. **Detect** all faces in the frame (SCRFD detector).
2. **Embed** each detected face into its 512-number faceprint.
3. **Compare** each faceprint against every enrolled student using **cosine
   similarity** (a 0–1 closeness score). A student's score is the *best* match
   across all their reference photos, so any one good photo is enough.
4. **Decide**: if the best score is **≥ 0.40** (`MATCH_THRESHOLD`), that face is
   recognized as that student; otherwise it's labeled `unknown`.

Recognition speed depends on **how many faces are in the frame**, not on how many
students are enrolled — comparing one face against hundreds of students takes
only a few milliseconds. (Enrolling more students mainly costs one-time startup
embedding, which the cache then makes instant.)

> Code: `identify_all()` and `_match_embedding()` in `recognizer.py`.
> Tuning: raise `MATCH_THRESHOLD` to be stricter, lower it to be more lenient.

---

## 4. What gets written during class

Every 5-second scan writes one row **per recognized student** to
`attendance.csv`:

```csv
regno,date,time,camera
2021331106,2026-06-24,14:05:15,hikvision
2021331106,2026-06-24,14:05:20,hikvision
2021331106,2026-06-24,14:05:25,hikvision
2021331079,2026-06-24,14:05:30,hikvision
```

So the CSV is a raw timeline of "who was seen at each scan." A student present
for the whole class appears many times. A **cooldown** prevents the same student
being logged twice in the same cycle when seen by two cameras at once.

> Code: `SharedLogger.mark()` in `multicam_attendance.py`.
> Note: the backend deletes `attendance.csv` at the start of each session, so it
> only ever holds the current class.

---

## 5. How start time & end time are calculated

The raw CSV has many rows per student. When the teacher clicks **Save
Attendance**, the rows are **aggregated into one entry per student**:

- Group all rows by `regno`.
- **`startTime`** = the **earliest** detection time for that student (first time
  the camera recognized them).
- **`endTime`** = the **latest** detection time for that student (last time they
  were recognized).
- **`date`** = the session date.

Example — these raw rows:

```
2021331106 at 14:05:15, 14:05:20, 14:05:25
```

aggregate to:

```json
{ "regno": "2021331106", "date": "2026-06-24",
  "startTime": "14:05:15", "endTime": "14:05:25" }
```

So **start/end time are simply the first and last moments the system recognized
that face** during the class — not a login/logout. If someone is only ever seen
in a single scan, their start and end times are the same.

> Code: `Report.aggregate()` in `frontend/shared/report.js`.

---

## 6. Saving the report

The aggregated result is compiled into one session report and saved:

```json
{
  "classid": "303_CSE101_2026-06-24_14:05:15",
  "courseName": "CSE101",
  "room": "303",
  "savedAt": "2026-06-24T14:30:00Z",
  "attendance": [
    { "regno": "2021331106", "date": "2026-06-24", "startTime": "14:05:15", "endTime": "14:05:25" },
    { "regno": "2021331079", "date": "2026-06-24", "startTime": "14:05:30", "endTime": "14:05:36" }
  ]
}
```

- `classid` is built as `room_course_date_firstStartTime`.
- For now it's stored locally in **`db/db.json`** (a JSON array of sessions);
  later this becomes a **MongoDB Atlas** collection.
- Re-saving the same `classid` overwrites that session instead of duplicating it.
- The **student view** reads the latest saved session and lets a student look up
  their own start/end time by registration number.

> Code: `POST /api/report/save` in `backend/server.py`; student page in
> `frontend/student/`.

---

## Timeline of one class

1. Teacher signs in, picks **Course** + **Room**, clicks **Start Class**.
2. Backend launches the capture process; the model loads (instant if cached) and
   the camera window opens.
3. Every **5 s**: detect faces → embed → compare to students → log the
   recognized ones to `attendance.csv`.
4. Teacher clicks **End Class** → capture stops, the CSV is handed back.
5. Teacher clicks **Save Attendance** → rows are aggregated into
   first-seen/last-seen per student and saved to `db/db.json`.
6. Students can look up their attendance in the student view.

---

## Key settings (where to change them)

| Setting | Default | Where |
|---------|---------|-------|
| Scan interval | **5 s** | `INTERVAL` env var / defaults in `multicam_attendance.py`, `backend/server.py` |
| Match strictness | **0.40** | `MATCH_THRESHOLD` in `recognizer.py` |
| Cameras | Hikvision RTSP | `cameras.json` |
| Detector input size | 640×640 | `det_size` in `recognizer.py` (raise it to catch smaller/farther faces) |
