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

/** Event types that first-party code and vetted libraries register globally. */
/**
 * Event types React DOM listens to on its root container. The Next.js App
 * Router hydrates the whole document, so that root container IS `document`:
 * blocking any of these silently breaks the matching React props everywhere
 * (e.g. `input` -> onChange of every text field, `submit` -> form onSubmit,
 * `mouseover`/`mouseout` -> onMouseEnter/Leave, media events -> onPlay...).
 * Mirrors react-dom's registered native events (simpleEventPluginEvents,
 * media events, enter/leave, change/select/beforeinput/composition plugins).
 */
export const REACT_ROOT_EVENT_TYPES: ReadonlyArray<string> = [
  'abort', 'auxclick', 'beforetoggle', 'cancel', 'canplay', 'canplaythrough', 'click', 'close',
  'contextmenu', 'copy', 'cut', 'drag', 'dragend', 'dragenter', 'dragexit', 'dragleave', 'dragover',
  'dragstart', 'drop', 'durationchange', 'emptied', 'encrypted', 'ended', 'error', 'fullscreenchange',
  'fullscreenerror', 'gotpointercapture', 'input', 'invalid', 'keydown', 'keypress', 'keyup', 'load',
  'loadeddata', 'loadedmetadata', 'loadstart', 'lostpointercapture', 'mousedown', 'mousemove',
  'mouseout', 'mouseover', 'mouseup', 'paste', 'pause', 'play', 'playing', 'pointercancel',
  'pointerdown', 'pointermove', 'pointerout', 'pointerover', 'pointerup', 'progress', 'ratechange',
  'reset', 'resize', 'seeked', 'seeking', 'stalled', 'submit', 'suspend', 'timeupdate', 'touchcancel',
  'touchend', 'touchstart', 'volumechange', 'scroll', 'scrollend', 'toggle', 'touchmove', 'waiting',
  'wheel', 'animationend', 'animationiteration', 'animationstart', 'dblclick', 'focusin', 'focusout',
  'transitionrun', 'transitionstart', 'transitioncancel', 'transitionend', 'change', 'selectionchange',
  'compositionend', 'compositionstart', 'compositionupdate', 'textInput', 'beforeinput', 'select',
];

export const GLOBAL_EVENT_ALLOWLIST: ReadonlySet<string> = new Set([
  ...REACT_ROOT_EVENT_TYPES,
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
