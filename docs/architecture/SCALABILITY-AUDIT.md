# Scalability audit: running many copies at once

Cloudflare runs every Worker as many isolates in many locations at the same time, autoscales queue
consumers, and lets several requests share one isolate. This audit covers every Al Ummah Now app and
lists the code that is only correct when exactly one copy runs.

Repos covered: AlUmmahNow (web, api-videos, processor, admin-api, admin-web, scheduler,
websocket-server/realtime, log-service, packages), AlUmmahNowAuth (auth, profile, admin,
audit-consumer) with the openauth fork, AlUmmahNowUI, AlUmmahNowCMS, AlUmmahNowCore and
AlUmmahNowTools. `globalThis.OPENAUTH_THEME` is handled separately and is not covered here.

## What counts as a defect

- **Module-level or `globalThis` mutable state** that is meant to be shared, such as locks,
  counters, rate limits, single-flight maps or per-user caches. Each isolate has its own copy, and
  one isolate serves many users at once.
- **R2 or KV read-modify-write without a condition.** On R2, use `onlyIf: { etagMatches }` and
  retry. KV has no compare-and-swap, its reads are cached for about 60 s, and it accepts about one
  write per second per key, so nothing that must add up exactly can live in KV.
- **In-memory locks, counters or rate limits** that assume a single instance.
- **Single global Durable Objects** that every request funnels through.
- **Unbounded fan-out**, meaning work that grows with the catalogue or audience inside one
  invocation. Each invocation has a limit of 1000 subrequests.
- **D1 write hot spots** and multi-statement sequences that are not atomic.

**Not a defect:** short-TTL read caches of non-user data held in module scope or the Cache API,
such as JWKS, OIDC discovery documents, public CMS JSON, imported crypto keys and config. A stale
copy for a few minutes is acceptable. A cache becomes a defect only when it holds per-user data,
never expires, or is invalidated in one isolate only while correctness depends on the change.

## Fixed designs

### View counter (AV-1), [#504](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/504)

The old code read the video JSON, added one, and wrote it back blind. Parallel views were lost, and
every view could overwrite a concurrent edit, moderation action or comment.

- **Counting.** `POST /videos/:id/view` sends `POST /views/increment` to a Durable Object named
  `views:<videoId>:<shard>`. There are 4 shards, chosen at random per view. Each shard keeps a
  cumulative total in DO storage, and the DO serializes increments, so none are lost.
- **Writing back to R2.** A shard writes back at most once every 10 s, using an alarm. It writes
  `viewCounter: { base, shards: { <n>: total } }` into the video JSON with an etag compare-and-swap,
  and it merges by taking the maximum. A flush is therefore idempotent, a retry can never count
  twice, and the shards never overwrite each other.
- **The `views` field.** `views = base + Σ shards`. Views counted outside the counter, for example
  by the fallback or legacy data, fold into `base`, which keeps the merge monotonic.
- **Self-healing.** Each shard rewrites its total 30 s and 5 min after a write. A blind writer that
  still overwrites the document only hides the count briefly, and the next flush restores it.
- **Reuse of an existing class.** The counter runs in the existing `WebSocketDurableObject` class
  under the new names. A new class would need `wrangler deploy` to apply migrations, and releases go
  through `wrangler versions upload`.
- **Fallback.** If the counter binding is missing or unreachable, api-videos adds one with an etag
  compare-and-swap. The response shows `video.views + unflushed`.
- **Migration.** No data migration is needed. The first flush for a video sets
  `base = views − Σ shards`, so existing counts carry over.
- **Tests.** `apps/websocket-server/test/view-counter.test.ts` runs 1000 parallel views across 4
  shards, with blind writers, a failed flush, a restart and a deleted video, and asserts an exact
  count. `apps/api-videos/test/view-counter.spec.ts` covers the endpoint, the fallback with 200
  parallel requests, and the bindings for each environment.

### Analytics rollups (PR-1), [#505](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/505)

The old code kept monthly rollup documents in R2 and had every processor isolate read-modify-write
them. An in-isolate promise chain was the only serialization, and consumers autoscale, so updates
were lost.

- **Storage.** D1 table `analytics_daily(entity_type, entity_id, day, metric, dim, value)` in
  `NOTIFICATIONS_DB`, with a primary key on all five columns. Every write is
  `INSERT … ON CONFLICT DO UPDATE SET value = value + excluded.value`, so any number of concurrent
  writers adds up exactly.
- **Batching.** Each queue batch collects its increments in one `CounterBatch` and flushes them as a
  single D1 transaction, using a `json_each` bulk upsert of up to 500 rows per statement.
- **Bounded breakdowns.** Embed origins are capped at 50 per entity and day, and anything past the
  cap is counted under `other`. The cap is enforced inside the SQL, so concurrent writers cannot
  exceed it.
- **Studio API.** `apps/processor/src/lib/analytics-counters.ts` exports `CounterBatch`,
  `addCounters` and `readCounters`, and `CounterIncrement { entityType, entityId, day, metric, dim?,
  value, maxDims? }`. New metrics need no migration.
- **Migration and backfill.** An hourly cron (`17 * * * *`) imports the legacy R2 documents that
  have gone 24 h without a write, up to 200 per run. Each import inserts a marker row in
  `analytics_rollup_imports` in the same transaction as the counts, so a document is imported at
  most once. The cron then deletes the document. While the import runs, readers in api-videos add
  D1 to the documents that are not yet imported, so nothing is counted twice or missed.
- **Check script.** `pnpm check:rollup-import --env qa|stage|production` is read-only. It exits 1
  if a document stays un-imported, or imported but not deleted, for more than 48 h.

## Defect list

Severity is the reported impact at scale. The status column links the fix.

