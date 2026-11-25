# Media delivery runbook (R2 + Cloudflare CDN beside Bunny)

Plan and design: [R2-DELIVERY-PLAN.md](./R2-DELIVERY-PLAN.md). Epic #687.

## What exists per environment

| | QA | Stage | Production |
|---|---|---|---|
| Public bucket (R2 custom domain) | `al-ummah-now-media-qa` → `media.qa.alummahnow.net` | `al-ummah-now-media-stage` → `media.stage.alummahnow.net` | `al-ummah-now-media` → `media.alummahnow.net` |
| Private bucket (no public access) | `al-ummah-now-media-private-qa` | `al-ummah-now-media-private-stage` | `al-ummah-now-media-private` |
| Worker (queue consumer, container, `/priv/*` route) | `al-ummah-now-media-qa` | `al-ummah-now-media-stage` | `al-ummah-now-media` |
| Transcode queue / DLQ | `al-ummah-now-transcode-qa` / `-dlq-qa` | `…-stage` | `al-ummah-now-transcode` / `-dlq` |
| Path-token key (Secrets Store) | `media-sign-key-qa` | `media-sign-key-stage` | `media-sign-key` |

The buckets and queues are created by `scripts/release/ensure-resources.ts` on every deploy. The
signing keys were created once, with `wrangler secrets-store secret create`.

## Releases

- **QA:** `deploy.yml` deploys `apps/media` from `wrangler.qa.jsonc` on every push to main (job `deploy-qa-media`).
- **Stage and production:** `release.yml` deploys `apps/media` from `wrangler.jsonc` (`--env stage` for stage) after the other apps' promote and its smoke. Containers take no versions upload, so this is a plain `wrangler deploy`. It builds the transcoder image with Docker and pushes it to Cloudflare's registry.
- **Media smoke:** `scripts/release/media-smoke.ts` checks three things:
  - `/priv/` with a bad token gets 403 from the Worker;
  - a missing `/pub/` key gets 404 from R2;
  - the transcoder application exists.
- **On a failed smoke:** the release runs `wrangler rollback` on the media Worker.
- **Cache Rule and Smart Tiered Cache:** applied by the release when the `MEDIA_CDN_API_TOKEN` secret is set; otherwise it skips with a notice.
- **Manual rollback:** `cd apps/media && pnpm wrangler rollback -c wrangler.jsonc [--env stage]`.
- **Viewers:** the production delivery switch defaults to Bunny. Uploads are dual-written to R2 from the first release. Viewers move only when an admin changes the switch on the Delivery page.

## Backfilling existing videos

Videos uploaded before R2 (only on Bunny) are moved by the admin on the videos admin's **R2 backfill** page, never by a
script: estimate from real sizes, a budget cap, Start; then "Play R2 first" and, separately, retiring a legacy Bunny
library after a grace period. See [BACKFILL.md](./BACKFILL.md). Failed videos are on the Errors page with Retry.

## Bunny originals

The transcode reads `/{id}/original` first. Bunny serves it only when the Stream library has:
- **Keep original files** (`KeepOriginalFiles`);
- **Expose originals on the CDN** (`ExposeOriginals`).

Both are set with the Bunny *account* API (`POST https://api.bunny.net/videolibrary/{id}`) or in the dashboard. The stored Stream library keys get 401 there (checked 2026-11-12). Until they're set, the transcode uses Bunny's MP4 fallback, which tops out at 720p and is a second-generation encode.

## Applying the CDN settings

```sh
# Plan (read-only): what differs, plus the purge and analytics access checks
CLOUDFLARE_API_TOKEN=… node --experimental-strip-types scripts/media-cdn/apply.ts --env qa
# Apply (and store the token for api-videos' runtime purge and analytics)
CLOUDFLARE_API_TOKEN=… node --experimental-strip-types scripts/media-cdn/apply.ts --env qa --apply --store-secret
```

Or run the **Media CDN settings** workflow (Actions → manual dispatch: env, apply).

