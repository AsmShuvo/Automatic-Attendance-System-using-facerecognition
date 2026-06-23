/* Teacher dashboard logic: camera controls, report generation, email mockup. */
(function () {
  const $ = (id) => document.getElementById(id);

  // --- State -------------------------------------------------------------
  let running = false;
  let timerId = null;
  let startedAt = null;
  let rawCsvText = null; // last loaded raw attendance CSV
  let currentReport = null; // last generated report object

  function setToast(el, msg, kind = "") {
    el.textContent = msg;
    el.className = "toast" + (kind ? " " + kind : "");
  }

  // --- A. Camera controls ------------------------------------------------
  function setStatus(state) {
    const dot = $("statusDot"), text = $("statusText");
    if (state === "live") { dot.className = "dot live"; text.textContent = "Live"; }
    else if (state === "off") { dot.className = "dot off"; text.textContent = "Stopped"; }
    else { dot.className = "dot off"; text.textContent = "Idle"; }
  }

  function tickTimer() {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    $("timer").textContent = Report.secToHMS(sec);
  }

  async function startAttendance() {
    const minutes = Number($("sessionMinutes").value) || 60;
    $("startBtn").disabled = true;
    setToast($("camToast"), "Starting camera…");
    try {
      await AttendanceAPI.startAttendance(minutes);
      setToast($("camToast"), "Capture window opened on the server machine. Recognition is running.", "ok");
    } catch (err) {
      // Backend not ready — tell the teacher exactly how to fix it.
      setToast($("camToast"),
        `Could not reach the backend at ${AttendanceAPI.base}. Start it with:  ` +
        `source venv/bin/activate && CAMERA_INDEX=1 python backend/server.py  ` +
        `(running the timer in demo mode for now)`, "err");
    }
    running = true;
    startedAt = Date.now();
    setStatus("live");
    $("stopBtn").disabled = false;
    timerId = setInterval(tickTimer, 1000);
    tickTimer();
  }

  async function stopAttendance() {
    $("stopBtn").disabled = true;
    clearInterval(timerId);
    setStatus("off");
    running = false;
    setToast($("camToast"), "Closing capture window…");
    try {
      const res = await AttendanceAPI.stopAttendance();
      if (res && res.csv) {
        rawCsvText = res.csv; // backend handed us the session CSV
        setToast($("camToast"), "Session stopped. CSV received — generating report…", "ok");
        generateReport();
      } else {
        setToast($("camToast"), "Session stopped.", "ok");
      }
    } catch (err) {
      setToast($("camToast"), "Session stopped (backend unavailable). Load the CSV manually below.", "err");
    }
    $("startBtn").disabled = false;
  }

  // --- B. Report generation ---------------------------------------------
  async function fetchCsvFromServer() {
    setToast($("reportToast"), "Fetching CSV from server…");
    try {
      rawCsvText = await AttendanceAPI.fetchCsv();
      setToast($("reportToast"), "CSV loaded from server.", "ok");
    } catch (err) {
      setToast($("reportToast"), "Could not fetch CSV: " + err.message, "err");
    }
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsText(file);
    });
  }

  async function generateReport() {
    const file = $("csvFile").files[0];
    if (file) rawCsvText = await readFile(file);

    if (!rawCsvText) {
      setToast($("reportToast"), "No CSV yet — load it from the server or pick a file.", "err");
      return;
    }

    const minutes = Number($("sessionMinutes").value) || 0;
    const scans = Report.parseCsv(rawCsvText);
    if (!scans.length) {
      setToast($("reportToast"), "CSV had no usable attendance rows.", "err");
      return;
    }
    currentReport = Report.buildReport(scans, minutes);
    renderReport(currentReport);
    setToast($("reportToast"), `Report generated for ${currentReport.rows.length} student(s).`, "ok");
  }

  function renderReport(report) {
    const tbody = $("reportTable").querySelector("tbody");
    tbody.innerHTML = "";
    for (const r of report.rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.regno}</td>
        <td>${r.enter_time}</td>
        <td>${r.leave_time}</td>
        <td>${r.total_attend_duration}</td>`;
      tbody.appendChild(tr);
    }
    $("reportArea").style.display = "block";
    $("reportMeta").textContent =
      `Session limit: ${Report.secToHMS(report.limitSec)} · threshold 60% = ${Report.secToHMS(report.limitSec * 0.6)}`;
  }

  function downloadReport() {
    if (!currentReport) return;
    const stamp = new Date().toISOString().slice(0, 10);
    Report.download(`attendance_report_${stamp}.csv`, Report.toCsv(currentReport));
  }

  function publishReport() {
    if (!currentReport) return;
    Report.publish(currentReport);
    setToast($("reportToast"), "Published — students can now see it in the Student view.", "ok");
  }

  // --- C. Email mockup ---------------------------------------------------
  function sendReport() {
    const email = $("teacherEmail").value.trim();
    const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    if (!valid) {
      setToast($("emailToast"), "Please enter a valid email address.", "err");
      return;
    }
    if (!currentReport) {
      setToast($("emailToast"), "Generate a report first.", "err");
      return;
    }
    // Static mock — no backend yet.
    setToast($("emailToast"),
      `✓ (Mock) Report for ${currentReport.rows.length} student(s) queued to ${email}. Email backend not built yet.`,
      "ok");
  }

  // --- Wire up -----------------------------------------------------------
  $("startBtn").addEventListener("click", startAttendance);
  $("stopBtn").addEventListener("click", stopAttendance);
  $("fetchCsvBtn").addEventListener("click", fetchCsvFromServer);
  $("generateBtn").addEventListener("click", generateReport);
  $("downloadBtn").addEventListener("click", downloadReport);
  $("publishBtn").addEventListener("click", publishReport);
  $("sendBtn").addEventListener("click", sendReport);
})();
