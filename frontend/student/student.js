/* Student view (read-only): look up a reg number and show that student's full
   attendance history (across every saved session in db.json). */
(function () {
  const $ = (id) => document.getElementById(id);

  function setToast(el, msg, kind = "") {
    el.textContent = msg;
    el.className = "toast" + (kind ? " " + kind : "");
  }

  async function lookup() {
    const reg = $("regInput").value.trim();
    if (!reg) { setToast($("toast"), "Enter your registration number.", "err"); return; }

    setToast($("toast"), "Searching all sessions…");

    let sessions;
    try {
      sessions = await AttendanceAPI.fetchAllReports();
    } catch (err) {
      setToast($("toast"), "Could not reach the server. Is the backend running?", "err");
      return;
    }

    // Flatten every session into one row per time this student was detected.
    const rows = [];
    for (const s of sessions || []) {
      for (const a of s.attendance || []) {
        if (a.regno === reg) {
          rows.push({
            regno: a.regno,
            date: a.date,
            startTime: a.startTime,       // kept only for chronological sorting
            courseName: s.courseName || "—",
            room: s.room || "—",
          });
        }
      }
    }

    // Order from beginning to end (by date, then start time).
    rows.sort((x, y) =>
      (x.date + " " + x.startTime).localeCompare(y.date + " " + y.startTime));

    const tbody = $("historyTable").querySelector("tbody");
    tbody.innerHTML = "";
    $("historyCard").style.display = "block";
    $("historyTitle").textContent = `Records · ${reg}`;

    if (!rows.length) {
      $("historyArea").style.display = "none";
      $("historyEmpty").style.display = "block";
      $("historySub").textContent = "Every session you were detected in, oldest to newest.";
      setToast($("toast"), `No records found for ${reg}.`, "err");
      return;
    }

    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="reg">${r.regno}</span></td>
        <td>${r.date}</td>
        <td>${r.courseName}</td>
        <td>${r.room}</td>`;
      tbody.appendChild(tr);
    }
    $("historyArea").style.display = "block";
    $("historyEmpty").style.display = "none";

    const days = new Set(rows.map((r) => r.date)).size;
    $("historySub").textContent =
      `${rows.length} record${rows.length > 1 ? "s" : ""} across ${days} day${days > 1 ? "s" : ""}.`;
    setToast($("toast"), "", "ok");
  }

  $("lookupBtn").addEventListener("click", lookup);
  $("refreshBtn").addEventListener("click", lookup);
  $("regInput").addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });
})();
