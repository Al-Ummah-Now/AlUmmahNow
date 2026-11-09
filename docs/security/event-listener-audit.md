# Global event listener audit (Story 1.2)

Scope: every `window.addEventListener` / `document.addEventListener` call in
`apps/web/src`, plus the global listeners of runtime dependencies (video.js / VHS,
Radix UI, Next.js router, TanStack Query, web-vitals, next-themes, dnd-kit). The
enforced allowlist is `apps/web/src/lib/security/allowlist.ts`. The automated
regression guard is `apps/web/src/lib/security/__tests__/event-listener-audit.test.ts`.

## First-party global listeners

| Target:event | Where | Purpose | Scoping / cleanup |
|---|---|---|---|
| document:keydown | `lib/video/keyboard-shortcuts.ts` | Player shortcuts while focus is on the page or in fullscreen | **Fixed:** previously ran for every key on the page and handled events twice (element + document listener). It is now wrapped in `shouldHandleGlobalPlayerShortcut` (ignores inputs, dialogs, menus, other players, and events already handled by the player element). Removed in the returned cleanup |
| document:keydown | `lib/video/playback-speed.ts` | Shift+< / Shift+> speed | **Fixed:** now scoped to its own player (`handleEventsInsidePlayer`). Removed by `cleanupPlaybackSpeedKeyboardShortcuts` |
| document:keydown | `components/VideoPlayer/KeyboardHelpModal.tsx`, `components/video/VideoKeyboardHelp.tsx`, `videoPreview` (LTR/RTL), `UnifiedNavigation`, `SaveToPlaylist`, `hooks/useFocusTrap.ts` | Escape / focus trap for open modals and menus | Added while open, removed in effect cleanup |
| document:mousedown | `ChannelSwitcher` (LTR/RTL), `SaveToPlaylist` | Click-outside to close | Effect cleanup |
| window:resize | `ChannelTabs` (LTR/RTL) | Tab overflow layout | Effect cleanup |
| window:popstate, window:session-login | `hooks/useMultiAccount.tsx` | Multi-account session switching | Effect cleanup |
| window:storage, window:session-updated | `components/CookieSizeMonitor.tsx` | Development-only cookie size monitor | Effect cleanup |
| window:beforeunload, document:visibilitychange | `services/analytics/video-analytics.ts` | Flush analytics before unload | Removed in `destroy()`. Consent-gated (Story 1.3) |
| window:beforeunload | `services/experiments/analytics.ts` | Flush A/B events | Process lifetime singleton. Consent-gated |
| document:securitypolicyviolation, document:visibilitychange, window:pagehide | `components/security/SecurityBootstrap.tsx` | CSP violation reporting, security log flush | AbortController on unmount |

Player events (`play`, `timeupdate`, `fullscreenchange` and so on) are registered on the
Video.js player or the `<video>` element. They are element-scoped and are disposed with
the player.

## Vulnerabilities found and remediated

1. **No listener validation existed**, although the story was marked
   implementation-complete. `lib/security/` did not exist. Added `EventListenerValidator`
   (allowlist plus blocked handler patterns, enforced on window/document from the first
   client chunk), `SecurityEventLogger` and `InputSanitizer`.
2. **The CSP allowed `'unsafe-inline'` and `'unsafe-eval'` for scripts in production**,
   which made the CSP ineffective against XSS. It is now nonce-based with `'strict-dynamic'`,
   no eval, `script-src-attr 'none'`, and a `report-uri`. `X-XSS-Protection` is set to `0`
   because the legacy auditor is obsolete and itself exploitable.
3. **Inline runtime config used `JSON.stringify` inside `<script>`.** A `</script>` in an env
   value could break out. It is now `serializeForInlineScript` and carries the nonce.
4. **Player keyboard listeners were document-wide and double-handled** (see table).
5. **WebSocket messages were dispatched without validation.** They are now sanitized
   (prototype-pollution keys, non-JSON values, control characters, size limits) and
   shape-checked before handlers run.
6. **Analytics/performance beacons were forwarded unsanitized.** They are now sanitized and
   stripped of identifiers (email, ip, token, URL query strings) in `normalizeClientEvents`.

## Residual risks and limits

- The validator wraps the `addEventListener` own property of `window` and `document`. Code
  that calls `EventTarget.prototype.addEventListener.call(document, ...)` directly bypasses
  it. The CSP is the primary control against injected code.
- Handler-source pattern checks are heuristics on `Function.prototype.toString`. Native or
  bound functions are opaque.
- A manual penetration test / OWASP ZAP scan of a deployed environment has not been run
  from this change. Automated XSS corpus tests run in CI (`InputSanitizer.test.ts`), along
  with CSP directive tests (`csp.test.ts`).
