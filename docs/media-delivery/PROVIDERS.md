# Media providers

Owner, 2026-11-14: "providers are providers, on or off, a video has a provider, but apis need to be
ours, inside settings and current video provider control where things are saved or pulled from, a
video can have multiple providers, future we might add more, admin should allow input into one or
more, playback should be one or more with loadbalancing, fallback or other rules".

Today's providers are **Bunny Stream** and **R2** (our Cloudflare stack: R2 + the transcoder
Container + the media Worker, see [R2-DELIVERY-PLAN.md](./R2-DELIVERY-PLAN.md)).

## The model

```
        clients (web, embeds, apps)  ── only ever talk to our API ──┐
                                                                    ▼
  api-videos ── settings (global_settings/ops/media-delivery.json, version 2)
             ── per video: provider records (which providers hold it, their ids, status)
             ── registry (lib/media/providers) ── bunny adapter ── Bunny Stream
                                                └─ r2 adapter    ── R2 / media Worker
```

- **A provider** is an adapter in `apps/api-videos/src/lib/media/providers/` implementing
  `MediaProvider` (`types.ts`): `record` (this video's copy, or none), `playback` (signed playlist and
  frame of a ready copy), `isOwnAutoThumbnail` (is a stored thumbnail this provider's automatic frame
  of the video), `probe` (can viewers reach it) and `ingest` (`upload-proxy`: bytes stream to it
  through our TUS proxy; `from-original`: it builds its copy from our kept original).
- **Adding a provider** = a new adapter file, its id in `MEDIA_PROVIDER_IDS`
  (`packages/shared-types/src/media-providers.ts`) and its label. Call sites never name a provider;
  they ask the registry (`provider(id)`, `allProviders()`, `videoProviderRecords(video)`).
