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

  function toast(el, msg, kind = "") {
    el.textContent = msg;
    el.className = "toast" + (kind ? " " + kind : "");
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

  // --- Wire up -----------------------------------------------------------
  $("startBtn").addEventListener("click", startClass);
  $("stopBtn").addEventListener("click", endClass);
  $("loadCsvBtn").addEventListener("click", loadCsv);
  $("saveBtn").addEventListener("click", saveAttendance);
  $("downloadBtn").addEventListener("click", downloadJson);

  refreshStartEnabled();
})();
