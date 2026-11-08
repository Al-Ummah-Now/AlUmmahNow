# Story 1.2: Remove Global Event Listener Security Vulnerabilities

Status: review

## Story

As a security-conscious user,
I want protection against malicious script injection through event listeners,
so that my data and browsing session remain secure.

## Acceptance Criteria

1. Given video player is initialized, when scripts attempt to add global event listeners, then only authorized listeners are permitted
2. Given suspicious event listeners are detected, when validation runs, then suspicious listeners are blocked and logged
3. Given security testing is performed, when penetration testing is executed, then zero injection vulnerabilities exist in event handling
4. Given video player is running, when event listeners are processed, then all event listeners are properly scoped
5. Given user input is received, when input validation occurs, then input sanitization happens before event processing
6. Given security audit is conducted, when comprehensive testing is performed, then security audit passes penetration testing

## Tasks / Subtasks

> Re-verified 2026-11-06. The earlier "implementation-complete" status was not accurate:
> `apps/web/src/lib/security/` did not exist, and the CSP allowed `'unsafe-inline'` and
> `'unsafe-eval'`. The gaps were implemented in this pass. Unchecked items need a human or a
> deployed environment.

- [x] Audit existing global event listeners in video player (AC: 1, 4)
  - [x] Scan video player codebase for global event listener usage
  - [x] Document all current event listeners and their purposes (`docs/security/event-listener-audit.md`)
  - [x] Identify potential security vulnerabilities in current implementation
  - [x] Create allowlist of authorized event listeners (`lib/security/allowlist.ts`)
- [x] Implement event listener validation middleware (AC: 1, 2)
  - [x] Create EventListenerValidator utility class
  - [x] Implement allowlist checking for new event listeners
  - [x] Add blocking mechanism for unauthorized listeners (enforce mode; report mode available)
  - [x] Integrate validation into video player initialization (installed by `SecurityBootstrap` when the first client chunk loads, before the player mounts)
- [x] Add security event logging and monitoring (AC: 2)
  - [x] Implement SecurityEventLogger for suspicious activities
  - [x] Server-side collection: `/api/security/events` and `/api/security/csp-report` write to the centralized server logger. This replaces the planned WebSocket transport: these are one-way reports and need no realtime channel
  - [x] Real-time monitoring through the log service (`level=error` stream shows high/critical events)
  - [ ] Set up alerting for critical security events (needs an alert rule in Cloudflare/observability; not code)
- [x] Implement input sanitization for event data (AC: 5)
  - [x] Create InputSanitizer utility for event data
  - [x] Integrate sanitization into event handlers: WebSocket messages (`WebSocketManager`), analytics/performance beacons (`normalizeClientEvents`), security reports
  - [x] Add validation for event payload structure (`validateStructure`)
  - [x] Test sanitization with various attack vectors (OWASP XSS evasion corpus)
- [x] Update Content Security Policy headers (AC: 3, 6)
  - [x] Review current CSP configuration
  - [x] Add directives to prevent inline script execution (per-request nonce + `'strict-dynamic'`, `script-src-attr 'none'`, no `'unsafe-eval'` in production)
  - [x] Configure CSP for event listener restrictions (inline `on*=` handler attributes blocked)
  - [x] Test CSP effectiveness (directive unit tests; production build checked for nonce on every script tag)
- [ ] Security testing and penetration testing (AC: 3, 6)
  - [ ] Set up OWASP ZAP for automated security scanning (needs a deployed QA target)
  - [ ] Perform manual penetration testing on event handling (human task)
  - [x] Test XSS prevention mechanisms (automated corpus + CSP tests)
  - [x] Validate CSP header effectiveness
  - [x] Document security test results and remediation (`docs/security/event-listener-audit.md`)

## Implementation Plans Created

All task groups have detailed implementation plans in `/docs/stories/implementation-plans/`:

1. **1-2-audit-global-event-listeners.md** ✅ - Security vulnerability scanning and documentation
2. **1-2-event-listener-validation.md** ✅ - Validation middleware implementation  
3. **1-2-security-event-logging.md** ✅ - Real-time monitoring system
4. **1-2-input-sanitization.md** ✅ - Input sanitization for event data
5. **1-2-csp-updates.md** ✅ - Content Security Policy header updates

Each plan includes:
- Comprehensive code examples and implementations
- Testing strategies (unit, integration, security)
- Deliverables and success criteria
- Timeline and risk assessment
- File structure and dependencies

## Dev Notes

### Project Structure Notes

- **Video Player Components**: Located in `apps/web/src/components/video-player/`
- **Security Utilities**: New security module in `apps/web/src/lib/security/`
- **WebSocket Integration**: Existing server at `apps/websocket-server/`
- **Testing Framework**: Jest for unit tests, Playwright for security E2E tests

### Architecture Alignment

- **Security Layer**: New SecurityManager component following existing module patterns
- **Event System**: Integration with existing Video.js event architecture
- **Logging**: Integration with existing WebSocket server for real-time monitoring
- **Testing**: Following existing security testing patterns in monorepo

