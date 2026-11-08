# Analytics and watch history: current state and plan

Status as of 2026-11-08. Covers the queue event pipeline, watch history, and creator and admin analytics.

## 1. Pipeline overview

```
web player ──► Next route /api/analytics/video ──► POST /api/videos/:id/view ──┐
web player ──► useWatchProgress ──► /api/watch-history[/:id/progress] ─────────┤ api-videos
api-videos endpoints (likes, comments, subscriptions, uploads …) ──────────────┤ (binding `queue`)
                                                                               ▼
                                   queue al-ummah-now-videos ──► al-ummah-now-processor
                                         (DLQ al-ummah-now-dlq)   │
                                                                  ├─ archive every message: al-ummah-now-messages/<ISO>.<id>
                                                                  ├─ VideoView ─► analytics/rollups/{video,channel}/<id>/<YYYY-MM>.json
                                                                  ├─ Subscribe/Unsubscribe ─► D1 channel subscriber index
                                                                  ├─ Notification* ─► D1 notifications + realtime push
                                                                  ├─ Upload/LiveStream lifecycle ─► realtime push
                                                                  ├─ PostLike/PollVote ─► post counters
                                                                  ├─ Report*/UserDataErased ─► D1 moderation reports
                                                                  └─ SearchIndexSync ─► D1 search index
api-videos GET /api/analytics* ◄── reads rollups (binding `analytics_rollups`) + counters on R2 objects
```

Every message uses the `QueueMessage` envelope `{ id, type: MessageType, payload, timestamp }`. Messages without it fail `validateMessage`. They go to the DLQ and are never archived.

## 2. Watch history

### What was broken (fixed in this change)

| # | Defect | Effect |
|---|---|---|
| 1 | `useWatchProgress` called the API only when an `authToken` prop was set. No caller passes one, because auth cookies are httpOnly. | Every signed-in watch went to encrypted device storage. The prod and QA `watch-history` buckets held **0 objects**. |
| 2 | `POST /api/watch-history` and `/:id/progress` queued `{ type: "WatchHistory", data }`. | The processor rejected the message as "Invalid message structure" and sent it to the DLQ. |
| 3 | A duration of 0 produced a `NaN` percentage. | Corrupt entries. |
| 4 | Legacy (imported) videos have `channelId: null` and keep the channel name in `channel`. | The entry showed "Unknown Channel" and linked to `/channels/`. |

### Now

