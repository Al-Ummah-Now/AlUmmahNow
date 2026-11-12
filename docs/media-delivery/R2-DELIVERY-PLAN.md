# Video delivery on R2 + Cloudflare CDN, side by side with Bunny (epic #687)

Decision D2 (2026-11-10, Cloudflare's written confirmation in #686): HLS in R2, served from a custom
domain on our zone through the CDN. Owner decisions (2026-11-10):

- Transcoding runs on **Cloudflare Containers** (FFmpeg).
- **Bunny and R2 run side by side.** Every new upload goes to both until measured speed and cost decide.
- The whole platform stays **at or under $500/month**.

Not in this epic: migrating the existing catalogue (planned below, not run) and switching Bunny off
(the owner decides on the numbers).

## Architecture

```
            upload (TUS, unchanged)                       Bunny encodes (unchanged)
 Studio ───────────────────────────► api-videos ──────► Bunny Stream ──► playUrl (Bunny CDN)
                                        │ upload complete
                                        ▼
                         queue al-ummah-now-transcode[-env]
                                        │
                                        ▼
            al-ummah-now-media[-env] Worker (queue consumer + Transcoder container class)
                 │  one container per video (Durable Object id = video id → idempotent)
                 ▼
     FFmpeg container ── GET  http://source.internal/  → Worker → Bunny "original" (signed)
       (no internet)   ── PUT  http://media.internal/… → Worker → R2 binding (no S3 keys)
                       ── POST http://control.internal/ → Worker → progress / done / failed
                                        │
                                        ▼  service binding
                         api-videos /internal/media/* → video record: r2 { status, playUrl, … }

 Viewers ─► media.<env>.alummahnow.net
              /pub/<videoId>/<rev>/…   R2 custom domain + Cache Rule (no Worker)
              /priv/<token>/<videoId>/<rev>/…  Worker route: HMAC check → private bucket → edge cache
```

### Why these choices

- **Source from Bunny's kept original.** Upload bytes already stream through our TUS proxy to Bunny.
  Teeing them into R2 would touch the Bunny path (TUS chunk sizes don't match R2 multipart rules, and
  a half-written part would break resumes). Instead the media job reads
  `https://<bunny host>/<videoId>/original` (Bunny's "Keep original files"; signed where token auth is
  on). Bunny's path stays byte-for-byte unchanged, and both pipelines start from the same moment:
  upload complete. When Bunny is switched off, the TUS proxy writes to R2 instead (see Later).
- **Container outbound interception** (`@cloudflare/containers` `outboundByHost`): the container has
  no internet. It reads the source and writes renditions through the Worker's handlers, which use the
  R2 binding. No R2 S3 credentials exist anywhere, and the container can reach nothing else.
- **One container per video** (`getContainer(TRANSCODER, videoId)`): a redelivered or retried message
  reaches the same instance, which reports "already running" or "already done". `max_instances` and
  the queue's `max_concurrency` bound spend.
- **Public segments never touch a Worker.** The R2 custom domain serves `/pub/…` and a Cache Rule
  caches everything. Only `/priv/…` (private and unlisted) runs a Worker. Its token is in the path,
  like Bunny's directory token, so relative URLs in playlists inherit it. The Worker caches by object
  key, not by token, so every viewer of a private video shares one cached copy.
- **`rev` in every key** (a random id per transcode): a re-transcode never serves a mix of old and
  new segments, and segments can be cached immutable for a year.
- **Private renditions live in their own bucket** (`al-ummah-now-media-private[-env]`, no public
  access). An R2 custom domain serves every key in its bucket, so keeping `priv/…` out of the public
  bucket means a detached Worker route can never expose a private video.
- **Visibility changes move objects.** Public → private/unlisted copies `pub/…` (public bucket) to
  `priv/…` (private bucket), then deletes the originals and purges the old prefix from the cache. Private → public goes the other
  way. A queue job does the move, and the record keeps playing from the old place until the move is
  done.

### Bucket layout

```
pub/<videoId>/<rev>/master.m3u8     (al-ummah-now-media[-env]; priv/… in al-ummah-now-media-private[-env])
                    /<rung>/index.m3u8, init_<n>.mp4, seg_00000.m4s …   (fMP4 HLS, 6 s segments, 2 s GOP)
                    /thumb.jpg, thumb_640.jpg, preview.webp
```

Segments, stills and rendition playlists are written first and `master.m3u8` last, so a player
never sees a playlist whose segments aren't in R2 yet. Sizes and timings go to the video record
(`r2.result`).

Ladder (H.264 high, AAC 128k): 360p, 480p, 720p, 1080p, never above the source. Shorts (portrait)
use the same rungs by short side (360×640 … 1080×1920). CRF 23 with `maxrate` caps per rung:
0.8 / 1.4 / 2.8 / 5 Mbps.

### Limits we design around (from Cloudflare)

- **No Cache Reserve for R2 public buckets.** A cold long tail costs first-byte latency, not money.
  Smart Tiered Cache keeps one upper tier per region warm.
- **512 MB maximum cacheable file.** Segments are about 0.5–4 MB. We never serve a progressive MP4
  of a whole video from R2.
- **Management API: 50 bucket ops/s and 1,200 REST calls per 5 minutes.** All object I/O goes through
  bindings, which aren't counted. Only the IaC scripts and the cost collector use REST, a few calls a day.
- **The zone is on the Free plan** (checked 2026-11-11). Cache Rules (10 on Free) and Smart Tiered
  Cache are available. HMAC token rules in WAF are not, which is one more reason the `/priv/` check
  is a Worker.

## Phase 1: infra (QA → stage → production)

| Item | How | Who |
|---|---|---|
| Buckets `al-ummah-now-media[-qa\|-stage]` (public) and `al-ummah-now-media-private[-qa\|-stage]` | `scripts/release/ensure-resources.ts` (runs on every deploy) | CI |
| Custom domain `media.qa.alummahnow.net`, `media.stage…`, `media.alummahnow.net` | `scripts/media-cdn/apply.ts` (R2 custom-domain API) | Done for all three (QA, stage, production) |
| Cache Rule on the media hosts: cache everything; segments and init 1 year, playlists 10 s (VOD playlists don't change, `rev` makes them immutable), `manifest.json` bypass | `scripts/media-cdn/apply.ts cache` (Rulesets API, phase `http_request_cache_settings`, one rule per env, matched by its ref) | CI token (Zone Cache Settings Edit); QA applied, stage and production by the release |
| Smart Tiered Cache on | `scripts/media-cdn/apply.ts tiered` | CI token; on (zone-wide) |
| CORS on the public bucket (players on www, videos, admin, embeds, native apps) | `scripts/media-cdn/apply.ts` | Agent |
| Worker route `media.<env>/priv/*` → al-ummah-now-media | wrangler config | CI |
| Secrets Store `media-sign-key[-qa\|-stage]` (HMAC for `/priv/` tokens), shared by api-videos and the media Worker | `wrangler secrets-store secret create` + `scripts/release/secrets-manifest.ts` | Agent |
| Queues `al-ummah-now-transcode[-env]` and `al-ummah-now-transcode-dlq[-env]` | ensure-resources.ts | CI |

A `media-cdn` workflow (manual dispatch, env input, `--check` by default) runs the same script with
the repository's Cloudflare token, so the zone settings are reviewable code. The runbook
(`docs/media-delivery/RUNBOOK.md`) lands with step 2.

## Phase 2: pipeline

1. **`apps/media`** (Worker `al-ummah-now-media[-env]`): queue consumer, `Transcoder` container class
   (FFmpeg image, `standard-4`, `sleepAfter` 2 min), outbound handlers, `/priv/` edge, and a cron
   watchdog.
2. **api-videos**: on upload complete (the same place that starts Bunny's processing loop) it sends
   `{ videoId, jobId, rev, visibility, format }` to the transcode queue. The record gets
   `r2: { status: queued|transcoding|ready|failed, rev, prefix, jobId, attempts, queuedAt, readyAt, error, bytes, rungs, containerSeconds }`.
   `r2PlayUrl` is derived from it (public: plain URL; private/unlisted: signed in the response, like
   Bunny's `playUrl`).
3. **Job handling:**
   - Idempotency: the job id is on the record. Results from an older job are dropped. A finished `rev`
     is never overwritten.
   - Retries: a container crash or timeout re-runs the job up to 3 times, with backoff. Each attempt
     starts from scratch in a fresh `rev`, and the partial `rev` is deleted.
   - Failure: the record gets `r2.status = failed` with a reason. A "needs action" item goes to the
     Errors page (`reportNeedsAction`, key `media-transcode:<videoId>`, with Retry), and it is
     resolved when a later attempt succeeds.
   - Health: a 10-minute sweep re-queues anything stuck in queued/transcoding, as the Bunny loop does.
   - Admin: a "Retry R2 transcode" action next to "Sync from Bunny".
4. **Cleanup on delete.** Soft delete hides the video, and the R2 objects stay (restorable). The
   30-day purge and "promote to permanent" delete `pub|priv/<videoId>/` alongside Bunny's file, in the
   same purge path. Garbage collection (stale uploads, the QA test-library purge) removes them too.
5. **Playback switch** (admin setting per environment): a D1 key/value row with `updated_by` and
   `updated_at`, like the AI moderation config, cached for 30 s per isolate:
   `{ mode: bunny | r2 | split, r2Percent, assign: video | view }`.
   - `video`: a stable hash of the video id decides, so one video always plays from one source. This
     is cache-friendly.
   - `view`: the player draws per play. The API returns both sources and the percent, and the choice
     happens client-side, so cached API responses stay shared.
   - A video whose R2 rendition isn't ready always plays from Bunny.
   - The API returns `playUrl` (the chosen source), `playSource: bunny|r2` and `fallbackPlayUrl`. The
     web player (video.js VHS, which plays fMP4 HLS) switches to the fallback on a fatal error and
     reports the fallback. Native apps (AVPlayer, ExoPlayer) use the same fields.
6. **Player measurements**, tagged by source: one beacon per play session (sent at end or hidden)
   to `/api/playback/qoe`. It carries startup ms, rebuffer count and ms, watch ms, average and
   highest bitrate, switches, errors, fallback, and country and device class. These are stored as
   daily rollups in D1, one upsert per session.

## Phase 3: measure and compare

| Metric | Source |
|---|---|
| Time to playable after upload | Bunny: processing loop `uploadCompletedAt → first playable`. R2: `r2.queuedAt → r2.readyAt`. Both are already on the record. |
| Startup, rebuffering, bitrate, switches, errors, fallbacks | QoE rollups (Phase 2.6), by source, country and device |
| CDN cache hit ratio, edge bytes (egress) | Cloudflare GraphQL `httpRequestsAdaptiveGroups` by host and cache status (media host vs Bunny pull-zone stats) |
| R2 storage, Class A/B operations | GraphQL `r2StorageAdaptiveGroups` and `r2OperationsAdaptiveGroups`, filtered to the media bucket |
| Container seconds | Measured per job (start → exit) × instance size. Cross-checked with the Containers metrics. |
| Bunny storage, traffic, cost | Bunny statistics and billing API, per library |
| Cost per video-minute and per viewer-hour | The collector divides the day's cost by minutes transcoded and hours watched |

A daily cron in api-videos writes one row per provider per day to `delivery_cost_daily`. The admin
**Delivery comparison** page (videos admin, `media:manage` permission) shows the switch, the two
sources side by side over time with the shared chart component, a per-video job list with retry, and
the cost projection below, recomputed from measured unit costs. It follows the live-streaming page's
layout (#871).

The page (`apps/admin-web/src/app/(protected)/delivery/`, admin-api `/api/media/*`) replaces an
assumption with a measured unit cost as soon as the period has one: container seconds, duration and
bytes from `media_jobs`; R2 `class_a_ops` / `class_b_ops` and Bunny `egress_gb` from
`delivery_cost_daily`, divided by the period's video-minutes or viewer-hours. The collector writes
those metric names.

### Cost model (until the measured numbers replace it)

Unit assumptions (list prices, 2026-11):

- Stored ladder: about 7 Mbps summed over all rungs. With CRF, lectures come in well under the caps,
  so call it 40 MB per video-minute.
- Transcode on `standard-4`: about 0.75× real time. That's 45 s per video-minute, at about $0.0001 per
  instance-second (CPU billed only while active, so this is an upper bound), so about **$0.005 per
  video-minute**, once. Workers Paid includes 375 vCPU-minutes a month.
- R2: $0.015 per GB-month, Class A $4.50 per million (about 40 writes per video-minute), Class B
  $0.36 per million (cache misses only), egress $0.
- Bunny Stream: storage $0.01 per GB-month per region; delivery $0.005–0.01 per GB (volume vs
  standard network). Encoding is free.
- A viewer-hour averages about 2 Mbps, or 0.9 GB.

| Monthly | Small (today) | Medium | Large |
|---|---|---|---|
| Uploaded / watched | 20 h / 2k viewer-h | 200 h / 50k viewer-h | 1,000 h / 500k viewer-h |
| **R2 path:** transcode | $6 | $60 | $300 |
| R2 storage (after 12 months) | $9 | $86 | $430 |
| R2 ops + delivery | < $1 | ~$1 | ~$10 |
| **R2 total** | **~$16** | **~$147** | **~$740** |
| **Bunny path:** storage (2 regions, after 12 months) | $12 | $115 | $576 |
| Bunny delivery | $9–18 | $225–450 | $2,250–4,500 |
| **Bunny total** | **~$21–30** | **~$340–565** | **~$2,800–5,100** |
| Both during the trial | ~$40 | ~$490–710 | not viable |

What this means for the $500 cap:

- **Small:** both fit.
- **Medium:** both together exceed the cap. Shorten the dual-write trial, or dual-write a sample.
- **Large:** only R2 fits delivery. The large case is dominated by storage and transcode. The levers
  are lifecycle rules on old renditions, dropping 1080p for audio-led lectures, and the desktop
  pre-encode (D11). The admin page shows these projections with measured unit costs.

## Rollout

| Step | PR | Gate |
|---|---|---|
| 1 | This plan | — |
| 2 | Infra: buckets, queues, secrets, `scripts/media-cdn`, runbook, `media-cdn` workflow; QA domain + CORS applied | QA: `curl` public object → `cf-cache-status: HIT` on second request |
| 3 | `apps/media`: container image, Worker, queue consumer, `/priv/` edge, QA deploy step | QA: tiny clip transcodes end to end |
| 4 | api-videos: enqueue on upload complete, record fields, internal callbacks, purge/delete, visibility move, admin retry, errors page | QA upload shows `r2.status = ready` |
| 5 | Playback: setting, API fields, web player source + fallback, QoE beacon + rollups | QA watch plays from R2 at `r2` mode |
| 6 | Admin Delivery comparison page + cost collector | QA page shows both sources |
| 7 | Stage, then production via the tag release (media Worker deploy + consumers in release.yml) | Owner OK on production DNS; production starts at `split`, 10% |

Tests stay free: unit tests mock the container and R2. The QA end-to-end check uploads one 5-second
generated clip. No paid AI anywhere in this work.

## Owner actions

1. **Cloudflare token: done (2026-11-12).** The repository's `CLOUDFLARE_API_TOKEN` has Zone Cache
   Settings Edit, Cache Purge and DNS Edit, plus Account Analytics Read. `scripts/media-cdn/apply.ts`
   uses it for domains, the Cache Rule, Tiered Cache, and the purge and analytics checks.
   - It is stored in Secrets Store as `media-cdn-api-token` for api-videos' runtime purge and cost
     analytics (`apply.ts --store-secret`).
2. **Bunny originals.** "Keep original files" and "Expose originals" must be on for each upload
   library. The stored Stream keys can't change library settings: the account API answers 401. Until
   then, the transcode reads Bunny's MP4 fallback.

## Later (planned, not run)

- **Back-catalogue migration:** an admin job transcodes existing videos from Bunny originals, in
  batches with bounded concurrency. Videos without an original use the highest MP4 or HLS rendition
  as the source. This includes the legacy library 400189. QA first, then production.
- **Switching Bunny off:** the TUS proxy writes the upload to R2 (`src/<videoId>`, R2 multipart),
  the media job reads it from there, and Bunny calls are removed. This is the owner's decision, on
  the numbers.
- Storyboard sprites (scrub previews), audio-only rendition for Listen mode (Epic 14), downloads
  (Epic 14/18) from the same bucket.
