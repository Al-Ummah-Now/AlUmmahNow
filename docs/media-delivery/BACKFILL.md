# R2 backfill of existing videos

Owner, 2026-11-14: "build backfill infra, admin does it, dont do scripts". The videos admin's **R2 backfill** page
(`/backfill`, admins and super admins: `media:manage`) copies videos that exist only on Bunny into R2, transcodes
them with our pipeline, verifies every copy and marks it R2-ready. Afterwards the admin can play R2 first (per video,
per channel, or everywhere) and, as a separate action, retire a legacy Bunny library. Wiki: AUN-R2-MIGRATION (D2,
O31/O32); epic AlUmmahNow#687.

No script runs a backfill and nobody runs one on production by hand: the admin runs it from the page.

## Flow

```
admin: scope ─► estimate (queued) ─► sets the cap ─► Start
                                                     │
            per video, queued on PROCESSING_CHECK_QUEUE (kind media-backfill), resumable:
            copy ─► transcode ─► verify ─► verified (R2-ready)
                                                     │
admin: Play R2 first (video / channel / global)      │   admin: Retire library ─► grace period ─► Bunny delete
```

0. **This environment** (top of the page, `GET /internal/media/backfill/overview`, read-only): live counts of the
   videos with no ready R2 rendition (not live, not deleted) and their length, what Bunny stores for this environment
   (cached 10 min per isolate), and what moving all of them would cost, **likely** (this environment's measured ratios,
   copies = the missing videos' share of Bunny's bytes) and in the **worst case** (the page says "Worst case"; in code `ceiling`, `BACKFILL_CEILING`: 4 container-s per
   video-s, 1.25 MB of renditions per video-s, 2 writes per video-s, never below the measured ratios; copies = all of
   Bunny's bytes). Admins run the backfill in batches (a channel or a date range), each with its own estimate and cap.
   Backfills run only from this page: never from CI, scripts or by an agent; CI and E2E use mocks and tiny seed data.
1. **Scope** — all videos, one channel, an upload-date range, or a list of up to 500 ids; optionally only videos without
   a ready R2 rendition. Read from the `content_ownership` index (SEARCH_DB) in pages of 20, never an R2 list.
2. **Estimate** (`op: estimate`, one page per message). For each video, the item is planned from real sizes: a
   kept original (`media_originals`) needs no copy; otherwise Bunny's best file (`original`, else the largest
   `play_<res>p.mp4`) is measured with a one-byte range request (Content-Range gives the real size). Deleted videos,
   live streams, videos still processing or already verified are left out with a reason, and so is any video under a
   suspension hold (CSAM containment, a suspended or deleted channel or user): it is never copied or transcoded, and the
   check runs again when the video would start. Costs use `PRICES`
   (`lib/media/costs.ts`) with ratios measured from this environment's finished transcodes (`media_jobs`): container
   seconds, rendition bytes and objects per second of video. With no finished transcode yet the ratios are assumed and
   the page says so. The estimate also carries a `ceiling` (the same videos at the ceiling ratios). The cap starts at
   the likely estimate (rounded up to the cent); the admin may raise it toward the worst case.
3. **Start** needs a cap above 0. A tick (`op: tick`, every 20 s while running) starts videos up to the concurrency
   (capped by the max of the admin's concurrent transcodes range in Video providers → Cloudflare R2 settings, RUNBOOK.md Capacity) and the spacing between starts, and only when spent + what the videos in
   progress may still cost + the next video's estimate stays within the cap. Otherwise the run stops as **Stopped at
   the budget cap** and flags the admin. Resuming needs a cap that covers the spend and the next video.
4. **Copy** (`op: copy`, 2 × 64 MiB ranges per message) — each range: Bunny `Range` GET on a signed directory-token URL
   → R2 put at `src/<id>/<uploadId>/<offset>` in `MEDIA_ORIGINALS`. Its MD5 (computed while streaming) must equal R2's
   ETag and its size must match. A range already in R2 with the stored MD5 is skipped, so a redelivery resumes. When
   the ranges cover the file, the manifest is written and `media_originals` gets the row (`keep = 'backfill'`, so
   retention never deletes it). A changed size or a 404/410 from Bunny fails the item.
5. **Transcode** — `enqueueTranscode(…, 'backfill')`, the same queue and Container as uploads; a transcode already
   queued or running is followed instead of starting another.
6. **Verify** — every check must pass, stored per video and rendition rev in `media_r2_verified`:
   - original: manifest present, parts cover it, size equal to Bunny's, every copied part has its checksum;
   - renditions: ready, every rung in the master playlist, none above the source height;
   - duration: rendition vs Bunny's length (else the record's), tolerance max(2 s, 1%);
   - objects: every playlist, init segment and segment the playlists name exists in R2 and is not empty, plus `thumb.jpg`.
   A later re-transcode (new rev) makes the verification stale.

