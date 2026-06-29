/* Login page logic — validate, store session, redirect to the dashboard. */
(function () {
  // Already signed in? Skip straight to the dashboard.
  if (Auth.isAuthed()) { window.location.replace("index.html"); return; }

  const form = document.getElementById("loginForm");
  const toast = document.getElementById("loginToast");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (Auth.login(username, password)) {
      window.location.href = "index.html";
    } else {
      toast.textContent = "Enter a username and password.";
      toast.className = "toast err";
    }
  });
})();
