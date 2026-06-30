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

### a) Reference photos — once, with `create_embedd.py`
- `images/<regno>/` holds one folder per student (named by registration number)
  with one or more photos each.
- You run **`python create_embedd.py` once**. It turns every photo into an
  embedding and saves them all permanently to **`embeddings.pkl`**.
- This is the slow step (~1.6 s per photo), but it only happens when you run that
  script — **not** every time the server starts.
- The server (`recognizer.py`) then just **loads `embeddings.pkl` instantly**
  (~0.001 s) on each start. Re-run `create_embedd.py` only when you add, remove,
  or change student photos (the server warns you if `images/` changed since the
  embeddings were built).

### b) Live faces — every 5 seconds, during class
- At each scan, every face the camera currently sees is detected and embedded on
  the spot, so it can be compared to the known students.

> Code: `create_embedd.py` + `FaceRecognizer.build_known_faces()` (build &
> save reference photos), `load_known_faces()` (load `embeddings.pkl`), and
> `identify_all()` (live faces) in `recognizer.py`.

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
2. Backend launches the capture process; the face model loads and the prebuilt
   `embeddings.pkl` loads instantly, then the camera window opens.
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
| Cameras | Hikvision + GTech RTSP | `cameras.json` |
| Detector input size | 640×640 | `det_size` in `recognizer.py` (raise it to catch smaller/farther faces) |

---

## The recognition system in detail

### Which model

The system uses **InsightFace** with the **`buffalo_l`** model pack, which is two
neural networks working together:

1. **SCRFD** (`det_10g.onnx`) — the **face detector**. Given an image, it finds
   *where* the faces are (bounding boxes + 5 landmark points), even for many
   faces at once. The frame is resized to **640×640** before detection
   (`det_size`).
2. **ArcFace** (`w600k_r50.onnx`) — the **face recognizer**. It's a **ResNet-50**
   trained on the WebFace600K dataset. Given one aligned face crop, it outputs a
   **512-number embedding** (faceprint). Faces of the same person land close
   together in this 512-D space; different people land far apart.

Both run through **ONNX Runtime** on the **CPU** (`CPUExecutionProvider`). No
internet or cloud is involved — everything runs locally. The model files live in
`~/.insightface/models/buffalo_l/` (downloaded once on first install).

### How it's used (the pipeline per scan)

```
camera frame
   │
   ▼  SCRFD detector  (resize to 640×640, find all faces)
faces[]  → for each face:
   │
   ▼  ArcFace  (align the face to 112×112, run ResNet-50)
512-D embedding
   │
   ▼  cosine similarity vs every enrolled student's embeddings
best match score
   │
   ▼  score ≥ 0.40 ?  → recognized as that student : "unknown"
```

- **Enrolled students** are embedded once by `create_embedd.py` and stored in
  `embeddings.pkl`. At runtime only **live faces** are embedded.
- **Matching** is plain math: the dot product of two 512-number vectors. Comparing
  one face against hundreds of students takes only a few **milliseconds**.
- Why ArcFace is good: it was trained so that the *angle* between embeddings is a
  reliable identity signal — it's one of the most accurate open face-recognition
  models available, and it generalizes to people it never saw in training (you
  only give it a few photos per student).

> Code: `recognizer.py` (`FaceRecognizer`), model pack chosen in `__init__`.

---

## Will it work with 4 cameras?

**Yes.** The design already supports it — `cameras.json` just takes more entries:

```json
[
  { "name": "front-left",  "source": "rtsp://…/…" },
  { "name": "front-right", "source": "rtsp://…/…" },
  { "name": "back-left",   "source": "rtsp://…/…" },
  { "name": "back-right",  "source": "rtsp://…/…" }
]
```

What happens with 4 cameras:

- **One thread per camera.** Each opens its own stream and reads frames
  independently (`CameraWorker`).
- **Scans are staggered.** With a 5 s interval and 4 cameras, each camera scans at
  a different offset (0 s, 1.25 s, 2.5 s, 3.75 s) so they don't all hit the CPU at
  the same instant.
