# Bunny Stream libraries and channel collections

## Libraries per environment

| Env | Primary library (new uploads, live streams) | Legacy library (existing videos only) |
|---|---|---|
| Production | 498994 "al-ummah-now", `vz-25839d05-80d.b-cdn.net`, Secrets Store `bunny-stream-key-498994`, `bunny-stream-library-id-498994`, `bunny-stream-token-key-498994` | 400189, `vz-215a1ffd-a5a.b-cdn.net`, Secrets Store `bunny-stream-key`, `bunny-stream-token-key` (bindings `BUNNY_LEGACY_STREAM_KEY`, `BUNNY_LEGACY_TOKEN_KEY`; vars `BUNNY_LEGACY_LIBRARY_ID`, `BUNNY_LEGACY_HOSTNAME`) |
| QA, stage | the shared test library, `vz-cb79844a-c5d.b-cdn.net`, `bunny-stream-*-qa` | none |

Both production libraries have CDN token authentication on. "Block Direct Url File Access" must stay **off** in every library: with it on, Firefox and other no-referrer players get 403.

## Which library a video is in

`apps/api-videos/src/lib/bunny/libraries.ts` picks the library from the record:

1. `bunnyLibraryId` (set on every upload since 2026-11-12);
2. else the host of `playUrl` (or `thumbnailUrl`);
3. else the primary library.

Every Bunny call for an existing video goes through that library's API key, token key and host. This covers signing (`middleware/bunny-signing.ts`), thumbnails, the processing loop, deletes (owner, admin, purge, privacy erase, reaper), title and collection updates, TUS resume, R2 transcode sources and the video-format job. An orphan (no record) is looked up and deleted in every library, primary first.

## Channel and user collections

Every video belongs to a collection in its own library (`lib/channelCollection.ts`):

- **Channel videos** go into the channel's collection: `channel.bunnyCollections = { "<libraryId>": "<collectionId>" }`. An older single `bunnyCollectionId` is adopted by the library that actually holds it.
- **User-level uploads** (`channelId` is the owner) and uploads to a channel that no longer exists go into the owner's collection: `profile.bunnyCollections`. It is named after the display name, else `@handle`, else `User <id>`. The env prefix (stage: `[stage] `) is added as for every Bunny name.

Lifecycle:

- **Created:** lazily on the first upload to that library, by every path that creates a Bunny video: single and bulk initiate, `POST /api/videos/upload`, `POST /api/videos` and live streams. All of them use `uploadCollection`.
- **Safety net:** a failed collection step is retried once and logged at warn. The processing check then files any video Bunny still reports at the library root, and a reused upload is filed when it is reused.
- **Renamed:** with the channel (owner and admin edits) and with the profile's display name or handle (owner and admin edits).
- **Soft delete:** keeps them.
- **Purge:** removes them. For a channel that is the admin purge. For a user it is the profile delete, the privacy erase, the admin erase and the run-account erase. Videos are not deleted by removing a collection.

## Backfill: file existing videos into their collections

`lib/bunny/collectionBackfill.ts` runs as messages on the env's processing-check queue (`al-ummah-now-processing-check`, `…-qa`, `…-stage`). Start it by sending one message with the Queues REST API:

```json
{ "kind": "bunny-collection-backfill", "runId": "collections-2026-11-12-dry", "page": 0, "cursor": null, "dryRun": true, "limit": 25 }
```

- **Dry run** reads R2 and Bunny (GET only) and counts what it would do. **Apply** (`"dryRun": false`, new `runId`) creates or adopts collections and sets each video's collection.
- Placement per video, counted per library (`totals.byLibrary.<id>`):
  - `channel`: the channel is real. Goes into the channel's collection.
  - `user`: a user-level upload or no channel. Goes into the owner's collection.
  - `deletedChannel`: the channel was deleted (soft or hard). Goes into the owner's collection. If the channel is restored, a later run moves the videos back.
  - `ownerMissing`: the owner has no profile. Listed in `totals.ownerMissing`, never moved.
  - Each placement counts videos, already placed, moved (or would move), missing in Bunny and errors.
- Collections the old `POST /api/videos` named after a channel id are listed in `strayCollections.<id>`. Their videos are moved into the proper channel collection by the video pages; apply removes the ones that are then empty, and keeps and lists any that still hold videos no record references.
- After the video pages, each library's Bunny videos that no record or live stream references are listed in `unreferenced.<id>` (count, bytes, first 1000). **List only, never deleted.**
- Page 0 also proves each library's host and token key: `libraries.<id>.thumbnailStatus` is 200 for a signed thumbnail of one of its videos.
- Results are in `global-settings[-qa|-stage]` at `ops/bunny-collections/runs/<runId>.json` (and `latest.json`).
- The job is idempotent and can be run again at any time.
