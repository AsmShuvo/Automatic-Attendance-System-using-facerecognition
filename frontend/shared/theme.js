/* Theme toggle: dark (neon) <-> light. Persists in localStorage and injects a
   floating sun/moon button. Loaded in <head> so the theme is set before paint. */
(function () {
  var KEY = "sa-theme";
  var root = document.documentElement;

  // Apply saved theme immediately (default: dark) — runs before <body> paints.
  var saved = localStorage.getItem(KEY);
  root.dataset.theme = saved === "light" || saved === "dark" ? saved : "dark";

  var SUN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1.5 12h3M19.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>';
  var MOON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function build() {
    if (document.querySelector(".theme-toggle")) return;
    var btn = document.createElement("button");
    btn.className = "theme-toggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Toggle light / dark theme");

    function render() {
      // Show the icon for the theme you'd switch TO.
      btn.innerHTML = root.dataset.theme === "dark" ? SUN : MOON;
      btn.title = root.dataset.theme === "dark" ? "Switch to light" : "Switch to dark";
    }
    render();

    btn.addEventListener("click", function () {
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem(KEY, root.dataset.theme);
      render();
    });

    document.body.appendChild(btn);
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
