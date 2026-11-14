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
- **Queue backs off ("Could not start job"):** all `max_instances` containers are busy. That's
  expected under bursts. Raising `max_instances` raises the peak spend. The Delivery page's
  "Transcoder now" card shows transcoding now out of the maximum, the jobs waiting and the oldest
  wait (from `media_jobs`, refreshed every 30 s). The maximum is api-videos' `MEDIA_MAX_TRANSCODES`
  var: change it with `max_instances` in `apps/media/wrangler*.jsonc` (production 4, stage and QA 2).
- **One video:** its admin page has an R2 card with the status, the failure details when a
  transcode failed, and "Transcode again" (`media:manage`).
- **Dead letters** (`al-ummah-now-transcode-dlq-*`): the queue gave up starting a job. The
  api-videos sweep re-queues videos stuck in `queued`.
- **Container image:** `apps/media/container/Dockerfile` (node:22-alpine + ffmpeg). Wrangler builds
  and pushes it on deploy. Old images count toward the 50 GB image storage. Prune with
  `wrangler containers images list` / `delete`.

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

All three appear on the admin Delivery comparison page. Against the $500/month cap, see the cost
model in the plan.