- **What it manages:**
  - the custom domain and CORS on the public bucket;
  - one Cache Rule per env, found by its ref `al-ummah-media-cache-<env>` (it never edits other rules in the phase);
  - Smart Tiered Cache.
- **What it checks:** that the token can purge the media host's cache and read Account Analytics.
- **Token:** the repository's `CLOUDFLARE_API_TOKEN`, which has Zone Cache Settings, Cache Purge and DNS Edit, plus Account Analytics Read. `MEDIA_CDN_API_TOKEN`, if ever set, overrides it for zone calls.
- **Releases** apply stage and production. The manual workflow covers QA, or stage on demand.
- **By hand in the dashboard** (should a token ever lack zone access):
  - Caching → Cache Rules → Create rule:
    - Hostname equals `media.<env>.alummahnow.net` → Eligible for cache.
    - Edge TTL: use cache-control header if present.
    - Status code TTL: 400–599 → 10 s.
    - Browser TTL: respect origin.
  - Caching → Tiered Cache → Smart Tiered Caching Topology: on.

## Which source a play got

The API decides the order and returns every ready provider's signed playlist in it (providers:
[PROVIDERS.md](./PROVIDERS.md); `apps/api-videos/src/lib/media/playback.ts`):

- `GET /api/videos/:id`, playlist `videoItems` and the playlist queue: `sources` is the ordered list
  (`{ provider, src, type }`), `playUrl` is its first entry, and `thumbnailUrl` is that provider's frame
  only when the stored thumbnail is a provider's automatic frame of the video. Custom and legacy
  (imported) thumbnails are never replaced. `delivery` is `{ source }`, a label only.
