# Epics 1–4: status

Audited 2026-11-08 against `origin/main` and the live QA site (https://videos.qa.alummahnow.net). Stories and ACs come from `docs/tech-spec-epic-1.md` (Epic 1) and the GitHub issues (`docs/epics.md` lists only the epics).

**Status** is what the code and QA show now. **Needs people** means no code can finish it; those items are tracked in #349.

Live QA probe (branded Chrome, en and ar, 1280px and 390px touch): axe reports 0 WCAG 2.0/2.1 A and AA violations on the player; no CSP violations in the console.

## Summary

| | Done | Partly done | Open |
|---|---|---|---|
| Epic 1 stories 1.1–1.5 | 2 (1.1, 1.4) | 3 (1.2, 1.3, 1.5: code done, only the sign-off AC waits on people) | 0 |
| Epic 2 (#79) | 0 | 1 | 0 |
| Epic 3 (#80, #81, #82) | 3 | 0 | 0 |
| Epic 4 (#68, #71) | 0 | 2 | 0 |
| **Total (11)** | **5** | **6** | **0** |

## Epic 1: accessibility and security (#87)

| Story / AC | Status | Evidence | Gap |
|---|---|---|---|
| 1.1 Colour contrast (AC 1–5) | Done | `src/lib/accessibility/__tests__/contrast.test.ts`, `src/lib/video/__tests__/control-scrim.test.ts`; axe 0 violations on QA | axe can't measure text over video; the scrim test covers that |
| 1.2 Scoped, validated listeners (AC 1, 2, 4, 5) | Done | `src/lib/video/keyboard-shortcuts.ts` (`isTrusted`, rate limit, scoped), `src/lib/security/listener-scope.ts` + test; CSP live on QA, `src/lib/security/csp.ts` + `csp.test.ts` | |
| 1.2 Pen test (AC 3, 6) | Needs people | | #349 |
| 1.3 Encryption, access/export/delete, consent, retention (AC 1–5) | Done | `src/lib/crypto.ts`, `EncryptedStorage`, `apps/api-videos/src/endpoints/privacy/privacy.ts` (401 without auth on QA), `src/lib/consent/`, `apps/api-videos/src/lib/privacy/retention.ts` | Volume and speed stay unencrypted on purpose: they are non-personal preferences, listed in `src/lib/privacy/local-data.ts` |
| 1.3 GDPR audit (AC 6) | Needs people | | #349 |
| 1.4 Keyboard reach, order, help, skip links, focus (AC 1–6) | Done | QA Tab order runs through every control in logical order; `SkipLinks` on the page in en and ar; `KeyboardHelpModal`; #331 fixed the slider (English on `/ar`, wrong orientation, double step), `volume-control.test.ts` | Manual screen-reader pass: #349 |
| 1.5 Touch targets, spacing, feedback (AC 1–5) | Done | #333: 44×44 hit areas under `pointer: coarse`; `touch-feedback.test.ts` un-quarantined | |
| 1.5 Usability testing (AC 6) | Needs people | | #349 |

### Other #87 items

| Item | Status | Evidence / gap |
|---|---|---|
| 8 Auto-hide 4s, hover persistence | Done | #333; hover persistence is built into Video.js |
| 9 Keyboard feedback styles | Done | `src/styles/keyboard-feedback.css` |
| 10 Discoverability | Done | Help via `?` and a button; first-run gesture hint in #341 |
| 11 RTL scrubber | Done | On QA at `/ar`, a click 25% from the left seeks to 25%: the timeline stays left-to-right (`[dir="rtl"]` rules in `video-player.css`) |
| 12 Viewer count overlap | Done | Top corner, clear of the control bar |
| 13 Volume indicator timing | Done (part) | #331: 800ms, debounced. It stays centred rather than bottom-left: moving it is a design change the audit did not need |
| 14 Unified loading states | Not assessed | `LoadingStates.tsx` and `BufferingIndicator` exist; the styles were not compared in this audit |
| 7 `!important` cleanup, Phase 4 performance targets | Not done | Tracked in #348; no user-visible bug |
| Feature flags, 5/25/100% rollout | Superseded | The player has shipped; releases go stage → production with auto-rollback (`release.yml`) |

## Epic 2: analytics (#79)

| AC | Status | Evidence | Gap |
|---|---|---|---|
| All events tracked, methods added | Done | #336: volume, rate, loadstart, loadedmetadata join seek, progress, quality, buffering | |
| Sent to the backend with payload | Partly done | `POST /api/analytics/video` receives them | Route forwards only `ready` and `watch_time`; storing the rest is #347 |
| localStorage backup | Will not do | Removed on purpose for GDPR (Story 1.3, `2fdad40`), pinned by a test; bounded in-memory retry instead | Owner to confirm the AC is dropped |
| Tests, docs | Done | `video-analytics.test.ts`; `apps/web/docs/PHASE_3_INTEGRATION_GUIDE.md` | |

## Epic 3: i18n

| Issue | Status | Evidence |
|---|---|---|
| #82 Plurals | Done, closed | #339; `src/lib/video/i18n/utils/plural.ts`, `__tests__/pluralization.test.ts` |
| #81 `isValidLanguage` | Done, closed | #339 |
| #80 `locale` on `ErrorDisplay` | Done, closed | #339 |

App-wide count hacks outside the player are #299.

## Epic 4: testing and migration

| Issue / AC | Status | Evidence | Gap |
|---|---|---|---|
| #68 Playback, controls, quality, keyboard, errors, watch history | Done | `e2e/release/player.spec.ts`, `watch-history*.player.spec.ts`, `e2e/31-video-player.spec.ts` | |
| #68 Gestures, analytics | Done | `e2e/release/player-a11y.player.spec.ts` | |
| #68 Resume playback | Partly done | Unit: `CustomVideoPlayer.resume.test.tsx`, `resume.test.ts` | No E2E yet |
| #68 Cross-browser and mobile, CI | Partly done | Legacy projects (Firefox, WebKit, mobile) run nightly in `e2e-tests.yml`; on PRs chromium and the release suite only | Real-device runs: #349 |
| #71 Migration and rollout | Superseded | The custom player is the only player; `release.yml` gives stage, 0% smoke, 100%, auto-rollback, and `rollback.yml` | No iframe fallback, runbook or sign-off exists; owner to confirm the issue can close |

## Plan for what is left

Ordered by user impact. Items 1–5 are done. The release E2E in item 5 passes against QA (7 of 7); its PR is waiting for owner approval.

1. Volume slider accessibility and localization (#331).
2. 44px touch targets, 4s auto-hide (#333).
3. Remaining player analytics (#336).
4. Plurals, language guard, regional locale (#339).
5. Gesture hint (#341), release E2E coverage.
6. Store engagement events (#347).
7. CSS cleanup and performance baselines (#348).
8. People-led compliance work (#349).