- **One shared model.** All threads share a single loaded model, guarded by a lock
  (`rec_lock`) — the CPU runs one recognition at a time anyway, so this avoids
  thrashing.
- **Merged results.** A student seen by *any* camera is marked present; a student
  seen by two cameras in the same cycle is logged **once** (the `SharedLogger`
  cooldown dedups across cameras by registration number).
- **Tiled display.** The window auto-arranges into a grid (4 cameras → 2×2).
- **Auto-reconnect.** If any camera drops, its tile shows `offline — retrying` and
  reconnects on its own without affecting the others.

### The real limit: CPU, not the code

The bottleneck is **decoding + recognizing** on the CPU. Rough budget per scan:

```
detect (1 frame) ~0.2s  +  embed each visible face ~0.07s  +  match ~0.003s/face
```

The concern with 4 cameras is **continuous video decoding**. Four 6-MP H.265/H.264
streams decoded nonstop is heavy for a CPU. If the machine can't keep up you'll
see lag, dropped frames, or rising latency — **not wrong answers**, just slowness.

Practical guidance:

- **4 cameras at sub-stream resolution (e.g. 720p): comfortable on a typical CPU.**
- **4 cameras at full 6-MP main-stream: heavy** — works, but may lag on a laptop
  CPU. Use sub-streams, or a GPU (below).
- Recognition cost scales with **faces actually visible**, not the number of
  cameras or enrolled students. 4 cameras showing 25 students each = 100 face
  embeddings per full cycle, spread across the staggered 5 s — manageable.

---

## Making it faster / better

### Faster (more cameras, less lag)

1. **Use camera sub-streams.** Every IP camera sends a second, lower-resolution
   stream. Decoding 720p instead of 6-MP is several times cheaper and barely hurts
   recognition for nearby faces. Biggest single win for multi-camera setups.
   *(Hikvision: `…/Streaming/Channels/102`; XiongMai: `…&stream=1.sdp`.)*
2. **Add a GPU.** Switch `CPUExecutionProvider` → `CUDAExecutionProvider` (with
   `onnxruntime-gpu`). Face embedding drops from ~70 ms to ~5 ms — a 10×+ speedup
   that makes many cameras and crowded frames trivial. *(One line in
   `recognizer.py`.)*
3. **Lengthen the scan interval** if you don't need 5 s granularity. `INTERVAL=10`
   halves the recognition workload.
4. **Vectorize matching.** Replace the per-student Python loop with a single matrix
   multiply (all embeddings at once). Minor at hundreds of students, but free.
5. **Lower `det_size`** (e.g. 480) for faster detection — but this *reduces* the
   ability to see small/far faces, so it's a trade-off, not a free win.

### Better recognition (more accurate attendance)

1. **More reference photos per student.** 3–5 photos covering different angles,
   lighting, and with/without glasses dramatically improves reliability (a face
   matches if it's close to *any* stored photo). Re-run `create_embedd.py` after
   adding them.
2. **Raise `det_size`** (e.g. 1024 or 1280) to detect **smaller / farther** faces
   — important for back rows in a large classroom. Costs more CPU per scan but
   catches students a 640 input would miss.
3. **Tune `MATCH_THRESHOLD`.** Raise it (e.g. 0.45) if different students get
   confused (fewer false matches); lower it (e.g. 0.35) if real students are
   missed. 0.40 is a balanced default.
4. **Camera placement & resolution.** A face needs to be roughly **≥100 px** wide
   and reasonably front-facing to recognize well. Multiple cameras at good angles
   (front + sides) beat one wide shot — which is exactly why 4 cameras help: they
   give each student at least one clear, large, frontal view.
5. **Good lighting.** Even, front-ish lighting helps far more than any setting.
   Strong backlight (a bright window behind students) is the usual culprit for
   missed faces.

### Quick recommendation

For a full classroom with 4 cameras: run cameras on **sub-streams**, raise
`det_size` to ~960–1024 so back-row faces are still caught, give each student
3–5 varied reference photos, and — if you want it to fly — move recognition to a
**GPU**. That combination is both faster *and* more accurate than the current
single-CPU, full-resolution default.