- The order comes from the Delivery settings (strategy `priority` or `weighted`, the provider order and
  weights, assign `video` = the video's stable bucket or `view` = drawn per request), then the
  channel's override, then the video's. A provider that is off is never offered. With health-based
  fallback on, an unhealthy provider moves behind the healthy ones (never dropped).
- Players try `sources` in order. One that keeps a single URL calls
  `GET /api/videos/:id/playback?exclude=<provider>[,<provider>]&reason=<code>` and plays what it returns
  (`sources: []` when nothing is left). Reasons: `manifest_4xx`, `manifest_5xx`, `network`, `cors`,
  `decode`, `unsupported`, `stall_timeout`, `other`.

**Decision log** (Workers Logs, api-videos): `[Media] Playback decision` with
`{ videoId, strategy, order, ready, unhealthy, bucket, sources, chosen, reason, context }` (reason:
`priority`, `weighted`, `weighted_zero_weights`, `unhealthy_moved`, `none_ready`, `url_failed`). It is
`info`, so it shows on stage and QA; production runs at `warn` (docs/operations/logging.md), so raise
`LOG_LEVEL` there to see every decision. Fallbacks are `[Media] Playback fell back` at `warn` (always
kept) with `excluded` and reason `excluded:<code>`. Each one is counted per day in
`playback_fallback_daily` (`server_fallbacks` from the endpoint, `qoe_sessions` from the players' QoE
beacons) and per provider per minute in `media_provider_health` (the health signal). The Delivery
summary returns them as `fallbacks`, plus `providers` (the settings) and `health`.

**Provider health**: the every-minute cron probes each enabled provider and writes
`global_settings/ops/media-health.json`. A provider turning unhealthy is an Errors page item
(`media-provider-health:<provider>`, **Check now** = `POST /internal/media/health/check`), resolved when
it recovers. To see the state: `GET /api/media/providers` on admin-api.

## Checks

```sh
# Public object: second request is a HIT (needs the Cache Rule)
curl -sI https://media.qa.alummahnow.net/pub/<videoId>/<rev>/master.m3u8 | grep -i cf-cache-status
# Private path without a valid token: 403 from the Worker (never served by R2)
curl -s -o /dev/null -w '%{http_code}\n' https://media.qa.alummahnow.net/priv/1999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/x/y/master.m3u8
# A job as its container sees it (service binding from api-videos, or wrangler tail)
npx wrangler tail al-ummah-now-media-qa
```

**Release gate** (`apps/web/e2e/release/media-delivery.spec.ts`, #960, QA and stage): uploads one
short private clip as its own run account, waits for `r2.status = ready` on the owner's
`GET /api/videos/:id/upload-status`, then fetches the signed master playlist, a rendition playlist
and its segments from the media host. E2E run accounts are never transcoded, except the gate's
(`e2e+…-media-gate@e2e.alummahnow.net`): one clip per release run.

`cf-cache-status: DYNAMIC` on `/pub/…` means the Cache Rule is missing. Segments would then come
from R2 on every request, at Class B cost and with no edge cache.

## Failures

- **A job fails 3 times, or fatally** (`source_missing`, `no_video_stream`): the record gets
  `r2.status = failed`, and the Errors page shows a needs-action item with Retry. Viewers keep
  playing Bunny, which is untouched.
- **`source_missing`:** Bunny didn't keep the original. "Keep original files" must be on in the
  library's Encoding settings.
- **"Could not start job" (`reason` in the log line):** `capacity full` means all `max_instances`
  containers are busy (rare now that the dispatcher keeps starts under the admin's limit, see
  Capacity); `container start failed` means the container exited
  while starting, which is a broken image or the platform, never load. The consumer tries again
  after 15 s, 30 s, 60 s, 2 min, then every 5 min (`START_RETRY_DELAYS` in `apps/media/src/jobs.ts`),
  so a job resumes within seconds once the cause clears. After the queue's last delivery (9) the
  job is reported failed: the record gets `r2.status = failed` and the Errors page an item with
  "Transcode again", about 24 min after it was queued. 2026-11-15: an image without
  `container/review.mjs` crashed at every start (`ERR_MODULE_NOT_FOUND`, exit 1) from v2026.11.13.x
  to v2026.11.14.6; the release smoke now starts a real container (`GET /priv/_selftest`: the first call after a
  deploy runs it, a pass is reused for that Worker version, a failure reruns up to 10 times per version;
  any two real starts are at least a minute apart and at most 30 a day; the answer carries only the plain reason, the raw error is in the log) and the
  stage E2E fails a transcode that does not start within 2 min.
- **Container logs:** the container's stdout and exits are Workers Observability events of type
  `cf-container` with `$container.applicationId` = the transcoder application's id (not the
  Worker's script name). `.github/workflows/media-diagnostics.yml` prints them, read-only.
- **Deploys:** `rollout_active_grace_period` (1 h) lets running transcodes finish before a rollout
  replaces their instance. One cut off after that (SIGTERM, exit 143), a lost launch or a
  restarted container retries after 15 s without using up one of its 3 attempts (up to 6 in a row).
- **Capacity: concurrent transcodes** is an autoscaling **min–max range**, a setting of the R2
  provider: videos admin → **Video providers → Cloudflare R2 settings** (`/media-providers#r2-settings`;
  admins change it, audited as `media:transcode-limit` in `site_settings_log` with old and new range,
  Undo in the toast). Default 4–4 (a fixed 4, as before ranges). Rules: 1 ≤ min ≤ max ≤ the
  **Cloudflare limit** (shown as "Cloudflare limit: N" in the admin). We set no ceiling of our own:
  the container's `max_instances` is what Cloudflare allows. Containers have no per-application cap,
  only account-wide concurrency (15,000 vCPU, 60 TiB memory, 300 TB disk; Containers docs → Limits →
  [Account limits](https://developers.cloudflare.com/containers/platform-details/limits/#account-limits);
  `max_instances` has no documented maximum, Wrangler configuration → containers). vCPU binds first:
  every application reserves `max_instances` × its instance type's vCPU against the account's
  `total_vcpu` (15,000; `GET /accounts/{id}/containers/me` → `limits`), and Cloudflare refuses a deploy
  past it. The account is **shared with other projects**, so every application on it counts
  (`GET /accounts/{id}/containers/applications`) and 10% of the quota stays free so another project's
  deploy can't push ours over. Stage and QA keep 2 each (16 vCPU); on 2026-11-16 no other project had
  a container. Production: (15,000 × 0.9 − 16) / 4 = **3,371 instances**. v2026.11.15.3 tried 3,750
  and its media deploy was refused after the promote; the release now runs
  `scripts/release/container-quota.ts` in the Stage job, before anything deploys, and fails there
  (naming the largest production value that fits) if the planned media configs plus every other
  application on the account exceed the quota less 10%. Cloudflare
  raises account limits on request (account team or Support). The value reaches apps/media and
  api-videos as `MEDIA_TRANSCODE_CEILING`. The value lives in
  `global_settings/ops/media-transcode-limit.json` (written by api-videos; the first version's
  `{ limit }` reads as min = max), read by both Workers with a 30 s cache, so a change applies within a
  minute.
  - **Autoscaling** (`TranscodeSlots` Durable Object in apps/media, one object `global`;
    `src/slot-state.ts`, decision `scaleStep` in shared-types `transcode-limit.ts`): up to `min`
    transcodes run at once. A job that can't start waits: its message is sent again in 60 s and the
    delivery acked, so waiting never uses up one of its 9 deliveries; the oldest waiting job gets the
    next free slot. While jobs wait, one more slot opens each time a transcode starts or finishes,
    until nothing waits or `max` is reached. When a transcode finishes with nothing waiting, it falls
    back to `min`. Running transcodes are never stopped: over the allowance, new starts wait.
  - **Billing:** `min` is a concurrency floor, not warm instances. Cloudflare Containers bill an
    instance only while it runs (memory and disk per 10 ms while awake, CPU on active use only, nothing
    once it sleeps; developers.cloudflare.com/containers/pricing), and a transcoder starts only for a
    job, so idle slots cost nothing.
  - **Slots:** the Transcoder's watchdog renews its slot every minute (a job waiting for a retry keeps
    it until 10 min after its retry time) and gives it back when the job is ready, failed for good or
    cancelled; a slot nobody renews lapses after 10 min. If the slots object can't be reached the job
    starts anyway, under `max_instances`. Remux, caption-audio and live-review jobs are short and are not
    counted; they share the `max_instances` ceiling.
  - While at least `min` transcode, a job waiting in `queued` is its turn coming, not stuck: the
    10-min sweep doesn't re-queue it and the troubleshooting panel doesn't flag `queued_too_long`.
  - The Delivery page's "Transcoder now" card shows "N running · M waiting · range min–max", the range
    and the ceiling, the jobs waiting and the oldest wait (from `media_jobs`, refreshed every 30 s), and
    links admins to the R2 settings. The R2 settings show the estimated cost of one more slot next to
    the fields: about $0.40 an hour while it transcodes (standard-4 list price, the same as
    `lib/media/costs.ts`), about $289 a month if busy all month, and the worst case with every slot up
    to `max` busy.
  - If Cloudflare raises the account limit, change `max_instances` and `MEDIA_TRANSCODE_CEILING` in
    `apps/media/wrangler*.jsonc` and `apps/api-videos/wrangler*.jsonc` together (a unit test checks
    they match) and release. The cost line shows the worst case at the admin's max so operators can keep
    container spend controlled: each busy slot is about $0.40 an hour.
- **One video:** its admin page has an R2 card with the status, the failure details when a
  transcode failed, and "Transcode again" (`media:manage`).
- **Dead letters** (`al-ummah-now-transcode-dlq-*`): only when api-videos could not be told that a
  job never started. The api-videos sweep re-queues videos stuck in `queued` for over an hour and
  raises an Errors page item ("R2 transcode was stuck … re-queued automatically").
- **Container image:** `apps/media/container/Dockerfile` (node:22-alpine + ffmpeg). Wrangler builds
  and pushes it on deploy. Old images count toward the 50 GB image storage. Prune with
  `wrangler containers images list` / `delete`.

## Troubleshooting panel (videos admin → Delivery)

Why a transcode waits or fails, without Cloudflare access (owner 2026-11-15: "why the logs are not on
admin to troubleshoot?"). Needs `media:manage`; the token needs a super admin.

- **Jobs:** every R2 job queued, starting, running or waiting to retry, and those failed or cancelled
  in the last 3 days (api-videos `GET /internal/media/troubleshoot`, from `media_jobs` and each video's
  transcoder Durable Object through the `MEDIA_WORKER` binding). Per job: video, state, attempt n of
  max, queued/started/next try, the last error in words (`transcodeErrorReason` in
  `packages/shared-types/src/media-troubleshoot.ts`; the raw, scrubbed error is one click away) and
  the container instance (named by the video id) with its state from the Containers API.
- **One reason everywhere.** `explainVideoFailure` (`packages/shared-types/src/video-failure.ts`) turns a
  failure into its reason, its cause (the file, our side, not known) and what to do. The Videos list, the
  video page, Processing, Delivery and Errors all show it (`FailureWhy`), with the file's name, and link to
  this panel (`/delivery?video=<id>`; that video's failed job is listed however old). They read it from
  `GET /api/media/failures?ids=` (admin-api adds the imported file's name). A video counts as failed when its
  upload or Bunny did, or when its R2 transcode did while Bunny's copy plays. When the file is the cause,
  Errors offers no Retry and the other pages ask first.
- **Start failures are kept.** When a start fails the queue consumer notes it on the video's
  transcoder (`noteStartFailure`), so a job that never started shows "Start failed, retrying", the
  reason and the next try instead of a bare "queued".
- **Right now:** containers in use out of `max_instances` and their health (Containers API), the
  transcode queue's and the DLQ's backlog (GraphQL `queueBacklogAdaptiveGroups`, latest minute of the
  last 15), and the jobs waiting with the oldest wait (`media_jobs`).
- **Log lines:** warn/error lines of the media Worker (`$workers.scriptName`) and every line of the
  transcoder container (`$container.applicationId`) from Workers Observability, last 1, 6 or 24 h,
  filtered by a video or job id. admin-api builds every query from our own names
  (`mediaNames()` in `apps/admin-api/src/lib/media-troubleshoot/cloudflare.ts`); the browser only
  sends an id (checked against `^[A-Za-z0-9-]{8,64}$` on both sides), never a filter. URL query
  strings and credentials are scrubbed before a line leaves admin-api (`scrubOpsText`, from #1407).
- **Retry now / Cancel** (per job, confirm dialog): audited per video (`media:video:<id>`), then a
  queued admin job (`media.transcode-retry` / `media.transcode-cancel`, retry with backoff, DLQ). Retry
  now runs a waiting retry at once, re-sends a job that never started (same job id), or queues a failed
  or cancelled one again. Cancel stops the container, marks the job cancelled, deletes what it wrote
  and records `r2.status = cancelled` (the owner sees "failed"; Bunny keeps playing), so the sweep
  never re-queues it. A job that gives up flags the Errors page with Retry.
- **Stalls** (api-videos 10-minute sweep, `flagStalledTranscodes`): a running job with no word from its
  container for 10 min, a retry 5 min past its time, or a job queued over 30 min raises one Errors page
  item `media-transcode:<videoId>` with "Retry now" and a link to the panel (`/delivery?video=<id>`).
  Reported once per stall, so a dismissed item stays dismissed; resolved when the job finishes or is
  cancelled.

**The Cloudflare token.** A super admin sets it in the panel. Create it in the Cloudflare dashboard
(My Profile → API Tokens), scoped to the account, with read permissions only: **Workers
Observability: Read**, **Containers: Read**, **Queues: Read**, **Account Analytics: Read**. Save runs a
test and lists any permission it lacks; "Test again" repeats it. It is stored sealed in admin-api's
`site_settings` (`ops:cloudflare-troubleshoot-token`, AES-GCM with a key derived from
`INTERNAL_API_KEY`), never returned, shown by its last 4 characters, and every set/replace/test/remove
is audited (`media:troubleshoot-token`). After `INTERNAL_API_KEY` is rotated the panel says the token
can no longer be read and it has to be set again. Without a token the panel says so in plain words
and shows the jobs from our own records; nothing fails.

**Running cost.** While the page is open and visible it refreshes every 30 s: one admin-api request,
small D1 reads and up to one transcoder Durable Object call per listed job (30 at most), and with a
token 5 Cloudflare API calls (applications, instances, queues list, 2 GraphQL), cached 20 s in
admin-api. Log lines are 2 Observability queries, only when asked for. The stall sweep adds the same
Durable Object calls every 10 min, only while jobs are queued or running. Cloudflare API calls are not
billed and the rest is well inside the Workers plan: about $0 a month.

## Public MP4 (search engines' contentUrl)

Every transcode also writes one progressive MP4, `<prefix>/video.mp4`: a stream copy of the 480p
rung (360p for a smaller source), never a second encode (#1181, D-SEO-11). For a public video the
API gives it as `contentUrl` (`publicMp4Url`), and the watch page's VideoObject carries it (#1201).
Private and unlisted videos have it too, under `priv/`, and never expose it.

- **Backfill** (#1182): renditions made before #1181 get it with a remux-only job (`kind: 'mp4'`
  on the transcode queue → `Transcoder.remuxMp4`: the container reads the rung's init and segments
  from R2, remuxes, writes `video.mp4`; api-videos records `r2.result.mp4` only if the rendition is
  still the same rev and access). No new rev; playback never notices.
  ```bash
  node --experimental-strip-types scripts/release/mp4-backfill.ts start --env qa            # dry run: one line per video
  node --experimental-strip-types scripts/release/mp4-backfill.ts status --env qa --run <id>
  node --experimental-strip-types scripts/release/mp4-backfill.ts start --env qa --apply    # queue the jobs
  ```
  Candidates come from `media_jobs` (one primary-key page per message), jobs start 30 s apart.
- **Uploads:** a container upload with a Content-Length is streamed into R2 (`src/uploads.ts`); the
  MP4 of a long video is larger than a Worker's 128 MB.
- **Rate limit:** `/pub/*` is served by the R2 custom domain with no Worker, so the limit is a zone
  rate-limit rule (`scripts/media-cdn/apply.ts`, step `ratelimit`): path `/pub/*/video.mp4`, 10
  requests per 10 s per IP, block (the Free plan allows one rule, 10 s periods and block only). It
  needs **Zone WAF Edit** on the token; without it the step prints the rule to add by hand.
- **Cache:** the Free plan caches files up to 512 MB, so the MP4 of a video longer than about an hour
  is served from R2 on every request (Class B reads; the rate limit bounds them).
- **Cost:** the Operations page's R2 tab has its own line, `al-ummah-now-media[-env] video.mp4`
  (cost-monitor: the bucket's `%/video.mp4` reads, taken out of the bucket's own row).

## Rollback

- **Viewers:** set the delivery switch (admin, per env) to `bunny`. That is immediate, and nothing
  else changes.
- **Pipeline:** set "Transcode new uploads" off in the same setting. Running jobs finish, and no new
  ones start.
- **Worker:** `wrangler rollback` on `al-ummah-now-media-<env>`. The R2 objects stay.

## Costs to watch

- **Container seconds:** recorded per job (`r2.containerSeconds`).
- **R2:** storage and operations, for both media buckets.
- **Media host:** requests and cache status.

All three appear on the admin Delivery comparison page. For unit-cost projections at scale, see the cost
model in the plan.
