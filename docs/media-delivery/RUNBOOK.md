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

## Checks

```sh
# Public object: second request is a HIT (needs the Cache Rule)
curl -sI https://media.qa.alummahnow.net/pub/<videoId>/<rev>/master.m3u8 | grep -i cf-cache-status
# Private path without a valid token: 403 from the Worker (never served by R2)
curl -s -o /dev/null -w '%{http_code}\n' https://media.qa.alummahnow.net/priv/1999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/x/y/master.m3u8
# A job as its container sees it (service binding from api-videos, or wrangler tail)
npx wrangler tail al-ummah-now-media-qa
```

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