| ID | App | Severity | Defect | Status |
|---|---|---|---|---|
| AV-1 | api-videos | high | Blind view-counter write clobbers every other writer of the video JSON (known counter + the wider damage) | fixed in [#504](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/504) |
| AV-2 | api-videos | high | Video comments embedded in the video JSON are written blind | open |
| AV-3 | api-videos | med | Every other blind writer of the video JSON | open |
| AV-4 | api-videos | high | Channel subscriptions embedded in the channel JSON, written blind by many users | open |
| AV-5 | api-videos | med | Other blind writers of the channel JSON | open |
| AV-6 | api-videos | med | Profile JSON written blind by several features (subscriptions reverse index, legacy watch history, profile edits) | open |
| AV-7 | api-videos | low | watch_history entries written both with CAS and blind | open |
| AV-8 | api-videos | high | Community post JSON: view counter on GET clobbers edits, deletes and counters | open |
| AV-9 | api-videos | med | Community post JSON: other blind writers | open |
| AV-10 | api-videos | high | Community comment indexes written blind → comments disappear from listings | open |
| AV-11 | api-videos | med | Community comment JSON counters written blind (likes, repliesCount) and clobbered by edits/heart | open |
| AV-12 | api-videos | low | Pinned comment: two pins at once leave two pinned comments | open |
| AV-13 | api-videos | med | Channel handle claim is not atomic (duplicate handles) | open |
| AV-14 | api-videos | high | KV upload rate limiter is racy, eventually consistent and fails open | open |
| AV-15 | api-videos | high | Section indexes: stale-index stampede, each rebuild exceeds the subrequest budget, and rebuilds race | open |
| AV-16 | api-videos | high for videosearch/subscriptionfeed/channel lists/about | Request-path full-bucket scans (fan-out beyond 1000 subrequests / memory) | open |
| AV-17 | api-videos | high | D1 write amplification on the view path (and every content write) | open |
| AV-18 | api-videos | low-med | Search index can end up older than R2 (cross-request ordering) | open |
| AV-19 | api-videos | low-med | Playlists and watch-later written blind | open |
| AV-20 | api-videos | low | Channel sections / tab config / upload templates: multi-key RMW without conditions | open |
| AV-21 | api-videos | low | Report dedupe is check-then-act | open |
| AV-22 | api-videos | low-med | Community likes/votes: per-user record is check-then-put | open |
| AV-23 | api-videos | med for erasure | Retention / erasure / channel-deletion jobs rewrite objects blind | open |
| AV-24 | api-videos | low | Bunny collection / TUS session / upload status minor races | open |
| PR-1 | processor | high | R2 read-modify-write serialised only in-isolate (`pendingByKey`) | fixed in [#505](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/505) |
| PR-2 | processor | high | R2 read-modify-write of `posts/<channelId>/<postId>.json` with no `onlyIf` etag | fixed in [#510](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/510) |
| PR-3 | processor | high for popular polls | every vote recounts the whole poll (list + one GET per vote doc) and blind-PUTs results.json | fixed in [#510](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/510) |
| PR-4 | processor | medium | like count via full `list` of `likes/<postId>/` on every like. 1000 likes per list call, so 1M likes = 1000 list subrequests per message → over… | fixed in [#510](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/510) |
| PR-5 | processor | medium now, high for big channels | fan-out is one `INSERT OR IGNORE ... SELECT` over every subscriber with `RETURNING` all rows | fixed in [#513](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/513) |
| PR-6 | processor | medium | up to 500 realtime POSTs per fan-out message, and the videos batch runs 10 messages in one invocation | fixed in [#513](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/513) |
| PR-7 | processor | medium | `MESSAGE_QUEUE.send` in a loop, one subrequest each (100 recipients per message): 100k recipients = 1000 sends in one invocation | fixed in [#513](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/513) |
| PR-8 | processor | medium | SearchIndexSync applies the object snapshot carried in the message with no ordering guard | fixed in [#514](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/514) |
| PR-9 | processor | low | daily neuron cap is check-then-act (`SUM` then call AI then record). With autoscaled consumers (5 msgs × up to 250 invocations) the cap overshoots… | fixed in [#521](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/521) |
| PR-10 | processor | low | at-least-once interaction: fan-out insert succeeds, then the invocation fails before pushes/enqueue; the retry's `INSERT OR IGNORE` returns zero… | fixed in [#513](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/513) |
| WS-1 | websocket-server | critical | Hibernation API (`ctx.acceptWebSocket`) used, but all connection state lives only in instance fields | open |
| WS-2 | websocket-server | critical at scale | every socket, every broadcast and every stats call go to ONE global DO (`idFromName('websocket-instance')`) | open |
| WS-3 | websocket-server | medium | presence session list is a KV read-modify-write without any conditional write | open |
| WS-4 | websocket-server | low/medium | broadcast loops over every subscriber and `JSON.stringify`s the message once per socket. With one global… | open |
| WS-5 | websocket-server | low | per-session rate limit is in-memory: it resets on every hibernation/eviction (WS-1) and is per-session, not per-user/IP, so a client can open many… | open |
| WS-6 | websocket-server | low | `webSocketError` deletes the connection but not `sessionToWebSocket`, `rateLimits`, or presence, so the KV presence entry lingers until TTL and… | open |
| AA-1 | admin-api | high | moderator remove/warn/ban is a blind read-modify-write of the whole video/channel/playlist document | open |
| AA-2 | admin-api | high | reviewer hide/restore of a comment rewrites the entire video JSON (comments embedded) | open |
| AA-3 | admin-api | medium | verification is a blind RMW of the channel doc; a concurrent owner channel edit through api-videos either drops `isVerified` or reverts the… | open |
| AA-4 | admin-api | medium | index rebuild lists the whole videos bucket and does one GET per object (up to 50 × 100 = 5000), inside `waitUntil` | open |
| AA-5 | admin-api | low | translations merge and metadata.json are blind RMW. Two admins saving different locales at once: the second metadata.json write drops the first… | open |
| SC-1 | scheduler | high | publish is a blind RMW of the whole video document | open |
| SC-2 | scheduler | medium | every minute the cron lists 72 hourly prefixes (+1 debug `list({limit:100})`) and GETs every object found, plus GETs every object of the current hour | open |
| SC-3 | scheduler | medium | permanently failed entries are re-processed every minute for 72 h | open |
| SC-4 | scheduler | low | `daily_metrics` KV RMW from up to 10 parallel promises in one run (index.ts:105-184) and from overlapping cron runs. Counts are lost and KV's 1… | open |
| WEB-1 | web | medium | refresh single-flight and rotation memory are per isolate, and they hold per-user secrets (access + refresh tokens of up to 500 users, 60 s) | open |
| WEB-2 | web | low | unauthenticated POST that appends to `process.cwd()/logs/app.log` with `fs.appendFile`. On Workers the bundle filesystem is read-only/virtual and… | open |
| WEB-3 | web | low | `kvIncrementalCache` is configured without a `NEXT_INC_CACHE_KV` binding, and no tag cache / revalidation queue is configured. Fetch caching… | open |
| AW-1 | admin-web | low/medium | no single-flight at all for refresh: parallel admin requests (page + RSC prefetches) in different isolates each spend the same refresh token. Same… | open |
| AU-1 | auth | critical | One KV key is the token rate limit for every first-party user (hot key, global lockout, fails open) | open |
| AU-2 | auth | critical | No attempt limit on the 6-digit email code; password-reset brute force leads to account takeover | open |
| AU-3 | auth | high | The KV user record is read-modify-written on every login and overwrites admin changes | open |
| AU-4 | auth | medium | Revocation and sign-out take up to about 60 s per PoP (KV propagation and negative caching) | open |
| AU-5 | auth | low-medium | The `RESEND_API_KEY` secret is cached forever per isolate | open |
| AU-6 | auth | low-medium | D1 session writes are multi-statement and non-atomic, with check-then-insert races | open |
| AU-7 | auth | low | Audit events are buffered in an isolate-wide emitter and the logger singleton is shared across concurrent requests | open |
| AU-8 | auth | info | Dead code that would be unsafe if re-enabled (listed so nobody revives it) | open |
| PF-1 | profile | medium-high | Refreshes from stale reads can trip the issuer's reuse detection and sign the user out everywhere | open |
| PF-2 | profile | low | Logout takes effect only per PoP (tombstone in KV) | open |
| AD-1 | auth admin | medium-high | Same refresh race as PF-1 | open |
| AD-2 | auth admin | low | Every cold isolate fetches its own M2M token | open |
| OA-1 | openauth fork | high | The authorization code is not single-use across isolates or PoPs | open |
| OA-2 | openauth fork | medium-high | Refresh-token rotation and reuse detection run on KV | open |
| OA-3 | openauth fork | medium | A signing or encryption key generation race produces two different keys under the same `kid` | open |
| OA-4 | openauth fork | high (TV sign-in) | The device flow poll overwrites the approval (whole-record read-modify-write on KV) | open |
| OA-5 | openauth fork | low-medium | The flow-record provider state prefers a stale KV copy over the newer cookie | open |
| OA-6 | openauth fork | low-medium | Every request lists KV for the legacy signing keys (fan-out and cost) | open |
| OA-7 | openauth fork | medium | RBAC permission-cache invalidation fans out to every user in a role | open |
| OA-8 | openauth fork | low | Latent in-memory and KV rate limiters (not used by the app today) | open |
| OA-9 | openauth fork | low | The default-tenant cache is per isolate with a 1-hour TTL and local-only invalidation | open |
| UI-1 | UI (www) | medium | unbounded video fan-out per home / videos page render | open |
| UI-2 | UI (www) | low-medium | stale-while-revalidate stampede (no single-flight across isolates) | open |
| UI-3 | UI (www) | low | KV snapshot write is check-then-put; isolates race on the same key | open |
| CMS-1 | CMS | medium | admin media uploads keep the client's file name, so a second upload overwrites the first in R2 | open |
| CMS-2 | CMS | low | first SSO sign-in upsert is SELECT-then-INSERT; two concurrent callbacks for a new user fail one | open |
| CMS-3 | CMS | low | content edits are last-writer-wins with no version check | open |
| CMS-4 | CMS | low on its own, medium together with ui-1 | no cap on curated rows returned to www (feeds UI-1) | open |
| CORE-1 | Core | low | no cross-process lock on the sync and upload stores | open |
| TOOLS-1 | Tools | high | two imports of the same folder (or an import plus a Resume) upload everything twice and create duplicate video records | open |
| TOOLS-2 | Tools | medium | `ImportVideos` lookups ignore the session, so concurrent or repeated sessions update each other's rows | open |
| TOOLS-3 | Tools | medium | Resume marks videos Uploaded without writing their R2 record | open |
| TOOLS-4 | Tools | high | storage keys collide across channels and folders, and blind PUTs overwrite silently | open |
| TOOLS-5 | Tools | high | file watches are owned by a scoped service, so they stop immediately and can't be stopped later | open |
| TOOLS-6 | Tools | medium | duplicate approvals and lost counters from overlapping file events | open |
| TOOLS-7 | Tools | medium | scan progress handler uses the scan engine's DbContext concurrently | open |
| TOOLS-8 | Tools | low now, high once the real upload lands | import status claims are not atomic (ImportWorker vs UI vs a second worker) | open |
| TOOLS-9 | Tools | medium | FilterPresetService deadlocks on its own lock | open |
| TOOLS-10 | Tools | low | per-process rate limit and retry policy against Bunny | open |

The per-app data maps, full scenarios and the "OK" lists follow, one section per repo.


## api-videos — multi-instance / concurrency audit

Scope: `apps/api-videos` (read-only snapshot at `scratchpad/ro-mono/apps/api-videos`). All paths below are relative to `apps/api-videos/src`.

Key facts that drive most findings:

- `R2Repository.updateObject` (lib/r2Repo.ts:85) is a correct etag-CAS loop, but **CAS only protects a key if every writer of that key uses it**. A single blind `putObject`/`bucket.put` on the same key overwrites the CAS writers' changes. Today only 7 call sites use `updateObject`; ~80 blind writes hit the same keys.
- The video JSON in R2 (`videos/<id>`) is a **"god object"**: metadata + `likes[]` + `dislikes[]` + `comments[]` (with nested replies and comment likes/dislikes) + `views` + chapters + subtitles + schedule + upload state. It is written blind by the view counter on every view, so every other writer to that key races with traffic.
- The channel JSON (`channels/<id>`) embeds `subscriptions[]` (one entry per subscriber) and is written blind by subscribe/unsubscribe from *other* users and by owner edits.
- Every R2 put to `videos`/`channels`/`playlists`/`community_posts` is wrapped (lib/search/sync.ts:121) and fans out to D1 `SEARCH_DB` writes (inline ownership UPSERT + background search UPSERT/FTS rewrite).
- Workers bindings calls (R2/KV/D1) count against the per-invocation subrequest budget (1000 on Paid as stated in the brief). `R2Repository.listObjects(n)` costs **1 list + n gets** (lib/r2Repo.ts:17-39), so `listObjects(1000)` alone is 1001 subrequests; `waitUntil` work shares the same invocation budget.

---

### Data map

| Data | Where it lives | Key / table | How it is written |
|---|---|---|---|
| Video metadata | R2 `videos` | `<videoId>` | Blind RMW `getObject`→`putObject` (videoUpdate, bulkUpdate, thumbnail, chapters, subtitles, schedule*, upload*, tus, uploadStatus); blind create (videoCreate/upload/initiate/batch) |
| Video views | R2 `videos` (embedded `views`) | `<videoId>` | Blind RMW `views+1` per view (videoView.ts:99/125) — known; also D1 search row `views` |
| Video likes/dislikes | R2 `videos` (embedded `likes[]`,`dislikes[]`) | `<videoId>` | **CAS** `updateObject` (lib/reactions.ts:61) — defeated by blind writers to same key; mirror in D1 `NOTIFICATIONS_DB.liked_videos` (INSERT OR IGNORE, atomic) |
| Video comments, replies, comment reactions, approval | R2 `videos` (embedded `comments[]`) | `<videoId>` | Blind RMW (commentCreate/Update/Delete/Approve/Reaction) |
| Chapters / subtitles meta / schedule fields / upload status | R2 `videos` (embedded) | `<videoId>` | Blind RMW |
| Subtitle files | R2 `subtitles` | `<videoId>/<lang>...` | Blind put (new object per upload) |
| Scheduled-video records | R2 `scheduled-videos` (two bindings `SCHEDULED_VIDEOS` and `scheduled-videos` to the same bucket) | per video | Blind put / delete |
| Live streams | R2 `videos` | `livestream:<id>` | Blind create; blind RMW on update |
| Section indexes (recent / popular:{period} / trending / category:{c}) | R2 `videos` | `index:recent-videos`, `index:popular-videos:<p>`, `index:trending-videos`, `index:category:<c>` | Full rebuild + blind put, triggered from public GETs when stale (waitUntil) |
| Index metadata | R2 `videos` | `metadata:last-index-update` | Blind RMW (indexManager.ts:353-372) |
| Channels | R2 `channels` | `<channelId>` | Blind RMW (update, avatar, cover, uploadInitiate collection id, handle backfill, delete promote-main, channelDeletion) |
| Subscriptions | R2 `channels` (embedded `subscriptions[]`) + R2 `profiles` (embedded `subscribedTo[]`) | `<channelId>`, `<userId>` | Blind RMW both (SubscriptionCreate/Delete); D1 `channel_subscribers` (atomic upsert, in lib/notifications.ts, bell prefs) |
| Subscriber count | derived (`countSubscribers(channel.subscriptions)`) | — | not stored |
| Channel handles | R2 `channel_tabs` | handle key (`handleKey(h)`) | Blind put + read-back (lib/channelHandles.ts:163-171) |
| Channel tab config | R2 `channel_tabs` | `channel-tabs/<channelId>` | Blind RMW |
| Channel sections | R2 `channel_sections` | `<channelId>/<sectionId>` | Blind put; reorder/delete RMW many keys |
| Profiles | R2 `profiles` | `<userId>` | Blind RMW (profileUpdate, avatar, cover, watchHistoryAdd, Subscription*, channelDelete); CAS in `setWatchHistoryPaused` (lib/watch-history.ts:38) |
| Legacy watch history | R2 `profiles` (embedded `watchHistory[]`, ≤1000) | `<userId>` | Blind RMW (profile/watchHistoryAdd.ts:102/144) |
| Watch history / watch state | R2 `watch_history` | `<userId>:<videoId>` | CAS in watchState.ts:105; **blind** in watch-history/record.ts:171 and update-progress.ts:146 (same keys) |
| Watch later | R2 `playlists` | `watchLaterId(userId)` | Blind RMW (library/watchLater.ts:129/149/182) |
| Playlists | R2 `playlists` | `<playlistId>` | Blind create; blind RMW add/remove/update |
| Community posts | R2 `community_posts` | `posts/<channelId>/<postId>.json` | Blind put create; blind RMW update/delete/**get (views)**/comment count |
| Channel post index | R2 `community_posts` | `posts/<channelId>/index.json` | **CAS** (create-post.ts:242, delete-post.ts:119) |
| Post likes | R2 `community_posts` | `likes/<postId>/<userId>.json` | Check-then-put per user; counter via queue `CommunityPostLiked` (consumer is another worker) |
| Poll votes | R2 `community_posts` | `votes/<postId>/<userId>.json`, `votes/<postId>/results.json` | Check-then-put per user; results via queue `PollVoted` (other worker) |
| Post comments | R2 `community_posts` | `comments/<postId>/top-level/<id>.json`, `comments/<postId>/replies/<parent>/<id>.json` | Blind put / blind RMW (likes count, repliesCount, heart, edit, delete) |
| Post comment indexes | R2 `community_posts` | `comments/<postId>/top-level/index.json`, `comments/<postId>/replies/<parent>/index.json` | Blind RMW |
| Pinned comment pointer | R2 `community_posts` | pinned pointer key per post | Blind put / delete |
| Post comment likes | R2 `community_posts` | `comment-likes/<postId>/<commentId>/<userId>.json` | Check-then-put; comment `likes` counter blind RMW |
| Reports | R2 `reports` | `report:<entityId>:<id>:<userId>` | List-then-put (dedupe check), new key |
| Upload templates | R2 `upload-defaults` | `<userId>/[<channelId>/]<id>` | Blind put; "unset other defaults" loop RMW |
| Translations / i18n config | R2 (i18n bucket) | `translations/*.json`, `config/i18n-config.json` | Internal sync job, full replace |
| Analytics rollups | R2 `analytics_rollups` | `analytics/rollups/<type>/<id>/<month>.json` | read-only here |
| Search index | D1 `SEARCH_DB` | `search_*` + FTS, `content_ownership`, `search_meta` | Atomic SQL (UPSERT / batch); written after every content-bucket put |
| Ownership index heal lease / completeness | D1 `SEARCH_DB.search_meta` | lease/complete/invalidated keys | Atomic `INSERT … ON CONFLICT … WHERE` lease (OK) |
| Notifications, settings, channel_subscribers, liked_videos, saved_posts, push_devices | D1 `NOTIFICATIONS_DB` | tables | Atomic SQL (INSERT OR IGNORE / UPSERT / UPDATE … WHERE) |
| Upload rate limits | KV `RATE_LIMIT_KV` | `rate_limit:<operation>:<userId>` | Blind KV RMW (get→put), no CAS possible |
| Watch-time rate limit | CF Rate Limiting binding `WATCH_TIME_LIMITER` | `<session>:<video>` | Native limiter (OK) |
| TUS proxy sessions | KV `TUS_SESSIONS` | session key | KV put on create; get→put per PATCH (offset taken from Bunny response) |
| Token revocations | KV `TOKEN_REVOCATIONS` (written by auth worker) | `u:<userId>` | read-only here + 30 s isolate cache |
| App config / flags | KV (APP_CONFIG) | `flags`, `config`, `versions` | Admin full-document replace; 60 s isolate cache |
| Edge caches | Cache API (per colo) | `<origin>/__edge-cache/...` | anon first page of videos, recommendations (per user-hash key) |
| In-memory | module scope | openauth client, revocation map, app-config map | see OK section |
| Queues | `queue` (al-ummah-now-videos), `MODERATION_QUEUE` | — | producer only; consumers live in other workers |

---

### Defects

#### AV-1 — Blind view-counter write clobbers every other writer of the video JSON (known counter + the wider damage)
- **Where:** endpoints/video/videoView.ts:99 (`getObject`) → :125 (`putObject`).
- **Category:** R2 read-modify-write without condition (on the hottest key in the system).
- **Scenario:** The view counter loss itself is known. The wider impact: a viewer's request reads the video, meanwhile (a) another user likes it via CAS (`applyVideoReaction`), or (b) someone comments, or (c) the owner edits the title / sets `isPublic=false`, or (d) admin-api writes a moderation takedown to R2. The view request then `putObject`s its stale copy with `views+1` → the like, the comment, the edit, the takedown or a privacy change is **silently reverted**. On a video with steady traffic this happens all the time. It also **resurrects deleted videos**: videoDelete.ts:109 hard-deletes the key; a view request that read before the delete re-creates the object after it.
- **Severity:** high (data loss + moderation/privacy reversal + resurrection).
- **Fix:** take views out of the video JSON: count views in a Durable Object per video (or D1 `UPDATE video_stats SET views = views + 1 WHERE id = ?`, or Workers Analytics Engine + periodic rollup), and stop writing the video object on view. Until then, at minimum switch to `updateObject(id, v => { v.views = (v.views||0)+1 })` with no `initial`, so a deleted key is never re-created and concurrent changes are retried, not overwritten.

#### AV-2 — Video comments embedded in the video JSON are written blind
- **Where:** endpoints/video/commentCreate.ts:95→155; commentUpdate.ts:84→146; commentDelete.ts:64→112; commentApprove.ts:43→63; commentReaction.ts:75→98 (comment like/dislike for commentLikeCreate/Delete, commentDislikeCreate/Delete).
- **Category:** R2 RMW without condition.
- **Scenario:** Two users comment on the same video at once: both read `comments=[…n]`, each pushes its own comment, last `putObject` wins → one comment is lost (the API returned 201 and a CommentCreate event was queued for a comment that no longer exists). Same for two people liking different comments, and any interleaving with AV-1 views or video edits. Popular video + live comment burst = steady loss.
- **Severity:** high.
- **Fix:** short term: wrap each mutation in `repository.updateObject(id, (video) => { …same logic on fresh copy… })` (move the 404/permission checks inside the mutate or re-check). Long term: move comments out of the video document (per-comment R2 keys like community comments, or D1 `video_comments` table with atomic counters), which also removes the growing-document cost (every video read currently downloads all comments).

#### AV-3 — Every other blind writer of the video JSON
Each of these does `getObject(videoId)` → mutate → `putObject(videoId, …)` with no etag condition, so it both loses concurrent changes from AV-1/AV-2/likes and can be lost itself:
| File:line (get → put) | Trigger | Notes |
|---|---|---|
| video/videoUpdate.ts:109 → 171 | owner edit | reverts concurrent likes/comments; reverted by concurrent views |
| video/videoBulkUpdate.ts:81 → 90 | owner bulk edit (loop) | same, × N videos |
| video/videoThumbnailUpload.ts:75 → 126 | owner | same |
| video/chaptersUpdate.ts:107 → 159 | owner | same |
| video/chapters.ts:82 → 143 | **public GET** `/:id/chapters` when chapters missing **or `?regenerate=true`** | anonymous traffic writes the video object; `regenerate` lets anyone force a write on every request (write amplification + D1 search sync per call) |
| video/subtitlesUpload.ts:154 → 241; subtitlesDelete.ts:105 → 186/204; subtitlesSetDefault.ts:67 → 93 | owner | same |
| video/scheduleCreate.ts:172 → 228; scheduleUpdate.ts:127 → 210; scheduleDelete.ts:106 → 156; schedulePublishNow.ts:90 → 144 | owner | a reverted schedule field can publish/unpublish at the wrong time |
| video/uploadComplete.ts:99 → 125 and error path :157 → 160 | uploader | |
| video/uploadResume.ts:111 → 177 | uploader | |
| video/videoUploadStatus.ts:117 → 258 | **GET status polling** | client polls while processing; each poll can write |
| video/tus/tusProxy.ts:424 → 428 | final TUS PATCH | sets `uploadStatus='processing'`; can overwrite the `ready` state if Bunny webhook/status poll already wrote it (status regresses) |
| live/liveStreamUpdate.ts:106 → 152 (`livestream:<id>`) | owner | low traffic |
| lib/channelDeletion.ts:65 → 68 | channel delete cascade (soft-delete flag) | a concurrent view (AV-1) un-deletes the video |
- **Category:** R2 RMW without condition. **Severity:** med (high for chapters GET and uploadStatus GET because they are triggered by read traffic; low for liveStreamUpdate).
- **Fix:** route all of them through `updateObject(videoId, mutate)` — the mutate functions are already "apply these fields to the fresh object" so the change is mechanical. Make `chapters.ts` GET read-only (parse and return; persist only from the owner path or via `updateObject` once, ignore `regenerate` for non-owners).

#### AV-4 — Channel subscriptions embedded in the channel JSON, written blind by many users
- **Where:** endpoints/channel/SubscriptionCreate.ts:83 → 137; SubscriptionDelete.ts:81 → 105.
- **Category:** R2 RMW without condition on a multi-writer key.
- **Scenario:** A channel goes viral; 50 users press Subscribe in the same second. Each reads `subscriptions=[…]`, appends itself, `putObject` → all but the last write are lost; the users see "subscribed" (and the event was queued, D1 `channel_subscribers` may say subscribed) but the channel JSON does not list them, so `countSubscribers` and `isSubscribed` are wrong. Unsubscribe races the same way (an unsubscribe can be undone). Also clobbered by owner edits (AV-5), and the document grows O(subscribers) — every channel read downloads the whole subscriber list.
- **Severity:** high.
- **Fix:** short term `channelRepo.updateObject(id, ch => { …push/filter… return changed })`. Real fix: the subscription relation already exists in D1 (`NOTIFICATIONS_DB.channel_subscribers`, atomic `INSERT OR IGNORE`, lib/notifications.ts:223-234) — make it the source of truth (`INSERT OR IGNORE` / `DELETE`, `SELECT COUNT(*)` or a counter row updated with `UPDATE … SET n = n + 1`), and drop `subscriptions[]` from the channel JSON. Under heavy contention on one channel a CAS loop on a big JSON will hit `maxAttempts` — D1 or a DO avoids that.

#### AV-5 — Other blind writers of the channel JSON
| File:line (get → put) | Trigger |
|---|---|
| channel/channelUpdate.ts:103 → 158 | owner edit — overwrites concurrent subscriptions (AV-4) |
| channel/channelAvatarUpdate.ts:43 → 82; channelCoverUpdate.ts:43 → 82 | owner |
| video/uploadInitiate.ts:158 → 185 | first upload to a channel creates a Bunny collection and stores `bunnyCollectionId` |
| channel/channelHandle.ts:209 → 247 | admin handle backfill loop |
| channel/channelDelete.ts:119 → 121 | promote next channel to `isMain` |
- **Category:** R2 RMW without condition. **Severity:** med (they drop subscribers when they coincide with subscribe traffic).
- **uploadInitiate extra race:** a batch upload (uploadBatchInitiate / parallel initiates) on a channel without a collection: N requests each see no `bunnyCollectionId`, each creates a Bunny collection, last write wins → orphan collections, videos split across collections. Low-med.
- **Fix:** `updateObject` for all; for the collection, do the create inside a CAS: `updateObject(ch => { if (ch.bunnyCollectionId) return false; ch.bunnyCollectionId = newGuid })` and delete the Bunny collection you created if the stored id differs afterwards (or create it once in channelCreate).

#### AV-6 — Profile JSON written blind by several features (subscriptions reverse index, legacy watch history, profile edits)
- **Where:** channel/SubscriptionCreate.ts:166 → 175 and SubscriptionDelete.ts:122 → 129 (`subscribedTo[]`); profile/watchHistoryAdd.ts:102 → 144 (`watchHistory[]`, up to 1000 entries, fired by the player); profile/profileUpdate.ts:71 → 90; profileAvatarUpdate.ts:43 → 64; profileCoverUpdate.ts:43 → 64; channel/channelDelete.ts:140 → 142 (`channels[]`). Mixed with the CAS writer `setWatchHistoryPaused` (lib/watch-history.ts:38), which is therefore not protected either.
- **Category:** R2 RMW without condition (single user, multiple devices/tabs).
- **Scenario:** A user watches a video on the TV (watchHistoryAdd every few seconds/at end) while subscribing on the phone: the watch-history write reads the profile before the subscribe and writes after it → `subscribedTo` loses the channel → subscription feed (SubscriptionFeed.ts uses `profile.subscribedTo`) silently misses that channel even though channel says subscribed. Or "pause watch history" is reverted by a concurrent watchHistoryAdd.
- **Severity:** med.
- **Fix:** `profileRepo.updateObject(userId, …)` everywhere; better: move `subscribedTo` to D1 (`channel_subscribers` by user_id) and `watchHistory` to the `watch_history` bucket that already exists.

#### AV-7 — watch_history entries written both with CAS and blind
- **Where:** watch-history/record.ts:122 → 171; watch-history/update-progress.ts:118 → 146 (blind) vs watch-state/watchState.ts:105 (CAS) — same key `<userId>:<videoId>`.
- **Category:** mixed CAS/blind on one key.
- **Scenario:** Two progress beacons (two tabs, or a retry overlapping the next beacon) both read progress=40 %, write 45 % and 42 % → progress goes backwards / `watchCount` double-increments; the CAS path's "epoch clock" ordering is bypassed by the blind writers.
- **Severity:** low (single user, cosmetic).
- **Fix:** move record/update-progress onto the same `updateObject` + `applyWatchState` path as watchState.ts.

#### AV-8 — Community post JSON: view counter on GET clobbers edits, deletes and counters
- **Where:** community/get-post.ts:44 → 66-69 (`post.views++`, un-awaited `put`, no `waitUntil`).
- **Category:** R2 RMW without condition, written on read traffic.
- **Scenario:** (1) Owner deletes a post (delete-post.ts:89 writes `status=DELETED`) while a viewer's GET is in flight: GET read the published copy and writes it back after → **post is undeleted**. (2) Owner edits content (update-post.ts:148) → reverted by a concurrent view. (3) The like/poll/comment counters (`likes`, `comments`, poll option `votes`) that the queue consumer / comment endpoints write into the same JSON are rolled back by stale view writes. (4) Two viewers → lost views. Additionally the `put` promise is not awaited nor passed to `waitUntil`, so the runtime may cancel it after the response (the search-sync wrapper's D1 work is also skipped then).
- **Severity:** high (deletion/moderation reversal).
- **Fix:** do not store views in the post JSON (DO / D1 counter / Analytics Engine). If kept: `updateObject(postKey, p => { if (p.status === DELETED) return false; p.views = (p.views||0)+1 })` inside `c.executionCtx.waitUntil(...)`.

#### AV-9 — Community post JSON: other blind writers
| File:line (get → put) | Field |
|---|---|
| community/post-comment-create.ts:116 → 256 | `post.comments++` |
| community/post-comment-delete.ts:74 → 146 | `post.comments--` |
| community/update-post.ts:114 → 148 | content/visibility/pinned |
| community/delete-post.ts:72 → 89 | `status=DELETED` |
- **Scenario:** Two comments on the same post at once → `comments` counter +1 instead of +2; a comment arriving during an edit reverts the edit or the counter; an edit during a delete un-deletes. (The `likes` counter is updated by a queue consumer in another worker — whatever it does, these blind writers here overwrite its result with stale values.)
- **Severity:** med.
- **Fix:** `R2Repository(community_posts).updateObject(postKey, …)` for all four; better, derive `comments` from the comment index length or keep counters in D1/DO.

#### AV-10 — Community comment indexes written blind → comments disappear from listings
- **Where:** community/post-comment-create.ts:301 → 317 (`comments/<postId>/top-level/index.json`, `unshift`) and :327 → 343 (`replies/<parent>/index.json`, `push`); post-comment-delete.ts:202 → 210 and :220 → 228 (remove from indexes).
- **Category:** R2 RMW without condition on a list/index file.
- **Scenario:** Two users comment on a post at once: both comment objects are stored, both read the index `[a,b]`, one writes `[c1,a,b]`, the other `[c2,a,b]` → c1 is stored but never listed (post-comments-list.ts reads only the index). A delete racing a create can also drop the new id.
- **Severity:** high (user-visible lost comments on any busy post).
- **Fix:** exactly the pattern already used for `posts/<channelId>/index.json` (create-post.ts:242): `updateObject(indexKey, idx => { idx.commentIds.unshift(id) }, { initial: () => ({ postId, commentIds: [], lastUpdated }) })`. Or drop the index and use `bucket.list({ prefix })` (keys are per-comment already).

#### AV-11 — Community comment JSON counters written blind (likes, repliesCount) and clobbered by edits/heart
- **Where:** post-comment-like.ts:145/91 → 110/114 (`comment.likes++`); post-comment-unlike.ts:123/76 → 88/92 (`likes--`); post-comment-create.ts:144 → 243 (`parentComment.repliesCount++`); post-comment-heart.ts (findPostComment) → 69; post-comment-update.ts:162 → 132; post-comment-pin.ts:63 → 69 and :94 → 109 (+ pointer :111); post-comment-delete.ts:174 → 129/132.
- **Category:** R2 RMW without condition.
- **Scenario:** 10 people like a comment in the same second → `likes` ends at 1–3. A creator heart or the author's edit at the same time resets `likes` to the stale value. Two replies at once → `repliesCount` +1. `repliesCount` drives whether delete keeps the comment (post-comment-delete.ts:127), so an under-count can hard-hide a thread. Same-user double-like from two tabs: both see no like record (check-then-put at :91/:110) → +2.
- **Severity:** med.
- **Fix:** `updateObject(commentKey, …)` for all mutations; or derive `likes` from the `comment-likes/<post>/<comment>/` prefix / a D1 counter (`UPDATE … SET likes = likes + 1`), and create the per-user like record with a create-only conditional put so only the winner increments.

#### AV-12 — Pinned comment: two pins at once leave two pinned comments
- **Where:** community/post-comment-pin.ts:105-111.
- **Scenario:** Owner double-clicks / two tabs pin A and B: both read pointer = none, both set `isPinned=true` on their comment, pointer ends at B → A stays `isPinned=true` forever.
- **Severity:** low (owner-only).
- **Fix:** CAS on the pointer key (`updateObject(pointerKey…)`) and unpin the previous id returned by the CAS.

#### AV-13 — Channel handle claim is not atomic (duplicate handles)
- **Where:** lib/channelHandles.ts:150-172 (`checkHandleAvailability` → `bucket.put` → read-back); also channelHandle.ts:220 backfill repair put.
- **Category:** check-then-act on R2.
- **Scenario:** Channel A and B both claim `@quran`: A put, A read-back (sees A → ok), B put, B read-back (sees B → ok). Both channels store `handle='quran'`; the index points to B; A's handle URL resolves to B. The read-back only catches the interleaving where both puts happen before both reads.
- **Severity:** med.
- **Fix:** create-only conditional put: `bucket.put(key, body, { onlyIf: new Headers({ 'If-None-Match': '*' }) })` (R2 returns null if the key exists; confirm wildcard `If-None-Match` support on R2 put with a quick test before relying on it — the same applies to AV-21/AV-22) and, for re-claim by the same channel, an etag-matched put; or a D1 table with `handle TEXT PRIMARY KEY` and `INSERT … ON CONFLICT DO NOTHING`.

#### AV-14 — KV upload rate limiter is racy, eventually consistent and fails open
- **Where:** middleware/rate-limit.ts:246 (`kv.get`) → :326 (`kv.put`); release :365 → :371; middleware :488-493.
- **Category:** KV read-modify-write / rate limit assuming one instance.
- **Scenarios:**
  1. Burst bypass: a client fires 20 `upload/initiate` (or 15-video batch initiates) in parallel; all read `minute=0`, all pass, all write `minute=1` → limits (15/min, 20/h, 50/day) are not enforced against parallel requests.
  2. KV is eventually consistent (cached reads up to ~60 s in other colos) and allows ~1 write/s per key; concurrent `put`s to the same key get 429 → the `catch` at :331 returns `allowed: true` ("graceful degradation") → the more aggressive the burst, the more it is allowed.
  3. `concurrent` slot leak: two requests finish together, both read `concurrent=2`, both write 1 → one slot is leaked. If the isolate is killed (CPU limit, eviction) `finally` never runs → leaked. `concurrent` is never reset by time windows, and every write refreshes the 25 h TTL, so after `maxConcurrent` (5) leaks an active uploader is **locked out with 429 "concurrent"** until they stop for 25 h.
- **Severity:** high (security control ineffective + false lockouts).
- **Fix:** use a Durable Object per user (`idFromName(userId)`) that holds the counters in memory/storage and serialises check+increment; or D1 atomic `INSERT … ON CONFLICT(key) DO UPDATE SET n = n + ? WHERE n + ? <= ? RETURNING n` per window bucket; per-minute could use the native Rate Limiting binding already used for watch time. Drop the `concurrent` counter or make it lease-based with expiry.

#### AV-15 — Section indexes: stale-index stampede, each rebuild exceeds the subrequest budget, and rebuilds race
- **Where:** endpoints/sections/popular.ts:115/182/217 + rebuild :269-291; recent.ts:175/195 + :245-266; trending.ts:194-237 + :302-331; by-category.ts:215-257 + :336-360; writes via lib/indexManager.ts:147-158 (blind put) and :353-372 (`metadata:last-index-update` blind RMW).
- **Category:** unbounded fan-out + thundering herd + blind index writes.
- **Scenario:** Index goes stale (popular: 30 min). Every request in every isolate that arrives before a rebuild finishes (a) does the fallback scan in-request (`listObjects(200)` = 201 subrequests for popular; trending/by-category loop up to 10×101 = 1010) and (b) schedules its own full rebuild in `waitUntil` (`listObjects(100)` × 10 = 1010 subrequests for popular/category, 505 recent) in the same invocation budget → popular/trending/category exceed 1000 subrequests per invocation and fail once the bucket has ≥ ~900 objects, so the index never gets rebuilt and every request keeps hitting the fallback. With N concurrent visitors that is N × ~1–2k R2 ops per wave. Rebuilds also read the `index:*`/`metadata:*`/`livestream:*` keys of the same bucket as if they were videos. Concurrent rebuilds overwrite each other (benign, same source) but `metadata:last-index-update` RMW can drop category timestamps.
- **Severity:** high (availability/cost under load; the 1000-subrequest ceiling makes it a hard failure as the catalogue grows).
- **Fix:** build indexes off the request path (cron trigger or queue consumer), from D1 `SEARCH_DB` (it already has `views`, `created_at`, `category`, `popularity` per video — these sections are one `SELECT … ORDER BY … LIMIT 100`). If kept on-request: single-flight with the existing D1 lease pattern (`acquireHealLease` style) and serve the stale index while rebuilding instead of falling back to a scan.

#### AV-16 — Request-path full-bucket scans (fan-out beyond 1000 subrequests / memory)
| File:line | Worst case per request | Notes |
|---|---|---|
| video/videoSearch.ts:166-177 | 20 pages × `listObjects(1000)` = **20,020** R2 ops, all video JSON (with embedded comments) in memory | fallback when ownership index not used/complete |
| video/scheduleList.ts:102 | `listObjects(1000)` = 1001 | always scans |
| monitoring/metrics.ts:71-74 | 4 × 1001 = 4004 | metrics endpoint |
| channel/channelList.ts:151-160 | 50 pages × 101 = ~5050 | "my channels" fallback |
| channel/channelHandle.ts:150 → lib/channelAbout.ts:45-75 | 30 lists + 3000 gets | public `/channels/:id/about` fallback |
| lib/channelSectionPopulator.ts:158 | 1 + 1000 | per channel section populate fallback |
| analytics: lib/analytics.ts:319-326 | unbounded (`while (cursor)`) over all channels | owner analytics fallback |
| lib/analytics.ts:350-357 | 2000 gets + lists | |
| channel/SubscriptionFeed.ts:73-78 | 10 × 101 = 1010 | **always** scans (no index), per feed request |
| channel/channelVideosList.ts:202, channelShortsList.ts:172, channelLiveList.ts:151, channelPlaylistsList.ts:136 | `listObjects(limit*10)` → up to limit 100 ⇒ list caps at 1000 ⇒ 1001 | per channel page |
| sections/recommended.ts:203/290 | `limit*2` / `limit*3` | |
| video/videoList.ts:202-206 | 5 × (limit+1) | bounded, OK-ish |
| lib/discovery.ts:383-400 (500), :409-425 (300) | ~505 / ~303 | bounded; edge-cached |
| community/post-comment-helpers.ts:56-66; post-comment-like.ts:153, unlike.ts:131, update.ts:170, delete.ts:182 | lists every reply key of a post to find one reply | O(replies) per action; the non-helper copies only read the first 1000 keys (miss replies beyond) |
| channel/channelCreate.ts:48 | listObjects(100) loop | |
- **Category:** unbounded fan-out. **Severity:** high for videoSearch/SubscriptionFeed/channel lists/about (user-facing, exceed 1000 ops as soon as the bucket passes ~1000 objects, and the R2 Class-B op bill scales with traffic × catalogue size); med for analytics/metrics/scheduleList.
- **Cascade:** most fallbacks are guarded by "ownership index complete". `invalidateOwnership` (shared-types search/ownership.ts:175) is called whenever **one** inline ownership write fails (lib/search/sync.ts:107-118), which flips every reader in every isolate to the scan path at once until a full heal pass completes. A short D1 blip under load (see AV-17) therefore turns into a fleet-wide fan-out storm.
- **Fix:** query D1 (`SEARCH_DB` search rows / `content_ownership` already contain channel, visibility, created_at, views) instead of scanning R2; keep scans only in cron/queue jobs with an explicit op budget (the retention job's `OperationBudget` is the model). For the subscription feed, `SELECT … FROM search_videos WHERE channel_id IN (…) ORDER BY created_at DESC LIMIT ?`. For replies, store the parent id in the key or keep a `commentId → key` pointer.

#### AV-17 — D1 write amplification on the view path (and every content write)
- **Where:** lib/search/sync.ts:126-153 wraps every put to `videos/channels/playlists/community_posts`; for each: inline `syncOwnershipSafely` (unconditional UPSERT, shared-types ownership.ts:167) **before the put resolves**, then background `upsertSearchRow` (SELECT hash + batch of UPSERT + FTS DELETE + FTS INSERT; store.ts:51-88). The row hash includes `views`, so it changes on every view.
- **Category:** D1 write hot spot.
- **Scenario:** Each video view (AV-1) and each community post view (AV-8) costs 1 R2 put + 1 D1 ownership write (on the response path) + 1 D1 read + a 3-statement D1 write batch with FTS rewrite. D1 is a single-writer SQLite database; at a few hundred views/s the search DB saturates, ownership writes start failing, which calls `invalidateOwnership` (2 more writes to the single `search_meta` row each time) and flips all readers to R2 scans (AV-16). Also `scheduleOwnershipHeal` on every fallback request does a lease UPSERT on the single lease row (`acquireHealLease`, ownership.ts:379) — one hot row written per fallback request.
- **Severity:** high.
- **Fix:** take views out of the video/post JSON (AV-1/AV-8) so view traffic never reaches the sync wrapper; exclude `views` from the search hash (update views in D1 in periodic batches); skip the ownership UPSERT when the projected ownership row is unchanged (compare before writing, or have the caller pass the previous object); in `scheduleOwnershipHeal`, check the lease with a cheap read (or an in-isolate "last attempted" timestamp) before writing.

#### AV-18 — Search index can end up older than R2 (cross-request ordering)
- **Where:** lib/search/sync.ts:77-105 (ordering is per-request only).
- **Scenario:** Owner sets video private (request A) while a view (request B, other isolate) writes the stale public copy (AV-1). Even after AV-1 is fixed, two edits in different isolates can have their background D1 syncs land in reverse order → search row shows the older state (e.g. a now-private video stays searchable) until the daily reconcile.
- **Severity:** low-med.
- **Fix:** include the R2 `etag`/`uploaded` time or a monotonically increasing `dateModified` in the row and use `ON CONFLICT … DO UPDATE … WHERE excluded.version > version`.

#### AV-19 — Playlists and watch-later written blind
- **Where:** playlist/playlistAddVideo.ts:87 → 133; playlistRemoveVideo.ts:78 → 111; playlistUpdate.ts:87 → 120; library/watchLater.ts:41 → 129 / 149 / 182.
- **Scenario:** "Save to playlist" on two videos quickly (two tabs, or the UI firing add for several videos in parallel) → both read `videos=[…]`, last write wins → one video missing; a rename during an add reverts.
- **Severity:** low-med (single owner, but parallel UI calls are common).
- **Fix:** `updateObject` (the add/remove functions are already idempotent list ops).

#### AV-20 — Channel sections / tab config / upload templates: multi-key RMW without conditions
- **Where:** channel-section/channelSectionCreate.ts:197 (list for next position) → 238; channelSectionDelete.ts:131-148 (shift positions of all later sections); channelSectionReorder.ts:157-246; channelSectionUpdate.ts:169 → 216; channel/channelTabsUpdate.ts:124 → 211; settings/uploadDefaults.ts:329-338 and uploadDefaultsById.ts:433-446, :771-784 (unset other defaults loop) + :365, :706 puts.
- **Scenario:** Two section creates → same `position`; delete + reorder interleaved → duplicate/missing positions; two "set as default" templates at once → two defaults.
- **Severity:** low (owner-only, cosmetic).
- **Fix:** store order as one CAS-updated document per channel (`<channelId>/order.json` via `updateObject`) instead of `position` fields on every section; for templates keep `defaultTemplateId` in one CAS-updated per-user doc.

#### AV-21 — Report dedupe is check-then-act
- **Where:** moderation/reportCreate.ts:94 (list existing) → 124 (put new key with random id).
- **Scenario:** double-submit → two reports from one user for one entity (could inflate auto-moderation thresholds if counted).
- **Severity:** low.
- **Fix:** deterministic key `report:<entityId>:<userId>` with create-only conditional put.

#### AV-22 — Community likes/votes: per-user record is check-then-put
- **Where:** community/like-post.ts:66 → 76 (+ queue send); vote-poll.ts:94 → 139 (+ queue send).
- **Scenario:** same user double-taps like / submits vote twice concurrently: both see no record → two `CommunityPostLiked` / `PollVoted` messages → consumer double-counts (unless it recounts from records).
- **Severity:** low-med.
- **Fix:** create-only conditional put on the per-user key (`onlyIf` If-None-Match `*`); send the queue message only if the put returned an object.

#### AV-23 — Retention / erasure / channel-deletion jobs rewrite objects blind
- **Where:** lib/privacy/scan.ts:72 (`readJson`) → :83 (`writeJson`); lib/channelDeletion.ts:65 → 68.
- **Scenario:** a GDPR anonymisation rewrite of a video/comment races a user edit or a view → either the anonymisation is reverted (AV-1) or the user's edit is lost.
- **Severity:** med for erasure (compliance), low otherwise.
- **Fix:** use `updateObject` (etag CAS) in `writeJson` callers, and fix AV-1 so read traffic stops writing.

#### AV-24 — Bunny collection / TUS session / upload status minor races
- **Where:** tus/tusProxy.ts:277 → 310 and :354 → 415 (KV session get→put per PATCH); :420-428 status write (see AV-3).
- **Scenario:** KV reads are eventually consistent across colos; a resumed upload served by a different colo may read a session without `bunnyUploadUrl` (written seconds earlier elsewhere) → 4xx. Offset itself is taken from Bunny's response, so data integrity is fine.
- **Severity:** low.
- **Fix:** acceptable; if it shows up, keep TUS sessions in a DO keyed by session id.

---

### Call-site classification (every `putObject` / raw `.put` / `updateObject`)

Legend: **CAS** = `updateObject`; **NEW** = create of a fresh/unique key (fine); **RMW** = get then blind put of same key (defect id); **DERIVED** = full rebuild from a source, blind put (OK unless noted); **ADMIN** = internal/admin full replace (OK).

| File:line | Key | Class |
|---|---|---|
| lib/reactions.ts:61 | video | CAS (but defeated by AV-1/2/3) |
| lib/watch-history.ts:38 | profile | CAS (defeated by AV-6) |
| endpoints/watch-state/watchState.ts:105 | watch_history entry | CAS (defeated by AV-7) |
| community/create-post.ts:242 | post index | CAS |
| community/delete-post.ts:119 | post index | CAS |
| community/create-post.ts:211 | new post | NEW |
| community/delete-post.ts:89 | post | RMW AV-9 |
| community/get-post.ts:69 | post | RMW AV-8 |
| community/update-post.ts:148 | post | RMW AV-9 |
| community/like-post.ts:76 | like record | NEW (check-then-put AV-22) |
| community/vote-poll.ts:139 | vote record | NEW (check-then-put AV-22) |
| community/post-comment-create.ts:229, :248 | new comment | NEW |
| community/post-comment-create.ts:243 | parent comment | RMW AV-11 |
| community/post-comment-create.ts:256 | post | RMW AV-9 |
| community/post-comment-create.ts:317, :343 | comment indexes | RMW AV-10 |
| community/post-comment-delete.ts:129, :132 | comment | RMW AV-11 |
| community/post-comment-delete.ts:146 | post | RMW AV-9 |
| community/post-comment-delete.ts:210, :228 | comment indexes | RMW AV-10 |
| community/post-comment-heart.ts:69 | comment | RMW AV-11 |
| community/post-comment-like.ts:110 | like record | NEW (check-then-put AV-11) |
| community/post-comment-like.ts:114 | comment | RMW AV-11 |
| community/post-comment-unlike.ts:92 | comment | RMW AV-11 |
| community/post-comment-pin.ts:69, :109 | comment | RMW AV-11/AV-12 |
| community/post-comment-pin.ts:111 | pinned pointer | RMW AV-12 |
| community/post-comment-update.ts:132 | comment | RMW AV-11 |
| video/videoView.ts:125 | video | RMW AV-1 (known) |
| video/commentCreate.ts:155, commentUpdate.ts:146, commentDelete.ts:112, commentApprove.ts:63, commentReaction.ts:98 | video | RMW AV-2 |
| video/videoUpdate.ts:171, videoBulkUpdate.ts:90, videoThumbnailUpload.ts:126, chapters.ts:143, chaptersUpdate.ts:159, subtitlesUpload.ts:241, subtitlesDelete.ts:186/204, subtitlesSetDefault.ts:93, scheduleCreate.ts:228, scheduleUpdate.ts:210, scheduleDelete.ts:156, schedulePublishNow.ts:144, uploadComplete.ts:125/160, uploadResume.ts:177, videoUploadStatus.ts:258, tus/tusProxy.ts:428 | video | RMW AV-3 |
| video/videoCreate.ts:141, videoUpload.ts:198, uploadInitiate.ts:337, uploadBatchInitiate.ts:174 | new video (uuid) | NEW |
| video/uploadInitiate.ts:185 | channel | RMW AV-5 |
| video/scheduleCreate.ts / scheduleUpdate.ts raw `.put` (scheduled-videos bucket) | schedule record per video | owner, blind replace — low (part of AV-3 flow) |
| video/subtitlesUpload.ts raw `.put` ×3, subtitlesDelete/SetDefault raw `.put` | subtitle files | NEW / owner replace — OK |
| live/liveStreamCreate.ts:132 | new livestream | NEW |
| live/liveStreamUpdate.ts:152 | livestream | RMW AV-3 (low) |
| channel/SubscriptionCreate.ts:137, SubscriptionDelete.ts:105 | channel | RMW AV-4 |
| channel/SubscriptionCreate.ts:175, SubscriptionDelete.ts:129 | profile | RMW AV-6 |
| channel/channelUpdate.ts:158, channelAvatarUpdate.ts:82, channelCoverUpdate.ts:82 | channel | RMW AV-5 |
| channel/channelCreate.ts:166 | new channel | NEW |
| channel/channelDelete.ts:121 | other channel | RMW AV-5 |
| channel/channelDelete.ts:142 | profile | RMW AV-6 |
| channel/channelHandle.ts:220 | handle entry | check-then-put AV-13 |
| channel/channelHandle.ts:247 | channel | RMW AV-5 (admin backfill) |
| lib/channelHandles.ts:163 | handle entry | check-then-put AV-13 |
| channel/channelTabsUpdate.ts:211 | tab config | RMW AV-20 |
| channel-section/channelSectionCreate.ts:238 | new section | NEW (position race AV-20) |
| channel-section/channelSectionDelete.ts:148, channelSectionReorder.ts:246, channelSectionUpdate.ts:216 | sections | RMW AV-20 |
| library/watchLater.ts:129, :149, :182 | watch-later doc | RMW AV-19 |
| playlist/playlistCreate.ts:87 | new playlist | NEW |
| playlist/playlistAddVideo.ts:133, playlistRemoveVideo.ts:111, playlistUpdate.ts:120 | playlist | RMW AV-19 |
| profile/profileCreate.ts:82 | profile | NEW-ish (blind create; overwrites if called twice — low) |
| profile/profileUpdate.ts:90, profileAvatarUpdate.ts:64, profileCoverUpdate.ts:64, watchHistoryAdd.ts:144 | profile | RMW AV-6 |
| watch-history/record.ts:171, update-progress.ts:146 | watch_history entry | RMW AV-7 |
| moderation/reportCreate.ts:124 | new report | NEW (dedupe race AV-21) |
| settings/uploadDefaults.ts:294 | new template | NEW |
| settings/uploadDefaults.ts:338, uploadDefaultsById.ts:446, :784 | templates (unset default loop) | RMW AV-20 |
| settings/uploadDefaultsById.ts:365, :706 | template | RMW AV-20 (owner) |
| lib/indexManager.ts:150 | `index:*` | DERIVED (stampede AV-15) |
| lib/indexManager.ts:369 | `metadata:last-index-update` | RMW AV-15 (low) |
| lib/channelDeletion.ts:68 | videos/playlists | RMW AV-3/AV-23 |
| lib/privacy/scan.ts:83 | user records | RMW AV-23 |
| lib/thumbnail/storage.ts:29 | thumbnail image | NEW / replace (OK) |
| lib/bunny/tus.ts:249; tus/tusProxy.ts:246, :310, :415 | KV TUS session | NEW / per-upload RMW AV-24 (low) |
| middleware/rate-limit.ts:326, :371 | KV rate-limit | RMW AV-14 |
| i18n/translationsSync.ts:141, :157, :180, :211 | translations | ADMIN (internal job; version read at :51 is RMW but single operator — OK) |
| app-config/appConfigAdmin.ts:75 | KV app config doc | ADMIN full replace (OK; last admin wins) |
| lib/edge-cache.ts:38 | Cache API | OK |
| lib/r2Repo.ts:68 / :91 | helper | — |
| routers/*.ts `.put(` and index.ts `.put(` | Hono route definitions | not writes |

---

### OK (not defects)

- **lib/r2Repo.ts:85 `updateObject`** — correct etag CAS + retry; creates missing objects unconditionally (only the first write can race; acceptable for the current callers). Note: with `maxAttempts=5` and no backoff, a very hot key (popular video likes) can throw "gave up"; adding jittered backoff would help once AV-1 removes view writes from the same key.
- **lib/openauth-client.ts:14** module-level `cached` client (issuer+client key, 10 min TTL) — not per-user, fine.
- **lib/token-revocation.ts:35** per-isolate `Map` of per-user revocation entries (30 s TTL, capped 5000, cleared when full) — holds per-user data but read-only cache of a KV value; staleness bound (~2 min) is documented and intentional. Fine.
- **lib/app-config-store.ts:11** 60 s per-isolate cache of config KV docs — non-user data; fine (other isolates converge in 60 s, documented).
- **lib/search/sync.ts:78 `SearchSyncQueue.chains`** — per-request instance (created in `withSearchSync` per fetch), not module state. Correctly ignores `onlyIf`-rejected puts (`result !== null`), so CAS retries don't index losing writes.
- **Edge cache** (lib/edge-cache.ts; videoList.ts:97 anon-only key; discovery.ts:243 key includes sha256(userId) and paused/excludeWatched) — no cross-user leakage.
- **WATCH_TIME_LIMITER** (videoWatchTime.ts:54) — Cloudflare Rate Limiting binding; distributed by design (per-colo approximate is fine for this use).
- **Ownership heal lease** (shared-types ownership.ts:379) — D1 atomic `INSERT … ON CONFLICT DO UPDATE … WHERE updated_at < ?` single-flight; correct (only the write volume is noted in AV-17).
- **D1 NOTIFICATIONS_DB writes** (lib/notifications.ts, lib/library.ts, lib/push-devices.ts, library/backfill.ts) — atomic `INSERT OR IGNORE` / UPSERT / `UPDATE … WHERE`; per-user rows, no hot single row. push-devices register does SELECT-then-batch but the batch itself is idempotent per `install_id`.
- **Channel post index** `posts/<channelId>/index.json` — already CAS (create-post.ts:242, delete-post.ts:119). This is the pattern to copy for AV-10.
- **New-object creates with random ids** (videos, channels, playlists, posts, comments, reports, livestreams, subtitles, thumbnails) — no race.
- **lib/discovery.ts** scans are bounded (500 videos / 300 channels) and their results are edge-cached; **video/videoList.ts** fallback is bounded to 5 pages of `limit`.
- **Daily cron** (index.ts:386) — retention uses an explicit `OperationBudget`; search/ownership reconcile is page-bounded and lease-protected.
- **Module singletons** `thumbnailStorage`, `thumbnailProcessor`, Hono `app` instances, constant `Set`s — stateless.

---

## Scalability audit: monorepo apps other than api-videos

Scope: apps/processor, apps/websocket-server, apps/admin-api, apps/admin-web, apps/web, apps/scheduler, apps/log-service, packages/*.
Question asked: what breaks when Cloudflare runs many isolates / instances at once.

Global note on queue consumers: no wrangler config in the repo sets `max_concurrency`, so every consumer
autoscales (Cloudflare default: up to 250 concurrent invocations per consumer). Any "serialised in this
isolate" assumption is therefore false as soon as a backlog builds.

### processor

Consumers (prod / stage / qa identical): `al-ummah-now-videos` (max_batch_size 10, max_batch_timeout 30, max_retries 3, DLQ al-ummah-now-dlq, max_concurrency unset),
`al-ummah-now-moderation` (5 / 10 / 3, DLQ, unset), `al-ummah-now-dlq` (10 / 30 / 10, unset). Cron `41 3 * * *` (retention).
Videos batches are processed with `Promise.allSettled` over all 10 messages in one invocation (src/index.ts:201), so
one invocation's subrequest budget is shared by 10 messages.

#### Data map

| Data | Where | Write pattern |
|---|---|---|
| Raw message archive | R2 MESSAGES_BUCKET `YYYY-MM-DDTHH-MM-SS.<messageId>` | blind put, key includes message id (idempotent) (messageProcessor.ts:642) |
| Channel-section analytics | R2 MESSAGES_BUCKET, per-message keys (handlers/channel-section.ts:110-232) | blind put of new keys (append-only) |
| View / watch-time monthly rollups | R2 MESSAGES_BUCKET rollup keys (lib/analytics-rollup.ts) | read-modify-write, serialised only in-isolate by `pendingByKey` map (KNOWN) |
| Poll results | R2 community_posts `votes/<postId>/results.json` | full recount via list+get of every vote doc, then blind put (handlers/poll-vote.ts:67-144) |
| Poll totals on post | R2 community_posts `posts/<channelId>/<postId>.json` | read-modify-write, no etag (poll-vote.ts:166-188) |
| Like count on post | same post doc | list-count `likes/<postId>/`, then read-modify-write, no etag (post-like.ts:66-113) |
| Notifications | D1 NOTIFICATIONS_DB `notifications` | `INSERT OR IGNORE ... RETURNING`, dedupe on (user_id, dedupe_key) (notifications-store.ts:56-93) |
| Fan-out notifications | D1 `notifications` from `channel_subscribers` | one `INSERT OR IGNORE ... SELECT` over the whole audience (notifications-store.ts:99-141) |
| Channel subscribers mirror | D1 `channel_subscribers` | INSERT OR IGNORE / DELETE (atomic) |
| Push devices | D1 `push_devices` | read; delete invalid by (install_id, token) (push/dispatch.ts:142) |
| Push dispatch work | queue al-ummah-now-videos, PushDispatch messages of 100 recipients | `MESSAGE_QUEUE.send` in a loop (push/dispatch.ts:38-52) |
| Dead letters | D1 NOTIFICATIONS_DB `dead_letters` | INSERT OR IGNORE; replay claim via `UPDATE ... WHERE replayed_at IS NULL` (atomic CAS) (dlq/store.ts:69,135) |
| Reports | D1 REPORTS_DB `reports` | INSERT OR IGNORE / UPDATE with COALESCE (atomic) |
| AI moderation signals / usage | D1 REPORTS_DB `moderation_signals`, `ai_usage_daily` | insert; usage via `ON CONFLICT DO UPDATE SET x = x + excluded.x` (atomic) |
| Moderation config | D1 REPORTS_DB `moderation_config` | read per scan (no cache) |
| Search + ownership index | D1 SEARCH_DB (shared-types/search/store.ts, ownership.ts) | upsert batch of snapshot carried in the message; no version check |
| Realtime pushes | HTTP POST to websocket-server `/broadcast` | one subrequest per channel per event |

#### Defects

**PR-1** — `src/lib/analytics-rollup.ts:135` — R2 read-modify-write serialised only in-isolate (`pendingByKey`).
KNOWN, not re-analysed. With unset max_concurrency, two consumer invocations updating the same video's monthly rollup lose increments.
Also: queue delivery is at-least-once, so a redelivered VideoView adds the view again. Severity: high (already tracked).

**PR-2** — `src/handlers/poll-vote.ts:158-188` and `src/handlers/post-like.ts:93-113` — R2 read-modify-write of `posts/<channelId>/<postId>.json` with no `onlyIf` etag.
Scenario: a like and a poll vote on the same post arrive in the same batch (both run in parallel via allSettled), or in two concurrent consumer invocations, or api-videos edits the post text at the same time.
Each handler GETs the post, changes one field and PUTs the whole document. The last PUT wins: the like count write puts back the old poll totals (or the reverse), and a post edit made by the author between the GET and PUT is silently reverted.
Severity: high (user-visible data loss on post edits, not only counters). Fix: move counters out of the post doc (D1 counters, or a per-post Durable Object), or at least use `get` → `put(..., { onlyIf: { etagMatches } })` with a retry loop. Never rewrite the author-owned document from the processor.
Fixed in [#510](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/510): the processor no longer writes the post document; like and vote totals live in D1 (`analytics_daily`, entity `post`) and api-videos reads them from there (`src/lib/post-counters.ts`).

**PR-3** — `src/handlers/poll-vote.ts:67-144` — every vote recounts the whole poll (list + one GET per vote doc) and blind-PUTs results.json.
Scenarios: (a) a poll with N votes costs N R2 GETs per vote, so O(N²) total; at about 1000 votes one message exceeds the per-invocation subrequest limit, the message throws, retries 3 times and dead-letters, and results stop updating. With 10 messages per batch sharing one invocation it fails sooner.
(b) Two concurrent recounts: the one that listed earlier (fewer votes) can PUT last, leaving results.json and post totals lower than reality until the next vote.
Severity: high for popular polls. Fix: count votes in D1 (`poll_votes(post_id, user_id, option_ids)` with `INSERT ... ON CONFLICT` and `SELECT option, COUNT(*) GROUP BY`), or a per-poll Durable Object holding counters.
Fixed in [#510](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/510): one vote = one R2 read + one D1 batch: `poll_votes` row plus `poll_votes`/`poll_option` counter deltas, applied only when the row changes state, so redelivery cannot double count. Legacy votes import in leased, cursor-paged follow-up messages.

**PR-4** — `src/handlers/post-like.ts:61-88` — like count via full `list` of `likes/<postId>/` on every like. 1000 likes per list call, so 1M likes = 1000 list subrequests per message → over the limit; plus PR-2 race. Severity: medium. Fix: D1 counter (`UPDATE posts_counters SET likes = likes + 1`) or derive from a D1 likes table.
Fixed in [#510](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/510): `post_likes` row + `likes` counter delta in one D1 batch, counted only on a state change (idempotent under at-least-once delivery); no `list` per like.

**PR-5** — `src/lib/notifications-store.ts:99-141` — fan-out is one `INSERT OR IGNORE ... SELECT` over every subscriber with `RETURNING` all rows.
Scenario: a channel with 200k "all" subscribers uploads; the single statement writes 200k rows in one D1 transaction. D1 is single-writer per database, so every other NOTIFICATIONS_DB write (notification inserts, DLQ storage, subscriber mirror) queues behind it, and the statement can hit D1's per-query time / memory limits and fail; the retry then re-runs the whole statement. The returned array is held in Worker memory (128 MB).
Severity: medium now, high for big channels. Fix: page the fan-out (`WHERE s.user_id > ? ORDER BY s.user_id LIMIT 1000`), enqueue one follow-up message per page.
Fixed in [#513](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/513): `fanoutNotificationPage` writes `FANOUT_PAGE` (1000) subscribers per message by `user_id` cursor; the next page is queued as a follow-up message before this page's pushes.

**PR-6** — `src/lib/notifications-store.ts:144-165` with `src/index.ts:201` — up to 500 realtime POSTs per fan-out message, and the videos batch runs 10 messages in one invocation.
Scenario: 3 fan-outs in one batch = 1500 fetches + D1 + queue sends in one invocation; past the subrequest limit fetches throw. `sendWebSocketNotification` swallows errors, so pushes are silently dropped. Each POST also lands on the websocket-server (see WS defects). Severity: medium. Fix: one batched `/broadcast-many` call per fan-out (array of user channels) or enqueue realtime pushes in chunks; process fan-out messages with a smaller batch size.
Fixed in [#513](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/513): realtime events go to the websocket server as one batched `/broadcast` call per 500 recipients (`broadcastMany`).

**PR-7** — `src/push/dispatch.ts:38-52` — `MESSAGE_QUEUE.send` in a loop, one subrequest each (100 recipients per message): 100k recipients = 1000 sends in one invocation. Severity: medium. Fix: `sendBatch` (100 messages per call) and page together with PR-5.
Fixed in [#513](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/513): `enqueuePush` uses `sendBatch`, 25 PushDispatch messages (2500 recipients) per call, one fan-out page at a time.

**PR-8** — `src/handlers/search-index.ts:44-63` + `packages/shared-types/src/search/store.ts:51-125` — SearchIndexSync applies the object snapshot carried in the message with no ordering guard.
Scenario: scheduler publishes video (snapshot A, public), then the owner makes it private (snapshot B). The two messages are in different batches handled by concurrent invocations or retried; B is applied, then A overwrites it, and a private video is searchable until the next reconciliation pass. Same for delete-then-stale-upsert resurrecting a deleted item.
Severity: medium (privacy leak window). Fix: store the object's `updatedAt`/version in the base row and make the upsert `ON CONFLICT DO UPDATE ... WHERE excluded.version >= version`; or have the processor re-read the current R2 object instead of trusting the snapshot.
Fixed in [#514](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/514): `source_version` guard on the search base rows and tombstones (`packages/shared-types/src/search/store.ts`), same pattern as the ownership index; every producer sends the snapshot's R2 `uploaded` time as `version`.

**PR-9** — `src/moderation/consumer.ts:66-71` — daily neuron cap is check-then-act (`SUM` then call AI then record). With autoscaled consumers (5 msgs × up to 250 invocations) the cap overshoots by up to every in-flight scan. Severity: low (cost overrun bounded by backlog). Fix: reserve budget atomically before calling AI (`UPDATE ai_budget SET used = used + ? WHERE day = ? AND used + ? <= cap`), reconcile after; or set `max_concurrency` on the moderation consumer.
Fixed in [#521](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/521): `reserveBudget` reserves the scan's worst-case neurons in one conditional `UPDATE ai_budget_daily` before calling AI and `settleBudget` reconciles after (`src/moderation/budget.ts`).

**PR-10** — `src/lib/notifications-store.ts:99-141` + `messageProcessor.ts:493-511` — at-least-once interaction: fan-out insert succeeds, then the invocation fails before pushes/enqueue; the retry's `INSERT OR IGNORE` returns zero rows, so push and realtime are never sent. Not a concurrency bug strictly, but it appears under load (subrequest/timeout failures in PR-6/PR-7). Severity: low. Fix: track `pushed_at` on notifications and select un-pushed rows on retry.
Fixed in [#513](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/513): `notifications.pushed_at` (migration 0007); a retried page or create selects rows with `pushed_at IS NULL`, pushes them and marks them, so a partial failure is resent, not lost.

#### OK

- Raw message archive puts (key includes message id: idempotent).
- Channel-section analytics (append-only keys).
- `insertNotification`, `upsertChannelSubscriber`, `removeChannelSubscriber`, report insert/resolve, GDPR erasure batches: single atomic D1 statements.
- DLQ store (`INSERT OR IGNORE` on queue message id) and replay claim (`UPDATE ... WHERE replayed_at IS NULL` is a real CAS).
- `recordUsage` uses atomic `x = x + excluded.x` upsert.
- `dispatchPush` IN-list is exactly 100 binds (D1's max is 100); OK but must not grow.
- No module-level mutable state besides PR-1's `pendingByKey`. `MessageProcessor` is created per batch.

### websocket-server

Worker `al-ummah-now-comms` + Durable Object `WebSocketDurableObject` (migration v1 `new_classes`, i.e. KV-backed DO, no SQLite). Bindings: WEBSOCKET_DO, PRESENCE_KV, TOKEN_REVOCATIONS (KV, read only). No queues, no crons. `MAX_CONNECTIONS_PER_DO` / `RATE_LIMIT_*` not set in any wrangler file, so code defaults apply (1000 connections, 100 msgs/min).

#### Data map

| Data | Where | Write pattern |
|---|---|---|
| All sockets, sessions, channel→subscriber sets, per-session rate limits | In-memory Maps on ONE DO instance `idFromName('websocket-instance')` (index.ts:50,102,137; websocket.ts:24-28; channels.ts:11-14) | plain in-memory mutation; nothing persisted, no `serializeAttachment`, no `ctx.getWebSockets()` |
| Presence `presence:<userId>` → JSON array of session ids | KV PRESENCE_KV, TTL 300 s | read-modify-write, no CAS (presence.ts:18-118) |
| Token revocation lookups | KV TOKEN_REVOCATIONS `u:<userId>`, module-level Map cache 30 s, max 5000 (token-revocation.ts:35-52) | read only |
| JWKS per issuer | module-level Map of `createRemoteJWKSet` (auth.ts:61-69) | cache of public keys |

#### Defects

**WS-1** — `src/websocket.ts:74` with `:24-28` — Hibernation API (`ctx.acceptWebSocket`) used, but all connection state lives only in instance fields.
Scenario: sockets are idle between client heartbeats (web sends one every ~25 s, useVideoWebSocket.ts:95). The runtime may hibernate the DO in that gap: the instance is evicted while the sockets stay open. On the next event a fresh instance runs the constructor with empty `connections`, `sessionToWebSocket` and `ChannelManager`. `webSocketMessage` then finds no connection and returns silently (websocket.ts:121-124), and `/broadcast` finds no subscribers. Every connected client is a zombie: no notifications, no upload/live updates, no errors to trigger a reconnect. The same happens on any DO eviction or code-update restart where sockets survive.
This does not need many isolates to fail; it gets more likely as traffic patterns become bursty. Severity: critical. Fix: store `{sessionId, userId, authExpiresAt, channels}` with `ws.serializeAttachment()` on every change, and rebuild maps in the constructor from `this.ctx.getWebSockets()` + `deserializeAttachment()`; or use `ctx.getWebSockets(tag)` with channel tags (`acceptWebSocket(server, [tags])`) so subscriber lookup needs no memory map. Use `setWebSocketAutoResponse` for ping/pong.

**WS-2** — `src/index.ts:50,102,137` — every socket, every broadcast and every stats call go to ONE global DO (`idFromName('websocket-instance')`).
Scenarios: (a) connection cap: `MAX_CONNECTIONS_PER_DO` defaults to 1000 (websocket.ts:59), so user 1001 site-wide gets 503 and has no realtime at all. (b) Throughput: a DO is single-threaded; all client messages, all heartbeats (with a KV RMW each, WS-3) and all processor `/broadcast` POSTs (up to 500 per fan-out, PR-6) serialise on one thread in one location. Past the DO's per-object request rate it returns overload errors, the processor swallows them (PR-6) and pushes are lost. (c) Every user worldwide connects to one colo. (d) One DO restart (deploy) drops every socket at once, followed by a reconnect storm into the same object.
Severity: critical at scale. Fix: shard: `user:<id>` channels → DO keyed by user id (or `hash(userId) % N`); public channels (`video:<id>`, `channel:<id>`, `live-streams`) → DO keyed by channel; client opens one socket to its user shard, and that shard subscribes on behalf of the client to channel DOs (or the client opens a second socket per watched video). `/broadcast` then routes by channel name to exactly one DO.

**WS-3** — `src/presence.ts:18-118` — presence session list is a KV read-modify-write without any conditional write.
Scenarios: two tabs of the same user authenticate at the same time; both read `[]`, both write a one-element array, one session is lost; when that tab closes, `setOffline` deletes the key while the other tab is still open, so the user shows offline. KV is eventually consistent across colos (up to 60 s) and allows 1 write/s per key, so heartbeat refreshes from several tabs get 429s (caught and ignored). Once WS-2 is sharded, the race spans isolates. Severity: medium (presence is wrong; no data loss elsewhere). Fix: keep presence in the user-shard DO's storage (strongly consistent, single writer) and expose it from there; or one KV key per session (`presence:<userId>:<sessionId>`, TTL) and `list({prefix})` to read.

**WS-4** — `src/websocket.ts:533-541`, `:456-461` — broadcast loops over every subscriber and `JSON.stringify`s the message once per socket. With one global DO, `live-streams` or a popular `video:<id>` channel with thousands of sockets is O(n) stringify per event on the only thread. Severity: low/medium. Fix: stringify once per broadcast; shard per channel (WS-2).

**WS-5** — `src/websocket.ts:28,491-516` — per-session rate limit is in-memory: it resets on every hibernation/eviction (WS-1) and is per-session, not per-user/IP, so a client can open many sockets. Within one DO it is otherwise correct. Severity: low. Fix: rate-limit per userId/IP (Workers Rate Limiting binding at the Worker before forwarding to the DO); keep counters in the attachment if they must survive hibernation.

**WS-6** — `src/websocket.ts:238-245` — `webSocketError` deletes the connection but not `sessionToWebSocket`, `rateLimits`, or presence, so the KV presence entry lingers until TTL and maps leak per errored socket in a long-lived single DO. Severity: low. Fix: share one cleanup function with `webSocketClose`.

#### OK

- `token-revocation.ts:35` module-level cache: per-user revocation entries, 30 s TTL, capped at 5000, documented staleness (~2 min), fails open by design. Holds no secrets; OK.
- `auth.ts:61` JWKS cache: public keys, safe to share across requests.
- `index.ts:12` module-level logger: stateless.

### admin-api

Worker `al-ummah-admin-api`. Bindings: D1 REPORTS_DB; KV TOKEN_REVOCATIONS (read); R2 videos, channels, profiles, playlists, global_settings, community_posts; queue producer `al-ummah-now-videos`. No consumers, no crons, no DOs.
No `onlyIf` / etag conditional write anywhere in admin-api (and none in apps/api-videos either, so every R2 document admin-api edits is also blind-written by api-videos).

#### Data map

| Data | Where | Write pattern |
|---|---|---|
| Reports | D1 REPORTS_DB `reports` | read, then `UPDATE ... WHERE id = ? AND status IN ('pending','reviewing')` (atomic CAS) (ReportAction.ts:116) |
| Moderated content flags (isHidden, hasWarning, isDeleted) | R2 videos `<videoId>`, channels `<channelId>`, playlists `<id>` | read-modify-write whole doc, blind put (ReportAction.ts:222-280 via r2Repo.ts:61) |
| Comment hide/restore | R2 videos `<videoId>` (comments are embedded in the video JSON) | read-modify-write whole video doc, blind put (lib/aiModeration.ts:228-242) |
| Channel verification | R2 channels `<channelId>` + D1 `channel_verification_log` | D1 insert, then R2 read-modify-write blind put (ChannelVerification.ts:107-126) |
| Section indices `index:recent-videos`, `index:popular-videos:<period>`, `index:trending-videos`, `index:category:<c>`, `metadata:last-index-update` | R2 videos bucket | full rebuild from list + GET of every object, blind put (lib/initializeIndices.ts, lib/indexManager.ts:125) |
| Translations `translations/<locale>.json`, `translations/metadata.json` | R2 global_settings | read-modify-write blind put (translationsUpdate.ts:177-245) |
| AI moderation review state, config | D1 REPORTS_DB `moderation_signals`, `moderation_actions`, `moderation_config` | single-row UPDATE / upsert (aiModeration.ts:135,309) |
| Search index refresh | queue SearchIndexSync with object snapshot | send (see PR-8 ordering issue) |

#### Defects

**AA-1** — `src/endpoints/moderation/ReportAction.ts:222-280` (with `src/lib/r2Repo.ts:61`) — moderator remove/warn/ban is a blind read-modify-write of the whole video/channel/playlist document.
Scenario: a moderator bans a video while api-videos updates the same object (owner edits title, a comment is added since comments live in the video JSON, a like/view counter write). api-videos read the object before the ban and PUTs after it: `isHidden`/`isDeleted` vanish and the banned video is public again, while the report row says "resolved" and the search index entry was removed (so the state is also inconsistent). Severity: high (moderation silently undone). Fix: conditional put (`onlyIf: { etagMatches }`) with re-read/retry, AND make api-videos writes conditional too; better, keep moderation state outside the owner-editable doc (D1 `moderation_state(entity, id, hidden, deleted)` checked on read) so no document merge is needed.

**AA-2** — `src/lib/aiModeration.ts:228-242` — reviewer hide/restore of a comment rewrites the entire video JSON (comments embedded).
Scenario: on a busy video, a viewer posts a comment (api-videos RMW of the same object) between the reviewer's GET and PUT; the new comment is deleted, or the api-videos write lands last and the hide is undone (abusive comment visible again). Severity: high. Fix: same as AA-1; long-term move comments out of the video object (per-comment keys or D1).

**AA-3** — `src/endpoints/channels/ChannelVerification.ts:107-126` — verification is a blind RMW of the channel doc; a concurrent owner channel edit through api-videos either drops `isVerified` or reverts the owner's edit. Also the audit row is written even if the R2 put later loses. Severity: medium. Fix: etag CAS with retry; or keep verification in D1 and project it.

**AA-4** — `src/lib/initializeIndices.ts:88-104` with `src/lib/r2Repo.ts:15-38` — index rebuild lists the whole videos bucket and does one GET per object (up to 50 × 100 = 5000), inside `waitUntil`.
Scenario: with more than about 1000 objects in the videos bucket (videos plus `index:` / `metadata:` / `livestream:` keys) the rebuild exceeds the per-invocation subrequest limit and throws; past 5000 objects it silently builds indices from a truncated set; loading every video doc (with embedded comments) can exceed 128 MB. Two admins clicking "rebuild" run two overlapping rebuilds that blind-PUT the same index keys (harmless, last wins). If api-videos maintains these `index:*` keys incrementally, a rebuild started earlier overwrites increments made during it. Severity: medium. Fix: build indices from the D1 SEARCH_DB / ownership index (already has views, created_at, category) with SQL; or run the rebuild as a queue job paging N objects per message.

**AA-5** — `src/endpoints/i18n/translationsUpdate.ts:177-245` — translations merge and metadata.json are blind RMW. Two admins saving different locales at once: the second metadata.json write drops the first locale's checksum, so clients keep a stale cached locale. Severity: low (admin-only, rare). Fix: etag CAS on metadata.json, or compute checksums on read.

#### OK

- `src/lib/openauth-client.ts:14` module-level OpenAuth client: caches issuer discovery + JWKS only (no user data), rebuilt every 10 min. OK.
- `src/lib/token-revocation.ts:35` revocation cache: same file as websocket-server, OK.
- Report resolution uses a proper D1 CAS (`WHERE status IN (...)`, checks `changes`).
- `moderation_config` upsert, signal review UPDATEs: single-row atomic statements.
- No in-memory locks, counters or rate limits.

### scheduler

Worker `al-ummah-scheduler`, cron `* * * * *`. Bindings: R2 VIDEOS, SCHEDULED_VIDEOS; KV SCHEDULER_LOCKS, SCHEDULER_METRICS; DO SCHEDULER_LOCK (`SchedulerLock`, per-video `idFromName(videoId)`); queue producer `al-ummah-now-videos`. Vars: BATCH_SIZE 50, MAX_RETRIES 3, LOCK_TTL 120. No consumers.

#### Data map

| Data | Where | Write pattern |
|---|---|---|
| Schedule entries `YYYY-MM-DD/HH/<videoId>.json` | R2 SCHEDULED_VIDEOS (written by api-videos, rewritten/deleted here) | blind put / delete (retry.ts:79-100, publisher.ts:209-268) |
| Video publish state (isPublic, publishedAt, scheduledPublishStatus) | R2 VIDEOS `<videoId>` | read-modify-write whole doc, blind put (publisher.ts:17-49) |
| Per-video publish lock | DO SchedulerLock, one instance per videoId, storage key `lock` + alarm | DO-serialised get/put with token (correct) |
| `last_run` | KV SCHEDULER_LOCKS | blind put every minute, TTL 300 |
| `daily_metrics` | KV SCHEDULER_METRICS | read-modify-write, no CAS, up to 10 in parallel (monitoring.ts:102-140) |
| Search index refresh | queue SearchIndexSync with snapshot | send (PR-8 ordering) |
| Publish notification | HTTP POST websocket-server /broadcast | one per video |

#### Defects

**SC-1** — `src/publisher.ts:17-49` — publish is a blind RMW of the whole video document.
Scenario: the owner cancels or reschedules (api-videos writes `scheduledPublishStatus: 'cancelled'` / `isPublic: false`) or edits the title, or a viewer comment is added (comments live in the video doc), between the scheduler's GET and PUT. The scheduler's PUT restores the pre-cancel document with `isPublic: true`: a video the owner just cancelled is published anyway, or the owner's edit/comment is lost. The reverse order (api-videos PUT lands last with a stale copy) silently un-publishes a video the UI reports as published. The DO lock only stops two scheduler runs from racing each other; it does nothing against api-videos/admin-api writers. Severity: high (privacy: unwanted publish). Fix: `put(..., { onlyIf: { etagMatches: videoObject.etag } })`, on precondition failure re-read and re-check `cancelled`/`isPublic`; make api-videos writes conditional too.

**SC-2** — `src/publisher.ts:124-201` (+ `:71-116`) — every minute the cron lists 72 hourly prefixes (+1 debug `list({limit:100})`) and GETs every object found, plus GETs every object of the current hour.
Scenarios: (a) list results are not paginated (`truncated`/`cursor` ignored), so past 1000 entries in one hour the rest are never seen and never published. (b) Subrequests per run = 73 lists + one GET per pending/overdue entry + 2–4 per published video (lock acquire/release DO calls, R2 get/put, queue send, KV metrics get/put, websocket POST). Around 200 overdue entries plus 50 publishes, a run exceeds the 1000-subrequest limit and aborts partway, so the same backlog is re-read and fails again every minute. (c) Each scheduled object of the hour is re-read 60 times. Severity: medium (grows with scheduled uploads; failure mode is "nothing publishes"). Fix: index schedules by due time in D1 (`SELECT ... WHERE due_at <= ? AND status = 'pending' LIMIT 50`), or a per-video DO alarm at the publish time (`SchedulerLock.setAlarm(scheduledAt)` already exists, so the DO could own the schedule) and drop the scan.

**SC-3** — `src/retry.ts:21-27` + `src/publisher.ts:235-268` + `:124-201` — permanently failed entries are re-processed every minute for 72 h.
Scenario: a video is deleted or its schedule cancelled; publish throws; after MAX_RETRIES `markAsFailed` PUTs the entry back under its original hour prefix. `queryOverdueVideos` picks it up on every subsequent run, publish throws again, `retryCount >= max` → `markAsFailed` + `sendFailureNotification` again. One broken entry = 4320 runs of wasted subrequests and up to one failure notification per minute to the owner; many such entries feed SC-2. Severity: medium. Fix: move permanently failed entries to a `failed/` prefix (or mark `status: 'failed'` and skip), and have api-videos delete the schedule entry on cancel.

**SC-4** — `src/monitoring.ts:102-140` — `daily_metrics` KV RMW from up to 10 parallel promises in one run (index.ts:105-184) and from overlapping cron runs. Counts are lost and KV's 1 write/s per key limit returns 429 (swallowed). The 24 h TTL is refreshed on every write, so the "daily" counters never reset while the scheduler is busy. Severity: low (metrics only; health check failure rate is wrong). Fix: drop KV metrics in favour of Workers Analytics Engine / logs, or aggregate per run and write once.

#### OK

- `SchedulerLock` DO: per-video instance (not global), state in DO storage, token-checked release, alarm expiry. Overlapping cron runs cannot double-publish the same video.
- `publishVideo` is idempotent on `isPublic` (except the cross-writer race in SC-1).
- No module-level mutable state.

### web

Next.js on Workers via OpenNext (`al-ummah-now-production`, stage, qa, preview, staging). Bindings: ASSETS, R2 `videos` (declared but never used: no `getCloudflareContext`/`env.videos` anywhere in src). No KV, D1, DO or queues. `open-next.config.ts` selects `kvIncrementalCache`, but no wrangler file binds `NEXT_INC_CACHE_KV`.
Sessions live entirely in httpOnly cookies (`al_ummah_session(.N)`, lib/auth/session-manager.ts); OAuth state is a cookie nonce (lib/auth/oauth-state.ts). Server routes proxy to api-videos / the auth issuer.

#### Data map

| Data | Where | Write pattern |
|---|---|---|
| User sessions (multi-account tokens, channels) | httpOnly cookies, chunked | cookie write per request; `mergeSessionTokens` keeps the newer token pair (token-refresh.ts:155) |
| Refresh-token rotation memory + single-flight | module-level Maps `rotations` (max 500, 60 s) and `inflight` (lib/auth/token-refresh.ts:168-169) | in-isolate only |
| OpenAuth client (discovery + JWKS) | module-level, 10 min TTL (lib/auth/openauth-client.ts:14) | in-isolate cache |
| Stored translations | module-level Map, 1 h TTL (lib/api/i18n.ts:17) + `fetch(..., { next: { revalidate: 3600 } })` | in-isolate cache |
| View / watch-time events | forwarded to api-videos (app/api/analytics/video/route.ts) | proxy, no local state |
| Client-only singletons (QueryClient, client-token cache, consent, engagement service, analytics maps) | browser memory, guarded by `typeof window` or used only from client hooks | n/a on the server |

#### Defects

**WEB-1** — `src/lib/auth/token-refresh.ts:168-169, 296-315` — refresh single-flight and rotation memory are per isolate, and they hold per-user secrets (access + refresh tokens of up to 500 users, 60 s).
Scenario: a page load fires the middleware refresh for a page request, RSC requests and `/api/auth/token` at the same moment; OpenNext routes them to different isolates. Each isolate spends the same refresh token at the issuer, each gets a different new pair, and each writes its own Set-Cookie; whichever cookie the browser stores last wins. Correctness therefore depends entirely on the issuer's 60 s reuse window and on every pair it issued staying valid. If the issuer revokes the losing pair's family (common refresh-token-reuse protection), the user is signed out at random under load. The in-memory map only helps when requests share an isolate, which becomes rarer as traffic spreads over more isolates. Holding other users' live tokens in shared module memory is acceptable only because lookups require the old refresh token (keyed by userId + token). Severity: medium (random sign-outs that cannot be reproduced locally). Fix: make the single-flight cross-isolate: a Durable Object keyed by userId (or by a hash of the refresh token) that performs the refresh and remembers the rotation for 60 s, so all isolates converge on one pair. Alternatively confirm in apps/auth that a reused-within-window refresh token returns the same successor pair (idempotent rotation) and document it as the invariant this code relies on.

**WEB-2** — `src/app/api/log/route.ts:1-25` — unauthenticated POST that appends to `process.cwd()/logs/app.log` with `fs.appendFile`. On Workers the bundle filesystem is read-only/virtual and per isolate, so every call fails with 500 (or writes to an isolate-local in-memory file that disappears). Anyone can call it at volume. Severity: low. Fix: delete the route (the shared logger ships to log-service in dev only) or gate it to `NODE_ENV=development`.

**WEB-3** — `open-next.config.ts` + `wrangler.*.jsonc` — `kvIncrementalCache` is configured without a `NEXT_INC_CACHE_KV` binding, and no tag cache / revalidation queue is configured. Fetch caching (`next.revalidate`) and `revalidatePath` (lib/actions/multi-account.ts) are therefore silent no-ops (or per-isolate) instead of shared. Nothing correct depends on it today, but anyone adding ISR will get per-isolate, inconsistent pages. Severity: low. Fix: bind a KV namespace (or switch to the R2 incremental cache) plus the D1/DO tag cache, or remove the override.

#### OK

- Session state is cookie-only: no server-side session store, so no cross-isolate session inconsistency.
- `lib/auth/openauth-client.ts:14`: discovery + JWKS only, 10 min TTL.
- `lib/api/i18n.ts:17`: non-user data; 1 h TTL means an admin translation edit can take up to an hour to reach each isolate and different users can see different versions in that window. Acceptable for a read cache; shorten it if editors complain.
- `lib/profileFetchLock.ts:2` module-level Set: dead code (no importers).
- `services/api/engagement.service.ts:515` singleton with `viewTracked` Set: only reached from the client hook `useVideoEngagement`; constructor bails out without `window`.
- `lib/auth/client-token.ts:29-30`, `lib/query-client.ts:60`, `lib/consent/ConsentManager.ts`, `lib/crypto.ts:98`: browser-only (window/IndexedDB guarded).
- `packages/logger`: HTTP log shipping is off unless `LOG_SERVICE_URL` or development; if it were enabled in production each log line would be one subrequest.

### admin-web

Next.js on Workers via OpenNext (`al-ummah-admin-web`, stage, qa). Bindings: ASSETS only; same `kvIncrementalCache`-without-binding config as web. Session = httpOnly cookie with access + refresh token; every API call goes to admin-api / api-videos.

#### Data map

| Data | Where | Write pattern |
|---|---|---|
| Admin session tokens | httpOnly cookie (lib/session-cookie.ts) | rewritten by middleware refresh (lib/session-middleware.ts:49) |
| OpenAuth client | module-level `authClient`, never expires (lib/auth.ts:40-53) | in-isolate cache (JWKS) |
| Per-request session | React `cache()` (lib/auth.ts:64) | per request |

#### Defects

**AW-1** — `src/lib/session-middleware.ts:49` + `src/lib/auth.ts:87-121` — no single-flight at all for refresh: parallel admin requests (page + RSC prefetches) in different isolates each spend the same refresh token. Same dependency on the issuer reuse window as WEB-1; in addition, when `getAdminSession` refreshes during a page render it cannot persist the rotated pair (read-only cookies), so the cookie keeps the spent refresh token and the admin is signed out about 60 s later. Severity: low/medium (admin-only traffic). Fix: same as WEB-1 (shared refresh via a DO, or idempotent rotation at the issuer); never refresh inside render, redirect through a route handler instead.

#### OK

- `src/lib/auth.ts:40` module-level OpenAuth client: public keys/discovery only; jose refetches JWKS on unknown `kid`, so no TTL is needed. (admin-api uses a 10 min TTL for the same thing; either is fine.)
- No other module-level mutable state; no bindings beyond ASSETS.

### log-service

Not a Cloudflare Worker: a Node (Hono + `@hono/node-server`) local-development log sink run with `tsx` (package.json "description: Local development logging service"), no wrangler config. It writes per-app log files on local disk.

#### Data map

| Data | Where | Write pattern |
|---|---|---|
| Log lines per app | local files (endpoints/logEntry.ts, batchLogEntry.ts) | append |
| Stream cursors | per-request Map (streamLogsRealtime.ts:60) | per connection |

#### Defects

None in scope: it runs as one Node process on a developer machine, so single-instance assumptions are correct. If it is ever deployed as a Worker it must be rewritten (local fs, long-lived streams).

#### OK

- `batchLogEntry.ts:71` and `streamLogsRealtime.ts:60` Maps are request-local.

### packages

- `packages/shared-types`: only constant module-level Maps/Sets (entitlements catalogue, Arabic normaliser). Search index writers (`search/store.ts`, `search/ownership.ts`) are shared with api-videos: atomic D1 upserts, but no version/ordering guard (see PR-8).
- `packages/logger`: no buffers or timers at module level; HTTP shipping off in deployed workers.
- `packages/fanous-tokens`, `packages/mcp-log-server`: build/dev tools, not runtime Worker code.

### Cross-cutting summary

1. Realtime is a single global Durable Object with in-memory-only state under the Hibernation API (WS-1, WS-2). This is the most urgent item: it can fail silently today, independent of scale, and it hard-caps the site at 1000 concurrent realtime users.
2. No R2 conditional writes anywhere in these apps (or in api-videos). Video docs (with embedded comments), post docs and channel docs are blind-rewritten by admin-api (AA-1..3), scheduler (SC-1), processor (PR-2) and api-videos. Moderation, scheduled-publish cancellations and post edits can be silently undone.
3. Counters derived by full rescans (poll votes PR-3, post likes PR-4) and the known in-isolate rollup lock (PR-1) break under consumer autoscaling (max_concurrency unset) and hit subrequest limits on popular content.
4. Unbounded single-invocation fan-out: D1 notification fan-out (PR-5), realtime pushes (PR-6), push enqueue (PR-7), scheduler scans (SC-2), admin index rebuild (AA-4).
5. Per-user secret caches in web (WEB-1) are bounded and keyed safely, but the refresh single-flight they implement does not work across isolates.

---

## Scalability audit: AlUmmahNowAuth + openauth fork (multi-isolate / multi-PoP)

Scope: `ro-AlUmmahNowAuth` (apps/auth, apps/profile, apps/admin, apps/audit-consumer, packages/ui) and
`ro-openauth/packages/openauth`. `globalThis.OPENAUTH_THEME` skipped (other agent).

Ground facts that drive most findings:
- No Durable Objects anywhere. Every piece of auth state is in **Workers KV** (`AUTH_STORAGE`, `TOKEN_REVOCATIONS`) or **D1** (`AUTH_DB`, single primary).
- KV has no CAS / no transactions, writes take up to ~60 s to reach other PoPs, reads are edge-cached (default `cacheTtl` 60 s, negative lookups cached too), `list()` lags writes, and a single key accepts ~1 write/s (more returns 429).
- `CloudflarePatchedStorage` (apps/auth/src/storage/cloudflare-patched.ts) is a thin KV wrapper: `get` = plain `kv.get` (60 s edge cache), `set` = blind `kv.put`, `scan` = `list` + one `get` per key.
- The issuer (`createMultiTenantIssuer`) and all services are rebuilt per request (apps/auth/src/index.ts:166-331), so per-issuer `lazy()` caches only live for one request.

Sections: apps/auth, apps/profile, apps/admin, openauth fork, priority order.

---

### apps/auth (OpenAuth issuer Worker, `al-ummah-now-auth`)

#### Data map

| Data | Store | Key / table | Write pattern |
|---|---|---|---|
| Password hashes | KV `AUTH_STORAGE` | `email/<email>/password` | blind put (register verify, reset); check-then-put on register (openauth provider/password.ts:492-503) |
| Email to subject | KV | `email/<email>/subject` | blind put on login (password.ts:384-390) |
| Users (KV copy) | KV | `user:<tenant>:<id>`, `email:<tenant>:<email>` (openauth user/service.ts) | read-modify-write of the whole JSON record on every login (`updateLastLogin`), suspend, delete, force-reset, update |
| Users (source of truth) | D1 `users` | unique `(tenant_id,email) WHERE deleted_at IS NULL` | single-row SQL UPDATE/INSERT (dual-written after KV) |
| Roles / permissions | D1 `rbac_*` | | SQL |
| Permission cache | KV | `rbac/permissions/<tenant>/<user>/<client>` TTL 60 s | blind put on miss; invalidation = `list` + delete per user, per user in the role (openauth rbac/service.ts:120-150, 470-520) |
| Authorization codes | KV | `oauth:code/<uuid>` TTL 60 s+ | put at /authorize; **get, mint tokens, then delete** at /token (openauth issuer.ts:1275-1345) |
| Refresh tokens | KV | `oauth:refresh/<subject>/<uuid>` TTL 1 y | pre-reserved `nextToken`; on use: get, put `timeUsed` (reuse window 60 s), mint (issuer.ts:1367-1440) |
| Refresh-token invalidation | KV | `list oauth:refresh/<subject>/` + delete each | scan (list lags writes) |
| Revocation list | KV `TOKEN_REVOCATIONS` | `u:<usr_id>` TTL 400 d | read-modify-write but monotonic `max(existing, now)` (revocation/revocation-list.ts:65-86) |
| Signing key (ES256) | KV | `signing:key/primary` (+ legacy `oauth:key/*` scan) | generate-if-missing, blind put of fixed id, re-read (openauth keys.ts:132-205) |
| Encryption key (RSA-OAEP) | KV | `encryption:key/primary` | same as signing key (keys.ts:230-305) |
| Sign-in flow records (incl. OTP code, sealed) | KV | flow key, TTL = flow lifetime | read-modify-write of the whole record per provider step (issuer.ts:784-812, 918-921) |
| OTP / email codes | inside the flow record + encrypted cookie | | no attempt counter at all |
| Device-flow records | KV | `oauth:device/<hash>`, user-code key, `oauth:device_handle/*` | read-modify-write of the whole record on every poll and on approve (openauth device.ts:497-620) |
| Device-flow rate limits | KV | `oauth:device_rl/<bucket>/<id>/<minute>` | get, +1, put (device.ts:157-167) |
| App rate limits (token endpoint, sendCode, admin) | KV | `ratelimit:<key>` JSON array of timestamps | get, filter, push, put; fails open on any error (apps/auth/src/rate-limit.ts:55-136) |
| Rate-limit config | KV | `config:rate-limits` | admin put |
| Introspect/revoke M2M rate limit | KV | `ratelimit/<endpoint>/<client>` | get, push, put (issuer.ts:1900-1928) |
| Browser sessions / account sessions (`__session` SSO) | D1 `browser_sessions`, `account_sessions` | unique `(browser_session_id,user_id)` | multi-statement sequences, not batched (adapters/session-adapter.ts:120-250, 334-410) |
| Client registrations | D1 `oauth_clients` | | admin SQL; read per /authorize and /token (no cache) |
| Audit events | Queue `AUDIT_QUEUE` → audit-consumer → D1 `audit_events` | | buffered in an isolate-wide emitter, `sendBatch` at end of request; consumer `db.batch` idempotent inserts |
| E2E code sink (QA/stage) | KV | sink key | blind put |
| Analytics | Analytics Engine | | fire-and-forget |
| Secrets (RESEND_API_KEY) | Secrets Store, cached in module `Map` forever | | (utils/secrets.ts:12) |

#### Defects

**AU-1. One KV key is the token rate limit for every first-party user (hot key, global lockout, fails open).**
- Where: apps/auth/src/utils/token-rate-limit-subject.ts:37-42, router.ts:477-488, rate-limit.ts:67-113 and 125-135.
- Category: KV read-modify-write rate limit; single-key write hot spot.
- What happens: every `/token` call from profile, admin, videos, www and cms (code exchange and every 15-minute refresh, server-side from Workers) does get + put on the same key `ratelimit:token:/token:worker:alummahnow.net`, holding up to 500 timestamps (limit 10 × 50 per 60 s). KV allows about 1 write/s per key, so from roughly 1 token request per second the puts return 429. `checkRateLimit` catches the error and allows the request, so under load the limit does nothing. Increments are also lost between concurrent isolates and between PoPs. The opposite case is worse: a busy PoP whose local copy reaches 500 entries refuses every first-party sign-in and refresh in that PoP for up to 60 s. Sessions then fail to refresh and users are signed out. 500 per minute is about 7,500 active users with 15-minute access tokens, so platform growth alone sets this off.
- Severity: **Critical** (availability of sign-in for the whole platform).
- Fix: drop the KV limiter for first-party traffic. Use the Workers Rate Limiting binding (`ratelimit` in wrangler: atomic per-PoP counters, no KV writes) keyed per user or `client_id`. For a precise global limit, use a Durable Object counter sharded by key. At minimum, never put one shared key on the request path.

**AU-2. No attempt limit on the 6-digit email code; password-reset brute force leads to account takeover.**
- Where: openauth provider/password.ts:567-576 (change/reset verify), 488-491 (register verify), 334-370 (password login). App side: only `sendCode` is rate limited (auth-handlers.ts:388-399, per IP, KV read-modify-write).
- Category: OTP brute-force limit missing; concurrency makes it fast.
- What happens: the attacker opens "Forgot password" for the victim's email (one `sendCode`, which passes the per-IP limit) and then POSTs `action=verify` with guesses. A wrong guess just rewrites the same state (`transition(provider, invalid_code)`), so there is no counter, the code never rotates and it stays valid for 24 h. Guesses spread over many isolates and PoPs run in parallel without limit. 10^6 codes at a few hundred requests per second is under an hour, after which `action=update` sets a new password. Password login (`POST /password/authorize`) has no limit either, so credential stuffing is open.
- Severity: **Critical** (security).
- Fix: keep a per-flow attempt counter and a per-email failure counter in a strongly consistent store: a Durable Object keyed by email, or a D1 row updated with `UPDATE ... SET attempts = attempts + 1 WHERE email=? AND attempts < 5 RETURNING attempts`. Invalidate the code after 5 failures and expire it after 10-15 minutes. Add the Workers Rate Limiting binding on `/password/*` POSTs per IP and per email. KV cannot hold this counter.

**AU-3. The KV user record is read-modify-written on every login and overwrites admin changes.**
- Where: openauth user/service.ts:408-421 (`updateLastLogin`, called from apps/auth handlers/auth-handlers.ts:155), plus `suspendUser` 237-274, `deleteUser` 198-224, `forcePasswordReset` 423-451, `updateUser` 143-196.
- Category: read-modify-write on KV without CAS, made worse by the 60 s edge cache.
- What happens: an admin suspends or deletes the user, or forces a password reset, and the KV record now has `status:"suspended"` / `deleted_at` / `password_reset_required:true`. A login in another PoP, or in the same PoP within the 60 s cache, reads the old record and writes it back with `last_login_at` updated. The suspension, deletion or reset flag is gone from KV while D1 still has it. `GET /admin/users/:id` (served from KV) then disagrees with the list (served from D1), and a deleted user reappears through `getUser`. Two admins editing at once also lose one edit.
- Severity: **High** (data integrity; becomes a security problem once anything enforces status from KV).
- Fix: make D1 the only store for user records. Drop the KV copy, or treat it as a cache that is deleted and never rewritten. `updateLastLogin` should be a single SQL `UPDATE users SET last_login_at=? WHERE id=?` with no rewrite of the whole record.

**AU-4. Revocation and sign-out take up to about 60 s per PoP (KV propagation and negative caching).**
- Where: revocation/token-gate.ts:54-72, revocation-list.ts:50-58.
- Category: KV eventual consistency used for a security decision.
- What happens: "sign out everywhere", a password change, or an admin suspend or delete writes `u:<id>`. A refresh served in another PoP within about 60 s still reads no entry. A recent miss is cached at the edge, so even a just-checked PoP keeps answering "not revoked". That refresh succeeds and mints a fresh 15-minute access token, so a stolen session survives the reset by up to about 16 minutes. The monotonic `max()` design is sound; the lag is the problem.
- Severity: **Medium**.
- Fix: keep the revocation entry in a strongly consistent store on the refresh path: a Durable Object per user, or D1 with `SELECT before FROM revocations WHERE user_id=?`, one indexed read per refresh. Keep KV only for resource servers, or read KV with `cacheTtl` at its minimum and accept the lag explicitly.

**AU-5. The `RESEND_API_KEY` secret is cached forever per isolate.**
- Where: apps/auth/src/utils/secrets.ts:12, 48-60.
- Category: module-level mutable cache without a TTL (not user data).
- What happens: after the key is rotated in Secrets Store and the old one revoked, warm isolates keep sending with the old key, so sign-up and reset emails fail with `code_send_failed` on some requests and work on others until each isolate is evicted (hours). `services/encryption.ts:22` (`masterCryptoKey`) does the same for `KEY_ENCRYPTION_MASTER_KEY` and also ignores its argument once set.
- Severity: **Low-Medium**.
- Fix: give the cache a TTL of a few minutes, or drop it (Secrets Store `get()` is cheap). Key the crypto key cache by the secret value.

**AU-6. D1 session writes are multi-statement and non-atomic, with check-then-insert races.**
- Where: adapters/session-adapter.ts:120-250 (`addAccountToSession`: SELECT existing, then UPDATE/INSERT, then 2 more UPDATEs; "max 3 accounts" COUNT then INSERT), 334-353 (`switchActiveAccount`, 3 statements), 357-397 (`removeAccount`).
- Category: D1 read-modify-write across statements.
- What happens: two tabs finish sign-in or switch accounts at the same moment, and the statements interleave. The result is zero or two `is_active=1` rows, an `active_user_id` that points at a different user than `is_active`, a 4th account past the limit, or a unique-index error on the parallel INSERT. That error is caught in enterprise/issuer.ts:440-458, so the SSO session silently misses the account. Each sign-in also costs about 5 sequential D1 round trips to the single primary.
- Severity: **Low-Medium**.
- Fix: send each sequence as one `db.batch([...])` (a transaction). Use `INSERT ... ON CONFLICT(browser_session_id,user_id) DO UPDATE`. Enforce the account limit inside the INSERT (`INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < 3`).

**AU-7. Audit events are buffered in an isolate-wide emitter and the logger singleton is shared across concurrent requests.**
- Where: audit-emitter.ts:729-800 (`ensureAuditEmitter` rebinds the shared emitter to the latest `ctx`), QueueSink buffer 561-613; logger.ts:18-57, 203 (`currentRequestId`, `ctx` and the flush timer are module state; `initialRequest` clears another request's timer).
- Category: module-level mutable state written per request.
- What happens: request A buffers events and request B arrives and rebinds `ctx`. A's `flushAuditEvents` still runs in its own `waitUntil`, so this is mostly benign. But a failed `sendBatch` puts events back in the buffer of an isolate that may never get another request, so those audit events are lost on eviction. The logger's `currentRequestId` belongs to whichever request started last. D1 logging is off, so the shared timer is currently harmless.
- Severity: **Low**.
- Fix: create the emitter and logger per request, or pass `ctx` and the request id explicitly. On `sendBatch` failure, write the events to the stdout backup immediately instead of keeping them in isolate memory.

**AU-8. Dead code that would be unsafe if re-enabled (listed so nobody revives it).**
- routes/authorize.ts and utils/authorization-code.ts:60-110: not imported. Its D1 code redemption is SELECT `used_at IS NULL` then UPDATE, which is not single-use under concurrency. If revived, use `UPDATE ... SET used_at=now WHERE code_hash=? AND used_at IS NULL RETURNING *`.
- routes/session-routes.ts: not mounted (`/session/*` is served by OpenAuth). Its KV rate limits have the AU-1 problems.
- Severity: Info.

#### OK
- `utils/jwks-cache.ts:63`: module-level JWKS cache (public key only, TTL). Fine.
- `revocation-list.ts`: monotonic `max(existing, now)`, so a stale read cannot shorten a revocation. Sound apart from the lag in AU-4.
- `token-gate.ts` `handleTokenRevoke`: delete of one refresh token, idempotent.
- `services/token-cleanup.ts` and the cron: batched `DELETE ... WHERE id IN (SELECT ... LIMIT ?)` with a time box. No unbounded fan-out.
- apps/audit-consumer: queue batches of 50, `db.batch` idempotent inserts, DLQ replay. It shares the auth D1 database (single primary), which is acceptable at current volume. Watch write contention with session writes if audit volume grows.
- `router.ts:563` `adminGuardApp`, `GUARDED` and the e2e-sink `Set`: immutable module constants.
- No Durable Objects, so there is no single-object funnel.
- The per-request issuer construction means the `lazy()` key caches are never shared across requests. Correct, at the cost of extra KV reads (see OA-6).

---

### apps/profile (`al-ummah-now-profile`)

#### Data map

| Data | Store | Key | Write pattern |
|---|---|---|---|
| App session (user, access + refresh token) | KV `AUTH_STORAGE` (shared namespace with the issuer) | `session:<uuid>` TTL 7 d | put on callback; read-modify-write of the whole record on every token refresh (session-store.ts:127-148) |
| Logout tombstone | KV | `profile-revoked:<uuid>` TTL 7 d | blind put, then delete the session (session-store.ts:99-103) |
| OpenAuth client (discovery + JWKS) | in-memory `Map`, 10-minute TTL | index.ts:95 | per-isolate cache of public data |
| Profile images | none (no R2 binding; nothing stored) | | |

#### Defects

**PF-1. Refreshes from stale reads can trip the issuer's reuse detection and sign the user out everywhere.**
- Where: apps/profile/src/session-store.ts:161-201 (`ensureFreshTokens`) and 127-148 (`persistSessionTokens`). Issuer side: openauth issuer.ts:1405-1440 (reuse window `DEFAULT_REFRESH_REUSE_WINDOW = 60` s; past it, `auth.invalidate(subject)`).
- Category: read-modify-write of rotating credentials on KV; the 60 s KV propagation and cache equal the 60 s reuse window.
- What happens: request A (PoP X) refreshes R0, gets R1 and writes the session. Request B, in PoP Y or in X with the 60 s edge cache still holding the old session, reads R0 and refreshes with it. Within 60 s of A's use it gets the same pre-reserved R1, which is fine. Once more than 60 s have passed, which happens when KV propagation is slow or a cached read lingers, the issuer treats it as token theft. `invalidate` deletes every refresh token of the subject (all apps, all devices), so the user is signed out everywhere. Concurrent tabs firing API calls right at the refresh threshold make this routine at scale. The same applies to the admin app (AD-1) and any other first-party app with this pattern.
- Severity: **Medium-High** (spurious global sign-outs under load).
- Fix: on the issuer, raise the reuse window well beyond the KV staleness bound (for example 5-10 minutes) and make the reuse response revoke only the token family descended from that token, not the whole subject. In the apps, keep the session in a Durable Object (or serialize the refresh per session in one) so only one refresh per session runs at a time. KV cannot give a fresh read, so the app-side fix has to be a DO or D1.

**PF-2. Logout takes effect only per PoP (tombstone in KV).**
- Where: session-store.ts:40-81, 99-103.
- Category: KV eventual consistency.
- What happens: after logout in PoP X, requests through PoP Y keep the session working for up to about 60 s. The design (tombstone first, re-check after the write) correctly stops a racing refresh from reviving the session once the tombstone is visible. The lag itself remains.
- Severity: **Low**.
- Fix: acceptable as is. For instant logout, keep sessions in a DO or D1.

#### OK
- `authClients` Map (index.ts:95): isolate-wide cache of the OpenAuth client (discovery document and JWKS, public data), 10-minute TTL. Fine.
- `createSession`: random UUID key, blind put, no contention.

---

### apps/admin (`al-ummah-now-auth-admin`, React Router on Workers)

#### Data map

| Data | Store | Key | Write pattern |
|---|---|---|---|
| Admin session (user, tokens) | KV `AUTH_STORAGE` | `session:<uuid>` | put on callback; read-modify-write on refresh (lib/session-tokens.server.ts:143-175, 192-240) |
| Logout tombstone | KV | revoked key | put then delete (session-tokens.server.ts:70-76) |
| M2M access token (client_credentials) | module `let tokenCache` | lib/admin-api.server.ts:103 | per-isolate cache, expires 60 s before `expires_in` |
| OpenAuth client | module `Map`, 10-minute TTL | lib/openauth.client.server.ts:27 | per-isolate cache |
| Logs | module `Logger` singleton | lib/logger.server.ts:210 | console only |

#### Defects

**AD-1. Same refresh race as PF-1.**
- Where: apps/admin/app/lib/session-tokens.server.ts:192-240 and lib/auth.server.ts:160-185.
- Severity: **Medium-High**. Same fix as PF-1.

**AD-2. Every cold isolate fetches its own M2M token.**
- Where: lib/admin-api.server.ts:103-160.
- Category: per-isolate cache of non-user data (the acting admin is sent per request in `X-Acting-User-Id`, so no user data leaks between requests).
- What happens: no correctness problem. Each new isolate does a `client_credentials` call, and those land in the shared first-party `/token` bucket of AU-1. `clearTokenCache` only clears the local isolate.
- Severity: **Low** (Info).
- Fix: none needed beyond AU-1. Optionally cache the token in KV with its expiry.

#### OK
- `clients` Map: public discovery and JWKS data, TTL. Fine.
- `logger.server.ts` singleton: same shape as AU-7, console only. Fine.

---

### openauth fork (`packages/openauth`)

#### Defects

**OA-1. The authorization code is not single-use across isolates or PoPs.**
- Where: packages/openauth/src/issuer.ts:1275-1352 (get, PKCE check, `generateTokens`, then `Storage.remove`). Same pattern for the device flow callback, device.ts:516-535.
- Category: single-use credential on KV without an atomic consume.
- What happens: two `/token` requests with the same code arrive concurrently, or within about 60 s through different PoPs (the delete has not propagated or the edge still caches the code). Both read the payload and both mint full token pairs. The `authorization_code` grant does not authenticate confidential clients (it only compares `client_id`; the secret is checked only on `client_credentials`), so for clients registered without PKCE a code leaked through logs, a Referer header or a proxy can be redeemed even after the legitimate exchange. RFC 6749 §4.1.2 also asks to revoke tokens issued from a reused code, and nothing here records that a code was used.
- Severity: **High**.
- Fix: consume the code atomically. Use a Durable Object per code (or one sharded by code prefix) with `get+delete` inside the DO, or D1 `DELETE FROM oauth_codes WHERE code=? RETURNING payload`. Remember used codes, so a replay revokes the tokens minted from them (store the refresh token id with the used-code marker). Require PKCE or client authentication for every client.

**OA-2. Refresh-token rotation and reuse detection run on KV.**
- Where: issuer.ts:1367-1440, 1041-1080 (`generateTokens` pre-reserves `nextToken`).
- Category: read-modify-write on KV for rotating credentials.
- What happens:
  - (a) False reuse detection that wipes every token of the subject (see PF-1).
  - (b) A just-issued refresh token R1, written in PoP X, is not found when used from PoP Y within about 60 s. This affects mobile clients changing networks and server-side clients outside Cloudflare such as the CMS SSO backend. The result is `invalid_grant` and a forced sign-in.
  - (c) The reuse response `auth.invalidate` lists `oauth:refresh/<subject>/`, and `list` lags writes, so tokens minted in the last minute, including the attacker's freshly rotated one, can be missed.
  - (d) Concurrent refreshes of one token each put the same key, and above about 1 write/s per key KV returns 429, which surfaces as a 500.
- Severity: **Medium-High**.
- Fix: move refresh tokens to a strongly consistent store. A D1 table with `UPDATE refresh_tokens SET used_at=? WHERE id=? AND used_at IS NULL RETURNING *` gives atomic rotation. Alternatively use a Durable Object per subject, which also makes `invalidate` exact. On reuse, also write the user's revocation entry (apps/auth revocation list) so tokens missed by the list still die. Widen the reuse window beyond the staleness bound.

**OA-3. A signing or encryption key generation race produces two different keys under the same `kid`.**
- Where: keys.ts:111-205 (signing), 207-305 (encryption). The in-memory `keyGenerationLocks` (keys.ts:32) only covers one isolate.
- Category: key generation race; in-memory lock assuming one instance.
- What happens: on a fresh environment, after the key is deleted, or if a key ever gets `expired`, isolates in several PoPs all miss `signing:key/primary` (misses are cached at the edge for 60 s), all generate an ES256 pair and all put under the same id `primary`. Each one then re-reads its own write in its own PoP and signs with its own private key under `kid:"primary"`. KV settles on one winner. Every token signed by the losers fails verification everywhere, and because the `kid` is identical, verifiers cannot even fetch "the other key" (bearer-auth, profile/admin clients, apps/auth `jwks-cache.ts` and resource servers cache JWKS for 10 minutes). The encryption key has the same problem: flow and provider cookies encrypted by a loser cannot be decrypted. There is no rotation code (nothing sets `expired`), so today it only happens on bootstrap (new env, QA reset). A future rotation would hit it in production.
- Severity: **Medium** (bootstrap and future rotation; production is stable while the key exists).
- Fix: provision keys out of band (a deploy-time script or admin endpoint) and make the request path read-only, failing closed when the key is missing. If generation must happen at runtime, do it inside a single Durable Object or with D1 `INSERT ... ON CONFLICT DO NOTHING` followed by re-reading the winner. Use a unique `kid` per key and publish all non-expired keys so a race can never produce two keys with one `kid`.

**OA-4. The device flow poll overwrites the approval (whole-record read-modify-write on KV).**
- Where: device.ts:566-620 (`deviceToken`: every poll writes `{...record, lastPollAt}` or `{...record, interval+5}`), 497-551 (callback writes `{...record, status:"approved", grant}`), 426-436 (deny).
- Category: read-modify-write on KV without CAS.
- What happens: the TV polls every 5 s. The user approves on the phone and the callback writes `approved`. A poll that read the record before the approval, or in another PoP or the same PoP within the 60 s edge cache (likely, since the TV polls constantly and the cached copy says `pending`), writes `{status:"pending", lastPollAt}` back. Last writer wins, so the approval is lost, the user code has already been deleted (device.ts:550), and the TV never gets tokens. The user has to start over, possibly several times. Also: concurrent polls on an approved record both mint tokens (get, then remove, then `generateTokens`, device.ts:581-595), and the poll puts one key every 5 s per device (within limits).
- Severity: **High** for the TV sign-in feature (it fails often, independent of load).
- Fix: keep poll metadata (`lastPollAt`, `interval`) in a separate key from the status, or better, keep the device record in a Durable Object keyed by the device-code hash (the DO serializes approve and poll and gives an atomic "approved, then consume once"). Never rewrite the whole record from a poll.

**OA-5. The flow-record provider state prefers a stale KV copy over the newer cookie.**
- Where: issuer.ts:843-855 (`get`: if the flow record has a sealed value, return it; the cookie is used only when KV has none), 784-812 (`set` writes both).
- Category: KV eventual consistency; read-modify-write of the flow record.
- What happens: a user on a network that switches PoPs mid-sign-in (mobile), or a request whose PoP cached the old record, submits the code. The stale KV state (`start`, or a code that was since re-sent) wins over the fresh cookie. The user gets bounced back to the start, or sees "invalid code" for the code just emailed.
- Severity: **Low-Medium**.
- Fix: put a monotonically increasing `rev` (or `updatedAt`) in both the sealed KV value and the cookie, and use whichever is newer.

**OA-6. Every request lists KV for the legacy signing keys (fan-out and cost).**
- Where: issuer.ts:679-684 (`Promise.all([signingKeys(storage), legacySigningKeys(storage)])`), keys.ts:85-109 (`Storage.scan(["oauth:key"])` = `list` + one `get` per key). The issuer is built per request (apps/auth/src/index.ts:271).
- Category: unbounded per-request KV fan-out.
- What happens: each token issuance or JWKS request does a KV `list` plus N gets plus imports of PKCS8 keys. That adds latency and KV list cost, which grows with traffic. `encryptionKeys` and `signingKeys` also re-import keys on every request.
- Severity: **Low-Medium** (performance and cost).
- Fix: cache the imported key set in module scope with a short TTL (keys are not user data). Drop `legacySigningKeys` once no RS512 key remains, or store the legacy list under a single key.

**OA-7. RBAC permission-cache invalidation fans out to every user in a role.**
- Where: rbac/service.ts:138-150 (`invalidateRoleCache`), 470-520 (`assignPermissionToRole`/`removePermissionFromRole`: `listUserRoles(roleId)`, then for each user a KV `list` and deletes, sequentially).
- Category: unbounded fan-out.
- What happens: changing a permission on `role_member` (held by every user) runs one KV list per user in a single request. Past about 1,000 users it hits the subrequest limit and CPU and time limits. The `try/catch` swallows the error, so the admin sees success while invalidation stopped halfway. The cache TTL is 60 s anyway, so the work is pointless.
- Severity: **Medium** (admin operations break as the user base grows).
- Fix: rely on the 60 s TTL, or version the cache key (`rbac:v<roleVersion>:...` with the version stored in D1 or KV) so one write invalidates everything.

**OA-8. Latent in-memory and KV rate limiters (not used by the app today).**
- Where: middleware/rate-limit.ts:13-42 (`memoryStore` default: a per-isolate `Map`, so the limit multiplies by the number of isolates and resets on eviction), 47-70 (`kvStore`: read, +1, put, losing increments); issuer.ts:1900-1928 `checkRateLimit` (introspect/revoke, per client: KV array read-modify-write, loses increments, and puts one key per call, so 429s above 1 req/s per client); device.ts:157-178 (`hitRateLimit`: KV get, +1, put).
- Category: in-memory or KV rate limits assuming one instance.
- What happens: the limits are not enforced under concurrency. Parallel requests all read the same count, so N isolates allow N times the limit. The device-flow lookup limits are therefore soft, which is acceptable given the 34-bit code space. The introspection limiter becomes a 429-to-500 source for a busy resource server.
- Severity: **Low** (Medium if anything starts relying on them).
- Fix: Workers Rate Limiting binding, or a DO counter. Remove `memoryStore` as the default.

**OA-9. The default-tenant cache is per isolate with a 1-hour TTL and local-only invalidation.**
- Where: enterprise/default-tenant-cache.ts:50-120 (module `let cache`, `invalidateDefaultTenantCache()` only clears the calling isolate). Exported but currently unused by apps/auth. Theme-adjacent and separate from `OPENAUTH_THEME`.
- Category: module-level cache of non-user data with local invalidation.
- What happens: after the default tenant changes, other isolates serve the old values for up to 1 h.
- Severity: **Low**.
- Fix: shorter TTL, or a version key in KV.

#### OK
- `client.ts:571-572` discovery and JWKS caches: public data, TTL, deduplicated in-flight fetches, forced re-fetch gap. Fine.
- `middleware/bearer-auth.ts:106` JWKS resolver cache: 10-minute TTL. Fine.
- `enterprise/issuer.ts:305` `requestContextMap`: a WeakMap created per issuer instance (per request in this app). Fine.
- `storage/aws.ts:11` cached EC2 credentials: not used on Workers.
- The refresh `nextToken` pre-reservation (issuer.ts:1063-1081) correctly makes concurrent refreshes within the reuse window idempotent. The problems are only the KV staleness issues in OA-2.

---

### Priority order
1. AU-2: OTP and password brute force (account takeover).
2. AU-1: global first-party `/token` KV rate-limit key (platform-wide sign-in and refresh outage at modest scale).
3. OA-4: device-flow approval lost to the poll (TV sign-in unreliable today).
4. OA-1: auth code not single-use.
5. OA-2, PF-1, AD-1: refresh rotation on KV (spurious global sign-outs; cross-PoP invalid_grant).
6. AU-3: KV user record clobbering.
7. OA-3: key generation race (fix before any rotation work or new environment).
8. AU-4, OA-7, AU-6, OA-6, AU-5, OA-5, then the rest.

Common remedy: one small Durable Object class (or D1 conditional SQL) for the four things that must be atomic: code consume, refresh rotation, OTP attempts, and device-record state. Plus the Workers Rate Limiting binding to replace every KV rate limiter.

---

## Scalability / concurrency audit: UI, CMS, Core, Tools

Scope: code that breaks when Cloudflare runs many isolates at once, or when several copies of a
Tools program run in parallel against the same data. Read-only audit of the `ro-*` checkouts.
Line numbers refer to those checkouts.

### AlUmmahNowUI (www Worker, Astro on Workers + static assets)

Bindings (wrangler.jsonc): `CMS` service binding, `CONTENT_SNAPSHOT` KV, `ASSETS`. No D1, no R2,
no Durable Objects, no queues. Sessions are stateless sealed cookies (AES-GCM). Pages never read the
session server-side (only `/auth/*` routes do), so cached HTML holds no per-user data.

#### Data map

| Data | Where it lives | How it is written |
|---|---|---|
| Rendered locale HTML (`/en/*`, `/ar/*`, `?page=` only) | Cache API (per colo), key = URL | blind `cache.put` in `waitUntil`; only 200, no `Set-Cookie`, not built-in fallback (`src/lib/edge.ts:99-135`) |
| CMS JSON responses | Cache API key `${SITE_URL}/__cms/v1<path>` | blind put, 60 s fresh + 600 s stale (`src/lib/cms.ts:60-70`) |
| Last-known-good CMS JSON | KV `CONTENT_SNAPSHOT`, key `v1:<path>` | read-metadata-then-put (no CAS), throttled per isolate to 1 per 5 min per key (`src/lib/cms.ts:72-87`) |
| Videos API item metadata | Cache API key `${SITE_URL}/__videos/v1/<kind>/<id>` | blind put, 60 s (`src/lib/videos.ts:120-123`) |
| Session / login state | sealed cookies `__Host-aun_www`, `__Host-aun_www_login` | set on response; nothing server-side |
| Snapshot write throttle | module-level `Map` `snapshotWrites` (`src/lib/cms.ts:42`) | per isolate |
| Imported AES key per secret | module-level `Map` `keys` (`src/lib/session.ts:26`) | per isolate, immutable value |
| JWKS fetcher per issuer | module-level `Map` `jwks` (`src/lib/auth.ts:118`) | per isolate, jose remote JWK set (10 min cache) |
| Content source of truth | CMS Worker (D1) via service binding; videos API over HTTPS | read only |

#### Defects

**UI-1: unbounded video fan-out per home / videos page render**
- Where: `src/lib/videos.ts:130-132` (`resolveCurated` → `Promise.all` over every curated row), fed by
  CMS `src/routes/public-api.ts:151-160` (`curated()` has no `LIMIT`).
- Category: unbounded fan-out vs the per-invocation subrequest limit.
- Scenario: editors curate N items for `placement=home` (or `videos`). Every cache-missing render of
  `/en/` and `/ar/` does, per item, `cache.match` + `fetch(videos API)` + `cache.put`. Cache API
  calls count as subrequests, so a render costs up to about 3N + the CMS calls. With a few hundred
  curated rows (or after the 60 s item cache expires everywhere at once) a render hits the
  subrequest limit or the 2.5 s timeouts, and items silently drop off the page. All renders in a colo
  do this together (see UI-2), so the videos API also gets N × (renders) requests per minute.
  `renderBody` is already capped at 12 (`src/lib/body.ts:10`); curated lists are not.
- Severity: medium (low today if lists stay small, but nothing enforces that).
- Fix: cap in the CMS query (`LIMIT 48` per placement) and in `resolveCurated` (`slice(0, 48)`);
  better, use the server-side `snapshot` the picker already stores so a render needs no per-item
  videos call, refreshing snapshots out of band, or batch through one videos API call if one exists.

**UI-2: stale-while-revalidate stampede (no single-flight across isolates)**
- Where: `src/lib/edge.ts:123-131`.
- Category: per-isolate assumption / herd.
- Scenario: a popular page goes stale (age 60–660 s). Every request that lands in that window, in
  every isolate in the colo, starts its own background `render()` (each = CMS calls + curated video
  calls + cache puts) until the first one finishes its `cache.put`. With 50 req/s on `/ar/` that is
  dozens of full renders per colo per minute instead of one, multiplied by UI-1's fan-out, and a
  burst on the CMS service (D1 reads) and the videos API every 60 s.
- Severity: low-medium (cost and upstream load, not correctness).
- Fix: on a STALE hit, first re-`put` the stale entry with a bumped `x-www-stored-at` (e.g. now - 50 s)
  as a cheap "revalidation in progress" lease before rendering, so other isolates see it as fresh for
  ~10 s; or move HTML caching to the CDN cache (`s-maxage` + `stale-while-revalidate` via Cache Rules)
  which collapses revalidation per colo.

**UI-3: KV snapshot write is check-then-put; isolates race on the same key**
- Where: `src/lib/cms.ts:72-87`.
- Category: read-modify-write on KV without a conditional write; per-isolate throttle.
- Scenario: the in-isolate `snapshotWrites` throttle only covers one isolate. When a key's
  `writtenAt` passes 5 min, every isolate that fetches that path fresh in the same second reads the
  old metadata and `put`s. KV allows 1 write/s per key, so extra puts get 429 (caught and logged), and
  an isolate whose CMS fetch was slower can overwrite a newer snapshot with older JSON. Data is
  public and only a fallback, so the effect is log noise and a snapshot up to one CMS cycle older.
- Severity: low.
- Fix: acceptable as is; to be tidy, write snapshots from a cron trigger (one writer) instead of on the
  request path, or compare a content hash/`updated_at` before `put`.

#### OK (not defects)

- `snapshotWrites` (`src/lib/cms.ts:42`): per-isolate throttle of non-user data, documented as such; KV metadata covers other isolates (see UI-3 for the residual race).
- `keys` (`src/lib/session.ts:26`) and `jwks` (`src/lib/auth.ts:118`): per-isolate caches keyed by config (secret / issuer URL), no per-user data.
- HTML edge cache key is the URL only, which is safe because no page reads the session or cookies server-side (`readSession` is only used by `/auth/me`), responses with `Set-Cookie` are never stored, `/` redirect is `private, no-cache`.
- Cache API entries for CMS and videos JSON: short-TTL read caches of public data.
- `cmsClient().sources` array (`src/lib/cms.ts:169`): created per request.
- Sign-in state lives in sealed cookies, so any isolate can finish a login another isolate started.
- No D1/R2/Durable Objects/queues in this Worker.

### AlUmmahNowCMS (cms Worker: Hono wrapper around bknd 0.21.0, D1 + R2)

Bindings: `DB` (D1), `MEDIA` (R2). No KV, no Durable Objects, no queues. Admin sessions are bknd
HS256 JWT cookies (stateless); SSO tx state is a signed cookie.

#### Data map

| Data | Where it lives | How it is written |
|---|---|---|
| pages, posts, nav_items, curated_videos, site_settings | D1 tables (`migrations/0001_init.sql`) | bknd mutator `insertOne`/`updateOne` (single-row SQL, last writer wins); content-rules plugin reads the current row before update (`src/lib/content-rules.ts:109-120`) |
| curated_videos from the picker | D1 `curated_videos` | `insertOne` with server-side snapshot (`src/routes/picker.ts:236-270`); no uniqueness on (kind, ref_id, placement, locale) |
| CMS users (SSO identity cache) | D1 `users` (unique `sso_sub`, unique `email`) | SELECT then `batch` UPDATE/INSERT (`src/lib/users.ts:15-45`) |
| Media files | R2 `MEDIA`, key = media `path` | bknd `putObject` (blind put), then `media` row insert (unique `path`) via `FileUploadedEvent` |
| Media metadata | D1 `media` | bknd insert after upload |
| Admin session | `auth` cookie (bknd JWT, 8 h) | set on SSO callback; nothing server-side |
| SSO login transaction | signed cookie `__Host-cms_sso` | set on `/sso/login`, consumed on `/sso/callback` |
| bknd App instance | module-level `cached` (`src/app.ts:28`) | built once per isolate, keyed by secret length + public URL |
| JWKS fetcher | module-level `jwksCache` (`src/lib/oidc.ts:89`) | per isolate |
| Public API responses | none server-side; `Cache-Control` for shared caches, www caches them | read-only D1 |

#### Defects

**CMS-1: admin media uploads keep the client's file name, so a second upload overwrites the first in R2**
- Where: bknd admin UI posts to `getFileUploadUrl(file)` = `/api/media/upload/<file.path>` unless
  `randomFilename` is set (bknd `ui/index.js`, `b5({... randomFilename: o ...})`, default unset); the
  route does `uploadFile(file, filename ?? random)` = blind `R2.put` and only then inserts the
  `media` row (unique index on `path`). The wrapper passes it through untouched
  (`src/index.ts:159-170`, `src/lib/paths.ts:28-40` only checks type/size).
- Category: blind put on R2 with a shared key; insert-after-write with no rollback.
- Scenario: editor A uploads `cover.jpg` and attaches it to a published post. Later (or at the same
  moment, from another isolate) editor B uploads a different `cover.jpg`. B's `R2.put` silently
  replaces A's bytes; B's `media` insert then fails on `idx_unique_media_path` and B sees an error,
  but the live post now shows B's image (and its stored size/etag/width/height no longer match).
  Two concurrent same-name uploads both write R2; one row wins, the other request errors.
  Entity-attached uploads (`/api/media/entity/...`) use a random name and are not affected.
- Severity: medium (silent content corruption on the public site; needs only two same-named files).
  Confirm on QA by uploading two different files with the same name via the Media page.
- Fix: in the wrapper, reject or rewrite `POST /api/media/upload/<name>` so bknd always generates the
  name (forward to `/api/media/upload` with the same body), or check `media.path`/`R2.head` first
  and 409 when it exists. If keeping names, use R2 `put(key, body, { onlyIf: ... })` so an existing
  object is never replaced.

**CMS-2: first SSO sign-in upsert is SELECT-then-INSERT; two concurrent callbacks for a new user fail one**
- Where: `src/lib/users.ts:20-44`.
- Category: D1 read-then-write race (non-atomic upsert).
- Scenario: a new editor signs in from two tabs, or the silent re-auth and a normal login cross, so
  two `/sso/callback` requests for the same `sub` run in different isolates. Both SELECT no row, both
  run the batch `UPDATE users SET email=NULL…; INSERT …`; the second INSERT violates
  `idx_unique_users_sso_sub`, the batch rolls back and that request 500s ("Sign-in failed").
  The existing-row path is fine. Also, the `UPDATE … SET email = NULL WHERE email = ?1` in the insert
  batch can strip the email from a row another callback just updated (account re-created case).
- Severity: low (rare, user retries, no data loss).
- Fix: one statement: `INSERT INTO users (sso_sub, email, strategy, role) VALUES (?1, ?2, 'sso', ?3)
  ON CONFLICT(sso_sub) DO UPDATE SET email = excluded.email, role = excluded.role, strategy = 'sso',
  strategy_value = NULL RETURNING id` (keep the email-release UPDATE before it in the same batch,
  scoped `AND sso_sub IS NOT ?1`), plus the legacy email-only-row match as a separate UPDATE.

**CMS-3: content edits are last-writer-wins with no version check**
- Where: bknd `PATCH /api/data/entity/<entity>/<id>` via the admin UI; `src/lib/content-rules.ts:109-120`
  reads `current` then the mutator writes the full form.
- Category: lost update (read-modify-write without a version/`updated_at` precondition).
- Scenario: two editors open the same post; A fixes a typo in `body` and saves; B, whose form still
  has the old body, changes the title and saves. bknd sends B's whole form, so A's fix is lost with
  no warning. The `published_at` rule reads `current` separately, so it is safe, but the row body is
  not.
- Severity: low (small editor team; standard CMS behaviour).
- Fix: optional optimistic lock: in the `MutatorUpdateBefore` listener, if the payload carries
  `updated_at` and it differs from `current.updated_at`, throw a 409 `ContentRuleError`.

**CMS-4: no cap on curated rows returned to www (feeds UI-1)**
- Where: `src/routes/public-api.ts:151-160` (`curated()` has no `LIMIT`); the picker allows duplicate
  rows for the same video (`src/routes/picker.ts:236-270`, no unique index), so a double-click on
  "Add" creates two rows and two fetches per render on www.
- Category: unbounded fan-out (downstream subrequests on www).
- Severity: low on its own, medium together with UI-1.
- Fix: `LIMIT 48` in `curated()`; unique index on `(kind, ref_id, placement, locale)` or an
  `INSERT … ON CONFLICT DO NOTHING` in the picker (needs a new expand-only migration).

#### OK (not defects)

- `cached` bknd App per isolate (`src/app.ts:28-57`): built from config only. Checked bknd 0.21.0's
  `Authenticator.resolveAuthFromRequest`/`verify`: stateless (no per-user field on the instance), and
  `asyncEventsMode: "sync"` keeps listeners off the first request's `waitUntil`. Safe to share.
- `jwksCache` (`src/lib/oidc.ts:89`): per-issuer, public keys only.
- D1 write volume is editor-driven (a handful of writes per minute at most); public traffic is read-only
  and fronted by www's Cache API + KV. No D1 write hot spot.
- `/healthz?deep=1` does one `SELECT 1`; `sitemap` reads all published rows in two queries, fine at CMS scale.
- `admin-ui.ts` `busy` flag is browser-side script text, not Worker state.
- No Durable Objects, KV, queues or in-memory rate limits.

### AlUmmahNowCore (Rust core + UniFFI bindings)

Client-only. It builds `aun_core` as a `cdylib`/`staticlib` via UniFFI for the Apple, Android and
.NET desktop apps (`docs/PLAN.md` §1, `crates/aun-ffi/Cargo.toml:12`). No wasm target, no Workers
code, nothing in it runs on Cloudflare. It talks to the platform only as an HTTP client
(api-videos REST, TUS upload proxy, auth). So the isolate questions don't apply; only
multi-process client issues and how its writes land on the server.

#### Data map

| Data | Where it lives | How it is written |
|---|---|---|
| Sync state (watch position, history, watch later, likes, notes) | one JSON file per account on device | in-process `Mutex`, atomic temp+rename (`crates/aun-sync/src/store.rs:125-139`); LWW registers with Lamport floor |
| Server watch progress / library | api-videos (D1 on the server side) | outbox of REST calls, coalesced per video every 30 s; server stamps with server time (`docs/SYNC.md` "Server gaps") |
| Upload manifests | `<dir>/<upload id>.json` on device | temp + rename (`crates/aun-upload/src/store.rs:110-115`) |
| Upload bytes | api-videos TUS proxy | TUS `POST` + `PATCH` with `Upload-Offset` |
| Tokens | platform token store trait (Keychain, etc.) | via adapter |

#### Defects

**CORE-1: no cross-process lock on the sync and upload stores**
- Where: `crates/aun-sync/src/store.rs:125-139`, `crates/aun-upload/src/store.rs:110-115`.
- Category: parallel instances racing on the same files.
- Scenario: the desktop app is started twice (or a helper process opens the same profile). Both load
  the same `sync` JSON, each applies its own edits, and each renames its file over the other's: the
  last persist wins and the other process's watch-later / note edits are lost locally (and their
  outbox entries with them). Both upload engines scan the same manifest directory and resume the same
  TUS upload, so the server sees two writers on one upload (409 offset conflicts, retries) and the
  fixed temp name `<id>.json.tmp` can be written by both at once.
- Severity: low (client-side, needs two processes on one profile).
- Fix: take an exclusive advisory lock (`fs4`/`fd-lock`) on `<store>.lock` when an engine opens a
  store, and fail or go read-only if it is held; use a unique temp name per write in the upload store.

Server-side ordering issues (server-time stamps on progress, no tombstones) are already documented in
`docs/SYNC.md` "Server gaps" and belong to the api-videos audit.

#### OK (not defects)

- In-process concurrency: every engine method goes through one `Mutex`; listeners run outside the lock.
- Sync merge is commutative/idempotent (property-tested), so replays and reordering converge.
- Sync temp file name includes the PID, so two processes never share a temp file for the sync store.

### AlUmmahNowTools (.NET importer / uploader / file-scan tools)

Executables: `AlUmmahNow.VisualImporterUno` (desktop UI, runs `VideoImporter`), `AlUmmahNow.FileScanService`
(ASP.NET + SignalR host with `FileScanWorker`, `ImportWorker`, file watches, approvals),
`AlUmmahNow.DataImporter` (CLI over the scan DB), `AlUmmahNow.BunnyBulkUploader` (CLI). Shared state is a
SQL Server DB (`ImportDbContext`, default `(localdb)\MSSQLLocalDB`), Bunny Storage zones, Bunny Stream,
and an R2 bucket `videos` via the S3 API. None of the tools call the platform APIs (api-videos / auth);
`DataImporter start-import` and `ImportWorker`'s upload are still TODO stubs.

#### Data map

| Data | Where it lives | How it is written |
|---|---|---|
| Video files | Bunny Storage, key `<VideoStoreRoot><file name>`; `VideoStoreRoot = /videos-<channel lower>/<channel>/` (`AlUmmahNow.Importer/VideoImporter.cs:607`); BunnyBulkUploader uses fixed `/faisal-aljasem/<file name>` (`AlUmmahNow.BunnyBulkUploader/Program.cs:64`) | blind `PUT` (`BunnyStorageClient.UploadAsync`, `AlUmmahNow.Data/Storage/BunnyStorageClient.cs:111-139`), no existence check, Polly retries re-send the whole file |
| Thumbnails | Bunny Storage, key `<ImageStoreRoot><file name>`; `ImageStoreRoot` is built from a method group, so it is the literal `/images-System.Func`1[System.String]/` for every channel (`VideoImporter.cs:609`) | blind `PUT` |
| Video metadata records | R2 bucket `videos`, key = `Video.ID` (new `Guid` per import for folder imports, Bunny GUID for `ImportFromBunnyApiAsync`) | blind `PutObject` of JSON (`AlUmmahNow.Data/Repository/Repository.cs:56-73`, `AlUmmahNow.Data/Storage/R2Client.cs:48-70`); existence check only in the Bunny-API path, and `GetObjectAsync` maps every error to "not found" (`Repository.cs:76-93`) |
| Bunny Stream videos | Bunny Stream library | read (list/get), `PUT` upload, `DELETE` (`AlUmmahNow.Data/Video/BunnyStreamClient.cs`) |
| Import sessions / channels / videos | SQL Server `ImportSessions`, `ImportChannels`, `ImportVideos` | EF Core tracked entities, `SaveChangesAsync` (last writer wins); no unique index on `ImportVideos.FilePath`; no concurrency tokens anywhere in the model |
| Scan sessions / scanned files / channels | SQL Server `ScanSessions`, `ScannedVideoFiles`, `ScannedChannels` | EF Core read-then-update; status machine `Selected → Pending → Uploading → Uploaded` with no conditional update |
| Channel watches, pending approvals | SQL Server `ChannelWatches`, `PendingApprovals` | EF Core check-then-insert (`AnyAsync`/`FirstOrDefaultAsync` then `Add`); `TotalFilesDetected++` in memory |
| Active file watchers, debounce timers | in-memory `ConcurrentDictionary` on a **scoped** `FileWatchService` (`AlUmmahNow.FileScanService/Services/FileWatchService.cs:18-20`, registered `AddScoped` in `Program.cs:171`) | per hub invocation |
| Filter presets | `%AppData%/AlUmmahNow/VisualImporterUno/filter-presets.json` | in-process `SemaphoreSlim` + `File.WriteAllTextAsync` (`AlUmmahNow.Data/Services/FilterPresetService.cs`) |
| Watch templates | JSON files (`AlUmmahNow.Data/Services/WatchTemplateService.cs:248`) | `File.WriteAllTextAsync` |
| Upload concurrency limit | in-memory `SemaphoreSlim(10)` per `BunnyStorageClient` instance | per process |
| Single-instance guard | TCP port probe (`AlUmmahNow.FileScanService/Services/SingletonManager.cs`) | per machine, check-then-bind |

#### Defects

**TOOLS-1: two imports of the same folder (or an import plus a Resume) upload everything twice and create duplicate video records**
- Where: `AlUmmahNow.Importer/VideoImporter.cs:99-181` (`ImportMultiChannelAsync`), `:638-781`
  (`ProcessChannelVideosAsync`), `:783-864` (`ProcessPendingVideosAsync`), `:866-885`
  (`CheckIfVideoExistsAsync` only looks for a local `.r2.json` file nothing writes), `:714-727`
  (`new Video` gets a fresh `Guid`).
- Category: parallel tool instances racing on the same remote objects / no idempotency.
- Scenario: an operator starts an import of `D:\Channels` in VisualImporter, then starts it again
  (second window, or "Resume" on the session while the first run is still going). Each run creates its
  own `ImportSession`, there is no claim step (status `Pending → Uploading` is a plain tracked update,
  not `UPDATE … WHERE Status = Pending`), and the remote-existence check is a stub. Both runs `PUT` every
  video and thumbnail to the same Bunny keys (double bandwidth, partial-file window while the second
  PUT streams), and each run writes a **new** `videos/<new Guid>` JSON record to R2 for every file, so
  the catalogue gets one duplicate record per run. Re-running after a crash does the same.
- Severity: high (duplicate catalogue records and full re-uploads of large video files on any rerun).
- Fix: derive `Video.ID` deterministically (e.g. SHA-256 of channel + relative path, or the content
  hash the scanner already computes) so reruns overwrite one record; use `PutObject` with
  `IfNoneMatch = "*"` for the record and `HEAD` (or Bunny's list) before uploading a video; claim rows
  with `ExecuteUpdateAsync(... WHERE Id = @id AND Status IN (Pending, Failed))` and skip when 0 rows;
  refuse to start a session for a root that already has one `InProgress`.

**TOOLS-2: `ImportVideos` lookups ignore the session, so concurrent or repeated sessions update each other's rows**
- Where: `AlUmmahNow.Importer/VideoImporter.cs:654-655` and `:751-752`
  (`FirstOrDefaultAsync(v => v.FilePath == videoFile.FullName)`; no `SessionId` filter, no ordering),
  no unique index on `FilePath` (`AlUmmahNow.Data/Database/ImportDbContext.cs:50-58`).
- Category: lost update / wrong-row update across parallel runs.
- Scenario: session A (yesterday, file marked Uploaded) and session B (today) both have a row for
  `X.mp4`. B's loop fetches A's row, sees Uploaded, skips, and never touches B's own row, which stays
  `Pending` forever, so B never reaches Completed. If A's row was Failed, B uploads and marks **A's** row
  Uploaded. Two concurrent sessions both mutate the same oldest row. A later Resume of B then re-uploads
  the file (TOOLS-1).
- Severity: medium.
- Fix: filter by `SessionId == sessionId` (and load the session's rows once, keyed by path); add a unique
  index on `(SessionId, FilePath)`.

**TOOLS-3: Resume marks videos Uploaded without writing their R2 record**
- Where: `AlUmmahNow.Importer/VideoImporter.cs:783-864` (`ProcessPendingVideosAsync` never calls
  `_repo.SaveObjectAsync`, unlike `ProcessChannelVideosAsync:727`).
- Category: partial write on retry (related to parallel/rerun behaviour).
- Scenario: an import fails halfway (network blip); the operator clicks Resume. The remaining files are
  uploaded to Bunny and their rows set to Uploaded, but no `videos/<id>` JSON is written, so those
  videos exist in storage with no catalogue record and nothing will ever create one (the rows now say
  Uploaded).
- Severity: medium.
- Fix: share one "upload + write record + mark Uploaded" routine between the first run and Resume.

**TOOLS-4: storage keys collide across channels and folders, and blind PUTs overwrite silently**
- Where: `AlUmmahNow.Importer/VideoImporter.cs:609` (`$"/images-{channelName.ToLowerInvariant}/"`: method
  group, not a call, so every channel's thumbnails share the prefix `/images-System.Func`1[System.String]/`);
  `AlUmmahNow.BunnyBulkUploader/Program.cs:64` (hard-coded `/faisal-aljasem/` for every run);
  keys are `<root><file name>` without the sub-folder (`VideoImporter.cs:887-897`, `ScanDirectoryRecursiveAsync`
  recurses into sub-folders but drops the relative path).
- Category: parallel writers on the same object keys (lost updates).
- Scenario: channel A has `01.jpg` and channel B has `01.jpg`; whichever import finishes last owns
  `/images-System.Func.../01.jpg`, and both channels' videos show that thumbnail. Two BunnyBulkUploader runs
  over different folders that both contain `lecture-1.mp4` overwrite each other in `/faisal-aljasem/`.
  Within one channel, `Season1/ep1.mp4` and `Season2/ep1.mp4` map to the same key.
- Severity: high (wrong thumbnails/videos served; silent, and it happens even without parallel runs).
- Fix: `ToLowerInvariant()`; make keys unique per item (channel id + relative path, or content hash);
  take the BunnyBulkUploader target root from a required `--root` option; check existence (or compare
  size/checksum) before PUT and refuse to overwrite a different file.

**TOOLS-5: file watches are owned by a scoped service, so they stop immediately and can't be stopped later**
- Where: `AlUmmahNow.FileScanService/Program.cs:171` (`AddScoped<IFileWatchService, FileWatchService>`),
  `FileWatchService.cs:13` (`IDisposable`), `:16-20` (watchers, timers and `ImportDbContext` held as
  instance fields), `:319-345` (watchers started), `:515-539` (`Dispose` stops all watchers),
  `Hubs/FileScanHub.cs:284-300` (`StartWatch` resolves the service per hub call).
- Category: in-memory state that assumes one long-lived instance.
- Scenario: the UI calls `StartWatch`. The hub's DI scope creates a `FileWatchService`, which writes the
  `ChannelWatches` row and starts a `FileSystemWatcher`; when the hub method returns, the scope disposes the
  service and `Dispose()` stops the watcher. The DB says the watch is active, but no files are ever detected.
  If disposal is skipped (e.g. an event fires first), the timer callback uses the already-disposed scoped
  `ImportDbContext`. `StopWatch` gets a fresh instance whose `_watchers` is empty, so it can only flip the DB
  flag. Nothing re-creates watchers for active rows at service start.
- Severity: high (the watch → approval pipeline silently does nothing).
- Fix: make the watcher registry a singleton `IHostedService` that loads active `ChannelWatches` at startup,
  and have hub calls only change DB rows and signal it; inside timer callbacks create a scope per event
  (`IServiceScopeFactory`) for the DbContext.

**TOOLS-6: duplicate approvals and lost counters from overlapping file events**
- Where: `AlUmmahNow.FileScanService/Services/FileWatchService.cs:476-493` (`AnyAsync` then
  `AddPendingApprovalAsync`, `TotalFilesDetected++`), `ApprovalService.cs:300-330` (insert without a unique key),
  `FileWatchService.cs:52-79` (`StartWatchAsync` check-then-insert on `WatchPath`, no unique index).
- Category: check-then-insert race; read-modify-write counter; in-memory debounce per instance.
- Scenario: a large copy raises Created, then Changed and Renamed; the debounce map is per instance, and two
  watches (two `StartWatch` calls for the same path from two UI windows, each racing past the
  `FirstOrDefaultAsync` check) each process the file. Both run `AnyAsync(FilePath, Pending)` before either
  inserts, so the file gets two `PendingApprovals`, and approving both queues it twice for import.
  `TotalFilesDetected` is read into memory, incremented and saved, so concurrent detections lose counts.
- Severity: medium (once TOOLS-5 is fixed and watches actually run).
- Fix: filtered unique index on `PendingApprovals(FilePath) WHERE Status = Pending` and on
  `ChannelWatches(WatchPath) WHERE IsActive = 1`, catch the duplicate-key error; increment with
  `ExecuteUpdateAsync(w => w.SetProperty(x => x.TotalFilesDetected, x => x.TotalFilesDetected + 1))`.

**TOOLS-7: scan progress handler uses the scan engine's DbContext concurrently**
- Where: `AlUmmahNow.FileScanService/Services/FileScanWorker.cs:60-62` (one scope: `dbContext` and
  `IFileScanEngine` share the same `ImportDbContext`), `:96-110` (async progress handler calls
  `dbContext.SaveChangesAsync`), `FileScanEngine.cs:486-511` (`UpdateScanProgress` saves, then raises
  the event and returns straight to more queries such as `:259`).
- Category: shared mutable state used by two concurrent operations in one process.
- Scenario: the event handler starts `SaveChangesAsync` and yields; the engine immediately issues its next
  query on the same context, and EF Core throws "A second operation was started on this context
  instance". When the engine's call is the one that throws, the scan is marked Failed; on large folders
  (many progress events) scans fail intermittently.
- Severity: medium.
- Fix: drop the DB write from the handler (the engine already persisted the same fields) and only forward to
  SignalR; or give the handler its own scope/context.

**TOOLS-8: import status claims are not atomic (ImportWorker vs UI vs a second worker)**
- Where: `AlUmmahNow.FileScanService/Services/ImportWorker.cs:58-99` (reads 10 `Selected` rows, then sets
  `Pending` with a tracked update), `AlUmmahNow.VisualImporterUno/.../Services/DatabaseFileScanService.cs:264-273`
  (UI sets `Selected`/`NotImported` unconditionally).
- Category: read-modify-write without a conditional update; per-machine singleton only.
- Scenario: the user un-ticks a file just after the worker read it; the worker then writes Pending/Uploading/
  Uploaded over the user's NotImported. Re-ticking an Uploaded file puts it back to Selected and it is imported
  again. Two service hosts on one shared SQL Server (the singleton guard is a localhost port probe) both read the
  same 10 rows and import them twice. Today the upload step is a simulation, so the impact is wrong statuses;
  it becomes duplicate uploads once the TODO is implemented.
- Severity: low now, high once the real upload lands.
- Fix: claim with `ExecuteUpdateAsync(... WHERE Id = @id AND ImportStatus = Selected)` and process only rows you
  won (or `UPDATE TOP (10) … OUTPUT inserted.*`); make the UI's change conditional too (`WHERE ImportStatus IN
  (NotImported, Selected)`), and add a `rowversion` to `ScannedVideoFile`.

**TOOLS-9: FilterPresetService deadlocks on its own lock**
- Where: `AlUmmahNow.Data/Services/FilterPresetService.cs:58` (`SemaphoreSlim(1, 1)`); `SavePresetAsync:124-127`,
  `DeletePresetAsync:164-167`, `ClearDefaultPresetAsync:231-234` and the method at `:199-202` take the
  semaphore and then call `GetAllPresetsAsync`, which waits on the same semaphore (`:86`);
  `GetAllPresetsAsync` itself calls `InitializeBuiltInPresetsAsync` (`:251`, waits again) when the file is missing.
- Category: in-memory lock (non-reentrant) misuse.
- Scenario: first launch with no presets file: the Approval page loads presets → `GetAllPresetsAsync` holds the lock
  → `InitializeBuiltInPresetsAsync` waits forever; the presets call never completes. Any save/delete of a preset
  hangs the same way. Separately, two app instances write the JSON with `File.WriteAllTextAsync` (no temp+rename,
  no cross-process lock) and the last writer wins, or a reader sees a truncated file.
- Severity: medium (hang in the desktop app; not a cloud issue).
- Fix: split into private `LoadUnsafeAsync`/`InitializeUnsafeAsync` that assume the lock is held; write to a temp
  file and `File.Move(tmp, path, overwrite: true)`.

**TOOLS-10: per-process rate limit and retry policy against Bunny**
- Where: `AlUmmahNow.Data/Storage/BunnyStorageClient.cs:23-45, 111-139`.
- Category: in-memory limiter that assumes one instance.
- Scenario: the limiter caps each `BunnyStorageClient` at 10 concurrent uploads, but VisualImporter, BunnyBulkUploader
  and the FileScanService each make their own (and DI creates one per generic type, so video and image clients each
  get 10). Running tools side by side multiplies the concurrency; on 429/5xx-type `HttpRequestException`s every process
  retries on the same 1/2/4 s schedule, re-streaming whole video files in step. (Today uploads run sequentially per
  importer, so the cap is rarely reached.)
- Severity: low.
- Fix: add jitter to the backoff, and honour `Retry-After`; if parallel uploads are added, size the limit per account,
  not per client.

#### OK (not defects)

- `SingletonManager` port probe: fine as a same-machine guard for the FileScanService (the DB defaults to LocalDB, so
  it is per machine too); see TOOLS-8 for the shared-SQL-Server case.
- `NotificationService._queueSemaphore` and `ConcurrentDictionary`s inside one process: correct for in-process use.
- Upload loops are sequential per run (no unbounded `Task.WhenAll` over files); `ApprovalViewModel` `Task.WhenAll` is two
  tasks.
- `ImportFromBunnyApiAsync` uses the Bunny GUID as the record key, so a rerun overwrites the same `videos/<guid>`
  record instead of duplicating it (but a transient R2 read error is treated as "missing" and overwrites; low).
- `ApprovalService` decision update only changes rows still `Pending` in memory; with two approvers the second
  `SaveChanges` wins (no rowversion), which only re-sets the same decision fields; low and editor-driven.

### Summary

| ID | Severity | One line |
|---|---|---|
| UI-1 | medium | curated videos fan out to 3 subrequests each, unbounded (CMS has no LIMIT) |
| UI-2 | low-medium | stale HTML triggers a full re-render in every isolate until one finishes |
| UI-3 | low | KV snapshot check-then-put across isolates (benign, 429 noise) |
| CMS-1 | medium | admin media upload keeps client file name; second same-named upload overwrites R2 object |
| CMS-2 | low | SSO user upsert SELECT-then-INSERT; concurrent first sign-ins fail one |
| CMS-3 | low | content edits last-writer-wins, no version check |
| CMS-4 | low | no LIMIT / no uniqueness on curated rows (feeds UI-1) |
| CORE-1 | low | no cross-process lock on sync/upload stores (client only) |
| TOOLS-1 | high | reruns / parallel imports re-upload everything and duplicate R2 video records |
| TOOLS-2 | medium | `ImportVideos` looked up by path across sessions; sessions update each other's rows |
| TOOLS-3 | medium | Resume never writes the R2 video record |
| TOOLS-4 | high | key collisions: thumbnail prefix is a `Func` ToString, fixed bulk root, sub-folders dropped |
| TOOLS-5 | high | file watches live in a scoped, disposed service; they never fire |
| TOOLS-6 | medium | duplicate approvals / lost counters from check-then-insert |
| TOOLS-7 | medium | scan progress handler races the engine on one DbContext |
| TOOLS-8 | low (high once implemented) | import status claims not atomic |
| TOOLS-9 | medium | FilterPresetService re-enters its own SemaphoreSlim and hangs |
| TOOLS-10 | low | per-process Bunny rate limit, no jitter |
