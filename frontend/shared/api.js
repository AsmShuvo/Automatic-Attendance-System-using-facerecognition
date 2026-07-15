/*
 * Backend API client for the Smart Attendance System.
 *
 * The Python side (a small Flask/FastAPI wrapper around attendance.py) is
 * expected to expose the endpoints below. They don't all exist yet — every
 * call degrades gracefully so the UI is usable before the backend is wired up.
 *
 *   POST  /api/attendance/start   body: { session_minutes }      -> { ok }
 *   POST  /api/attendance/stop                                   -> { ok, csv }
 *   GET   /api/attendance/csv                                    -> text/csv
 *   POST  /api/report/email       body: { teacher_email, report } -> { ok }   (future)
 *
 * The camera capture window opens on the server machine (not in the browser).
 *
 * Loaded as a plain <script> so it also works over file:// — it attaches a
 * single global: window.AttendanceAPI.
 */
(function () {
  // Change this if the backend runs elsewhere. Empty string = same origin.
  const API_BASE = window.ATTENDANCE_API_BASE || "http://localhost:8000";

  async function postJson(path, body) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res.json();
  }

  window.AttendanceAPI = {
    base: API_BASE,

    // Courses + room names for the dashboard dropdowns (no camera URLs exposed).
    async fetchConfig() {
      const res = await fetch(API_BASE + "/api/config");
      if (!res.ok) throw new Error(`config -> HTTP ${res.status}`);
      return res.json();
    },

    // Start a class session. course/room are recorded with the session.
    startAttendance: ({ course, room } = {}) =>
      postJson("/api/attendance/start", { course, room }),

    stopAttendance: () => postJson("/api/attendance/stop"),

    async fetchCsv() {
      const res = await fetch(API_BASE + "/api/attendance/csv");
      if (!res.ok) throw new Error(`csv -> HTTP ${res.status}`);
      return res.text();
    },

    // Persist the aggregated session report (-> db/db.json now, MongoDB later).
    saveReport: (report) => postJson("/api/report/save", report),

    // Most recent saved session report (for the student view).
    async fetchLatestReport() {
      const res = await fetch(API_BASE + "/api/report/latest");
      if (!res.ok) throw new Error(`latest -> HTTP ${res.status}`);
      return res.json();
    },

    // Every saved session report (used to build a student's full history).
    async fetchAllReports() {
      const res = await fetch(API_BASE + "/api/reports");
      if (!res.ok) throw new Error(`reports -> HTTP ${res.status}`);
      return res.json();
    },
  };
})();
