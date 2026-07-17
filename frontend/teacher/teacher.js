/* Teacher dashboard: auth guard, class setup, session control, save report. */
(function () {
  // --- Auth guard --------------------------------------------------------
  if (!Auth.requireAuth("login.html")) return;

  const $ = (id) => document.getElementById(id);

  // --- Config: courses & rooms come from the backend (config.json). These are
  //     only fallbacks shown if the backend can't be reached. -----------------
  const FALLBACK_COURSES = ["CSE101", "CSE205", "CSE311", "CSE413", "EEE101", "MAT201"];
  const FALLBACK_ROOMS = ["G1", "G2"];

  // --- State -------------------------------------------------------------
  let running = false;
  let timerId = null;
  let startedAt = null;
  let rawCsvText = null;     // raw attendance CSV from the session
  let currentReport = null;  // aggregated report object
  let lastHistory = null;    // last viewed history: { course, room, date, rows }

  function toast(el, msg, kind = "") {
    el.textContent = msg;
    el.className = "toast" + (kind ? " " + kind : "");
  }

  // "HH:MM:SS" -> seconds since midnight.
  function timeToSec(t) {
    const [h, m, s = 0] = String(t).split(":").map(Number);
    return h * 3600 + m * 60 + s;
  }

  // --- Init UI -----------------------------------------------------------
  function fillSelect(sel, items) {
    // keep the disabled placeholder (first option), drop the rest, then refill
    while (sel.options.length > 1) sel.remove(1);
    for (const v of items) {
      const o = document.createElement("option");
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    }
  }

  // Populate dropdowns from the backend; fall back to defaults if it's down.
  async function loadDropdowns() {
    let courses = FALLBACK_COURSES, rooms = FALLBACK_ROOMS;
    try {
      const cfg = await AttendanceAPI.fetchConfig();
      if (cfg.courses && cfg.courses.length) courses = cfg.courses;
      if (cfg.rooms && cfg.rooms.length) rooms = cfg.rooms;
    } catch (_) {
      toast($("camToast"), "Backend offline — showing default course/room list.", "");
    }
    fillSelect($("course"), courses);
    fillSelect($("room"), rooms);
    fillSelect($("histCourse"), courses);
    fillSelect($("histRoom"), rooms);
  }
  loadDropdowns();

  const who = Auth.current();
  $("who").textContent = who ? `Signed in as ${who.username}` : "";

  $("logoutLink").addEventListener("click", (e) => {
    e.preventDefault();
    Auth.logout();
    window.location.replace("login.html");
  });

  // --- Class setup: enable Start only when course + room chosen ----------
  function selection() {
    return { course: $("course").value, room: $("room").value };
  }
  function refreshStartEnabled() {
    const { course, room } = selection();
    $("startBtn").disabled = running || !course || !room;
  }
  $("course").addEventListener("change", refreshStartEnabled);
  $("room").addEventListener("change", refreshStartEnabled);

  // --- Status helpers ----------------------------------------------------
  function setStatus(state) {
    const dot = $("statusDot"), text = $("statusText");
    if (state === "live") { dot.className = "dot live"; text.textContent = "Live"; }
    else if (state === "off") { dot.className = "dot off"; text.textContent = "Ended"; }
    else { dot.className = "dot off"; text.textContent = "Idle"; }
  }
  function tickTimer() {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    $("timer").textContent = Report.secToHMS(sec);
  }

  // --- A. Start / End class ---------------------------------------------
  async function startClass() {
    const { course, room } = selection();
    if (!course || !room) return;

    $("startBtn").disabled = true;
    $("course").disabled = true;
    $("room").disabled = true;
    $("classLabel").textContent = `${course} · Room ${room}`;
    toast($("camToast"), "Starting session…");

    let res = null, netError = false;
    try {
      res = await AttendanceAPI.startAttendance({ course, room });
    } catch (err) {
      netError = true;
    }

    // Definitive config error (e.g. no cameras configured for this room).
    if (res && res.ok === false) {
      toast($("camToast"), res.error || "Could not start the session.", "err");
      $("course").disabled = false;
      $("room").disabled = false;
      refreshStartEnabled();
      return;  // don't enter "live" state
    }

    if (netError) {
      toast($("camToast"),
        `Could not reach the backend at ${AttendanceAPI.base}. ` +
        `Start it with: source venv/bin/activate && python backend/server.py`, "err");
    } else {
      const cams = (res && res.cameras) || [];
      const list = cams.length ? ` (${cams.join(", ")})` : "";
      toast($("camToast"), `Capture window opened on the server${list}. Recognition is running.`, "ok");
    }

    running = true;
    startedAt = Date.now();
    setStatus("live");
    $("stopBtn").disabled = false;
    timerId = setInterval(tickTimer, 1000);
    tickTimer();
  }

  async function endClass() {
    $("stopBtn").disabled = true;
    clearInterval(timerId);
    setStatus("off");
    running = false;
    toast($("camToast"), "Ending session…");

    try {
      const res = await AttendanceAPI.stopAttendance();
      if (res && typeof res.csv === "string") rawCsvText = res.csv;
      toast($("camToast"), "Session ended. Click “Save Attendance” to aggregate the report.", "ok");
    } catch (err) {
      toast($("camToast"), "Session ended (backend unavailable). Use “Load latest CSV”.", "err");
    }

    // Re-enable setup for the next class; allow saving this one.
    $("course").disabled = false;
    $("room").disabled = false;
    $("saveBtn").disabled = false;
    refreshStartEnabled();
  }

  // --- B. Load CSV / Save report ----------------------------------------
  async function loadCsv() {
    toast($("reportToast"), "Fetching latest CSV…");
    try {
      rawCsvText = await AttendanceAPI.fetchCsv();
      $("saveBtn").disabled = false;
      toast($("reportToast"), "CSV loaded. Click “Save Attendance” to build the report.", "ok");
    } catch (err) {
      toast($("reportToast"), "Could not fetch CSV: " + err.message, "err");
    }
  }

  async function saveAttendance() {
    if (!rawCsvText) {
      toast($("reportToast"), "No attendance data yet — end a class or load a CSV first.", "err");
      return;
    }
    const scans = Report.parseCsv(rawCsvText);
    if (!scans.length) {
      toast($("reportToast"), "The CSV had no usable detection rows.", "err");
      return;
    }

    const { course, room } = selection();
    currentReport = Report.aggregate(scans, { course, room });
    renderReport(currentReport);
    $("downloadBtn").disabled = false;
    $("emailReportBtn").disabled = !currentReport.attendance.length;

    // Persist to db/db.json via the backend.
    try {
      await AttendanceAPI.saveReport(currentReport);
      toast($("reportToast"),
        `Saved ${currentReport.attendance.length} student(s) — classid ${currentReport.classid}`, "ok");
    } catch (err) {
      toast($("reportToast"),
        `Report built (${currentReport.attendance.length} student(s)) but could not save to server: ${err.message}`, "err");
    }
  }

  function renderReport(report) {
    const tbody = $("reportTable").querySelector("tbody");
    tbody.innerHTML = "";
    for (const r of report.attendance) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="reg">${r.regno}</span></td>
        <td>${r.date}</td>
        <td>${r.startTime}</td>
        <td>${r.endTime}</td>`;
      tbody.appendChild(tr);
    }
    $("reportEmpty").style.display = report.attendance.length ? "none" : "block";
    $("reportArea").style.display = report.attendance.length ? "block" : "none";
    $("reportMeta").textContent = report.classid ? `classid: ${report.classid}` : "";
  }

  function downloadJson() {
    if (!currentReport) return;
    const name = `${currentReport.classid || "session"}.json`;
    Report.download(name, JSON.stringify(currentReport, null, 2), "application/json");
  }

  // --- C. Attendance history --------------------------------------------
  async function viewHistory() {
    const course = $("histCourse").value;
    const room = $("histRoom").value;
    const date = $("histDate").value;   // yyyy-mm-dd (empty if not chosen)

    if (!course || !room || !date) {
      toast($("histToast"), "Select a course, room, and date first.", "err");
      return;
    }

    toast($("histToast"), "Loading attendance…");
    let sessions;
    try {
      sessions = await AttendanceAPI.fetchAllReports();
    } catch (err) {
      toast($("histToast"), "Could not reach the server. Is the backend running?", "err");
      return;
    }

    // Collect rows for sessions matching course + room on that date. For each
    // session, the class span = earliest first-seen to latest last-seen across
    // its attendees; each student's duration = their (last - first) seen.
    const rows = [];
    for (const s of sessions || []) {
      if (s.courseName !== course || s.room !== room) continue;
      const att = (s.attendance || []).filter((a) => a.date === date);
      if (!att.length) continue;

      let minStart = Infinity, maxEnd = -Infinity;
      for (const a of att) {
        minStart = Math.min(minStart, timeToSec(a.startTime));
        maxEnd = Math.max(maxEnd, timeToSec(a.endTime));
      }
      const totalSec = Math.max(0, maxEnd - minStart);

      for (const a of att) {
        const attendSec = Math.max(0, timeToSec(a.endTime) - timeToSec(a.startTime));
        rows.push({
          regno: a.regno,
          courseName: s.courseName,
          room: s.room,
          date: a.date,
          startTime: a.startTime,
          endTime: a.endTime,
          attendMin: Math.round(attendSec / 60),
          totalMin: Math.round(totalSec / 60),
          pct: totalSec > 0 ? Math.round((attendSec / totalSec) * 100) : 0,
        });
      }
    }

    rows.sort((x, y) => x.startTime.localeCompare(y.startTime) || x.regno.localeCompare(y.regno));

    const tbody = $("histTable").querySelector("tbody");
    tbody.innerHTML = "";

    if (!rows.length) {
      $("histArea").style.display = "none";
      $("histEmpty").style.display = "block";
      $("histMeta").textContent = "";
      lastHistory = null;
      $("emailHistBtn").disabled = true;
      toast($("histToast"), `No attendance for ${course} · Room ${room} on ${date}.`, "");
      return;
    }

    lastHistory = { course, room, date, rows };
    $("emailHistBtn").disabled = false;

    for (const r of rows) {
      const cls = r.pct >= 75 ? "full" : "partial";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="reg">${r.regno}</span></td>
        <td>${r.courseName}</td>
        <td>${r.room}</td>
        <td>${r.date}</td>
        <td>${r.startTime}</td>
        <td>${r.endTime}</td>
        <td>${r.attendMin}/${r.totalMin} min <span class="badge ${cls}">${r.pct}%</span></td>`;
      tbody.appendChild(tr);
    }
    $("histArea").style.display = "block";
    $("histEmpty").style.display = "none";
    $("histMeta").textContent = `${rows.length} student${rows.length > 1 ? "s" : ""} present`;
    toast($("histToast"), "", "ok");
  }

  // --- D. Email a report -------------------------------------------------
  async function sendEmail({ inputId, toastEl, btnId, payload }) {
    const to = $(inputId).value.trim();
    if (!to || !to.includes("@")) {
      toast(toastEl, "Enter a valid email address.", "err");
      return;
    }
    const btn = $(btnId);
    btn.disabled = true;
    toast(toastEl, `Sending report to ${to}…`);
    try {
      const res = await AttendanceAPI.emailReport({ ...payload, to });
      toast(toastEl, `Report sent to ${res.sent_to} (${res.count} student(s)).`, "ok");
    } catch (err) {
      toast(toastEl, "Could not send: " + err.message, "err");
    } finally {
      btn.disabled = false;
    }
  }

  function emailSessionReport() {
    if (!currentReport || !currentReport.attendance.length) {
      toast($("reportToast"), "Save an attendance report first.", "err");
      return;
    }
    const { course, room } = selection();
    sendEmail({
      inputId: "reportEmail",
      toastEl: $("reportToast"),
      btnId: "emailReportBtn",
      payload: {
        course: course || currentReport.courseName,
        room: room || currentReport.room,
        date: currentReport.attendance[0] ? currentReport.attendance[0].date : "",
        rows: currentReport.attendance,
      },
    });
  }

  function emailHistory() {
    if (!lastHistory) {
      toast($("histToast"), "Load an attendance history first.", "err");
      return;
    }
    sendEmail({
      inputId: "histEmail",
      toastEl: $("histToast"),
      btnId: "emailHistBtn",
      payload: {
        course: lastHistory.course,
        room: lastHistory.room,
        date: lastHistory.date,
        rows: lastHistory.rows,
      },
    });
  }

  // --- Wire up -----------------------------------------------------------
  $("startBtn").addEventListener("click", startClass);
  $("stopBtn").addEventListener("click", endClass);
  $("loadCsvBtn").addEventListener("click", loadCsv);
  $("saveBtn").addEventListener("click", saveAttendance);
  $("downloadBtn").addEventListener("click", downloadJson);
  $("histBtn").addEventListener("click", viewHistory);
  $("emailReportBtn").addEventListener("click", emailSessionReport);
  $("emailHistBtn").addEventListener("click", emailHistory);

  refreshStartEnabled();
})();
