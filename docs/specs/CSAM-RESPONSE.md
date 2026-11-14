# CSAM response (platform side)

Owner brief: 2026-11-14. Decisions on 2026-11-14:
- Retention: at least 365 days after the report. It is configurable longer, never shorter. A legal hold never expires.
- Intake: the admin pastes the alert, and a signed webhook for Cloudflare "Trust and Safety Blocks" also feeds it. Unknown payloads only flag the admin.

Cloudflare's **CSAM Scanning Tool** is on for `alummahnow.net` and `alummahnow.org`. It hashes images served through those zones. On a match it blocks the URL and emails the matched file paths, once a day. **It does not report to NCMEC.** Under 18 U.S.C. § 2258A we must report to the NCMEC CyberTipline and preserve what we reported.

This spec covers what the platform does from the match to the report.

| Part | Where | What |
|---|---|---|
| Intake | admin-api `/api/csam/*`, admin-web `/moderation/csam` | paste or webhook, then a case; super admins only |
| Mapping | api-videos `lib/csam/resolve.ts` | URL → item and uploader |
| Takedown | api-videos `lib/csam/contain.ts`, job `csam.contain` | hide at once, keep encrypted evidence, purge every copy, ban the uploader |
| Evidence | api-videos `lib/csam/evidence.ts`, bucket `al-ummah-now-csam-evidence[-qa\|-stage]` | encrypted, access-restricted, legal hold |
| Freeze | admin-api, Auth moderation requests | revoke sessions and suspend the Auth account |
| Report | admin-web case page | CyberTipline checklist, pre-filled facts, "Reported" with the report ID |
| Audit | admin-api `csam_access_log` | every view, download, mapping, hold and report |

## 1. Who can see it

Only **super admins** (`isSuperAdmin`, shared `roles.ts`) can see the CSAM pages, the cases, the evidence and the access log. No permission, role or channel role grants it, and that includes `users:manage` and `content:delete`.

- admin-api checks super admin on every `/api/csam/*` route. Evidence downloads, legal-hold changes, the retention setting and evidence deletion are also step-up routes (`STEP_UP_ROUTES`).
- api-videos `/internal/csam/*` sits behind the internal API key. Only admin-api calls it, after its own checks.
- The admin jobs list hides the parameters of `csam.contain` jobs from anyone who is not a super admin, and only a super admin can retry one.

## 2. Intake

**Paste.** The super admin pastes the email, a list of paths or URLs, or one URL at `/moderation/csam`. `extractCsamUrls` (shared-types `csam.ts`) pulls out up to 200 of our URLs.

**Webhook.** `POST /webhooks/cloudflare/notifications` on admin-api, which is public. The request must carry `cf-webhook-auth`, and its value must match `CF_NOTIFICATIONS_WEBHOOK_SECRET` (a constant-time compare). Anything else gets a 401.
- A payload that names one of our URLs opens cases exactly as a paste does.
- Any other payload, of an unknown type or carrying no URL, opens no case. It only flags the admin (Errors page, `csam-webhook:<hash>`) with the payload's alert type and size, never its body.

Each URL becomes one **case**. A URL that already has an open case is attached to that case and starts nothing new. The case id is a random UUID.

## 3. Mapping a URL to an item

`parseCsamUrl` reads the URL. `resolveCsamUrl` then looks up the rest:

