// Light/dark for the status page (owner rule 2026-11-13: no "System" option). The first visit
// follows the device; the toggle's choice is remembered on this device. Runs before paint.
// The toggle is the shared control (docs/design/NAV.md, packages/fanous-tokens/nav/mode-toggle.js):
// one icon button named for the mode it switches to; CSS shows the Moon in light, the Sun in dark.
// data-fanous-theme picks the Fawanees token set (/fanous/tokens.css) the shared header is styled with.
(function () {
  var KEY = 'aun_status_mode';
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  var dark = saved ? saved === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  function set(mode) {
    root.setAttribute('data-mode', mode);
    root.setAttribute('data-fanous-theme', mode);
  }
  set(dark ? 'dark' : 'light');
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('mode-toggle');
    if (!btn) return;
    function name() {
      var label = root.getAttribute('data-mode') === 'dark' ? btn.getAttribute('data-label-light') : btn.getAttribute('data-label-dark');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
    name();
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
      set(next);
      name();
      try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: the choice lasts this page */ }
    });
  });
})();
