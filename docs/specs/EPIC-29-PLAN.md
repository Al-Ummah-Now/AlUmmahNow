# Epic 29 plan and status

Audit of [CORE-WEB-EXPERIENCE.md](CORE-WEB-EXPERIENCE.md) against `main` and QA (https://videos.qa.alummahnow.net) on 2026-11-08.

**Summary:** the P0 stories were already built (Sprint A branches merged through #163). The audit found they work on QA, and that the remaining P0 work was bugs and missing release coverage, not missing features. P1 and P2 stories are mostly open and are tracked as queue issues.

How it was checked:

- A signed-in browser sweep of the core pages, English at desktop width and Arabic at 390x844. All pages rendered in the right direction, with no horizontal overflow and no untranslated keys.
- Live flows with the seeded viewer and creator accounts: posting, replying, live delivery between sessions, watch later and notifications.
- Direct calls to the QA API, including Arabic search.

Absent features under P1 and P2 were judged by searching the code and probing routes, not by using each feature.

## P0 stories

| Story | Status | Evidence | Plan |
|---|---|---|---|
| 29.1 `@handle` URLs, About tab | Built | `/c/[handle]` route, About tab and `channelHandle` endpoint exist; unknown handles return 404 | Lookalike handles: #276 |
| 29.2 Comments completion | Built, one gap fixed | Posting and replies work on QA. Sort, timestamps and the edited flag have components and legacy specs. Live delivery reached signed-in viewers but not signed-out ones | Signed-out delivery fixed in #361 (#301). Extra sockets: #379 |
| 29.6 Library, Watch later, Liked | Built | Hub and list pages render in en and ar; Watch later add and list verified on QA | Liked channel section: #174 |
| 29.7 Explore | Built | `/api/explore` returns categories, new channels and seasonal rails from config; page renders in en and ar | None |
| 29.8 Search v2 | Built | Filter UI and multi-type results; on QA, `الامة` (no hamza) matched a channel named `الأمة` | None |
| 29.9 Search index | Built | D1 FTS5 (`SEARCH_DB`), kept in sync on writes, daily reconciliation | None |
| 29.10 Notification center | Built | Inbox page in en and ar, per-channel bell component; a comment produced a keyed notification on QA | None |

## P1 and P2 stories

| Story | Priority | Status | Tracking |
|---|---|---|---|
| 29.3 Creator comment moderation | P1 | Owned by Epic 5–8 (Epic 6) | n/a |
| 29.4 Community posts completion | P1 | Partial: no post detail page | #370 |
| 29.5 Public profile and privacy toggles | P1 | Not built | #371 |
| 29.11 Home personalisation | P1 | Partial: Continue watching shipped by the history work | #372 |
| 29.12 Watch page completion | P1 | Owned by Epic 5–8 (Epic 8) | n/a |
| 29.13 Playlists queue, shuffle, visibility | P1 | Not built | #373 |
| 29.14 Lamahat vertical viewer | P2 | Not built | #374 |
| 29.15 Subscriptions UX | P1 | Partial: per-channel bell shipped | #375 |
| 29.16 Account settings consolidation | P2 | Not built | #376 |
| 29.17 Live watch page | P1 | Not built: `/en/live/{id}` is a 404 | #377 |
| 29.18 Channel extras | P2 | Partial: channel delete shipped | #378 |

## Bugs handled in this epic

| Issue | Outcome |
|---|---|
| #293 Arabic users get English auth pages | Fixed in #338. AlUmmahNowAuth#183 remains open for language loss later in the auth flow |
| #297 Unknown channel loses client config | Fixed in #342 |
| #298 CDN outage shown as a format error | Fixed in #345 |
| #299 UI nits | Items 1–4 fixed in #358. Item 5 (prod titles) and item 6 (console noise) remain open |
| #301 Live comments | Signed-out delivery added in #361; the extra sockets moved to #379 |

The sign-out family (#291, #295), the resume prompt and history UI (#242), and the mobile fixes (#300) belong to other work and were not touched.

## Release coverage

`apps/web/e2e/release/core-web.spec.ts` covers the auth page language, unknown channels, live comments for signed-out viewers, and Arabic at 390x844 for library, notifications, explore and search. `network-error.player.spec.ts` covers the CDN outage message.