A hold can land at any time, so every stage (start, each copy message, transcode, its poll, verify) checks the record
first: a held video is left out as **Skipped: under a hold**, a copy in progress loses the parts this run wrote (only
this run's upload id, never an upload's own kept original), and it is never marked R2-ready.

Every step is idempotent and runs from the queue with retries (backoff, up to 6 deliveries). A step that cannot
succeed fails its item; after the last delivery the message goes to the DLQ. Failures appear in the item list with
**Retry**, and on the **Errors** page (needs-action `media-backfill:<videoId>`, run-level `media-backfill-run:<runId>`,
Retry through `/internal/media/backfill/items/retry`). The 10-minute sweep cron re-queues a running run whose tick went
quiet. Pause starts nothing new; Cancel cancels what has not started. Videos already verified stay verified.

## Play R2 first

Through the existing provider settings (PROVIDERS.md), never a new mechanism:

| Target | Change | Undo |
|---|---|---|
| Video | its override: priority `[r2, bunny]` — only for videos verified at their current rev | clears that override (only an R2-first one) |
| Channel | the channel override: R2 first, keeping the rest of the order | removes the strategy/order from the override |
| Everywhere | the global playback order: R2 first | Bunny first again |

Bunny stays the fallback in every case, and playback only offers a provider whose copy is ready, so a video without a
ready R2 copy keeps playing from Bunny.

## Retiring a Bunny library

A separate action on the same page, with a typed confirmation (the library id) and a step-up sign-in (admin-api
`step-up-routes.ts`). The library new uploads go to (the primary) cannot be retired.

- **Schedule** — every video verified in that library gets a row in `media_bunny_removals` with `delete_after` = now +
  the grace period (7–90 days). Cancel puts scheduled rows back to cancelled.
- **Remove** (sweep cron queues due rows, `op: removal`, 2 s apart) — right before the delete, the video is checked
  again: a video under any suspension hold is cancelled (a CSAM hold's Bunny copy is preserved evidence, never deleted),
  and it must still be verified at its current rev, else the removal fails and flags the admin. The hold is checked
  again inside the compare-and-swap that marks the copy removed, and once more right before the Bunny delete. A thumbnail hosted on
  Bunny is copied byte for byte to R2 (`pub/thumbs/<id>/kept-<uuid>.<ext>`) first, never replaced by another frame.
  The video's Bunny provider entry is removed and `bunnyRemoved` is set, then the Bunny video is deleted
  (`deleteBunnyVideo` in that library). Failures: needs-action `media-bunny-removal:<videoId>`, Retry through
  `/internal/media/backfill/removals/retry`.
- **Never** changes a Bunny library's settings. "Block Direct Url File Access" in particular is never touched.

## Audit and access

admin-api `/api/media/backfill/*` (media:manage) audits every change in `site_settings_log`: run actions under
`media:backfill:<runId>` (`media:backfill:new` for a new estimate), video flips and removal retries under
`media:video:<id>`, channel/global flips under `media:delivery` with the old settings, retirement under
`media:bunny-retire:<libraryId>`. A refused change leaves no audit row.

## Data

SEARCH_DB migration `0042_media_backfill.sql`: `media_backfill_runs`, `media_backfill_items` (one row per run and
video, with the parts' MD5s, spend and checks), `media_r2_verified`, `media_bunny_removals`. A permanent video delete
(`purgeVideoMedia`) removes the video's rows from the last three.

## Cost

Nothing runs while no backfill runs: no new cron (the existing 10-minute sweep checks two indexed queries) and no idle
resources. A run spends at list prices: Bunny egress for copies ($0.01/GB), container seconds for transcodes, R2 writes
($4.50 per million) and R2 storage ($0.015/GB-month for originals and renditions). It never spends past its cap.

## Code map

| Where | What |
|---|---|
| `packages/shared-types/src/media-backfill.ts` | scope/settings parsing, cost and budget math, playlist helpers |
| `apps/api-videos/src/lib/media/backfill/` | `estimate`, `copy`, `verify`, `run` (ticks, items, budget), `flip`, `removal`, `store` |
| `apps/api-videos/src/endpoints/media/backfillInternal.ts` | `/internal/media/backfill/*` |
| `apps/admin-api/src/routers/media.router.ts` | `/api/media/backfill/*` with audit |
| `apps/admin-web/src/app/(protected)/backfill/` | the page |
| `apps/web/e2e/release/r2-backfill.player.spec.ts` | local stack: estimate → start → copy → transcode → verify → R2 first → plays |
