/*
 * Report engine: turns the raw attendance.csv (one row per recognised scan)
 * into a per-student session report.
 *
 * Raw CSV columns (produced by attendance.py):   regno, date, time
 * Report columns:  regno | enter_time | leave_time | total_attend_duration | attendance_mark
 *
 * Rules (from the spec):
 *   total_attend_duration = leave_time - enter_time
 *   attendance_mark = 1   if duration >= 60% of the session limit  (Full)
 *                     0.5  otherwise                                (Partial)
 *
 * Loaded as a plain <script>; attaches window.Report.
 */
(function () {
  const STORAGE_KEY = "attendance.report.v1";

  function timeToSec(t) {
    const parts = String(t).trim().split(":").map(Number);
    if (parts.some(isNaN) || parts.length < 2) return null;
    const [h, m, s = 0] = parts;
    return h * 3600 + m * 60 + s;
  }

  function secToHMS(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }

  // Parse raw attendance CSV text -> [{ regno, date, time }]
  function parseCsv(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const rows = [];
    let start = 0;
    if (/regno/i.test(lines[0])) start = 1; // skip header if present
    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      if (cols.length < 3) continue;
      const [regno, date, time] = cols;
      if (timeToSec(time) === null) continue;
      rows.push({ regno, date, time });
    }
    return rows;
  }

  /*
   * Build the report.
   *   scans          : output of parseCsv()
   *   sessionMinutes : teacher-entered session length. If falsy, the session
   *                    limit is inferred from the data (latest leave - earliest
   *                    enter across all students).
   */
  function buildReport(scans, sessionMinutes) {
    const byStudent = new Map();
    for (const r of scans) {
      const sec = timeToSec(r.time);
      if (!byStudent.has(r.regno)) byStudent.set(r.regno, []);
      byStudent.get(r.regno).push(sec);
    }

    // Determine the session limit (in seconds).
    let limitSec = Number(sessionMinutes) > 0 ? Number(sessionMinutes) * 60 : 0;
    if (!limitSec) {
      let minEnter = Infinity, maxLeave = -Infinity;
      for (const secs of byStudent.values()) {
        minEnter = Math.min(minEnter, ...secs);
        maxLeave = Math.max(maxLeave, ...secs);
      }
      limitSec = isFinite(minEnter) ? Math.max(1, maxLeave - minEnter) : 1;
    }

    const rows = [];
    for (const [regno, secs] of byStudent) {
      secs.sort((a, b) => a - b);
      const enterSec = secs[0];
      const leaveSec = secs[secs.length - 1];
      const durationSec = Math.max(0, leaveSec - enterSec);
      const mark = durationSec >= 0.6 * limitSec ? 1 : 0.5;
      rows.push({
        regno,
        enter_time: secToHMS(enterSec),
        leave_time: secToHMS(leaveSec),
        total_attend_duration: secToHMS(durationSec),
        durationSec,
        attendance_mark: mark,
      });
    }
    rows.sort((a, b) => a.regno.localeCompare(b.regno));
    return { rows, limitSec, generatedAt: new Date().toISOString() };
  }

  // Report object -> clean CSV string (the downloadable/Excel-openable report).
  function toCsv(report) {
    const header = [
      "regno",
      "enter_time",
      "leave_time",
      "total_attend_duration",
    ];
    const lines = [header.join(",")];
    for (const r of report.rows) {
      lines.push(
        [r.regno, r.enter_time, r.leave_time, r.total_attend_duration].join(",")
      );
    }
    return lines.join("\n");
  }

  // Trigger a browser download of text content.
  function download(filename, text, mime = "text/csv") {
    const blob = new Blob([text], { type: mime + ";charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Bridge teacher -> student without a backend: publish/read via localStorage.
  function publish(report) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(report));
  }
  function loadPublished() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  window.Report = {
    parseCsv,
    buildReport,
    toCsv,
    download,
    publish,
    loadPublished,
    secToHMS,
  };
})();
