# Epics 5–8 status audit

**Audited:** 2026-11-08, against `origin/main` (da566b6) and the live QA site (https://videos.qa.alummahnow.net).
**Source of the stories:** `docs/archive/epics-original.md`. `docs/epics.md` keeps only a one-line summary per epic. In the archive, Epic 8's two stories (8.1 chapters, 8.2 player navigation) and Epic 6's stories appear under duplicate "Epic 7" headings and are mapped here by story number.

**Legend:**
- **Done:** every AC is met in code and works on QA.
- **Partial:** some ACs are met.
- **Not done:** nothing, or only a stub.
- **Owned by Epic N:** another epic (and its agent) owns the work, so it is skipped here to avoid duplication.

Owners referenced: Epic 21 (native "Islamic differentiators": 21.3 scholar verification, 21.8 study notes), Epic 22 (22.3 study circles), Epic 24 (creator support/premium, decision D4), Epic 26 (embedded discussions), Epic 27 (plans & payments), Epic 28 (AI moderation, `docs/specs/AI-MODERATION.md`), Epic 29 (core web, `docs/specs/CORE-WEB-EXPERIENCE.md`).

## Counts (acceptance criteria)

| Epic | ACs | Done | Partial | Not done (here) | Owned elsewhere |
|---|---|---|---|---|---|
| 5 Creator tools | 23 | 4 | 4 | 6 | 9 |
| 6 Community & moderation | 26 | 2 | 3 | 3 | 18 |
| 7 Discovery | 24 | 13 | 5 | 2 | 4 |
| 8 Video features | 20 | 15 | 0 | 2 | 3 |
| **Total** | **93** | **34** | **12** | **13** | **34** |

"Not done (here)" means the AC is in this epic's scope; its plan is in the last section.

---

## Epic 5: Content Creator Tools Enhancement

### Story 5.1 Advanced creator analytics: **Partial**

| AC | Status | Evidence | Gap |
|---|---|---|---|
| Dashboard with per-video performance | Done | `/[locale]/analytics`, `/[locale]/analytics/videos/[id]`. API `GET /api/analytics/{summary,metrics,channels/:id,videos/:id}` (`api-videos/src/endpoints/analytics/analyticsOwner.ts`). Rollups in `processor/src/lib/analytics-rollup.ts` (#284, #285) | CTR is 0: no impressions tracked |
| Viewer demographics | Not done | Rollups hold views, watchTime, sources and embedOrigins only | Country, device and language never collected → queue issue |
| Engagement patterns | Partial | Watch time, average view duration, likes, comments, engagement rate, daily trend chart | No retention curve ("coming soon", `VideoAnalyticsView`) |
| Compare across videos | Partial | Top-5 list, period-over-period change (`AnalyticsDashboard`) | No side-by-side comparison |
| Posting-time / content-type insights | Not done | none | → queue issue |
| Export | Not done | none | **Planned here (CSV export)** |
| Real-time data during live events | Owned by Epic 29.17 / native live (Epic 17) | `currentViewers` always 0 (`liveStreamCreate.ts:89`) | Live provider is decision D3 |
| Revenue metrics | Owned by Epic 24 (D4) | none | No monetisation yet |
| Predictive suggestions | Not done | none | → queue issue |

### Story 5.2 Halal-compliant monetisation: **Owned by Epic 24 (+ Epic 27 payments)**

Donations, memberships with revenue share, sponsorship vetting, merchandise, revenue reports and tax tools: **none exist** (no hits for `donat|sponsor|merch|payout|stripe|paddle` in `apps/` or `packages/`). Epic 24 (24.1 creator support, 24.2 premium, 24.3 ethical sponsorship) owns this. It is blocked on decision D4 ("none at launch") and Epic 27.7 payment providers. 6 ACs, all owned elsewhere.

### Story 5.3 Content management workflow: **Partial**

| AC | Status | Evidence | Gap |
|---|---|---|---|
| Bulk metadata edit | Not done | `/[locale]/dashboard/videos` and channel videos settings: bulk **delete** only (`POST /api/videos/bulk-delete`) | **Planned here (bulk edit: visibility, category, tags)** |
| Scheduled publication | Done | `POST/GET/PATCH/DELETE /api/videos/:id/schedule`, `publish-now`, `GET /api/videos/scheduled`; `apps/scheduler` (every minute); `ScheduleSection`, `/[locale]/scheduled-videos` (200 on QA) | – |
| Playlists and series | Partial | Playlist CRUD, `/[locale]/playlist/[id]`, management page; play-all is Epic 29.13 | No "series" type → learning paths are Epic 21.5 |
| Collaborate with other creators | Owned by Epic 19.6 / 29.18 (team roles) | single `userId` ownership | – |
| Upload with progress | Done | TUS (`TusParallelManager`, `tusProxy.ts`), pause/resume, batch queue | – |
| Processing status visible | Done | `GET /api/videos/:id/upload-status`, dashboard status filter | Per-rendition detail not shown |
| Versioning/backup | Not done | none | → queue issue (replace file, metadata history) |
| Rights management | Partial | `VideoLicense` type only in upload templates; `copyright` report reason | License not on the video or edit form; claims → Epic 28 appeals |

---

## Epic 6: Community & Moderation Platform

### Story 6.1 Scholar verification: **Partial (mostly owned by Epic 21.3)**

| AC | Status | Evidence | Gap |
|---|---|---|---|
| Verification badges displayed | Partial | `Channel.isVerified`; badge in `ChannelHeader`, `ChannelTile`, `ChannelCard`, `PostCard`, `Comment`, search results | **Planned here:** badge on the watch page |
| Credentials visible | Owned by Epic 21.3 | none | – |
| Transparent documented process | Owned by Epic 21.3 | none | – |
| Consistent across platform | Partial | see above; search `verified` filter (`lib/search/query.ts:131`) | **Planned here** with the badge work |
| False claims prevented | Partial | Owners can't set `isVerified` (`ChannelUpdateInput` strips it) | **Planned here:** no admin endpoint sets it either |
| Appeals | Owned by Epic 21.3 / 28.11 | none | – |
| Verified prioritised in recommendations | Owned by Epic 21.3 | none | – |
| Application workflow + admin review | Owned by Epic 21.3 | none | – |
| Scholar directory | Owned by Epic 21.3 | `/en/scholars` 404 | – |

### Story 6.2 Moderation tools: **Owned by Epic 28**

The base works: D1 `reports`, admin-api list/stats/get/action, admin-web `/moderation` with report detail, user reports via queue, and roles (`super_admin`, `admin`, `moderator`). All 8 ACs go to Epic 28:

| AC | Status | Owner |
|---|---|---|
| AI-assisted review with scoring | Not done | Epic 28.1–28.3 |
| Context-sensitive rules | Not done | Epic 28.2, 28.13 |
| Decisions and appeals tracked | Partial (decision fields on the report row) | Epic 28.11 |
| Scholar consultation | Not done | Epic 28 (escalation) |
| Auditable actions | Partial (report row + logs, no append-only audit) | Epic 28.1 |
| Escalation paths | Not done (`escalated` only in docs) | Epic 28.1 |
| Moderator wellness | Not done | Epic 28 |
| Performance metrics | Partial (`ReportStats` counts) | Epic 28.5 |

### Story 6.3 Community engagement: **Partial**

| AC | Status | Evidence | Gap / owner |
|---|---|---|---|
| Study groups / watch parties | Owned by Epic 22.3 (study circles) | none | – |
| Moderated Q&A | Owned by Epic 26 / 22.3 | none | – |
| Topic forums | Owned by Epic 26 (discussions) | none | – |
| Connect with similar users | Not done | none | → queue issue |
| Community features moderated and safe | Done for what exists | Community posts and comments go through the report flow | – |
| Cultural sensitivities respected | Owned by Epic 28 | – | – |
| Positive contributions recognised | Not done | none | → queue issue (reputation) |
| Clear community guidelines | Not done | `/en/community-guidelines` 404; only an upload-page hint | **Planned here: guidelines page (en/ar)** |
| (Community posts on channels, from the technical notes) | Done | `/api/community` (19 endpoints), `CommunityTabContent`, management page | Remaining gaps are Epic 29.4 |

**#301 (live comments never arrive):** **owned by Epic 29.2**, which lists "live updates for other viewers". The audit found the hook subscribes correctly (`useRealTimeComments.ts:206`). The likely cause is that anonymous sockets never authenticate and the server rejects their subscribes (`websocket-server/src/websocket.ts:315`). Each watch page also opens a second socket (`useVideoWebSocket`). These notes are on the issue for the Epic 29 owner.

---

## Epic 7: Content Discovery Enhancement

### Story 7.1 Advanced search (#40): **Owned by Epic 29.8 (mostly done)**

| AC | Status | Evidence |
|---|---|---|
| Filter type/language/duration/date | Done (custom date range missing) | `GET /api/search` (`searchGet.ts`), `SearchFilterPanel` |
| Sort relevance/date/views/rating | Partial (no rating sort) | `lib/search/query.ts:135` |
| Saved search preferences | Owned by Epic 29.8 | URL state only |
| Arabic input / normalisation | Done | `shared-types/src/search/normalize.ts`, FTS5 index (`migrations/search/0001_search_index.sql`) |
| Suggestions | Done | `GET /api/search/suggestions` (live on QA) |
| Search history | Done (on device) | `web/src/lib/search/history.ts` |
| View-count / subtitles / HD filters | Owned by Epic 29.8 | not indexed |

### Story 7.2 Trending (#39): **Partial**

| AC | Status | Evidence | Gap / owner |
|---|---|---|---|
| Algorithm (engagement + recency) | Done | `GET /api/trending` → `rankTrending` (`api-videos/src/lib/discovery.ts`); live on QA | Computed on read (no cron cache) |
| By region and language | Partial (language only) | `discovery.ts:115` | Region: Epic 29.7 |
| Trending categories | Partial | category filter; Explore category counts | Epic 29.7 |
| Filter by content type | Owned by Epic 29.7 | videos only | – |
| Time periods | Done (API hour/day/week/month) | Explore UI fixed to week | Picker: Epic 29.7 |
| Trending page / home section | Done | `/[locale]/explore`, `/[locale]/sections` | – |
| Real-time updates | Not done | none | → queue issue |
| Discover new creators | Done | Explore "new channels" rail | – |
| Aligns with Islamic values | Done | hidden/moderated content excluded from discovery | – |

### Story 7.3 Navigation: **Partial**

| AC | Status | Evidence | Gap |
|---|---|---|---|
| Category navigation | Done | Explore `CategoryGrid`, `GET /api/explore` | – |
| Related content relevant | Not done | Watch page calls the generic feed (`WatchPageContent.tsx:82` `fetchVideos(null)`), not `GET /api/recommendations?videoId=`, which exists | **Planned here** |
| Recommendations improve over time | Partial | History-seeded `RecommendationsGet` | "Not interested" feedback: Epic 29.11 |
| Create/follow collections | Owned by Epic 29.13 | playlists, no follow | – |
| RTL navigation | Done | `rtl/` component variants | – |
| Islamic topics taxonomy | Done | `VIDEO_CATEGORIES` (15 categories, en/ar) | – |
| Similar content and creators | Partial | via related (above) | Fixed by the related-content work |
| Explore page | Done | `/[locale]/explore` (200 on QA, en/ar) | – |

---

## Epic 8: Video Content Features

### Story 8.1 Chapters (#38): **Partial**

| AC | Status | Evidence | Gap |
|---|---|---|---|
| Chapter storage + API | Done | Stored on the video; `GET`/`PUT /api/videos/:id/chapters` (owner-checked, `chaptersUpdate.ts`) | PUT replaces the list (no per-chapter POST/DELETE; not needed by the UI) |
| See chapters with timestamps | Done | `ChapterList` in `VideoPlayerWithChapters` | – |
| Jump to chapter | Done | `seekToChapter` | – |
| Current chapter highlighted | Done | `currentChapterIndex`, `CurrentChapter` overlay | – |
| Progress-bar markers | Done | `ChapterMarkers.tsx` | – |
| Previous/next chapter | Not done | `nextChapter`/`previousChapter` exist in `useVideoChapters` but no control or key calls them | **Planned here** |
| Creator chapter editor | Done | `ChapterEditor`, `ChapterUpload` on `/video/[id]/edit` | – |
| Bilingual chapters | Done | `titleLocalized.{en,ar}` | – |
| Chapters parsed from description | Done | `api-videos/src/lib/chapters/parser.ts` | – |
| `?t=` links | Done | `parseTime` (`123`, `2m30s`, `1h2m3s`) on the watch page; share-at-time (#264) | Clickable description timestamps: Epic 29.12 |
| Personal timestamps / notes | Owned by Epic 21.8 (study notes) | none | – |
| Works on mobile | Done | responsive `ChapterList` | – |
| AI auto-chapters | Owned by Epic 28.7 (transcripts) / `docs/features/27-auto-chapters-ai.md` | `source: 'automatic'` type only | – |

### Story 8.2 Player navigation: **Partial**

| AC | Status | Evidence | Gap |
|---|---|---|---|
| Keyboard shortcuts | Done | `lib/video/keyboard-shortcuts.ts`, `?` help modal | – |
| Playback speed | Done | 0.25–2× (`videojs-setup.ts`) | – |
| Timestamped notes | Owned by Epic 21.8 | none | – |
| Create and share clips | Not done | share-at-time only (`ShareDialog`) | → queue issue (needs start/end, clip player) |
| Picture-in-picture | Done | `fullscreen-pip.ts` | – |
| Resume across sessions | Done | `useWatchProgress` + player opens at the saved position with a "Start from beginning" pill (#282, #242) | – |
| Accessibility | Done | `lib/video/accessibility.ts` aria labels, `ChapterList` roles | – |

---

## Bugs taken by these epics

| Issue | Status |
|---|---|
| #296 Shorts tab always empty | Fixed in #326: Shorts/Live from the ownership index, `videosCount` from the index |
| #294 "Unknown Channel" in history | Fixed in #327: channel resolved by `channelId`, old entries repaired on read |
| #301 Live comments never arrive | Owned by Epic 29.2 (comment with findings left on the issue) |

## Plan: gaps implemented by Epics 5–8

Small PRs, each with unit tests and, for user-facing flows, a release E2E (`apps/web/e2e/release/`). All are en/ar with RTL and no hard-coded strings.

1. **7.3** Watch page "related" uses `GET /api/recommendations?videoId=`.
2. **8.1** Previous/next chapter buttons and keyboard shortcuts.
3. **6.3** Community guidelines page (`/[locale]/community-guidelines`), linked from the footer and upload page.
4. **5.1** Analytics CSV export (channel summary and per-video daily metrics).
5. **6.1** Admin endpoint to set or clear channel verification (audited), and the verified badge on the watch page.
6. **5.3** Bulk edit of visibility, category and tags on the creator videos dashboard.

## Implemented (2026-11-08)

| Plan item | PR | Release E2E |
|---|---|---|
| #296 Shorts tab / `videosCount` | #326, #332 | `channel-shorts.spec.ts` |
| #294 history channel name | #327 | `watch-history.player.spec.ts` |
| 7.3 Related from `GET /api/recommendations?videoId=` | #337 | `related.spec.ts` |
| 8.1 Previous/next chapter buttons and Ctrl/Alt+arrow keys (RTL aware) | #340 | `chapters.player.spec.ts` |
| 6.3 Community guidelines page (en/ar), nav and upload links | #346 | `community-guidelines.spec.ts` |
| 6.1 Admin verification endpoint with audit log | #367 | API only (admin) |
| 6.1 Verified badge on the watch page, one localized `VerifiedBadge` | #382 | n/a |
| 5.1 Analytics CSV export | #383 | n/a (client download) |
| 5.3 Bulk edit visibility, category and tags | #388 | n/a (needs a creator account) |

Release E2E specs: #389. Follow-ups: #368 (schema snapshot with spaces), #380 (verification vs concurrent owner edit), admin-web UI for verification (not built; the endpoint is usable from admin-api).

Queued as GitHub issues (label `queue`), outside this pass: viewer demographics, posting-time insights, predictive suggestions, video file replacement/versioning, license on video, real-time trending, clips, reputation, similar-user discovery.
