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

## Channel collections

Each channel has one Bunny collection per library: `channel.bunnyCollections = { "<libraryId>": "<collectionId>" }` (`lib/channelCollection.ts`).

- **First upload:** the upload creates the collection in the library it goes to. Single, bulk and live-stream uploads all do this. An older single `bunnyCollectionId` is adopted by the library that actually holds it.
- **Rename:** renaming the channel renames its collections, from the owner's channel edit and from the admin.
- **Delete:** soft delete keeps the collections. The admin purge deletes them; videos are not deleted by removing a collection.

## Backfill: file existing videos into their channel's collection

`lib/bunny/collectionBackfill.ts` runs as messages on the env's processing-check queue (`al-ummah-now-processing-check`, `…-qa`, `…-stage`). Start it by sending one message with the Queues REST API:

```json
{ "kind": "bunny-collection-backfill", "runId": "collections-2026-11-12-dry", "page": 0, "cursor": null, "dryRun": true, "limit": 25 }
```

- **Dry run** reads R2 and Bunny (GET only) and counts what it would do. **Apply** (`"dryRun": false`, new `runId`) creates or adopts collections and sets each video's collection.
- Page 0 also proves each library's host and token key: `libraries.<id>.thumbnailStatus` is 200 for a signed thumbnail of one of its videos.
- Results are in `global-settings[-qa|-stage]` at `ops/bunny-collections/runs/<runId>.json` (and `latest.json`). They show totals per library: videos, already placed, moved (or would move), missing in Bunny and errors. They also list the collections created or adopted, and the skipped videos: user-level uploads (`noChannel`), deleted channels and unknown libraries.
- The job is idempotent and can be run again at any time.
