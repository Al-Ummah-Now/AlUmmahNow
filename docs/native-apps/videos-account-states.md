# Videos account states (for web and native clients)

api-videos can refuse a signed-in user's requests because of what an admin
did to their **videos** account. Their Al Ummah Now (Auth) account is never
touched: sign-in keeps working, and so do other apps.

Every refusal is `403` with a JSON body clients switch on by `code`. The
schema is `AccountStateError` in the public contract (`/api/v1/openapi.json`,
`apps/api-videos/openapi/v1.json`). The codes are exported from
`@al-ummah/shared-types` (`VIDEOS_BANNED_CODE`,
`VIDEOS_ACCOUNT_PENDING_DELETION_CODE`).

| `code` | Meaning | Reads | Writes | Ends when |
| --- | --- | --- | --- | --- |
| `videos_banned` | An admin banned the user on videos | Allowed (like a visitor) | Refused | An admin unbans them |
| `videos_account_pending_deletion` | An admin ran "Delete videos data". The profile, channels and videos are hidden and restorable for 30 days | Allowed (like a visitor) | Refused | An admin restores it (lifted at once), or the cleanup erases the data. After that the user starts with a new, empty profile |

A ban wins: a banned user with a pending deletion gets `videos_banned`.

## `videos_account_pending_deletion` (#701)

```json
{
  "success": false,
  "code": "videos_account_pending_deletion",
  "error": "Your videos account is scheduled for deletion. Contact support.",
  "deletion": { "deletedAt": "2026-11-11T10:00:00.000Z", "purgeAfter": "2026-12-11T10:00:00.000Z" }
}
```

### Refused

- Every `POST`, `PUT`, `PATCH` and `DELETE` under `/api/`. This covers:
  - uploads: initiate, batch initiate, TUS create, `PATCH` and complete, failed-upload retry
  - comments, likes and subscriptions
  - channel create and edit
  - video, playlist and community-post edits
  - Studio bulk actions
  - watch history and watch-later
  - profile create and edit
- `GET /api/profile`. Show the account state, never the "create your profile" flow.
- `GET /api/videos/upload/resume/:videoId`. Resuming an upload hands out upload credentials.

### Still allowed

- Every other `GET`, `HEAD` and `OPTIONS` request.
- `/api/privacy/*`: export or erase one's own data.
- The playback signals a visitor also sends:
  - `POST /api/videos/:id/view`
  - `POST /api/videos/:id/watch-time`
  - `POST /api/videos/:id/retention`
  - `POST /api/analytics/events`
- `PUT` and `DELETE /api/devices/:installId`. This is push registration, part of signing in.

`GET /api/me/creator` answers `canUpload: false`, `canCreateChannel: false`
and `pendingDeletion: true`. Hide Upload and Create channel.

### What clients should show

Show one clear account-state screen or banner with the localized message,
never one error per failed action and never a system alert:

| | Text |
| --- | --- |
| en | Your videos account is scheduled for deletion. Contact support. |
| ar | حسابك في الفيديوهات مجدول للحذف. تواصل مع الدعم. |

The web app shows `VideosPendingDeletionNotice`
(`apps/web/src/components/VideosNotices`). ProfileGuard shows it above every
page and in place of the create-profile form, and the upload page shows it in
place of the uploader. The strings are `profile.videosPendingDeletionTitle`,
`profile.videosPendingDeletionBody` and `creator.accountPendingDeletion` in
`@al-ummah/shared-types` i18n.

Native clients: on this code from any call, stop retrying it. Pause queued
or resumable uploads instead of failing them, and show the account-state
screen. Read `GET /api/profile` again when the app comes to the foreground.
When it answers `200`, the account was restored. When it answers `404`, the
data was erased: offer to create a new profile.

### Timing

The block applies as soon as the admin's deletion is recorded. Other API
isolates may take up to 15 seconds to see it, because they cache "not
pending" answers briefly. A restore is never cached, so it applies at once
everywhere.
