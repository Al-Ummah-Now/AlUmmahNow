# Keeping our own originals (R2 independent of Bunny)

Epic #687. Decided by the owner on 2026-11-12, after the first production R2 job had to wait for
Bunny's encode.

## Problem

Today an upload's bytes pass through our TUS proxy (api-videos) straight to Bunny, and we keep no
copy. The R2 transcode therefore reads back from Bunny, which has three costs:

- **Bunny's CDN refuses `/<id>/original`**, with 403 even when correctly signed, on QA (pull zone
  4943033) and production (library 400189). The R2 job can only use Bunny's MP4 fallback.
- **The MP4 exists only after Bunny encodes.** The owner's 63 s production upload waited about 9
  minutes for Bunny before R2 could start (2026-11-12).
- **Quality is capped at what Bunny produced:** a second-generation encode, at most 1080p.

The comparison is neither fair nor independent.

## Design

The original upload is kept in a private bucket we own, written by our own upload path, and the
transcode starts from it as soon as the upload completes, in parallel with Bunny.

**Bucket:** `al-ummah-now-media-originals[-qa|-stage]`. It is private, with no custom domain and no
public access.
- api-videos binds it as `MEDIA_ORIGINALS` (write, delete).
- apps/media binds it as `MEDIA_ORIGINALS` (read).

**Keys:**
```
src/<videoId>/<uploadId>/<offset, 15 digits>   one object per TUS PATCH (or the whole file)
src/<videoId>/manifest.json                      { uploadId, size, parts, completedAt }, written at completion
```
`uploadId` is the TUS proxy upload id, so a re-upload of the same video (a new session) never mixes
with older parts.

### Writing: every path that receives the bytes

| Path | How the original is kept |
|---|---|
| `POST /api/videos/upload/initiate` and `/upload/batch/initiate` → TUS proxy `PATCH /api/videos/tus/<id>` (web, Studio, native apps) | The PATCH body is `tee()`d: one branch goes to Bunny exactly as before, the other is `put` to `src/<videoId>/<uploadId>/<Upload-Offset>`. Both are awaited; **Bunny's answer is the response**, and an R2 failure is logged, never returned. |
| `POST /api/videos/upload` (multipart, the whole file in the Worker) | One part at offset 0. |
| `POST /api/videos` (VideoCreate) | Creates a record without bytes; the bytes then arrive through one of the paths above. |
| Live streams | Out of scope: live has its own R2 path. |

**Rules for PATCH parts:**
- **Keyed by offset, so retries are safe.** A resumed or retried PATCH at the same offset overwrites
  that part, so a half-written part can never survive next to a good one.
- **Partial PATCHes.** When Bunny takes fewer bytes than were sent, the client resumes from Bunny's
  offset, so parts may overlap. Assembly reads parts in offset order and skips bytes it already has.
- **Interrupted PATCHes.** A part whose R2 put failed is missing. Assembly then sees a gap and the job
  falls back to Bunny's MP4. Nothing breaks; we lose only the independence for that one upload.
- **Memory.** A PATCH is copied only when its `Content-Length` is known and ≤ 64 MiB. Clients send
  5 MiB chunks, the size initiate recommends. Larger or unknown-length chunks skip the copy, with a
  log line, rather than buffer too much in the Worker.

### Completing

`markUploadComplete` already runs once Bunny holds every byte. Before it queues the transcode, it
lists the upload's parts and checks they cover `[0, size)`:
- **If they do:** it writes `manifest.json` and records the original in D1 (`media_originals`).
- **If not:** the job uses Bunny's MP4 fallback, as #955 does.

The transcode is queued at the same moment as today, now with a source that already exists.

### Reading (apps/media)

The source handler (`http://source.internal/src`) prefers the original. With a manifest present it
serves the container's Range requests by **virtual concatenation**: it finds the parts that overlap
the range and streams their byte ranges in order (R2 ranged gets). Nothing is copied or re-assembled
into one object.
- R2 multipart is not used: it needs equal-sized parts, which overlapping TUS chunks can't
  guarantee.
- The response carries `x-media-source: original`, recorded as `result.source.file`.
- **No manifest** (videos uploaded before this ships, or a gap): Bunny candidates as today. Bunny's
  `/original` stays first in case Bunny ever serves it, then its MP4s highest first.

### Retention and cost

- **Keep rule:** keep an original at least `ORIGINALS_RETENTION_DAYS` (default 30) after upload, and
  until the video's R2 rendition is `ready`, whichever is later. It is deleted when both hold.
- **Ceiling:** `ORIGINALS_MAX_DAYS` (default 90) is a hard limit for originals whose transcode never
  succeeds.
- **Configurable:** both are api-videos vars, per env.
- **Who deletes:** the daily cron deletes due originals (`src/<videoId>/`) and marks the D1 row. The
  30-day purge, promote-to-permanent and erase also delete them, along with the renditions.
- **Leftovers:** a bucket lifecycle rule deletes anything under `src/` older than `ORIGINALS_MAX_DAYS`
  + 30 days, for parts of uploads that never completed.
- **Cost:** the daily cost job adds `originals_stored_gb` and the matching storage cost to the R2
  side. Uploads are one Class A op per 5 MiB chunk, which is negligible.

D1: `media_originals (video_id PK, upload_id, bytes, parts, completed_at, deleted_at)`, migration
`search/0023`.

### What does not change

- **Bunny:** the upload to Bunny is byte-for-byte the same request, and its response decides the
  client's.
- **Upload limits, sessions, resume and the reaper:** unchanged.
- **Delivery switch and playback:** unchanged.

## Rollout

1. This note.
2. **One PR** with the bucket (`ensure-resources`, configs for QA, stage and production), the tee in
   the TUS proxy and multipart upload, completion, the source handler, retention, the cost metric and
   tests. Labelled `skip-qa-e2e`, merged on green code checks.
3. **QA check:** one upload. The R2 job must start within seconds of the upload completing and read
   `source.file = original`, at the source's full resolution, before Bunny is ready.
4. Production with the next videos release, after reporting to the owner.
