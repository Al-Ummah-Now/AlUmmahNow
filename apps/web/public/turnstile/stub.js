/* Turnstile stand-in for Cloudflare's test site keys (QA, stage, local, CI): renders nothing and
   answers with the documented test token, so tests never call challenges.cloudflare.com.
   Production uses a real site key and never loads this (src/lib/turnstile/client.ts). */
(function () {
  var widgets = {};
  var n = 0;
  var TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
  window.turnstile = {
    render: function (el, opts) {
      var id = 'stub-' + ++n;
      widgets[id] = opts || {};
      setTimeout(function () { if (opts && opts.callback) opts.callback(TOKEN); }, 0);
      return id;
    },
    reset: function (id) { var o = widgets[id]; if (o && o.callback) setTimeout(function () { o.callback(TOKEN); }, 0); },
    remove: function (id) { delete widgets[id]; },
    getResponse: function () { return TOKEN; },
    execute: function () {},
    ready: function (f) { f(); },
  };
})();
