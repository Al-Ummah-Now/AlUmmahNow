/*!
 * Al Ummah Now embedded discussions widget (read-only v1).
 * Contract: docs/embeds/README.md §7 in github.com/Al-Ummah-Now/AlUmmahNow.
 *
 *   <script src="https://videos.alummahnow.net/embed/widget.js" async></script>
 *   <alummah-discussion video="VIDEO_ID" lang="ar"></alummah-discussion>
 *
 * Renders an iframe of {host}/embed/comments/{video} and sizes it to the
 * height the frame reports (aun:v1:resize, accepted only from that frame and
 * from the widget's own host origin). Sets no cookies on the host page.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.customElements || window.customElements.get('alummah-discussion')) return;

  var script = document.currentScript;
  var HOST = (function () {
    try { return new URL(script && script.src ? script.src : '').origin; } catch (e) { return 'https://videos.alummahnow.net'; }
  })();
  var ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

  function pageLang(el) {
    var lang = (el.getAttribute('lang') || document.documentElement.getAttribute('lang') || '').toLowerCase();
    return lang.indexOf('ar') === 0 ? 'ar' : 'en';
  }

  function AlummahDiscussion() {
    return Reflect.construct(HTMLElement, [], AlummahDiscussion);
  }
  AlummahDiscussion.prototype = Object.create(HTMLElement.prototype);
  AlummahDiscussion.prototype.constructor = AlummahDiscussion;
  Object.setPrototypeOf(AlummahDiscussion, HTMLElement);
  AlummahDiscussion.observedAttributes = ['video', 'lang'];

  AlummahDiscussion.prototype.connectedCallback = function () {
    if (!this._root) {
      this._root = this.attachShadow({ mode: 'open' });
      var self = this;
      this._onMessage = function (event) {
        if (!self._frame || event.source !== self._frame.contentWindow || event.origin !== HOST) return;
        var data = event.data;
        if (!data || data.type !== 'aun:v1:resize') return;
        var height = Number(data.height);
        if (isFinite(height) && height > 0) self._frame.style.height = Math.min(Math.ceil(height), 20000) + 'px';
      };
      window.addEventListener('message', this._onMessage);
    }
    this._render();
  };

  AlummahDiscussion.prototype.disconnectedCallback = function () {
    if (this._onMessage) window.removeEventListener('message', this._onMessage);
    this._onMessage = null;
    this._root = null;
  };

  AlummahDiscussion.prototype.attributeChangedCallback = function () {
    if (this._root) this._render();
  };

  AlummahDiscussion.prototype._render = function () {
    var video = this.getAttribute('video') || '';
    var root = this._root;
    while (root.firstChild) root.removeChild(root.firstChild);
    this._frame = null;
    if (!ID_PATTERN.test(video)) return;
    var lang = pageLang(this);
    var style = document.createElement('style');
    style.textContent = ':host{display:block}iframe{display:block;width:100%;height:240px;border:0;color-scheme:normal}';
    var frame = document.createElement('iframe');
    var src = new URL(HOST + '/embed/comments/' + encodeURIComponent(video));
    if (lang === 'ar') src.searchParams.set('lang', 'ar');
    frame.src = src.toString();
    frame.title = lang === 'ar' ? 'التعليقات - الأمة الآن' : 'Comments - Al Ummah Now';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    root.appendChild(style);
    root.appendChild(frame);
    this._frame = frame;
  };

  window.customElements.define('alummah-discussion', AlummahDiscussion);
})();