- **Player:** `useWatchProgress` saves every 10 s, and also on pause, seek, end and unmount. (Fixed in #265: the 10 s interval never started when the player reached the hook before the media had metadata, because the hook waited on `one('ready')`, an event that had already fired. Pause/seek/ended still saved.) API save failures are now logged with `logger.warn` before falling back to device storage. Videos shorter than 30 s are skipped. For a signed-in user it gets the token from `/api/auth/token`, so it no longer needs the prop. It falls back to device storage when there is no token.
- **API:** `POST /api/watch-history` creates the entry and `POST /:id/progress` updates it. The web client tries progress first and records on a 404. Entries are stored in R2 `watch_history` as `${userId}:${videoId}`.
- **Pause:** `GET`/`PUT /api/watch-history/settings` read and set `{ paused }`, stored as `watchHistoryPaused` on the profile. While paused, record and progress return `200 { paused: true }`, and nothing is stored or queued.
- **UI:** `/[locale]/history` lists entries newest first, with "load more", remove one, clear all, and the new pause/resume toggle with a notice while paused.
- **Retention:** entries are deleted 548 days after the last watch (`lib/privacy/retention.ts`). History is included in GDPR export and erasure.

**Measuring the store:** `wrangler r2 bucket info watch-history` reports `object_count` from R2 metrics, which lag behind writes (it showed 0 while entries existed). List the objects instead, e.g. `GET /client/v4/accounts/<acct>/r2/buckets/watch-history/objects`, or call `GET /api/watch-history` as the user. History lives only in R2 (`watch-history`, `watch-history-qa`, `watch-history-stage`), not D1.

### Remaining gaps (viewer UI)

| Gap | Notes |
|---|---|
| Resume prompt on the watch page | `useWatchProgress` loads `savedProgress`, but the `ResumePrompt` component (`components/VideoPlayer/ResumePrompt*`) is not rendered anywhere, so there is no resume UI. |
| Recommendations from history | `sections/recommended.ts` and `discovery.ts` read history. Measure their quality now that history actually fills. |
| Legacy `/api/profiles/watch-history` | Writes to `profile.watchHistory`. No web caller. Remove it after one release. |
| Listing cost | `list` loads up to 5,000 entries per request. Needs a D1 index (`watch_history(user_id, last_watched_at)`) for paging. |
| In-place video switches | When the same player instance switches video, the hook re-keys on `videoId`. Confirm with an E2E test. |

## 3. Event audit (api-videos → processor)

Legend: **W** = working (consumed and its output is used), **L** = consumed but only logged and archived (nothing reads the result), **B** = broken, **D** = defined but never produced.

| MessageType | Produced by | Processor | Writes | Read by | State |
|---|---|---|---|---|---|
| VideoView (from `/videos/:id/view`) | `videoView.ts` | rollup | `analytics/rollups/video\|channel/*` | `GET /api/analytics*` | **B → fixed**: videos with `channelId: null` (imported legacy videos) were skipped entirely, and prod had **no** rollup objects. The video rollup is now always written. watchTime is always 0 (§5). |
| VideoView (fetch, search telemetry) | `videoFetch.ts`, `videoSearch.ts` | log | archive | nothing | L. Overloads VideoView; should become its own type. |
| WatchHistory | `watch-history/record.ts`, `update-progress.ts` | log | archive | nothing | **B → fixed** (envelope). Still log-only. |
| ProfileCreate/Update/Delete/View | profile endpoints, legacy `watchHistoryAdd` | log | archive | nothing | L |
| ChannelCreate/Update/Delete/View | channel endpoints | log | archive | nothing | L |
| Subscribe / Unsubscribe | `SubscriptionCreate/Delete.ts` | D1 subscriber index | `NOTIFICATIONS_DB` | notification fan-out | W. Not used for analytics; subscriber growth is computed from `dateCreated`. |
| VideoCreate/Edit/Delete | video endpoints | log | archive | nothing | L |
| VideoLike/Unlike/Dislike/Undislike | reaction endpoints | log | archive | nothing | L. Likes over time come from the counters, not from events. |
| CommentCreate/Edit/Delete/Unlike/Undislike | comment endpoints | log | archive | nothing | L. CommentLike and CommentDislike are never produced. |
| PlaylistCreate/Edit/Delete/Add/Remove | playlist endpoints | log | archive | nothing | L. PlaylistClone is never produced. |
| LiveStreamCreate/Update | live endpoints | realtime push | — | web live page | W. LiveStreamStart, End and View are never produced from api-videos. |
| VideoUploadStarted/Completed/Cancelled/Failed, VideoProcessingCompleted | upload endpoints, tus proxy, scheduler | realtime + notification | D1 notifications | uploader UI | W |
| PostComment* / CommunityPost* | community endpoints | log | archive | nothing | L |
| CommunityPostLiked/Unliked, PollVoted | community endpoints | counters | community-posts R2 | community UI | W |
| ChannelSectionCreate/Update/Delete/Reorder | channel-section endpoints | handler | channel-sections R2 | channel page | W |
| ChannelTabUpdate | `channelTabsUpdate.ts` | **none** (case commented out) | — | — | **B**: hits `default` → "Unknown message type" → retried, then sent to the DLQ. Issue filed. |
| ReportCreate / ReportResolve | moderation | D1 reports | `reports` table | admin moderation | W |
| ClientAnalyticsEvent | `/api/analytics/events` | archive | archive | nothing | L |
| UserDataErased | privacy | anonymise D1 reports, notifications | D1 | — | W |
| NotificationCreate / NotificationFanout | `lib/notifications.ts` | D1 + push | D1 notifications | notification center | W |
| SearchIndexSync | admin-api, scheduler | D1 search index | D1 | search | W |

On prod (2026-11-08), the messages archive holds 282 objects since 2025-11: VideoView, ProfileView, one ProfileCreate and one VideoLike. That matches the very low traffic (369 videos, 79 lifetime views in total), so there is no sign of lost events. The queue has a consumer (`batch_size` 10, `max_retries` 3, DLQ `al-ummah-now-dlq`). Backlog and DLQ depth need the Queues metrics API (issue filed).

**Prod data caveat:** all 369 prod videos are legacy imports with `channelId: null`, owned by a placeholder `userId` (`d3b07384-…`). Until they are assigned to real channels and owners (data migration issue filed), channel rollups stay empty, and no real creator passes the owner check in `/api/analytics`.

## 4. Creator analytics

**API** (`/api/analytics`, owner-scoped):

| Route | Returns |
|---|---|
| `/` | Metrics with previous-period comparison, chart, top videos |
| `/summary` | Lifetime totals |
| `/channels/:id` | One channel's totals and recent metrics |
| `/videos/:id` | One video's totals, watch time and average view duration |
| `/metrics` | Daily series |

Daily views and watch time come from the rollups. Likes, comments and subscribers come from record timestamps. Lifetime totals come from the object counters.

**Web:** there is a single page, `/[locale]/analytics`, showing totals cards, daily views, daily likes plus comments, and top videos. The "stuck loading" bug was fixed in #194: one parallel server action with a 20 s timeout and an error state. Watch time, average view duration and subscriber growth are returned by the API but not shown. There is no per-video analytics page.

**Supported now vs missing:**

| Capability | State |
|---|---|
| Lifetime views, likes, comments per video and channel | Supported |
| Daily views per video and channel | Supported from this fix on. Before it, empty for legacy videos and on prod overall. |
| Daily likes, comments, new subscribers | Supported. Gross gains only, no unsubscribes. |
| Watch time, average view duration | **0 everywhere.** The web route forwards `watchTime: 0`. |
| Retention curve, quartiles | Missing. The player tracks them, but the Next route drops everything except `ready`. |
| Traffic sources, devices, geography | Missing. Hardcoded `direct`/`desktop`. |
| Logged-in vs anonymous, unique viewers | Missing. The view call carries no identity. |
| View dedup and anti-abuse | Missing. One view per player load. |
| Realtime, hourly | Missing. `granularity=hour` falls back to daily. |
| Impressions, CTR, shares | Missing. Hardcoded 0. |
| Playlist and live analytics | Missing |

## 5. Admin analytics

The admin side has only moderation report stats (`GET /api/moderation/reports/stats`, plus the dashboard cards). It has no platform metrics: users, uploads, views, watch time, active creators, queue health or DLQ depth. The public `GET /metrics` in api-videos counts at most 1,000 objects per bucket, so it is wrong at scale.

## 6. Plan to complete

### Backend and pipeline
1. **Watch time:** add a `watch_time` heartbeat. The player sends played-seconds deltas from `VideoAnalytics` progress events to `POST /api/videos/:id/watch-time` (rate-limited, max delta 60 s), which queues `VideoWatchTime`. The processor adds the deltas to the rollups. *Issue.*
2. **Retention:** queue quartile and progress buckets per video and roll them into `analytics/retention/video/<id>/<YYYY-MM>.json` as 0–100 % in 5 % buckets. *Issue.*
3. **Dimensions:** forward real `deviceType` (from the UA), `referrer` (from `document.referrer` and the internal surface) and country (from `cf.country`, server side). Roll them up per day as top-N maps. *Issue.*
4. **ChannelTabUpdate:** stop producing it, or consume it as a no-op. *Issue.*
5. **Event hygiene:** give fetch and search telemetry their own types. Make log-only handlers explicit no-ops so a missing case cannot DLQ messages. Add a processor test asserting that every produced `MessageType` has a case. *Issue.*
6. **Archive and DLQ investigation:** reconcile producer volume against the archive. Expose queue and DLQ depth to admin. *Issue.*

### Creator UI
- Show watch time, average view duration and subscriber growth (the API already returns them).
- Add a per-video analytics page using `GET /api/analytics/videos/:id`, plus the retention curve once item 2 lands.
- Add traffic source and device breakdowns once item 3 lands. *Issue.*

### Viewer UI
- History, remove, clear and pause: done.
- Resume prompt from API progress, "Continue watching" shelf on the home page, recommendations weighted by history (respecting pause). *Issue.*

### Admin UI
- Platform dashboard: daily active viewers, views, watch time, uploads, new users and channels, top videos and channels, queue/DLQ depth. Data comes from new platform rollups (`analytics/rollups/platform/<YYYY-MM>.json`) written by the processor. *Issue.*

### Data and migrations
- No migration is required for this change. `watchHistoryPaused` is optional on the profile, and missing means not paused.
- **Backfill:** the archived VideoView messages can rebuild video rollups for legacy videos. This is a one-off script that reads `al-ummah-now-messages/<ISO>.<id>` where `typeName == VideoView && 'videoChannelId' in payload` and calls `recordViewRollup`. Optional, because the volume is small.
- Future D1 index for watch history paging (§2).

### Tests in CI
- Added: web hook regression (`useWatchProgress.auth.test.tsx`), pause hook and service tests, API `watch-history-pipeline.spec.ts` (envelope, pause, legacy channel, NaN), processor tests (legacy rollup, WatchHistory envelope).
- To add: an E2E test that signs in a QA user, plays 15 s and expects `/history` to list the video (extend `e2e/33-watch-history.spec.ts`), and the produced-type coverage test in item 5.