- **A video's providers.** New videos carry `media.providers` (`{ [provider]: { ref, status,
  libraryId?, addedAt, readyAt?, error? } }`) and an optional `media.override`. Rows written before
  providers existed have no `media` field and are read in code, never backfilled: Bunny under the
  video's own id (the GUID was the id) with the row's `uploadStatus`, plus R2 where `video.r2` exists.
  `bunnyRef(video)` is the one way to get a video's Bunny id.

## Settings

One document per environment at `global_settings/ops/media-delivery.json` (the key the old delivery
switch used), cached 30 s per isolate (`lib/media/settings.ts`):

| Field | Meaning |
|---|---|
| `providers.<id>.enabled` | on or off. Off: never offered for playback, never an ingest target, not probed |
| `ingest` | providers new uploads go to (one or more) |
| `playback.strategy` | `priority` (try `order` in turn) or `weighted` (pick the first by `weights`, the rest follow in `order`) |
| `playback.order` / `weights` | the provider order; weights are relative shares (0-100) |
| `playback.assign` | `video`: a video's bucket is stable (FNV of its id); `view`: drawn per request |
| `health` | `enabled`, `failureThreshold` distinct fallback reporters in `windowMinutes`, `probeFailures` in a row, `cooldownMinutes` |
| `thumbnails.store` | where new custom thumbnails are stored |
| `channels.<channelId>` | override: `ingest`, `strategy`, `order`, `weights`, `note` (at most 200 channels) |

A video's `media.override` has the same fields and wins over its channel's, which wins over the
global settings (`effectiveRules`).

**Refused** (`settingsProblems`, checked by admin-api and again by api-videos; 400 with `problems`):
no provider on, empty ingest, an ingest target that is off, no enabled provider in the playback order,
ingest targets none of which can play, weighted with every playable weight 0, the thumbnail store off,
and channel overrides with the same faults. A provider that is off may stay in the order: it is
skipped while off and back in place when switched on.

**Day one = before.** A stored legacy switch (`{ mode, r2Percent, assign, transcode }`) is migrated
in memory (`settingsFromLegacy`): `bunny` → priority `[bunny]`; `r2` → priority `[r2, bunny]`;
`split` → weighted `[r2, bunny]` with `{ r2: p, bunny: 100 - p }`; `transcode: false` → ingest
`[bunny]`. The unit tests check every bucket of every mode against the old picker. Saving writes
version 2 plus the legacy fields derived from it (`legacyFromSettings`), so rolling api-videos back
plays and transcodes the same way. Defaults: both providers on, ingest `[bunny, r2]`, playback
priority `[bunny]`, assign `video`, thumbnails on Bunny.

Routes: api-videos `GET|PUT /internal/media/providers`, admin-api `GET|PUT /api/media/providers`
(`media:manage`, audited as `media:delivery` with the old and new document). The legacy
`/settings` pair still works and rebuilds playback from the old shape, keeping the rest.

## Playback

`choosePlayback` (`lib/media/playback.ts`) → `planSources` (shared-types):

1. Rules: global → channel override → video override.
2. Candidates: providers whose copy is ready, that are on and not excluded by the player.
3. Order: `priority` keeps `order`; `weighted` picks the first by cumulative weight at the bucket,
   the rest follow in `order` (all weights 0 → `order`, reason `weighted_zero_weights`).
4. Health (when on): unhealthy providers move behind the healthy ones, never dropped
   (`unhealthy_moved`).
5. Each provider's adapter signs its URLs; one that cannot is skipped (`failed`).

The response carries `sources` (ordered), `playUrl` (= the first) and `delivery.source`. The
thumbnail becomes the playing provider's frame only when the stored one is a provider's automatic
frame of this video. Custom and legacy images, and their size variants, stay. Embeds
(`lib/media/public-play.ts`) sign at a pinned hour so their URLs stay cacheable. The decision log
and the fallback endpoint are described in the [RUNBOOK](./RUNBOOK.md#which-source-a-play-got).

## Health

Two signals per provider (`lib/media/health.ts`):

- **Player fallbacks** away from it (`/playback?exclude=`), counted only when that provider was
  ready for the video, one row per provider, minute and reporter in D1 `media_provider_health`
  (pruned after a day). The reporter is the client's network (its IPv6 /64, or its IPv4 address)
  hashed with HMAC keyed by `MEDIA_SIGN_KEY` and the day, so a stored row cannot be turned back into
  an address. The window counts **distinct reporters**: one client looping over many videos counts
  once. Fallbacks alone can demote a provider, because players see failures a probe cannot (CORS,
  decoding, one region), and demoting only reorders the sources; it never removes a way to play.
- **Probes**, every minute from the api-videos cron: Bunny is a HEAD on the primary CDN host
  (anything below 500 is up); R2 is a HEAD of `pub/_health/probe.txt` through the public media
  domain (written through the binding only when the edge answers 404).

**Idle cost.** The cron fires every minute, but a quiet minute (every provider healthy, last probes
passed, no fallback rows in the window) returns before probing until `IDLE_CHECK_MINUTES` (15) have
passed since the last check, so an idle site costs one zero-row D1 read a minute and a probe pair
plus one snapshot write every 15 minutes. Any fallback row, failed probe or unhealthy provider
brings back the minute cadence. The snapshot is rewritten only when its state changed or the idle
interval is due, and stale rows are pruned on the first stored pass of each hour. **Check now** is
always forced (probes and writes). Fallback reports are counted (D1 writes) at most 6 a minute per
video and 6 a minute per client network (`WATCH_TIME_LIMITER`); the answer itself is never refused.

`nextProviderHealth` turns them into `healthy` / `unhealthy`: unhealthy after `probeFailures` failed
probes in a row or `failureThreshold` distinct fallback reporters in the window, healthy again after `cooldownMinutes`
with passing probes and fallback reporters under the threshold. The snapshot is stored at
`global_settings/ops/media-health.json`. Turning unhealthy raises the Errors page item
`media-provider-health:<id>` with **Check now** (`POST /internal/media/health/check`, registered in
admin-api `SERVICE_RETRIES`); recovering resolves it.

## IDs

Every new video gets **our own id** (`newVideoId`, a UUID: the same shape as the Bunny GUIDs older
videos use as their id, so every route, id check and URL pattern keeps working). A provider's id for
its copy is stored on the record, `media.providers.<p>.ref`: Bunny's GUID, or for R2 our own id.
Lookups from the provider's side (the reaper's orphan sweep, collection repair, the signing
middleware) go through D1 `media_provider_refs` (`provider, ref → video_id`), written when the
provider-side video is created (`recordProviderRef`).

Legacy rows have no `media` field and are never rewritten: their id **is** their Bunny GUID.
`bunnyRef(video)` is the one accessor (stored ref, else the id on a legacy row, else null: Bunny holds
no copy). Every Bunny call (TUS signing, status, collections, title sync, thumbnails, delete, the
processing loop, the reaper, privacy erase) asks it, and a video Bunny does not hold is never sent to
Bunny. Old URLs and ids keep working because nothing about a legacy row changes.

## Ingest

Every upload path (single and bulk initiate, multipart, API create) asks `planIngest`
(`lib/media/ingest.ts`):

```
planIngest(channel) ─► ingestTargets(settings, channel override)
                    ─► our id
                    ─► Bunny targeted: create the Bunny video, its GUID → media.providers.bunny.ref
                    ─► media.providers: one pending entry per target
