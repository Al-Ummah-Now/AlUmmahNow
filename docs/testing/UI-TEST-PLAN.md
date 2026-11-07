# Web UI Test Plan (apps/web)

Inventory of every page and interactive component area of the user-facing web
app, with the Playwright case IDs that cover it. Admin-web has its own plan
(`docs/testing/ADMIN-UI-TEST-PLAN.md`).

## How the suite runs

| Item | Value |
|---|---|
| Runner | Playwright 1.56, `apps/web/playwright.config.ts` |
| Target | `WEB_APP_URL` (QA: https://videos.qa.alummahnow.net, API https://videos.api.qa.alummahnow.net, auth https://auth.qa.alummahnow.net) |
| Browser/device projects | `chromium`, `firefox`, `webkit` (desktop), `Mobile Chrome` (Pixel 5), `Mobile Safari` (iPhone 12) — every spec in `e2e/*.spec.ts` runs in each |
| Dedicated projects | `a11y` (axe on every page, `e2e/a11y/`), `visual` (screenshots, `e2e/visual/`) — Desktop Chrome only, excluded from the browser projects |
| Users | `auth.setup.ts` provisions 3 users: **single** (profile + 1 channel), **multi** (profile + 2 channels), **none** (profile, no channel); **anon** = `ANONYMOUS_STATE`. Each describe pins its user with `test.use({ storageState })`. Locally: `E2E_REUSE_USERS_TIMESTAMP=1794007739628` reuses the existing QA users |
| Data | Real QA data (server actions bypass `page.route`): public "QA Lecture" seed videos / "Al Ummah Now QA — Lectures" channel (read-only), per-user private seed videos (`ensureSeedVideos`, read-only), disposable videos/playlists/posts/sections/templates created and removed by the test that needs them |
| Cleanup | Every write is reverted in `afterEach`/`afterAll`; global teardown (`cleanup-test-content.ts`) removes the E2E users' non-seed videos older than 30 min |
| Consent | `e2e/fixtures.ts` pre-sets `aun_consent` (all optional categories off) except in the consent-banner spec |
| CI | `.github/workflows/e2e-tests.yml`: auth setup → 5 projects × 3 shards, `a11y` + `visual` jobs, `update-visual-snapshots` (workflow_dispatch, `update_snapshots=true`), Lighthouse (non-blocking) |

Legend — **Role**: anon / none (no channel) / single / multi / owner.
**Loc**: en, ar (RTL, `dir="rtl"` asserted). **Theme**: L = light, D = dark.
**VP**: D = desktop projects, M = mobile projects, D+M = both (default: every
spec runs in all five projects).

## 1. Route inventory

| Route (`src/app`) | Roles | Cases |
|---|---|---|
| `/` (root redirect) | anon | ERR-001, NAV-031 |
| `/[locale]` home | anon, single | HOME-001…009, 01-homepage, A11Y-ALL home, VIS-home |
| `/[locale]/videos` | anon | VIDS-001…004, A11Y-ALL videos |
| `/[locale]/video/[id]` watch | anon, single (owner), multi | WATCH-001…014, PLAYER-*, CMT-*, 02-video-player, 20-accessibility-axe, 22-video-comments, A11Y-ALL watch, VIS-watch |
| `/[locale]/video?vid=` legacy watch | anon, single | WATCH-001…003, WATCH-012, ERR-007, A11Y-ALL watch-legacy / watch-none |
| `/[locale]/video/[id]/edit` | single (owner), anon | 15-video-edit, EDIT-101…105, SCHED-201…205, CHAP-*, SUB-*, 16-thumbnail-management, A11Y-ALL video-edit |
| `/[locale]/upload` | anon, none, single, multi | 12/13/17/18 upload specs, UPL-001…010, THUMB-101…104, SCHED-101…104, BATCH-*, TPL-008…010, A11Y-ALL upload*, VIS-upload |
| `/[locale]/dashboard/videos` | single, multi | 14-video-management, 19-dashboard-videos-ownership, DASH-001…009, A11Y-ALL dashboard, VIS-dashboard |
| `/[locale]/scheduled-videos` | single, anon | scheduled-videos-calendar, CAL-101…107, A11Y-ALL scheduled |
| `/[locale]/channels` | anon, single | 04-channels, CHL-001…011, A11Y-ALL channels*, VIS-channels |
| `/[locale]/channels/[id]` (+ `?tab=`) | anon, single (owner), none | CHTAB-001…019, SECT-010, COMM-020…022, 21-channel-handles-owner, A11Y-ALL channel*, VIS-channel |
| `/[locale]/playlist/[id]` | anon, single | PLAY-010…012, PLAY-020…021, A11Y-ALL playlist |
| `/[locale]/sections` | anon | SECT-020…021, A11Y-ALL sections |
| `/[locale]/settings/channel/[id]` | single, multi, anon (redirect) | CHSET-001…002, CHSET-010…011, A11Y-ALL channel-settings |
| `…/channel/[id]/edit` | multi, single | CHSET-020…021, A11Y-ALL channel-settings-edit |
| `…/channel/[id]/tabs` | multi | CHSET-040…044, A11Y-ALL channel-settings-tabs |
| `…/channel/[id]/sections` | single | SECT-001…008, A11Y-ALL channel-settings-sections |
| `…/channel/[id]/playlists` | single | PLAY-001…003, A11Y-ALL channel-settings-playlists |
| `…/channel/[id]/community`, `/community/new` | single | COMM-001…006, A11Y-ALL channel-settings-community* |
| `…/channel/[id]/videos` | single | CHSET-030…031, A11Y-ALL channel-settings-videos |
| `/[locale]/settings` | anon, none, single | SET-001…030, A11Y-ALL settings* |
| `/[locale]/settings/privacy` | anon, none | PRIV-001…012, CONS-005, A11Y-ALL privacy, VIS-privacy |
| `/[locale]/settings/upload-defaults` | multi, single | TPL-001…007, A11Y-ALL upload-defaults |
| `/[locale]/profile` | anon, single | PROF-001…012, 03-profile, A11Y-ALL profile* |
| `/[locale]/profile/create` | anon, none | PROF-020…021, 03-profile, 10/11 profile-guard, A11Y-ALL profile-create-anon |
| `/[locale]/profile/edit` | anon, none, single | PROF-030…040, A11Y-ALL profile-edit |
| `/[locale]/history` | anon, none, single | HIST-001…005, A11Y-ALL history* |
| `/[locale]/feed` | anon, none, multi | FEED-001…012, A11Y-ALL feed* |
| `/[locale]/subscriptions` | anon, none, multi | SUBS-001…012, A11Y-ALL subscriptions* |
| `/[locale]/analytics` | anon, none, single | ANA-001…030, A11Y-ALL analytics* |
| `/[locale]/search` (search v2) | anon | 21-search-v2 (search v2 workstream) |
| `/en/live`, `/ar/live` (+ `error.tsx`) | anon | LIVE-001…003, A11Y-ALL live, jest `live-error-boundaries` |
| `not-found.tsx` (root + `[locale]`) | anon | ERR-002…006, A11Y-ALL not-found, VIS-not-found |
| `/explore`, `/library`, `/notifications`, `@handle` URLs | — | Owned by other workstreams: 21-library, 22-explore, 22-notifications, 21-channel-handles-owner |

### API routes with UI impact

| Route (`src/app/api`) | UI effect | Cases |
|---|---|---|
| `/api/callback`, `/api/callback/multi-account` | sign-in / add account, session cookie with channels | auth.setup, NAV-055…056, 11-account-switching |
| `/api/auth/token` | browser token for TUS uploads and client API calls | 12/13/17 upload specs, BATCH-003 |
| `/api/log` | client logger sink (no UI) | — (exercised by every page) |
| `/api/analytics/*`, `/api/security/*` | consent-gated analytics / CSP reports (no UI) | CONS-002…004 (consent gates the beacons), NAV-021 (no CSP/page errors) |

## 2. Component areas

### Navigation (header, drawer, account menu, channel switcher)
| ID | Case | Role | Loc | Theme | VP | Spec |
|---|---|---|---|---|---|---|
| NAV-001 | logo link, drawer toggle aria state | anon | en | L | D+M | 61-header-drawer |
| NAV-002 | Arabic header is RTL | anon | ar | L | D+M | 61 |
| NAV-003 | no upload shortcut when signed out | anon | en | L | D+M | 61 |
| NAV-004 | upload shortcut (label hidden on phones) | single | en | L | D+M | 61 |
| NAV-010 | drawer links incl. real Subscriptions link | anon | en | L | D+M | 61 |
| NAV-011 | following a drawer link closes the drawer | anon | en | L | D+M | 61 |
| NAV-012 | Escape and overlay close the drawer | anon | en | L | D+M | 61 |
| NAV-013 | Arabic drawer | anon | ar | L | D+M | 61 |
| NAV-014 | drawer fits a phone | anon | en | L | M | 61 |
| NAV-020 | theme toggle persists across reload and locale | anon | en, ar | L→D | D+M | 61 |
| NAV-021 | theme script throws no page errors | anon | en | L | D+M | 61 |
| NAV-030 | language toggle keeps path and query | anon | en, ar | L | D+M | 61 |
| NAV-031 | chosen language remembered; root redirects to it | anon | en, ar | L | D+M | 61 |
| NAV-040/041 | skip link moves focus to main (en / ar) | anon | en, ar | L | D+M | 61 |
| NAV-050…053 | account menu links (subscriptions, analytics, settings), aria-haspopup/expanded, Arabic labels | single | en, ar | L | D+M | 62-account-menu |
| NAV-054 | links offered without a channel | none | en | L | D+M | 62 |
| NAV-055/056 | two accounts listed; switching shows its channel + upload | none+single | en | L | D+M | 62, 11-account-switching |
| — | unified navigation, channel switching, profile guard | single, multi, none | en, ar | L | D+M | 06, 08, 09, 10, 11 |

### Watch page, player, comments
| ID | Case | Role | Loc | Theme | VP | Spec |
|---|---|---|---|---|---|---|
| WATCH-001 | title, channel, player, metrics on both routes | anon | en | L | D+M | 30-watch-page |
| WATCH-002 | Arabic RTL watch page (localized title) | anon | ar | L | D+M | 30 |
| WATCH-003 | legacy route without id shows prompt | anon | en, ar | L | D+M | 30 |
| WATCH-004 | unknown id shows "video not found" | anon | en, ar | L | D+M | 30 |
| WATCH-005 | anon can't react, save, report or edit | anon | en | L | D+M | 30 |
| WATCH-006 | related videos exclude current one; open another | anon | en | L | D+M | 30 |
| WATCH-007 | dark scheme | anon | en, ar | D | D+M | 30 |
| WATCH-008…010 | like on/off, like restored after reload, like→dislike | multi | en | L | D+M | 30 |
| WATCH-011 | report dialog requires a reason; closes without reporting | single | en, ar | L | D+M | 30 |
| WATCH-012/013 | owner edit link, no report button (en / ar) | owner | en, ar | L | D+M | 30 |
| WATCH-014 | create playlist with the video from Save dialog | single | en, ar | L | D+M | 30 |
| PLAYER-001 | unplayable stream: localized accessible error | anon | en, ar | L | D+M | 31-video-player |
| PLAYER-002 | no H.264 decoder: format error, no dead buttons, axe clean | anon | en | L | bundled Chromium | 31 |
| PLAYER-010…017 | play/pause, mute/volume, progress + number keys, quality menu, captions, keyboard help (Esc), fullscreen, Arabic labels | anon | en, ar | L | D+M (codec-capable engines) | 31 |
| PLAYER-020/021 | chapter list + markers seek; no chapter UI without chapters | anon | en, ar | L | D+M | 31 |
| — | contrast, keyboard order, skip links, touch targets | anon | en, ar | L, D | D+M | 20-accessibility-axe |
| CMT-001 | anon sign-in prompt and redirect | anon | en, ar | L | D+M | 32-comments |
| CMT-002 | no-channel user asked to create a channel | none | en, ar | L | D+M | 32 |
| CMT-003 | post comment, author shown, delete | single | en, ar | L | D+M | 32 |
| CMT-004 | cancel draft; dismissing delete keeps comment | single | en | L | D+M | 32 |
| — | replies, sort, live updates (comments v2) | single, multi | en, ar | L | D+M | 22-video-comments |

### History, live, errors
| ID | Case | Role | Loc | Theme | VP | Spec |
|---|---|---|---|---|---|---|
| HIST-001 | sign-in prompt | anon | en, ar | L | D+M | 33-watch-history |
| HIST-002…004 | entry with % watched, link, remove; completed entry; clear all → empty | none | en, ar | L | D+M | 33 |
| HIST-005 | Arabic empty state | none | ar | L | D+M | 33 |
| LIVE-001…003 | live list reaches grid/empty (never error), dark, no horizontal scroll | anon | en, ar | L, D | D+M | 34-live |
| ERR-001 | `/` redirects to `/en` | anon | en | L | D+M | 35-errors-404 |
| ERR-002…004 | localized 404 (status 404, axe), Home/Back buttons, dark | anon | en, ar | L, D | D+M | 35 |
| ERR-005…007 | unsupported locale, un-prefixed paths and `/video?vid=` redirect under `/en` | anon | en | L | D+M | 35 |

### Creator studio (upload, batch, templates, thumbnails, schedule, edit, chapters, subtitles, dashboard, calendar)
| ID | Case | Role | Loc | Theme | VP | Spec |
|---|---|---|---|---|---|---|
| UPL-001…006 | modes + labelled form, RTL form, category, phone layout, dark/light | single | en, ar | L, D | D+M | 40-upload-form |
| UPL-007 | Arabic title/description/category stored on upload | single | en | L | D+M | 40 |
| UPL-008/009 | sign-in prompt (ar / dark) | anon | en, ar | L, D | D+M | 40 |
| UPL-010 | channel required → create-channel link | none | ar | L | D+M | 40 |
| THUMB-101…104 | custom thumbnail preview/clear, non-image + >2MB rejected, frame extraction | single | en, ar | L | D+M (104 not on WebKit) | 40, 16-thumbnail-management |
| SCHED-101…104 | upload schedule validation, >1y rejected, Arabic preview, scheduled stays private | single | en, ar | L | D+M | 40 |
| BATCH-001…006 | batch mode, rejects non-video / >15, queue/remove/upload/add more, cancel all, Arabic, dark | single | en, ar | L, D | D+M | 41-batch-upload |
| TPL-001…007 | templates list, create, validation/variables/Esc, edit, default + delete, RTL, dark | multi | en, ar | L, D | D+M | 42-upload-templates |
| TPL-008…010 | template applied on upload, episode prompt, default pre-selected | multi | en, ar | L | D+M | 42 |
| SCHED-201…205 | edit-page schedule/cancel, publish now, local time, Arabic, public note | single | en, ar | L | D+M | 43-video-edit-schedule |
| EDIT-101…105 | category save, dark editor, Arabic labels, unknown video, anon redirect | single, anon | en, ar | L, D | D+M | 43, 15-video-edit |
| CHAP-001…006 | add/validate/save, <10s rejected + move/remove, Arabic, import file, parse errors, unsupported file | single | en, ar | L | D+M | 44-video-chapters-subtitles |
| SUB-001…003 | upload en+ar, switch default, delete; invalid file; Arabic dialog | single | en, ar | L | D+M | 44 |
| DASH-001…009 | sort by title, newest first, "Today", card select, open watch, cancel bulk delete, Arabic, dark, phone | single | en, ar | L, D | D+M | 45-dashboard-videos-extended, 14, 19 |
| CAL-101…107 | cancel schedule, publish now, countdown/edit link, Arabic, dark, phone, anon redirect | single, anon | en, ar | L, D | D+M | 46-scheduled-videos-extended, scheduled-videos-calendar |

### Channels, sections, settings, playlists, community
| ID | Case | Role | Loc | Theme | VP | Spec |
|---|---|---|---|---|---|---|
| CHL-001…005 | directory tiles, Load More, tile opens channel, Arabic RTL, dark | anon | en, ar | L, D | D+M | 50-channels-directory |
| CHL-010/011 | create-channel dialog validation + cancel (en / ar) | single | en, ar | L | D+M | 50, 09 |
| CHTAB-001…007 | header, Arabic header, anon Subscribe → login, unknown channel, owner actions, subscribe/unsubscribe, no-channel error | anon, single, none | en, ar | L | D+M | 51-channel-page |
| CHTAB-010…019 | tab bar per config, videos/shorts/live/playlists/community/channels tabs, invalid tab, back/forward, phone scroll, dark | anon | en, ar | L, D | D+M (018 M only) | 51 |
| SECT-001…008 | section manager: add, validate, edit, keyboard reorder, delete, Arabic, breadcrumb RTL | single | en, ar | L | D+M | 52-channel-sections |
| SECT-010 | featured-video and playlist sections render content | anon | en | L | D+M | 52 |
| SECT-020/021 | `/sections` page (en / ar) | anon | en, ar | L | D+M | 52 |
| CHSET-001/002 | settings overview (en / ar) | single | en, ar | L | D+M | 53-channel-settings |
| CHSET-010/011 | anon and non-owner redirected from all 8 settings pages | anon, multi | en, ar | L | D+M | 53 |
| CHSET-020/021 | edit Arabic description + restore; English name required | multi | en, ar | L | D+M | 53 |
| CHSET-030/031 | videos page, search (en / ar) | single | en, ar | L | D+M | 53 |
| CHSET-040…044 | tab manager: hide, default tab, keyboard reorder, Arabic | multi | en, ar | L | D+M | 53 |
| PLAY-001…003 | playlist manager create/rename/private/delete, validation, Arabic | single | en, ar | L | D+M | 54-playlists |
| PLAY-010…012 | playlist page, Play all, Arabic, unknown playlist | anon | en, ar | L | D+M | 54 |
| PLAY-020/021 | owner reorders/removes; private playlist hidden from anon | single, anon | en | L | D+M | 54 |
| COMM-001…006 | community management list/search/view, text/poll/quiz posts, validation, Arabic editor | single | en, ar | L | D+M | 55-community |
| COMM-010/011 | like/unlike, comment on a post | multi | en | L | D+M | 55 |
| COMM-020…022 | anon read-only, Arabic post card, empty state | anon | en, ar | L | D+M | 55 |

### Profile, settings, privacy/consent
| ID | Case | Role | Loc | Theme | VP | Spec |
|---|---|---|---|---|---|---|
| PROF-001…003 | sign-in prompt on /profile and /profile/edit, Arabic, Sign In starts OAuth | anon | en, ar | L | D+M | 63-profile |
| PROF-010…012 | profile page: name/photos/channel, Edit opens form, RTL placement | single | en, ar | L | D+M | 63 |
| PROF-020/021 | /profile/create redirects when a profile exists | none | en, ar | L | D+M | 63 |
| PROF-030…035 | edit: prefilled + read-only email, save bilingual name/bio then revert, Cancel, photo pickers (click/keyboard), avatar upload + revert, Arabic | none | en, ar | L | D+M | 63 |
| PROF-040 | inputs readable in dark mode | single | en | D | D+M | 63 |
| — | create form fields/validation, responsiveness | anon, single | en, ar | L | D+M | 03-profile |
| SET-001…030 | settings sign-in prompt, sections + links, Arabic, no-channel state, dark | anon, single, none | en, ar | L, D | D+M | 64-settings-privacy |
| PRIV-001…012 | privacy page: anon hides export/delete, consent save, clear device data, Arabic, export JSON, delete guarded by confirm word | anon, none | en, ar | L | D+M | 64 |
| CONS-001…030 | banner on first visit, reject/accept/customise, privacy page reflects choice, expired cookie re-asks, non-modal, Arabic, dark, signed-in | anon, none | en, ar | L, D | D+M | 65-consent-banner |

### Feed, subscriptions, analytics, home, search
| ID | Case | Role | Loc | Theme | VP | Spec |
|---|---|---|---|---|---|---|
| HOME-001…009 | cards, seed video, Load More, open watch, Arabic RTL, no h-scroll, grid columns, dark, signed-in | anon, single | en, ar | L, D | D+M | 60-home-videos, 01-homepage |
| VIDS-001…004 | videos page heading/cards, Arabic, load more, hreflang | anon | en, ar | L | D+M | 60 |
| FEED-001…012 | sign-in prompt, empty feed, Arabic, subscribed channel's videos, refresh, RTL cards | anon, none, multi | en, ar | L | D+M | 66-feed-subscriptions |
| SUBS-001…012 | sign-in prompt, empty list, list + unsubscribe, Arabic label, phone accessible name | anon, none, multi | en, ar | L | D+M (012 M only) | 66 |
| ANA-001…030 | sign-in prompt, zeroed totals without channel, totals/engagement/trends, Arabic, viewport, dark | anon, none, single | en, ar | L, D | D+M | 67-analytics |
| — | search v2 page, filters, history; explore | anon, single | en, ar | L | D+M | 21-search-v2, 22-explore (search workstream) |

## 3. Cross-cutting suites

| ID | What | Matrix | Spec / tool |
|---|---|---|---|
| A11Y-ALL | axe-core WCAG 2.0/2.1 A+AA, zero violations, on every page of the route inventory (45 pages × anon/none/single) | en, ar × L, D (180 scans) | `e2e/a11y/axe-all-pages.spec.ts`, project `a11y` |
| VIS-* | `toHaveScreenshot` of home, channels, channel, watch, 404, privacy, upload, dashboard; thumbnails/avatars/cards/metrics/player/dates masked | en, ar × L, D (32 snapshots), 1280×800 | `e2e/visual/visual-pages.spec.ts`, project `visual`; baselines in `e2e/visual/__screenshots__/visual/` generated by the `update-visual-snapshots` workflow job |
| LHCI | Lighthouse budgets (performance ≥ 0.6, a11y ≥ 0.95, best practices ≥ 0.9, SEO ≥ 0.9, LCP ≤ 4s, CLS ≤ 0.1, TBT ≤ 600ms, script ≤ 900KB) for home, watch, channel, search (+ `/ar`) on QA, warn-only | desktop preset, 3 runs | `apps/web/lighthouserc.js`, workflow job `lighthouse` |
| PERF | Core Web Vitals / load budgets in the browser projects | en | 07-performance |

## 4. Status

See the PR description for the latest run (passing/failing per project) and the
list of cases that wait for an api-videos deploy.
