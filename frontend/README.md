# Smart Attendance — Frontend

Vanilla **HTML / CSS / JavaScript** (no build step, no dependencies). Open the
HTML files directly in a browser, or serve the folder statically.

> Note: the brief mentioned "React components" but the Tech Stack section
> specified plain HTML/CSS/JS, so this is built with no framework. It can be
> ported to React component-for-component if needed.

## Structure

```
frontend/
  shared/
    styles.css     Shared design system (dark theme, cards, table, badges)
    api.js         Backend API client  -> window.AttendanceAPI
    report.js      CSV parsing + report math + export -> window.Report
  teacher/
    index.html     Teacher dashboard
    teacher.js     Camera controls, report generation, email mockup
  student/
    index.html     Student dashboard (view-only)
    student.js     Reads the teacher's published report
```

Scripts are loaded with plain `<script>` tags (not ES modules) so everything
works even when opened via `file://`.

## Teacher dashboard (`teacher/index.html`)

1. **Camera Stream & Controls**
   - *Start Attendance* → `POST /api/attendance/start { session_minutes }`,
     starts the elapsed timer and shows the live MJPEG preview.
   - *Stop Attendance* → `POST /api/attendance/stop` (replaces pressing `q`).
     If the backend returns the session CSV, the report is generated
     automatically.
   - If the backend isn't running yet, the controls still work in "demo mode".

2. **Session Report**
   - Load the raw `attendance.csv` from the server (`GET /api/attendance/csv`)
     or pick a file, then **Generate Report**.
   - Per student: `regno | enter_time | leave_time | total_attend_duration | attendance_mark`.
   - `total_attend_duration = leave_time − enter_time`.
   - `attendance_mark = 1` if duration ≥ 60% of the session limit, else `0.5`.
   - **Download Report (CSV)** exports the clean report (opens in Excel).
   - **Publish to Student View** shares it with the student page (via
     `localStorage`, until the backend DB exists).

3. **Send Report (mockup)**
   - Email field + *Send Report*. Static frontend only — wired to
     `POST /api/report/email` for later.

## Student dashboard (`student/index.html`)

View-only. Reads the latest **published** report and lets a student look up
their own row by registration number, plus a read-only class summary.

## Backend contract (to implement next)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/attendance/start` | `{ session_minutes }` → start camera |
| POST | `/api/attendance/stop`  | stop camera, return session CSV |
| GET  | `/api/attendance/csv`   | latest `attendance.csv` as text |
| GET  | `/api/attendance/stream`| MJPEG stream for the live preview |
| POST | `/api/report/email`     | `{ teacher_email, report }` (future) |

Set `window.ATTENDANCE_API_BASE` before `api.js` loads to point at a different
host (defaults to `http://localhost:8000`).

## Run

Just open `frontend/teacher/index.html` in a browser. For the camera stream and
server CSV loading you'll need the backend running; everything else (file
upload, report generation, download, publish, student view, email mockup) works
standalone.
```bash
# optional: serve statically
cd frontend && python3 -m http.server 5500
# then visit http://localhost:5500/teacher/index.html
```