| URL | Item | Uploader |
|---|---|---|
| `media[.qa\|.stage].alummahnow.*/pub/<video>/<rev>/<file>`, `/priv/<token>/<video>/…` | the video (`video`, or `video_thumbnail` for `thumb*.jpg`) | video `userId` |
| `vz-*.b-cdn.net/<video>/…` (Bunny Stream) | the video | video `userId` |
| `images.alummahnow.*/thumbnails/<video>/…` | the video's custom thumbnail | video `userId` |
| `images.alummahnow.*/community-posts/<channel>/<file>` | the post that shows it (the channel's posts are scanned) | post `userId`, else the image index |
| `images.alummahnow.*/<id>_avatar.<ext>`, `_cover` | an avatar or cover, found in `image_owners` | whoever uploaded it |
| site pages `/video/<id>`, `/shorts/<id>`, `/embed/v/<id>`, `/channels/<id>?post=<id>` | the video or post | as above |

Optimizer URLs (`/_next/image?url=…`, `/cdn-cgi/image/<opts>/…`) are unwrapped first. An encoded slash or dot segment makes a URL unmappable.

**The image index.** `image_owners` lives in SEARCH_DB (migration 0034). Avatar and cover paths carry only a random id, so every upload records who uploaded the image: profile and channel avatars and covers, post images, GIFs and link-preview copies.
- The `images.index-owners` job fills the index from the images already stored.
- Account erasure deletes the account's rows.
- A takedown deletes the row of each image it deletes.

**Unmapped.** If a URL cannot be mapped (a channel page, an image nobody indexed), the case opens as `unmapped`. Nothing is taken down until a super admin maps it by hand: a video id, a channel and post, or a profile or channel image field. The hand mapping is checked against the stores.

## 4. Takedown and evidence

**At once** (`hideNow`, inside the intake request):
- A video gets the `csam` hold. Every API surface stops serving it at once, and its media starts moving to the private bucket.
- A post is set to status `deleted` and leaves its channel's index.
- An avatar or cover field is cleared.

Every touched record keeps a `csamTakedown` mark (case id, time, the removed URL). Nothing is deleted at this point. The matched URL and the image URL are purged from the Cloudflare cache.

**Job `csam.contain`** (admin-jobs queue, resumable phases, retry with backoff, DLQ):

| Phase | Does |
|---|---|
| `plan` | Seals snapshots of the records (video, post, channel, the uploader's profile) and lists the files to keep. |
| `copy-public` | Copies the files viewers could fetch, encrypted: the matched file, the R2 thumbnail, the custom thumbnail, the post's images. |
| `purge-public` | Deletes every R2 rendition (both buckets) and every image file of the item. Purges the Cloudflare cache (prefix and URLs), and Bunny's edge when `BUNNY_API_KEY` is set. Removes the index rows. |
| `copy-source` | Copies the original upload (from our kept original, else Bunny's best file), encrypted, up to 96 MiB per delivery. |
| `purge` | Deletes the video record, its side records, the original, the Bunny Stream video and its notifications. A post is deleted for good. |
| `ban` | Bans the uploader on videos (`videos_bans` and the holds job) and writes the final manifest. |

The order guarantees that nothing is destroyed before it is kept. The public copies go first, so the window during which a stray public URL still answers stays short. A takedown never goes through `admin_deletions`, so no admin can restore it. Nothing lifts the `csam` hold.

The job's last failed attempt flags the admin on the Errors page:
- key `csam-contain:<caseId>`;
- Retry runs `POST /internal/csam/retry` (registered in admin-api `SERVICE_RETRIES`);
- a success resolves the flag.

The case page shows the job's phase and result.

**Evidence store.** The bucket is `al-ummah-now-csam-evidence[-qa|-stage]`, bound to api-videos as `CSAM_EVIDENCE`. It is created by `ensure-resources.ts`, never public, and has no lifecycle rule.
- Each file is `cases/<caseId>/<name>.bin`. The file is split into 8 MiB plaintext chunks, and each chunk is sealed with AES-256-GCM: `iv ‖ ciphertext ‖ tag`. The additional data `csam/<case>/<name>/<index>` binds every chunk to its case, file and position.
- Large files go up as R2 multipart uploads, one part per chunk.
- `manifest.bin` is sealed too. It lists every file with its source, size, content type, the SHA-256 of each plaintext chunk, the key version and the copy time, plus the files that could not be found.
- The key is `CSAM_EVIDENCE_KEY` in Secrets Store (`csam-evidence-key[-qa|-stage]`), formatted `<version>:<base64 32 bytes>[,…]`. New evidence uses the highest version. **Rotation adds a version and never removes one**: removing a version makes that evidence unreadable.
- Downloads go through admin-api (super admin, step-up, audited) to `GET /internal/csam/cases/<id>/files/<name>`. Each chunk is decrypted and checked against its hash as it streams, and a tampered chunk stops the download. The response is always `application/octet-stream` as an attachment, with `nosniff`, `no-store` and a sandbox CSP. It is never shown inline.
- **Erasure, backfills and repairs never touch it.** No privacy or erasure module, search or ownership rebuild, thumbnail repair or media sweep names the bucket, and `test/csam.spec.ts` fails if one ever does. The only paths that delete from it are the retention sweep and `DELETE /internal/csam/cases/<id>/evidence`, which admin-api calls only when the sweep allows it.

## 5. Freezing the uploader

At intake, once the case is mapped, admin-api does three things:
1. It bans the uploader on videos. The `csam.contain` job's `ban` phase does the same, idempotently.
2. It files two Auth moderation requests through `authModerationQueue`: `revoke_sessions` and `suspend_account`. Auth's admins approve them, as with every Auth moderation request (docs/admin/AUTH_MODERATION_REQUESTS.md).
3. Until both are approved, the case shows them as pending.

A failed request flags the admin (`csam-freeze:<caseId>`) with a Retry.

## 6. Reporting to NCMEC

The case is flagged on the Errors page as `csam:<caseId>`, "Report to the NCMEC CyberTipline". The case page holds the checklist:

1. **Open the CyberTipline** ([report.cybertip.org/reporting](https://report.cybertip.org/reporting), `NCMEC_CYBERTIPLINE_URL`).
2. **Incident facts**, pre-filled from the record with a copy button on each (`CsamReportFacts`):
   - the matched URL;
   - when it was detected (UTC);
   - the item kind and id, and when it was uploaded;
   - the uploader: account id, email, display name, handle, channel id and name.
   - The platform does not collect IP addresses, so that field says so for the reporter to state.
3. **Files.** The evidence list (names, sizes, types). The reporter attaches the files the form asks for from the downloads (step-up, audited).
4. **Confirm the report.** "Reported" asks for the CyberTipline report ID and the time it was sent. This sets the case to `reported`, starts the retention clock and resolves the `csam:<caseId>` flag.

## 7. Retention and legal hold

- The setting is `csam_settings.retention_days`: default 365, accepted range 365–3650 (`validCsamRetentionDays`). Only a super admin can change it, with step-up, and the change is audited.
- A case's evidence may be deleted at `reported_at + retention_days` (`csamRetainUntil`). That never happens before a report, and never while the case is under a **legal hold**, which any super admin can set or lift with a reason (audited).
- A daily sweep in admin-api deletes due evidence through api-videos. It keeps the case row and its access log, marks the case `closed`, and records the deletion in the log.

## 8. Audit

`csam_access_log` (REPORTS_DB) records every action on a case: actor, action, case, detail and time. The actions are opening the case, viewing the manifest, downloading a file (by name), mapping by hand, retrying, setting or lifting a hold, reporting and deleting evidence. Settings changes are logged too.
- The log is append-only: no route edits or deletes it.
- Account erasure does not touch it. The actor is a super admin's id, kept for the record of access.
- The case page shows the log.

## 9. Cloudflare dashboard steps (owner)

Webhook destination (once per account):
1. Cloudflare dashboard → **Manage Account → Notifications → Destinations**.
2. **Webhooks → Create**.
3. **Name**: `Al Ummah Now CSAM intake`. **URL**: `https://admin.api.alummahnow.net/webhooks/cloudflare/notifications`.
4. **Secret**: paste the value stored as admin-api's `CF_NOTIFICATIONS_WEBHOOK_SECRET`. Cloudflare sends it in the `cf-webhook-auth` header.
5. **Save and Test**. The test payload has no URL, so it shows up as a flag on the Errors page ("Cloudflare notification without a match"). That is the signal that the webhook works. Dismiss it.

Notification (once per account):
1. **Notifications → All Notifications → Add**.
2. Pick **Trust and Safety Blocks** (alert type "New Blocks"), with no zone filter so both zones are covered.
3. Under **Webhooks**, choose `Al Ummah Now CSAM intake`. Keep the email so the daily CSAM email still arrives.
4. **Save**.

Cloudflare documents no CSAM-specific notification type. The daily email remains the record of every match, so paste it whenever a block arrives that the webhook did not open as a case.

## 10. Tests

Tests use **synthetic placeholders only**: short ASCII strings and zero-filled bytes, never a real image, hash or hash list.
- `apps/api-videos/test/csam.spec.ts`:
  - URLs, extraction and retention;
  - encryption (round trip, AAD binding, rotation);
  - mapping and the backfill;
  - a full video takedown (evidence complete, unreadable at rest, decrypted downloads, purged everywhere, banned);
  - tamper detection;
  - takedown without a key (hidden, nothing destroyed, flagged, then Retry);
  - post and avatar takedowns;
  - request validation;
  - the erasure guard.
- admin-api and admin-web carry their own tests for super-admin gating, step-up, audit, webhook signatures, the retention rules and the checklist.
