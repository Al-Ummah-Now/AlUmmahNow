/**
 * Global event listener allowlist (Story 1.2, AC 1).
 *
 * Listeners registered directly on `window` or `document` see every event on the
 * page, which makes them the classic hook for keyloggers, clipboard sniffers and
 * injected tracking code. Only the event types below may be registered on those
 * two global targets; everything else is rejected by EventListenerValidator.
 *
 * The list was built from an audit of every `window/document.addEventListener`
 * call in apps/web/src (video player, modals, focus traps, multi-account routing)
 * plus the listeners registered by our runtime dependencies (React, Next.js
 * router, Radix UI, Video.js / VHS, TanStack Query, web-vitals). See
 * docs/security/event-listener-audit.md for the per-listener inventory.
 */

/**
 * Every native event React 19 delegates to its root container (react-dom
 * `allNativeEvents`, minus types already listed in the allowlist below).
 */
export const REACT_DELEGATED_EVENTS: ReadonlyArray<string> = [
  // Forms and text entry (onChange/onInput/onBeforeInput/onSubmit/onReset/onInvalid/onSelect)
  'input', 'beforeinput', 'textInput', 'compositionstart', 'compositionupdate', 'compositionend',
  'keypress', 'submit', 'reset', 'invalid', 'select',
  // Pointer and mouse
  'auxclick', 'dblclick', 'mouseover', 'mouseout', 'pointerover', 'pointerout',
  'gotpointercapture', 'lostpointercapture', 'drag', 'dragexit', 'scrollend',
  // Dialog / popover / details
  'beforetoggle', 'toggle', 'cancel', 'close',
  // Media elements (Video.js and <video> props)
  'abort', 'canplay', 'canplaythrough', 'durationchange', 'emptied', 'encrypted', 'ended',
  'loadeddata', 'loadedmetadata', 'loadstart', 'pause', 'play', 'playing', 'progress',
  'ratechange', 'seeked', 'seeking', 'stalled', 'suspend', 'timeupdate', 'volumechange', 'waiting',
  // Animations and transitions
  'animationstart', 'animationiteration', 'transitionrun', 'transitionstart', 'transitioncancel',
];

/** Event types that first-party code and vetted libraries register globally. */
export const GLOBAL_EVENT_ALLOWLIST: ReadonlySet<string> = new Set([
  // Keyboard: player shortcuts, modal Escape handling, focus traps, Radix menus
  'keydown',
  'keyup',
  // Pointer / mouse / touch: Radix dismissable layers, drag-and-drop, sliders
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
  'mousedown',
  'mouseup',
  'mousemove',
  'click',
  'contextmenu',
  'touchstart',
  'touchend',
  'touchmove',
  'touchcancel',
  'wheel',
  // Focus management: focus traps, Radix FocusScope
  'focus',
  'blur',
  'focusin',
  'focusout',
  // Layout / viewport
  'resize',
  'scroll',
  'orientationchange',
  // Navigation: Next.js router, multi-account session switching
  'popstate',
  'hashchange',
  'session-login',
  'session-updated',
  // Comment timestamps seek the watch-page player (lib/video/comment-timestamps.ts)
  'aun:player-seek',
  // Radix DismissableLayer re-renders open layers through this document event;
  // without it a dialog's content keeps pointer-events: none (dialogs can't be clicked)
  'dismissableLayer.update',
  // Page lifecycle: analytics flush, web-vitals, TanStack Query focus refetch
  'visibilitychange',
  'pagehide',
  'pageshow',
  'beforeunload',
  'unload',
  'load',
  'DOMContentLoaded',
  'readystatechange',
  'online',
  'offline',
  // Fullscreen / Picture-in-Picture (Video.js)
  'fullscreenchange',
  'webkitfullscreenchange',
  'fullscreenerror',
  'webkitfullscreenerror',
  'mozfullscreenchange',
  'MSFullscreenChange',
  'mozfullscreenerror',
  'MSFullscreenError',
  'webkitvisibilitychange',
  'enterpictureinpicture',
  'leavepictureinpicture',
  // Media queries / theme
  'change',
  // Cross-tab storage sync and error reporting
  'storage',
  'error',
  'unhandledrejection',
  // CSP violation reporting (SecurityEventLogger)
  'securitypolicyviolation',
  // Cross-document messaging: allowed only with origin validation (see createOriginCheckedHandler)
  'message',
  // Form input: React delegates onChange/onSubmit/IME handling to listeners on the
  // root container, which is `document` under the Next.js App Router. If the
  // validator installs before hydration (chunk order, dev builds) and these are
  // missing, controlled inputs silently stop updating (Arabic IMEs need composition*).
  'input',
  'beforeinput',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'submit',
  'reset',
  'select',
  'invalid',
  // Selection / clipboard used by text inputs and copy-link buttons
  'selectionchange',
  'copy',
  'paste',
  'cut',
  // Drag and drop (upload areas, playlist reordering)
  'dragstart',
  'dragover',
  'dragenter',
  'dragleave',
  'drop',
  'dragend',
  // Animation / transitions (Radix presence)
  'animationend',
  'transitionend',
  // React root event delegation. Next.js hydrates the whole `document`, so React
  // registers one listener per supported event on it. When this chunk evaluates
  // before hydration (timing-dependent; reproducible on Mobile Safari), any type
  // missing here silently breaks the matching React prop app-wide: e.g. without
  // `input`, controlled inputs never fire onChange. Listener sources are still
  // checked against BLOCKED_HANDLER_PATTERNS.
  ...REACT_DELEGATED_EVENTS,
]);

/**
 * Patterns in a listener's source that indicate code injection rather than UI
 * behaviour. A global listener whose handler matches any of these is blocked.
 * They are deliberately narrow: legitimate handlers in this codebase and its
 * dependencies never construct code from strings or rewrite the document.
 */
export const BLOCKED_HANDLER_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'eval', pattern: /\beval\s*\(/ },
  { id: 'function-constructor', pattern: /\bnew\s+Function\s*\(/ },
  { id: 'document-write', pattern: /\bdocument\.write(ln)?\s*\(/ },
  { id: 'javascript-url', pattern: /javascript:/i },
  { id: 'string-timer', pattern: /\bset(Timeout|Interval)\s*\(\s*['"`]/ },
];

/**
 * Patterns that are suspicious but have legitimate uses (e.g. reading a language
 * cookie). Matching handlers are allowed but reported to the security log.
 */
export const SUSPICIOUS_HANDLER_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'cookie-access', pattern: /\bdocument\.cookie\b/ },
  { id: 'inner-html-write', pattern: /\.(inner|outer)HTML\s*=(?!=)/ },
  { id: 'beacon-exfiltration', pattern: /\bnavigator\.sendBeacon\s*\(/ },
];
