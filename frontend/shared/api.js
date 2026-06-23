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

    startAttendance: (sessionMinutes) =>
      postJson("/api/attendance/start", { session_minutes: sessionMinutes }),

    stopAttendance: () => postJson("/api/attendance/stop"),

    async fetchCsv() {
      const res = await fetch(API_BASE + "/api/attendance/csv");
      if (!res.ok) throw new Error(`csv -> HTTP ${res.status}`);
      return res.text();
    },

    // Email backend is not built yet; this is the contract for later.
    sendReportEmail: (teacherEmail, report) =>
      postJson("/api/report/email", { teacher_email: teacherEmail, report }),
  };
})();
