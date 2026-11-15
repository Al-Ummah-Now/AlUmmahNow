# Move from YouTube (AUN-YT-IMPORT)

A creator moves their YouTube channel here: the videos with their titles, descriptions,
tags, localizations, publish dates, visibility, made-for-kids flag, custom thumbnails,
captions and playlists. Comments, likes and view counts stay on YouTube. Google's API
does not hand them over for import.

The video files come from **Google Takeout**. The YouTube Data API gives no download of
the original file. The creator downloads their Takeout zip(s) and picks them in the
Studio wizard. The browser reads the zips' central directory, matches each file to its
YouTube video and uploads each matched file through the normal resumable upload.
Matching uses the id in the file name, then the title (`matchTakeoutFiles` in
`packages/shared-types/src/youtube-import.ts`, `takeout-zip.ts`). The metadata comes
from the YouTube Data API v3, read with the creator's read-only consent.

## Flow

| Step | Who | What |
|---|---|---|
| Connect | Studio → `POST /api/youtube-import/oauth/start` | Google consent (PKCE S256, offline, `youtube.readonly`, plus `youtube.force-ssl` only when the creator asks for captions). Google sends the browser to `GET /api/youtube-import/oauth/callback`. That request carries no sign-in, so it exchanges nothing: it keeps Google's code on the consent row (single use, 5 minutes) and 302s to the wizard with `?connect=<state>` (or `?error=`). The signed-in wizard then calls `POST /api/youtube-import/oauth/finish { state }`. Only the user who started the consent may finish it, while they can still import into the channel; anyone else gets 403 and the consent is used up. This stops a consent link someone else started from binding the visitor's YouTube channel to their import (login CSRF). |
| List | queue `yt-list` | One API page per message: the uploads playlist, then the creator's playlists, then each playlist's items. Live and upcoming broadcasts and rejected uploads are left out. Ends in status `ready`. |
| Pick | Studio → `PUT selection`, `PUT matches` | The picked videos and playlists, `visibilityMode` (`keep` YouTube's visibility, or `private`), and which Takeout file is which video. |
| Import | Studio → `POST start`, then `POST /api/videos/upload/initiate` with `youtubeImport: { importId, itemId }` per file | The server builds the record from the item snapshot, so body values for title, description, tags, language, visibility, schedule and publish date are ignored. It also records the item's video and queues `yt-finalize`. A retried item reuses its video. |
| Finish | queue `yt-captions`, `yt-finalize`, `yt-playlists`, `yt-close` | Captions are staged in the subtitles bucket and attached once the video exists. YouTube's custom thumbnail is applied when it has the video's shape and the creator set none since. Playlists are recreated in YouTube's order once every picked video is here. The close revokes the Google token, sets `finished` and sends the creator the `youtubeImportFinished` notification. |

The full API contract (routes, bodies, answers, error codes) is in the OpenAPI document
(`apps/api-videos/openapi/v1.json`, tag "YouTube import"), with the types in
`packages/shared-types/src/youtube-import.ts`.

### Mapping

| YouTube | Here |
|---|---|
| public | public, `publishedAt` = YouTube's date, so the channel keeps YouTube's order |
| unlisted | unlisted |
| private with a future `publishAt` | private, scheduled for that time; the scheduler publishes it then |
| private | private |
| `madeForKids` | kept in `importedFrom.madeForKids` |
| the video | `importedFrom: { platform: 'youtube', videoId, publishedAt, madeForKids, importId }` on the record; the watch page shows "Originally published on YouTube on …" and JSON-LD `uploadDate` uses YouTube's date |
| chapters in the description | read from the description as for any upload |
| captions | the creator's own tracks, one per supported language; YouTube's automatic (ASR) tracks are never imported |

`visibilityMode: 'private'` makes every video and playlist private.

Imported videos are **never announced to subscribers** (`isAnnounceable` in
`lib/notification-events.ts`), so moving 500 videos sends no 500 notifications.
A YouTube schedule still in the future is the exception: the scheduler announces it
when it releases, because that release is new.

## Who

The user who connected manages the import. They need `video.upload` on the channel
(the owner, or a channel role that uploads), and the channel owner needs a creator tier,
the same as uploads. Uploads count against the tier's limits unless the tier has
**Imports count against limits** off (`importCountsAgainstLimits`, admin Creator tiers).
Even then, an import's upload session is counted like any other. It is given back only
after the initiate has confirmed a valid import item. The tier gate itself always applies.

## Reliability

- Every job is idempotent: the state lives in D1 (`yt_imports`, `yt_import_items`,
  `yt_import_playlists`, migration `0041_youtube_import.sql`), with upserts and
  create-only writes. A playlist's id is stored before the playlist is written, so a
  redelivery never makes a second one.
- Queue `al-ummah-now-yt-import[-qa|-stage]`, one message per invocation, 5 retries,
  dead letters to the shared `al-ummah-now-dlq[-env]`. A retryable failure is retried
  with a backoff (30 s doubling, at most 15 min). After 6 deliveries the job gives up.
  Its step is marked failed for the creator (Try again in the wizard,
  `POST …/items/:itemId/retry`) and flagged on the admin **Errors** page with a Retry
  (`POST /internal/youtube-import/retry`, registered in
  `apps/admin-api/src/lib/errors-actions.ts`).
- Quota: YouTube's daily API quota is 10,000 units per Google project. Lists cost 1
  unit; `captions.list` costs 50 and `captions.download` 200. When the quota runs out
  (`quotaExceeded`), the caption step waits for the reset at midnight Pacific
  (`waiting_quota`). The listing of a large channel costs about 2 units per 50 videos.
- A revoked or expired Google grant stops the import's YouTube reads
  (`youtube_not_connected`). The creator connects again, and the same YouTube channel
  continues the same import.
- The hourly cron (`sweepYoutubeImports`) does four things:
  - deletes consents not completed in 15 minutes;
  - ends imports nobody touched for 14 days, revoking their token;
  - queues the close of running imports;
  - empties the YouTube snapshot of imports over for 30 days and deletes their staged
    captions. Only the YouTube id → video mapping stays: it stops a second import of the
    same video and feeds the link-back file.

## Privacy and security

- The refresh token is stored AES-GCM encrypted, with a key derived (HKDF) from the
  Google client secret and the import id as associated data. It is revoked at Google
  when the import finishes, is cancelled, expires or the account is erased.
- The OAuth `state` is random, single use and expires in 15 minutes. The PKCE verifier
  never leaves the server. Google's code is exchanged only by `oauth/finish`, for the
  signed-in user who started the consent.
- Every action on an import (and each item's upload) checks again that the creator may
  still upload to the channel, so a channel role that was taken away stops the import.
- Each item's upload is claimed by the item (the upload claim of `lib/uploads/initiateOnce.ts`,
  keyed on import and item). Two parallel initiates make one video.
- Thumbnails are fetched only from `i.ytimg.com` / `i9.ytimg.com`, at most 6 MB, and only
  as JPEG, PNG or WebP.
- Account erasure (`eraseYoutubeImports`, in both erasure paths) deletes the imports,
  snapshots, consents and staged captions. The imported videos go with the rest of the
  account's content.

## Admin settings

The videos admin's **Move from YouTube** settings: a switch and the Google OAuth Web
client id.
- API: admin-api `GET|PUT /api/youtube-import/settings`. It needs `media:manage` and is
  audited in `site_settings_log` under the key `youtube-import:settings`.
- Storage: api-videos `global_settings` `youtube-import/settings.json`.
- The client secret is the Secrets Store entry `google-oauth-client-secret`
  (`-qa`, `-stage`), binding `GOOGLE_OAUTH_CLIENT_SECRET`. It is never sent or shown; the
  view says only whether it is present. A value of `unset` counts as missing: the
  entries are created with it, and the owner pastes Google's secret over it.
- Creators can connect only when the switch is on, the client id is set and the secret
  is present.

Google Cloud setup (owner):
1. Create an OAuth client of type **Web application** and enable the YouTube Data API v3.
2. Add the redirect URI for each environment: `https://<videos API host>/api/youtube-import/oauth/callback`.
   The admin page shows the exact one.
3. The consent screen asks for `youtube.readonly` and `youtube.force-ssl`. Both are
   sensitive scopes, so Google verifies the app before it opens to every user. Until
   then, up to 100 test users can connect.

## Cost

- One queue (`al-ummah-now-yt-import*`) and four small D1 tables. Messages are about
  (videos ÷ 50) × 2 for the listing plus about 3 per imported video. That is well inside
  the Workers paid plan's included queue operations at the expected volume.
- Captions and thumbnails are stored like any upload.
- The YouTube API is free within the quota.
- The video storage and encoding are those of a normal upload.

## Tests

- Unit tests: `apps/api-videos/test/youtube-import.spec.ts` (with a stubbed Google) and
  `apps/admin-api/test/youtube-import.test.ts`.
- Local stack: a fake Google (`scripts/local-stack/fake-google.ts`, see
  `docs/testing/LOCAL-STACK.md`). Its fixture channel has a public video with ar + en
  captions and a custom thumbnail, an unlisted made-for-kids video, a private video
  scheduled 30 days ahead, and a playlist of the first two.
