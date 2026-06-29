/*
 * Tiny client-side auth for the teacher portal (demo only — no real backend
 * auth yet). A successful "login" stores a session in localStorage; the
 * dashboard calls Auth.requireAuth() to bounce anonymous visitors to login.
 *
 * Loaded as a plain <script>; attaches window.Auth.
 */
(function () {
  const KEY = "attendance.session.v1";

  window.Auth = {
    // Demo login: accepts any non-empty username/password.
    login(username, password) {
      if (!username || !password) return false;
      localStorage.setItem(KEY, JSON.stringify({ username, at: Date.now() }));
      return true;
    },
    logout() {
      localStorage.removeItem(KEY);
    },
    current() {
      try { return JSON.parse(localStorage.getItem(KEY)); }
      catch { return null; }
    },
    isAuthed() {
      return !!this.current();
    },
    // Redirect to login if not signed in. Call at the top of protected pages.
    requireAuth(loginUrl = "login.html") {
      if (!this.isAuthed()) { window.location.replace(loginUrl); return false; }
      return true;
    },
  };
})();
