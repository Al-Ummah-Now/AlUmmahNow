# GDPR compliance: data inventory, legal basis, retention, data subject rights

Status: implemented in Story 1.3 (`docs/stories/1-3-gdpr-compliance.md`). This page records the
engineering facts a privacy review needs. Items marked **Decision needed** are proposed defaults
that product/legal should confirm.

## 1. Who holds what

| System | What it stores | Controller-side owner |
|---|---|---|
| AlUmmahNowAuth (separate service) | Sign-in account: email, password hash, sessions, multi-account links | Auth service. Not part of this repo. Managed at the account app (`profile.auth.<env>.alummahnow.net`) |
| api-videos (R2) | Profiles, channels, videos, comments, reactions, subscriptions, watch history, community content, playlists, templates, reports | This repo |
| processor (R2 + D1) | Pseudonymised event archive (`al-ummah-now-messages`, §3), aggregated rollups, D1 moderation reports, archive pseudonym secrets (`archive_subjects`) | This repo |
| websocket-server (Durable Object, memory only) | Presence: the open sockets of a signed-in user; gone when the socket closes | This repo |
| Browser (web app) | Preferences, consent cookie, encrypted on-device watch progress | This repo |
| Bunny.net | Video files, thumbnails, avatars, community images | Processor (sub-processor) |
| Cloudflare | Hosting, Workers logs, Turnstile bot checks (§3) | Processor (sub-processor) |

## 2. Server-side data inventory (api-videos R2)