```

- **Bunny targeted:** the bytes stream to Bunny through our TUS proxy as before (signed with the
  GUID). The proxy tees them into the originals bucket, and R2, when targeted, transcodes from that
  original once the upload completes.
- **Bunny not targeted:** our TUS proxy is the upload server (`lib/media/r2-tus.ts`). Each PATCH is
  written to the originals bucket at `src/<id>/<uploadKey>/<offset>`, the keys the tee uses. The
  offset is the contiguous coverage of stored parts, so a retried chunk rewrites the same key and a
  resume continues where the bytes end. POST needs `Upload-Length` (at most 5 GiB, and equal to the
  size announced at initiate). PATCH needs `Content-Length` (411), refuses a wrong offset with 409 and
  the stored offset, and refuses anything once the upload finished (409). DELETE removes the parts of
  an unfinished upload only. Completion runs the same `markUploadComplete`: the original is completed
  with the upload's own key, then the transcode is queued. When the original cannot be completed and R2
  is the only copy, the video is flagged for re-upload (Errors page).
- **Readiness from R2:** when R2 decides the video's state (R2 holds a copy and Bunny none, or Bunny's
  failed), the transcode's `ready` event makes the video ready the way Bunny's sync does: `uploadStatus`
  ready, `playableAt`, size and duration from the job, R2's own frame as the thumbnail unless a custom one
  is set, published, then the same uploader notification and subscriber fan-out
  (`announceAndRecordProcessingResult`). A final transcode failure fails the video
  (`processingIssue: encode_failed`), and the Errors page item offers Retry. `media.providers.<p>.status`
  mirrors each provider (Bunny in the processing sync, R2 in the job events).
- **Both targeted, Bunny fails:** the video does not fail while another copy is pending or ready
  (`planSync` with `otherCopy`). R2's copy is promoted when ready.

### R2 only on the Cloudflare stack

Turning Bunny off for ingest (globally or per channel) makes the Cloudflare stack the whole pipeline:
our Worker takes the upload into R2, the transcoder Container (FFmpeg, `apps/media`) builds the HLS
ladder and the frame, and the media Worker and R2 custom domain serve it. Why this holds:

- every piece is already in production for the dual write and proven end to end on stage by
  `media-delivery.spec.ts` (queue → Container → R2 → signed `/priv/` playback);
- the original is the master: retention never deletes the original of a video R2 alone holds
  (`media_originals.keep = 'sole_copy'`, migration 0036), so a re-transcode can always start over;
- no new vendor and no new secret; the transcoder's retries and DLQ, and the Errors page with Retry,
  already cover failures.

Day one does not change: the defaults keep Bunny as the ingest target and the first playback source,
and production is not switched to R2 only.

## Thumbnails

- **Automatic frames** come from the provider that holds the copy: Bunny's `thumbnail.jpg` under its
  GUID, or R2's `thumb.jpg` from the transcode. A stored frame of one provider becomes the playing
  provider's frame only when it is a provider's automatic frame of this video (Playback above).
- **Custom thumbnails** (uploaded, or a frame the uploader picked) are stored where
  `thumbnails.store` says (`lib/thumbnail/store.ts`): Bunny image storage (`images.alummahnow.net`)
  or the public media bucket under `pub/thumbs/<id>/` (purged with the video's media). Each upload gets
  its own path.
- **Never replaced automatically:** custom and legacy images stay as they are. Every path that sets a
  thumbnail refuses an image of another shape than the video (422 on upload; dropped at initiate), and
  the daily thumbnail check flags mismatches on the Errors page. For a video with no Bunny copy it flags
  and never swaps in a frame.
- **Signing per response:** stored URLs never carry a token. The response middleware signs Bunny
  URLs (a new video's GUID counts as its own only through `media_provider_refs`, so a record cannot sign
  another video's GUID) and private R2 frames (`lib/media/frame-signing.ts`). A private frame gets a
  **file token** (`mediaFileToken`) that the media Worker accepts for that one file, never for the
  playlist or segments. Folder tokens come only from the playback decision, after its visibility check.

## Our APIs only

Clients never see provider internals: video views drop `r2`, `media`, `bunnyLibraryId`,
`tusUpload`, `uploadFingerprint`, `lastInitiateAt`, `abandoned`, `processingAnnounced` and
`thumbnailCheck` (`publicVideoFields`), beside the processing and review internals they already
dropped. What leaves the API is our ids and server-signed playback and thumbnail URLs.

## Code map

| What | Where |
|---|---|
| Types, settings model, migration, planner, health machine | `packages/shared-types/src/media-providers.ts` |
| Adapters and registry | `apps/api-videos/src/lib/media/providers/` |
| Settings store | `apps/api-videos/src/lib/media/settings.ts` |
| Playback decision, view rewrite, fallback counting | `apps/api-videos/src/lib/media/playback.ts` |
| Health | `apps/api-videos/src/lib/media/health.ts`, D1 `0036_media_providers.sql` |
| Originals kept for a sole R2 copy | `apps/api-videos/src/lib/media/originals.ts`, D1 `0038_media_originals_keep.sql` |
| Internal routes | `apps/api-videos/src/endpoints/media/mediaInternal.ts` |
| Admin routes | `apps/admin-api/src/routers/media.router.ts` |
| Our ids, refs, ingest plan | `apps/api-videos/src/lib/media/refs.ts`, `ingest.ts`, D1 `media_provider_refs` |
| Our own TUS target | `apps/api-videos/src/lib/media/r2-tus.ts`, `endpoints/video/tus/tusProxy.ts` |
| Readiness from R2 | `apps/api-videos/src/lib/media/r2-delivery.ts` (`readyFromR2`, `applyJobEvent`) |
| Custom thumbnail store, frame signing | `apps/api-videos/src/lib/thumbnail/store.ts`, `lib/media/frame-signing.ts`, `apps/media/src/edge.ts` |
| Local stack fake media pipeline | `scripts/local-stack/fake-external.ts` (`POST /__fake/media/transcode/<id>`, `media.local-stack.test`) |
| Tests | `apps/api-videos/test/media-providers-*.spec.ts`, `media-playback.spec.ts`, `apps/admin-api/test/media.test.ts`, `apps/media/test/edge.test.ts`, E2E `apps/web/e2e/release/r2-only-upload.player.spec.ts` (local) |