### Technical Constraints

- **Performance**: Security validation must not impact video player performance
- **Compatibility**: Must work with existing Video.js event system
- **Bundle Size**: Security utilities should not significantly increase bundle size
- **Browser Support**: Security features must work across target browser matrix

### Security Requirements

- **Event Listener Validation**: Runtime validation of all event listeners
- **Input Sanitization**: XSS prevention for all user inputs
- **CSP Headers**: Content Security Policy to prevent script injection
- **Logging**: Comprehensive security event logging and monitoring
- **Testing**: Regular penetration testing and vulnerability scanning

### References

- [Source: docs/tech-spec-epic-1.md#Detailed Design - Security Manager]
- [Source: docs/epics-original.md#Story 1.2]
- [Source: docs/PRD.md#Security]
- [Source: apps/web/package.json#Dependencies]

## Dev Agent Record

### Context Reference

- docs/stories/1-2-security-vulnerabilities.context.xml

### Agent Model Used

Claude Code (claude-3-5-sonnet-20241022)

### Debug Log References

- Web jest baseline on `integrate/qa-features`: 19 failing suites, 92 failing tests (pre-existing). After this change: 0 new failures. Previously failing `crypto.test.ts` and `ab-testing-security.test.ts` now pass.

### Completion Notes List

Acceptance criteria verification (2026-11-06, Claude Opus 5.5):

| AC | Status | Evidence |
|---|---|---|
| 1. Only authorized global listeners | Met | `EventListenerValidator.install()` wraps `window`/`document.addEventListener`. Non-allowlisted types are not registered. Tests: `lib/security/__tests__/EventListenerValidator.test.ts` and `event-listener-audit.test.ts` (every global listener type in the app is allowlisted) |
| 2. Suspicious listeners blocked and logged | Met | Handlers matching eval / `new Function` / `document.write` / `javascript:` / string timers are blocked with a `listener_blocked` (high) event. Suspicious-but-legitimate handlers (cookie access, innerHTML) are logged. Events are shipped to `/api/security/events` and then the server logger. Tests: `EventListenerValidator.test.ts`, `SecurityEventLogger.test.ts` |
| 3. Zero injection vulnerabilities in event handling | Met (automated) / pending (manual pentest) | Nonce + strict-dynamic CSP with no eval; inline handler attributes blocked; XSS corpus neutralized by `sanitizeText`; WebSocket and beacon payloads sanitized before processing; inline config escaped. Tests: `InputSanitizer.test.ts`, `csp.test.ts`. A manual/ZAP pentest is still required |
| 4. Listeners properly scoped | Met | Player document keydown listeners are scoped with `shouldHandleGlobalPlayerShortcut`. This fixes double handling and page-wide capture. Every player global listener has cleanup (static audit test). Tests: `listener-scope.test.ts`, `event-listener-audit.test.ts` |
| 5. Sanitization before event processing | Met | `sanitizeEventPayload` + `validateStructure` in `WebSocketManager.onmessage`, `normalizeClientEvents`, security report routes. Tests: `InputSanitizer.test.ts`, `lib/analytics/__tests__/consent-gating.test.ts` |
| 6. Security audit passes pentest | Partially met | Audit documented in `docs/security/event-listener-audit.md`. A third-party/ZAP pentest against QA needs to be scheduled |

Notes:
- Performance: validation is cached per handler and measured well under 10 ms per registration in tests.
- Residual risk: code calling `EventTarget.prototype.addEventListener.call(document, ...)` bypasses the wrapper. The CSP is the primary control.
- E2E specs that load pages are unaffected by the validator. The consent banner from Story 1.3 can overlap bottom-of-page elements. Set the `aun_consent` cookie in E2E setup (for example `v1.a0.e0.p0.<Date.now()>`).

### File List

- apps/web/src/lib/security/allowlist.ts (new)
- apps/web/src/lib/security/EventListenerValidator.ts (new)
- apps/web/src/lib/security/SecurityEventLogger.ts (new)
- apps/web/src/lib/security/InputSanitizer.ts (new)
- apps/web/src/lib/security/csp.ts (new)
- apps/web/src/lib/security/nonce-header.ts (new)
- apps/web/src/lib/security/listener-scope.ts (new)
- apps/web/src/lib/security/security-report.ts (new)
- apps/web/src/components/security/SecurityBootstrap.tsx (new)
- apps/web/src/app/api/security/events/route.ts (new)
- apps/web/src/app/api/security/csp-report/route.ts (new)
- apps/web/src/middleware.ts (nonce CSP)
- apps/web/src/app/layout.tsx (nonce, escaped runtime config, SecurityBootstrap)
- apps/web/src/lib/video/keyboard-shortcuts.ts, apps/web/src/lib/video/playback-speed.ts (listener scoping)
- apps/web/src/lib/websocket/WebSocketManager.ts (message sanitization)
- apps/web/src/lib/analytics/client-events.ts (beacon sanitization)
- apps/web/src/lib/security/__tests__/*.test.ts (new)
- docs/security/event-listener-audit.md (new)
