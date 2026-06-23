/* Student dashboard (view-only): reads the report the teacher published. */
(function () {
  const $ = (id) => document.getElementById(id);
  let report = null;

  function setToast(el, msg, kind = "") {
    el.textContent = msg;
    el.className = "toast" + (kind ? " " + kind : "");
  }

  function markBadge(mark) {
    const full = mark === 1;
    return `<span class="badge ${full ? "full" : "partial"}">${mark} · ${full ? "Full" : "Partial"}</span>`;
  }

  function loadReport() {
    report = Report.loadPublished();
    const tbody = $("summaryTable").querySelector("tbody");
    tbody.innerHTML = "";

    if (!report || !report.rows.length) {
      setToast($("summaryToast"), "No published session yet. Ask your teacher to publish a report.", "err");
      return;
    }
    for (const r of report.rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.regno}</td>
        <td>${r.enter_time}</td>
        <td>${r.leave_time}</td>
        <td>${r.total_attend_duration}</td>
        <td>${markBadge(r.attendance_mark)}</td>`;
      tbody.appendChild(tr);
    }
    const when = report.generatedAt ? new Date(report.generatedAt).toLocaleString() : "";
    setToast($("summaryToast"), `Latest session · ${report.rows.length} students · generated ${when}`, "ok");
  }

  function lookup() {
    if (!report) { setToast($("toast"), "No published session yet.", "err"); return; }
    const reg = $("regInput").value.trim();
    if (!reg) { setToast($("toast"), "Enter your registration number.", "err"); return; }

    const r = report.rows.find((x) => x.regno === reg);
    if (!r) {
      $("myCard").style.display = "none";
      setToast($("toast"), `No record found for ${reg} in the latest session.`, "err");
      return;
    }
    $("myTitle").textContent = `Record · ${r.regno}`;
    $("myEnter").textContent = r.enter_time;
    $("myLeave").textContent = r.leave_time;
    $("myDuration").textContent = r.total_attend_duration;
    $("myMark").innerHTML = markBadge(r.attendance_mark);
    $("myCard").style.display = "block";
    setToast($("toast"), "", "");
  }

  $("lookupBtn").addEventListener("click", lookup);
  $("refreshBtn").addEventListener("click", loadReport);
  $("regInput").addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });

  loadReport();
})();
