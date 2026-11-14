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
| `health` | `enabled`, `failureThreshold` fallbacks in `windowMinutes`, `probeFailures` in a row, `cooldownMinutes` |
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

- **Player fallbacks** away from it (`/playback?exclude=`), one row per provider per minute in D1
  `media_provider_health` (pruned after a day).
- **Probes**, every minute from the api-videos cron: Bunny is a HEAD on the primary CDN host
  (anything below 500 is up); R2 is a HEAD of `pub/_health/probe.txt` through the public media
  domain (written through the binding only when the edge answers 404).

`nextProviderHealth` turns them into `healthy` / `unhealthy`: unhealthy after `probeFailures` failed
probes in a row or `failureThreshold` fallbacks in the window, healthy again after `cooldownMinutes`
with passing probes and fallbacks under the threshold. The snapshot is stored at
`global_settings/ops/media-health.json`. Turning unhealthy raises the Errors page item
`media-provider-health:<id>` with **Check now** (`POST /internal/media/health/check`, registered in
admin-api `SERVICE_RETRIES`); recovering resolves it.

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
| Internal routes | `apps/api-videos/src/endpoints/media/mediaInternal.ts` |
| Admin routes | `apps/admin-api/src/routers/media.router.ts` |
| Tests | `apps/api-videos/test/media-providers-*.spec.ts`, `media-playback.spec.ts`, `apps/admin-api/test/media.test.ts` |
