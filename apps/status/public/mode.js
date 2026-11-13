// Light/dark for the status page (owner rule 2026-11-13: no "System" option). The first visit
// follows the device; the toggle's choice is remembered on this device. Runs before paint.
(function () {
  var KEY = 'aun_status_mode';
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  var dark = saved ? saved === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-mode', dark ? 'dark' : 'light');
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('mode-toggle');
    if (!btn) return;
    btn.hidden = false;
    btn.setAttribute('aria-pressed', String(root.getAttribute('data-mode') === 'dark'));
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-mode', next);
      btn.setAttribute('aria-pressed', String(next === 'dark'));
      try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: the choice lasts this page */ }
    });
  });
})();