| Bucket / key | Personal data | Legal basis (Art. 6) | Retention |
|---|---|---|---|
| `profiles/{userId}` | Name, email copy, avatar/cover URLs, `subscribedTo[]`, legacy `watchHistory[]` (max 1000), `privacyConsent` (consent audit trail, last 50 decisions) | Contract (b): providing the account | Until erasure request or account closure |
| `channels/{channelId}` | Channel profile owned by `userId`, email copy, `subscriptions[]` entries naming subscriber user ids | Contract (b) | Until erasure / channel deletion |
| `channel_sections/{channelId}/...`, `channel_tabs/channel-tabs/{channelId}` | Channel layout | Contract (b) | With the channel |
| `videos/{videoId}` | Owner `userId`; embedded `comments[]`, `likes[]`, `dislikes[]` with user ids and comment text | Contract (b) | Until erasure / video deletion |
| `watch_history/{userId}:{videoId}` | What a user watched, when, how far | Contract (b): history and resume feature, user-controlled (clear/remove in Watch History) | **18 months after last watched** (enforced daily) |
| `community_posts/posts/...`, `comments/...`, `likes/{postId}/{userId}.json`, `votes/{postId}/{userId}.json`, `comment-likes/...` | Posts, comments, likes, poll votes | Contract (b) | Until erasure / content deletion |
| `playlists/{playlistId}` | Owner `userId` | Contract (b) | Until erasure |
| `upload-defaults/{userId}/...` | Upload templates | Contract (b) | Until erasure |
| `reports/report:{entityId}:{reportId}:{reporterId}` | Who reported what | Legitimate interest (f): platform safety and moderation history | Kept; reporter identity removed on erasure |
| D1 notifications DB `notification_settings`, `notification_email_prefs`, `notification_seen` | Category switches, email preferences, when the user last opened the notification menu (the bell's badge) | Contract (b) | Until erasure; exported (`notificationState`) and erased with the account |
| KV `RATE_LIMIT_KV` `rate_limit:{op}:{userId}` | Counters | Legitimate interest (f): abuse prevention | ~25 h TTL |
| KV `TUS_SESSIONS` | Upload session to user mapping | Contract (b) | 1 h TTL |

### Special-category data (Art. 9)

On a religious-content platform, viewing history and subscriptions can reveal religious or
philosophical beliefs. This drives three design choices: watch history has a bounded
retention period, on-device watch progress is encrypted, and analytics/experiments need
explicit opt-in consent. **Decision needed:** legal should confirm whether the account-level
history feature needs explicit Art. 9(2)(a) consent at sign-up, beyond the contract basis
used today.

## 3. Event archive, analytics and logs

| Data | Personal data | Legal basis | Retention |
|---|---|---|---|
| Processor archive `al-ummah-now-messages/{YYYY-MM-DD}T...` (production: every queue message: views, likes, comments, reports, analytics beacons; QA/stage: client analytics only) | Pseudonyms only (`ps_…`, see below): no raw user id, no free text, no user agent, no email; referrers as host only | Legitimate interest (f): abuse investigation, statistics, replay | **13 months** (enforced daily by the api-videos cron); unlinkable from the person at once on erasure |
| Aggregated rollups `analytics/rollups/...` | None (counts per video/channel/month) | n/a | Kept |
| A/B experiment events, web vitals, player QoS (`/api/analytics/ab-test`, `/api/analytics/performance`) | Pseudonymous ids, user agent, page path | **Consent (a)** | Archive retention (13 months) |
| Retention buckets and traffic sources (`analytics_daily` counters `retention_start`, `retention`, `traffic`, `external_host`) | None once rolled up: counts and hostnames. The queue message carries a random per-playback id, held only in the archive above | **Consent (a)**: sent only with analytics consent. Without it a view counts as `unknown` | Kept as aggregates; archive retention for the message |
| Anonymous view count (`/api/analytics/video` "ready" event) | None (video id only) | Legitimate interest (f): public view counters | n/a |
| D1 `reports` (`reporter_id`) | Reporter id | Legitimate interest (f) | Kept; reporter anonymised on erasure |
| Cloudflare Workers logs (observability) | User ids and paths in structured logs | Legitimate interest (f): operations, security | Cloudflare plan default (3-7 days). **Decision needed:** confirm the plan's log retention and add it to the privacy notice |
| Security event logs (`/api/security/events`, `/api/security/csp-report`) | Path (no query), event type | Legitimate interest (f): security | Same as Workers logs |
| Cloudflare Turnstile bot check (sign-up, password reset / email code, sign-in after 3 failed attempts, Contact us, reports, an account's first comment or post; `docs/features/bot-protection.md`) | Cloudflare processes the visitor's IP address and browser signals to issue a one-time token; we send that token and the client IP to Cloudflare's `siteverify` and store neither. No cookie is set for this by us; Turnstile does not use the data for ads | Legitimate interest (f): preventing spam, fake accounts and credential abuse | Nothing kept by us. Cloudflare's own handling: Turnstile privacy addendum (cloudflare.com/turnstile-privacy-policy) |
| "Passed the check" marker (api-videos KV `HUMAN_VERIFIED`, key `h:<user id>`) | Account id only | Legitimate interest (f): ask a person only once | **180 days** (KV expiry). It holds nothing but the id and expires on its own, so erasure does not need to touch it |
| Abuse counters (Analytics Engine `al_ummah_now_abuse[_stage|_qa]`) | None: app, endpoint, outcome, environment counts | n/a | Analytics Engine retention (3 months) |
| Rate-limit counters (Workers Rate Limiting) | User id or IP as a counter key, in Cloudflare memory only | Legitimate interest (f): abuse prevention | 60 seconds |

**How the archive is pseudonymised (#1177).** The processor scrubs every message before it
writes it (`@al-ummah/shared-types` `archive-privacy.ts`, processor `lib/archive-record.ts`).
The same rules apply to the copies it keeps under `channel-sections/` and `channel-tabs/`.

- **User ids become pseudonyms.** This covers person-id fields (`userId`, `viewerId`,
  `reporterId`, `actor.userId`, `videoOwnerId`, …) and any `usr_…` value anywhere. The pseudonym
  is `ps_` plus HMAC-SHA-256 of the id under a random 256-bit secret kept for that person. The
  secrets live in processor D1 `archive_subjects` (notifications DB), keyed by SHA-256 of the id,
  so that table holds no raw id either.
- **Free text, contact and device details are dropped.** This covers report descriptions,
  comment, post and message text, notes, search queries, names, emails, phone numbers, IP
  addresses and user agents. An email inside any other string becomes `[email]`.
- **Links are trimmed.** Referrers keep only their host; URLs and paths lose their query and
  fragment.
- **Each archived object is stamped** `privacy: pseudonymised-v1`, in its body and in its R2
  custom metadata.

**Erasure.** The `UserDataErased` step clears the person's secret and stamps `erased_at`. From
then on their archived pseudonyms cannot be tied back to them by anyone, including us. Any later
message about the account archives `deleted-user` instead of a new pseudonym. Erasure messages
(`UserDataErased`, `ContactDataErase`) are archived with `deleted-user` in place of the id they
erase. The 13-month retention period still removes the entries themselves.

**Titles (#1254).** The archive keeps public titles and channel names (`title`, `videoTitle`,
`streamTitle`, `channelName_<lang>`, …). An erased creator's become placeholders:
- Each titled entry is indexed under its owners (owner/creator/author/actor/recipient keys and the
  payload's own `userId`, never viewers) in notifications D1 `archive_title_refs`: the owner's
  `archive_subjects` hash and the R2 key, no raw id. Rows expire with the archive (400 days).
- `UserDataErased` queues `ArchiveTitlesErase` (payload: the subject hash). Each delivery rewrites
  50 entries with `erased video` / `erased channel` / `erased playlist` and deletes their rows.
- An owner erased before a message arrives gets the placeholders at write time.
- Entries from before the index: `archive-privacy-rewrite.ts start --titles` links each titled
  entry to the current owner of the content it names, or writes placeholders when the content is gone.

**Admin history (#1253).** `admin_deletions` and `admin_jobs` (search D1) are kept **2 years**
(processor daily cron). Erasure keeps the records and scrubs the account: its content's titles
become `erased <kind>`, its account row's title `erased user`, and every id naming it
(owner, deleted by, purge requested by, job actor, finished-job target, params, result)
`deleted-user`. Jobs list the accounts they name in `admin_job_users`, so the erasure never scans.

**Dead letters and late writes (#1255).** Processor `dead_letters` keep hashed user ids
(`uh_` + SHA-256) in the body and failure reason and expire after 30 days; hashed rows cannot be
replayed. Erasure steps keep the raw id so a failed erasure can still finish. The erasure writes a
30-day tombstone (reports D1 `erased_users`, SHA-256 of the id): error reports that arrive later are
stored as `deleted-user` without identifying extra keys.

**Entries written before pseudonymisation** were rewritten once by api-videos
`lib/archivePrivacyRewrite.ts` (`scripts/release/archive-privacy-rewrite.ts`: dry run, then
apply; QA, then stage, then production).
- Their ids became pseudonyms under a key that existed only for that run and was deleted when
  the run finished. Those entries are consistent among themselves but lead to nobody.
- Free text was dropped by the same rules.
- The per-person tab metric copies (`analytics/tabs/user-behavior/<userId>/…`) were deleted.

The local E2E leftover check stays strict on the archive. A run's ids found there would mean
the pseudonymisation broke.

## 4. Browser storage

All keys are listed in `apps/web/src/lib/privacy/local-data.ts` (`LOCAL_DATA_INVENTORY`).

| Key | Class | Purpose | Retention | Protection |
|---|---|---|---|---|
| `aun_consent` cookie | Strictly necessary | Records the consent choice (`v1.a?.e?.p?.<ts>`) | 6 months, then the banner asks again | First-party, SameSite=Lax, Secure on https |
| `aun.enc.watchProgress` | Personal | Resume playback for signed-out viewers | 90 days, max 50 videos, no user id | **AES-GCM-256 encrypted** |
| `video_views_tracked` | Personal | Avoid double-counting a view | 30 minutes (pruned on every load) | Minimised: video ids and timestamps only |
| `al-ummah-active-channel*` | Session | Active channel | Until sign-out | Not sensitive |
| `al-ummah-ab-assignments` | Tracking | Stable A/B variants | Only with experiments consent; purged on withdrawal | |
| `darkmode`, `preferred-language`, `videoPlayerVolume`, `video-player-playback-rate`, `subtitle-settings`, `last-subtitle-track` | Preference | UI preferences | Until cleared | Not personal |
| `pendingVideoAnalytics` (legacy) | Tracking | No longer written. It was an unbounded backup of analytics events that was never sent | Purged on every load | |

### Encryption design (AC 1)

`apps/web/src/lib/crypto.ts` and `apps/web/src/lib/storage/EncryptedStorage.ts`:

- Each browser gets a **non-extractable AES-GCM-256 CryptoKey**, generated with WebCrypto and
  stored in IndexedDB (`aun-secure-store`). IndexedDB stores the key object, not its bytes, and
  the bytes can never be exported.
- **No secret ships in the bundle.** The previous design relied on `NEXT_PUBLIC_ENCRYPTION_SECRET`,
  which is public by definition. It was also unset in builds and used a random salt per page
  load, so data could not be decrypted after a reload.
- A random 96-bit IV is used per write. The storage key is bound as associated data, so
  ciphertexts cannot be swapped between keys. GCM authentication replaces the separate HMAC
  from the plan.
- Every value has an expiry. The sweep removes expired values without decrypting them.
  Deleting the key ("Clear data on this device", or erasure) makes every value unreadable
  (crypto-shredding).
- If WebCrypto or IndexedDB is unavailable, values are kept in memory only. They are never
  written to disk in plaintext.
- Threat model: this protects data at rest (disk or profile copies, backups, other local
  software). It does not protect against script running on our origin. The Story 1.2 CSP and
  listener validation cover that.

## 5. Consent (AC 3, 4)

- Banner: `apps/web/src/components/consent/ConsentBanner` (LTR) and `ConsentBanner/rtl` (RTL),
  in English and Arabic. It appears until the user decides. "Accept all" and "Reject all" have
  equal weight and are one click each. "Customize" offers per-category switches, all off by
  default.
- Categories: `analytics` (video engagement analytics), `experiments` (A/B tests),
  `performance` (web vitals, player QoS). Strictly necessary storage is listed but cannot be
  turned off.
- **Default deny** is enforced in two places:
  - Client: `VideoAnalytics.addEvent`, `ExperimentAnalytics.trackEvent`,
    `ABTestingEngine.assignVariant/persistAssignments`, `WebVitalsMonitor.handleMetric` and
    `VideoPerformanceMonitor.sendMetrics` all check `hasConsent()`.
  - Server: `forwardClientEvents` (`/api/analytics/ab-test`, `/api/analytics/performance`) reads
    the `aun_consent` cookie and drops beacons without consent (202, `reason: no-consent`).
- Withdrawal (Settings > Privacy & data) takes effect immediately. Data collected under the
  withdrawn category is removed from the device. Queued analytics events are reduced to
  anonymous view counts.
- Audit trail: signed-in users' decisions are recorded server-side in `PUT /api/privacy/consent`
  (profile `privacyConsent.current` plus the last 50 decisions in `history`).
- Third-party trackers: the CSP no longer allows `static.cloudflareinsights.com`. **Decision
  needed:** keep Cloudflare Web Analytics disabled for the zone, or load it only after
  `analytics` consent.

## 6. Data subject rights (AC 2)

UI: `/{en|ar}/settings/privacy` (`apps/web/src/components/privacySettings`, LTR and RTL).

| Right | How |
|---|---|
| Access / portability (Art. 15, 20) | **Download my data**. Calls `GET /api/privacy/export`, which returns JSON with profile, consent record, channels (+ sections, tabs), owned video metadata (other people's comments reduced to counts), the user's video comments and reactions, subscriptions, watch history (new and legacy), community posts/comments/likes/poll votes, playlists, upload templates and reports filed. Large accounts are exported in passes (`complete:false` + `resumeToken`, `?resume=`). The client merges the passes into one file. |
| Erasure (Art. 17) | **Delete my data** (type the confirmation word). Calls `DELETE /api/privacy/data` with `{"confirm":"DELETE"}`. **Deleted:** profile, owned channels with their sections and tabs, owned videos with their subtitles and Bunny Stream media, posts of owned channels with their comment/like/vote trees, watch history, upload templates, playlists, the user's subscriptions on other channels, likes/dislikes, post likes, poll votes, comment likes. **Anonymised** (tombstone `deleted-user`, content emptied, thread kept): the user's comments in other people's threads, and reports they filed (R2, plus D1 via the `UserDataErased` queue message handled by the processor). **Made unlinkable:** the person's entries in the event archive (§3): the processor deletes their pseudonym secret. The operation is idempotent and resumable (`resumeToken`). The client repeats it until `complete:true`, then clears this device's data. |
| Sign-in account | Linked from the same page (**Open account settings**, `AUTH_PROFILE_URL` or derived from the issuer). **Decision needed:** the auth service has no self-service account deletion yet (only admin `deleteUser`). Add it there, or define a support process with a 30-day SLA. |
| Rectification (Art. 16) | Existing profile, channel and content edit screens. |
| Restriction / objection (Art. 18, 21) | Consent withdrawal, watch-history clear/remove, comment and post deletion. |

Each request is bounded by an operation budget (`PRIVACY_OP_BUDGET`, default 900 R2
operations, under the Workers subrequest limit). Export scans R2 list pages of 100 objects.
Interrupted pages are redone on resume. Export rolls back partial pages, so merged exports
contain no duplicates.

Erasure finds the user's records through indexes, so its cost follows the user, not the
environment (#1073):

| Data | Found through |
|---|---|
| Owned channels, owned videos (trashed included, and members' uploads on owned channels) | D1 `content_ownership` |
| Sections, tabs, posts of owned channels, watch history, upload templates, subtitles | key prefixes |
| Reactions and comments on other videos, legacy subscriptions on other channels, posts written on other channels, comments/likes/votes/comment likes on other posts, playlists, reports and report claims | D1 `privacy_footprints` (`apps/api-videos/src/lib/privacy/footprints.ts`) |
| Live stream records | `livestream:` prefix listing (no owner index) |

Every api-videos write to those buckets records who it names in `privacy_footprints`. A
one-time backfill pass per bucket records older data (`POST /internal/privacy/footprints/backfill`,
dry run by default). A bucket's footprints are trusted only after a complete pass and while no
footprint write has failed since. Until then that bucket is scanned as before, so nothing is
skipped. The erased user's footprint rows are deleted with the profile.

Known follow-ups:
- Cached post like counters and poll results are recomputed the next time someone likes or votes on that post.
- Avatars, covers and community images on Bunny Storage are not deleted yet. The URLs disappear with the profile and posts.
- Scheduled-publish entries for deleted videos are left for the scheduler, which skips missing videos.

## 7. Retention enforcement (AC 5)

- Server: api-videos runs a cron trigger (`17 3 * * *`, in `wrangler.jsonc` and
  `wrangler.qa.jsonc`) that calls `enforceRetention()` (`apps/api-videos/src/lib/privacy/retention.ts`).
  - Watch history: entries whose R2 `uploaded` time (rewritten on every progress update) is
    older than `WATCH_HISTORY_RETENTION_DAYS = 548` are deleted.
  - Event archive: keys sort chronologically, so the sweep deletes from the oldest key and stops
    at the first key inside `EVENT_ARCHIVE_RETENTION_DAYS = 395`. Rollups are kept.
  - Each run is budgeted. Leftovers are handled by the next day's run.
  - Recommended hardening: also add an R2 lifecycle rule on `al-ummah-now-messages(-qa)` to
    expire objects after 395 days (`wrangler r2 bucket lifecycle add`), as a backstop to the cron.
- Browser: `enforceLocalRetention()` runs on every page load (SecurityBootstrap). It removes
  expired encrypted values, legacy tracking keys, unconsented experiment data and stale view
  markers.

**Decision needed (proposed defaults):** watch history 18 months, event archive 13 months
(CNIL guidance for audience measurement), consent 6 months, on-device watch progress 90 days.

## 8. Audit checklist (AC 6)

- [x] Data inventory and legal bases documented (this page)
- [x] Encryption of sensitive client-side data, with no shipped secret
- [x] Consent banner with default deny, granular choices, withdrawal, audit trail, and server-side enforcement
- [x] Access/export and erasure endpoints and UI, covered by unit tests
- [x] Retention periods defined and enforced
- [ ] Privacy notice / cookie policy page with the final wording (product/legal)
- [ ] DPIA (Art. 35) for viewing-history processing (legal)
- [ ] Records of processing (Art. 30) and sub-processor DPAs (Cloudflare, Bunny.net) (legal)
- [ ] Third-party GDPR audit (scheduled by legal)
