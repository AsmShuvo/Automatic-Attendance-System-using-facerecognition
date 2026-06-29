/* Student view (read-only): shows the latest saved session from the backend. */
(function () {
  const $ = (id) => document.getElementById(id);
  let report = null;  // { classid, courseName, room, savedAt, attendance: [...] }

  function setToast(el, msg, kind = "") {
    el.textContent = msg;
    el.className = "toast" + (kind ? " " + kind : "");
  }

  function timeToSec(t) {
    const [h, m, s = 0] = String(t).split(":").map(Number);
    return h * 3600 + m * 60 + s;
  }
  function duration(rec) {
    return Report.secToHMS(Math.max(0, timeToSec(rec.endTime) - timeToSec(rec.startTime)));
  }

  async function loadReport() {
    setToast($("summaryToast"), "Loading latest session…");
    try {
      report = await AttendanceAPI.fetchLatestReport();
    } catch (err) {
      report = null;
      setToast($("summaryToast"), "Could not reach the server. Is the backend running?", "err");
      return;
    }

    const tbody = $("summaryTable").querySelector("tbody");
    tbody.innerHTML = "";

    if (!report || !report.attendance || !report.attendance.length) {
      $("summaryArea").style.display = "none";
      $("summaryEmpty").style.display = "block";
      setToast($("summaryToast"), "No saved session yet. Ask your teacher to save attendance.", "");
      return;
    }

    for (const r of report.attendance) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="reg">${r.regno}</span></td>
        <td>${r.date}</td>
        <td>${r.startTime}</td>
        <td>${r.endTime}</td>
        <td>${duration(r)}</td>`;
      tbody.appendChild(tr);
    }
    $("summaryArea").style.display = "block";
    $("summaryEmpty").style.display = "none";

    const title = [report.courseName, report.room ? "Room " + report.room : ""].filter(Boolean).join(" · ");
    $("summaryTitle").textContent = title || "Latest session";
    const when = report.savedAt ? new Date(report.savedAt).toLocaleString() : "";
    setToast($("summaryToast"), `${report.attendance.length} students · saved ${when}`, "ok");
  }

  function lookup() {
    if (!report || !report.attendance) { setToast($("toast"), "No saved session yet.", "err"); return; }
    const reg = $("regInput").value.trim();
    if (!reg) { setToast($("toast"), "Enter your registration number.", "err"); return; }

    const r = report.attendance.find((x) => x.regno === reg);
    if (!r) {
      $("myCard").style.display = "none";
      setToast($("toast"), `No record for ${reg} — you were not detected in the latest session.`, "err");
      return;
    }
    $("myTitle").textContent = `Record · ${r.regno}`;
    $("myStart").textContent = r.startTime;
    $("myEnd").textContent = r.endTime;
    $("myDuration").textContent = duration(r);
    $("myStatus").innerHTML = `<span class="badge full">Present</span>`;
    $("myCard").style.display = "block";
    setToast($("toast"), "", "");
  }

  $("lookupBtn").addEventListener("click", lookup);
  $("refreshBtn").addEventListener("click", loadReport);
  $("regInput").addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });

  loadReport();
})();
