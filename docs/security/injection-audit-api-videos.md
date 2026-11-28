# Videos API injection audit

The route inventory comes from the Worker's Hono registration table. It includes public, undocumented, internal, webhook, and health routes. The versioned API resolves to the same handlers. Hono also handles HEAD for GET routes, and the two explicit OPTIONS handlers use the same CORS origin policy. The live host is dispatched before Hono. The Worker consumes five queue families and calls Durable Objects in the realtime Worker.

## Findings and regression coverage

| Endpoint or boundary | Input | Risk and control | Status | Test |
| --- | --- | --- | --- | --- |
| Hono route dispatch | Decoded path components | Bound each component and reject separators and controls before deriving R2, cache, or service paths. Reserved video records retain their hidden response. | Fixed | injection-boundaries, internal-key, openapi-contract |
| Selected channel middleware | channelId header | Validate the ID before opening the R2 object. Ownership and delegated role checks determine access. | Fixed | injection-boundaries, channel-roles, upload-limits |
| Video subtitle list, read, download, upload, delete and default | Video ID and language parameters, format query, multipart text | Validate video and language before building object keys or an attachment filename. Format remains an enum. The upload checks supported languages and normalizes subtitle cues. | Fixed | subtitles-visibility, subtitle-download, subtitle-sanitize |
| Direct video upload | Multipart file, title, description, tags and boolean fields | Reject duplicate and mistyped fields before magic-byte validation, storage, or Bunny calls. The server generates the object key. | Fixed | upload-paths-collections, magic-bytes-video |
| TUS create, status, write and terminate | Upload metadata, upload identity, provider Location and stored URL | Use a bounded metadata parser at the tier check and the proxy. Forward file presentation fields to Bunny and derive identity from signed headers. Restrict upload destinations to Bunny's TUS origin and path and refuse redirects. | Fixed | injection-boundaries, tus-resilience, tus-session-write-once, upload-limits |
| HLS ingest on live host | Signed session key, rendition, filename and raw playlists | Validate session and file identifiers before R2 writes. Playlist files reference local segments in the same session. | Fixed | injection-boundaries, live-edge, live-providers |
| Bunny API and video-format backfill | Video and collection IDs, stored master URL, media playlist URI | Encode API path segments. Read from configured CDN hosts or the Bunny CDN namespace. The nested playlist stays on the same origin and under the same video directory. Disable redirects. | Fixed | injection-boundaries, bunny-libraries, media-providers-ingest, video-format-backfill |
| YouTube import finalization | Thumbnail URL returned by YouTube | Match HTTPS and the provider's thumbnail hosts. Refuse alternate ports, credentials, and redirects. | Fixed | youtube-import |
| Provider billing webhook | Provider path, signature headers, timestamp and JSON | Verify HMAC over the exact request body. Check the replay window. Parse authenticated events into bounded fields. | Fixed | billing |
| Auth account events webhook | Content type, signed SET and claims | Cap the body. Validate issuer, audience, type, expiry window, event type, sequence, subject and ID before database writes. | OK | account-events |
| Support webhooks | Vendor and side, signature, timestamp and JSON | Resolve adapters by name, verify the raw request, and validate each event variant. Support test adapters are limited to local and QA. | Fixed | support-adapters, support-jobs |
| Telegram webhook | Secret header and bot update JSON | Verify the configured secret before interpreting updates. | OK | social-connect |
| Federated social connections and publishing | Remote instance, DID discovery, OAuth metadata and API calls | Require public HTTPS destinations and disallow redirects in the social API client. Bluesky OAuth endpoints stay on the verified issuer origin. | Fixed | injection-boundaries, social-connect, social-deliver |
| Admin and run-erase queues | Job ID, run ID and optional timestamp | Parse the envelope before reading a job. The job row selects the handler and the run check rejects stale deliveries. | Fixed | billing, support-jobs, run-user-erase |
| YouTube import queue and internal replay | Kind, import ID, phase, item ID, cursor and playlist index | Parse each message variant before job or replay lookup. | Fixed | queue-validation, youtube-import |
| Auth account-events queue | Kind and SET event ID | Check the event ID before reading it. The stored event selects the action. | Fixed | account-events |
| Processing-check queue | Processing loop, playlist add, upload reaper, Bunny deletion, test-library purge and media move | Validate kind and fields before key creation or database calls. Invalid messages are acknowledged without logging their bodies. | Fixed | queue-validation, processing-loop, upload-reaper, playlist-upload-adds, renditions |
| Processing-check queue | Format, collection, publication date, archive privacy, public MP4, HDR, R2 media, privacy footprints and channel comments backfills | Validate run IDs, cursors, integers, booleans, and job variants. | Fixed | queue-validation, video-format-backfill, archive-privacy-rewrite, published-at, mp4-backfill, hdr-check, media-backfill, studio-comments |
| Inline and admin field translation | Source text, item ID, language and returned translation | Send structured data to the processor binding. Validate response shape and correlate item IDs before storage or response. Return translation as JSON text. | Fixed | queue-validation, caption-translation |
| Request and job logging | Messages derived from request fields and errors | Escape line terminators in log messages. Structured fields use the redactor. Malformed messages log fixed descriptions. | Fixed | injection-boundaries, request-logging |
| D1 search and directory queries | Search text, order, limits and cursor | Bind search terms, page limits and offsets. Escape LIKE wildcards and select ORDER BY fragments from application maps. Build FTS terms before binding. | Fixed | injection-boundaries, like-pattern, search, search-order, admin-content, admin-creators, tier-requests |
| External article, feed, media and link previews | External URL, metadata image and redirects | Public-web fetches check schemes, credentials, ports, and addresses on each hop. The Worker egress supervisor enforces public Internet reachability. | OK | link-preview, import-sources |
| Navigation and test payment pages | Return path, OAuth state and form data | Keep billing and support returns on the configured web origin. OAuth state resolves server-side data. Dynamic text in test checkout pages is escaped. | OK | billing, support-checkout, support-payees, social-connect, youtube-import |
| Realtime Worker bindings | Video/post/stream IDs, viewer heartbeat, shard and QoE | API calls use fixed binding URLs. Counters use loaded IDs and generated shards. Heartbeats check viewer IDs and hash the network identifier. QoE validates the sample and compares its stream ID to the route. | OK | view-counter, post-counters, live-viewers, qoe-live |

Headers pass through Fetch's Headers API. CORS checks the origin. Sign-in is based on bearer claims. The API does not parse cookies as credentials or storage identifiers. TUS, webhook signatures, native attestation, conditional requests and Range are handled by their protocol routes.

D1 query builders use SQL fragments selected from application enums, trusted table names, and generated placeholders. The caller's data goes into bindings. Storage keys include colon and slash namespaces. The route guard protects path components and the reserved video-record guard distinguishes content IDs from internal records. R2 list cursors are opaque.

Public-web lookups power link previews and source imports. On Workers, global fetch passes through Cloudflare's egress supervisor. [Cloudflare Workers security model](https://developers.cloudflare.com/workers/reference/security-model/)

## Text rendering handoff

| Fields | Representation | Renderers |
| --- | --- | --- |
| Video titles and descriptions, localized variants, tags and chapters | Plain text. Translation output is text. | Watch and embed details, search, video cards, playlist rows, Studio, social feeds and SEO metadata. Use text nodes and escape JSON for a script context. |
| Video comments, creator replies and live chat | Plain text with separate author attributes. | Watch/embedded comments, Studio review, live chat and replay. Validate schemes when creating links. |
| Community posts and comments, polls and quizzes | Legacy rich text passes through sanitize-html. Post V2 headings, alt text and link previews are text. Article bodies are Markdown. | PostCard, Comment, PostMarkdown, scholar sites, saved posts and embeds. Sanitize legacy markup at rendering and disable raw HTML in Markdown. |
| Channel, profile and playlist names, descriptions and bios | Text and localized maps. URL fields have separate policies. | Channel headers and About panels in both languages, profile and playlist pages, notifications, cards and metadata. |
| Caption files and translation | Timed text or plain text. Quran markers use the caption parser and official text substitution. | Watch player, transcripts, caption editor, translation views and exports. Use the WebVTT parser or interpolate as text. |
| Site settings, links and embeds | Site-owned text and separate URLs. | Scholar-site navigation, document titles, themes, links and embedded snippets. |

Moderation sends bounded text in typed messages. Caption and translation jobs send structured fields to the processor. Model calls, prompt templates and downstream consumer behavior belong to the processor. At this API's boundary, model results are JSON, text or subtitle data.

## Registered operations

Entries are relative to their mount. A dot represents the mount itself. A listing's query and a mutation's body come from its handler or versioned contract. The audit above identifies the shared credential, path, storage, protocol and response boundaries.

| Mount | Operations |
| --- | --- |
| `/` | `GET .`, `GET /health`, `GET /metrics`, `GET /openapi.json`, `GET /openapi.yaml`, `GET /redocs`, `GET /status`, `GET /test`, `GET /test-error` |
| `/api/*` | `OPTIONS .` |
| `/api/analytics` | `GET .`, `GET /channels/:channelId`, `POST /events`, `GET /metrics`, `GET /summary`, `GET /videos/:videoId`, `GET /videos/:videoId/retention` |
| `/api/app-config` | `GET .`, `POST /update-failure` |
| `/api/apps` | `POST /attestation/android`, `POST /attestation/apple/assert`, `POST /attestation/apple/register`, `POST /attestation/challenge`, `GET /attestation/config` |
| `/api/billing` | `GET /plans` |
| `/api/categories` | `GET .` |
| `/api/channel-invites` | `GET .`, `POST /:id/accept`, `POST /:id/decline` |
| `/api/channels` | `GET,POST .`, `GET /:channelId/events.ics`, `GET /:channelId/quran-translations`, `DELETE,PUT /:channelId/quran-translations/:language`, `GET,POST /:channelId/sections`, `DELETE,GET,PUT /:channelId/sections/:sectionId`, `GET /:channelId/sections/populated`, `PATCH /:channelId/sections/reorder`, `GET /:channelId/support`, `POST /:channelId/support/checkout`, `GET /:channelId/support/payee`, `POST /:channelId/support/payee/onboard` |
| `/api/channels` | `POST /:channelId/support/payee/refresh`, `GET /:channelId/support/quote`, `PUT /:channelId/support/settings`, `GET,PUT /:channelId/translation-settings`, `DELETE,GET,PUT /:id`, `GET /:id/about`, `GET /:id/analytics/top-content`, `GET /:id/audit`, `PUT /:id/avatar`, `GET,POST /:id/blocks`, `DELETE /:id/blocks/:userId`, `GET /:id/comments` |
| `/api/channels` | `POST /:id/comments/bulk`, `GET /:id/comments/summary`, `GET /:id/content`, `GET /:id/content/deleted`, `GET /:id/content/summary`, `PUT /:id/cover`, `GET /:id/deleted-videos`, `POST /:id/invites`, `DELETE /:id/invites/:inviteId`, `GET /:id/live`, `GET /:id/members`, `DELETE,PUT /:id/members/:userId` |
| `/api/channels` | `GET,POST /:id/move-offers`, `GET /:id/move-receivers`, `GET /:id/owner`, `GET /:id/playlists`, `GET /:id/shorts`, `DELETE,POST /:id/subscriptions`, `GET /:id/subscriptions/status`, `GET,PUT /:id/tabs`, `GET /:id/videos`, `GET /access`, `GET /by-handle/:handle`, `GET /handles/:handle/availability` |
| `/api/community` | `GET,POST /channels/:channelId/posts`, `DELETE,GET,PUT /channels/:channelId/posts/:postId`, `GET,POST /channels/:channelId/posts/:postId/comments`, `DELETE,PUT /channels/:channelId/posts/:postId/comments/:commentId`, `DELETE,POST /channels/:channelId/posts/:postId/comments/:commentId/heart`, `DELETE,POST /channels/:channelId/posts/:postId/comments/:commentId/like`, `DELETE,POST /channels/:channelId/posts/:postId/comments/:commentId/pin`, `GET /channels/:channelId/posts/:postId/comments/:commentId/replies`, `DELETE,POST /channels/:channelId/posts/:postId/like`, `GET /channels/:channelId/posts/:postId/results`, `POST /channels/:channelId/posts/:postId/vote`, `POST /media/link-preview` |
| `/api/community` | `POST /media/upload/gif`, `POST /media/upload/images`, `GET /posts/:postId` |
| `/api/continue-watching` | `GET .` |
| `/api/devices` | `GET .`, `DELETE,PUT /:installId`, `GET /webpush-key` |
| `/api/discovery` | `GET /home` |
| `/api/downloads` | `GET /revocations`, `POST /sync` |
| `/api/events` | `GET .` |
| `/api/events.ics` | `GET .` |
| `/api/explore` | `GET .` |
| `/api/hijri` | `GET .` |
| `/api/i18n` | `GET /config`, `GET /metadata`, `POST /sync`, `GET /translations/:locale` |
| `/api/islamic` | `GET /season` |
| `/api/library` | `GET /liked`, `DELETE,GET,POST /notes`, `DELETE,PUT /notes/:id`, `GET /notes/export.md`, `GET,POST /saved-posts`, `DELETE,GET /saved-posts/:postId`, `GET,POST /watch-later`, `DELETE,GET /watch-later/:videoId`, `PUT /watch-later/order` |
| `/api/live-streams` | `GET,POST .`, `DELETE,GET,PATCH /:id`, `GET,POST /:id/chat`, `POST /:id/chat/:messageId/moderate`, `GET /:id/chat/held`, `PATCH /:id/chat/settings`, `POST /:id/end`, `GET /:id/ingest`, `PATCH /:id/premiere`, `POST /:id/qoe`, `DELETE,POST /:id/reminders`, `POST /:id/start` |
| `/api/live-streams` | `GET /:id/state`, `POST /:id/viewers` |
| `/api/me` | `GET /billing`, `POST /billing/checkout`, `GET /billing/checkouts/:id`, `POST /billing/checkouts/:id/abandon`, `GET /billing/payments/:id/receipt`, `POST /billing/portal`, `POST /billing/subscriptions/:id/cancel`, `GET /creator`, `POST /creator/terms`, `GET /features`, `GET /human-check`, `GET /support` |
| `/api/me` | `GET /support/checkouts/:id`, `POST /support/pledges/:id/stop`, `GET /tier`, `GET,POST /tier-requests`, `POST /tier-requests/:id/withdraw` |
| `/api/moderation` | `POST /reports` |
| `/api/move-offers` | `GET .`, `DELETE,GET /:id`, `POST /:id/accept`, `POST /:id/decline` |
| `/api/notifications` | `GET .`, `DELETE /:id`, `GET,PUT /channels/:channelId/bell`, `GET,PUT /quiet-hours`, `POST /read`, `POST /read-all`, `POST /seen`, `GET,PUT /settings`, `POST /unread`, `GET /unread-count` |
| `/api/openapi.json` | `GET .` |
| `/api/playlists` | `GET,POST .`, `DELETE,GET,PATCH /:id`, `GET /:id/items`, `GET /:id/jobs/:jobId`, `POST /:id/jobs/:jobId/retry`, `GET /:id/queue`, `POST /:id/videos`, `DELETE /:id/videos/:videoId`, `POST /:id/videos/bulk`, `PUT /:id/videos/order`, `POST /:id/videos/remove`, `GET,POST /upload-adds` |
| `/api/prayer-times` | `GET .` |
| `/api/privacy` | `GET,PUT /consent`, `DELETE /data`, `GET /export` |
| `/api/profile` | `DELETE,GET,PUT .`, `PUT /avatar`, `PUT /cover`, `GET /handle-availability`, `GET,PUT /intentional`, `GET,PUT /islamic`, `GET,PUT /onboarding`, `GET,PUT /playback`, `PUT /public`, `GET /subscriptions`, `GET /subscriptions/feed` |
| `/api/profile*` | `OPTIONS .` |
| `/api/profiles` | `GET,POST .`, `GET /:id`, `GET,POST /watch-history` |
| `/api/quran` | `GET /credits`, `GET /passage`, `GET /translations` |
| `/api/recommendations` | `GET .` |
| `/api/search` | `GET .`, `GET /suggestions` |
| `/api/shorts` | `GET .` |
| `/api/sitemap` | `GET .`, `GET /:kind` |
| `/api/sites` | `GET /by-channel/:channelId`, `GET /by-host/:host`, `GET /by-host/:host/home`, `GET /by-host/:host/pages/:slug`, `GET,PUT /channel/:channelId`, `GET,POST /channel/:channelId/pages`, `DELETE,GET,PUT /channel/:channelId/pages/:pageId`, `POST /channel/:channelId/pages/:pageId/restore`, `POST /channel/:channelId/preview` |
| `/api/social` | `GET /bluesky/client-metadata.json`, `GET /bluesky/jwks.json`, `GET /channel/:channelId`, `DELETE,PATCH /channel/:channelId/accounts/:accountId`, `POST /channel/:channelId/connect`, `POST /channel/:channelId/connect/confirm`, `GET /channel/:channelId/deliveries`, `POST /channel/:channelId/deliveries/:id/retry`, `GET /channel/:channelId/share-kit/:videoId`, `GET /channel/:channelId/share-kit/:videoId/clip-source`, `GET /channel/:channelId/telegram/:code`, `PUT /channel/:channelId/templates` |
| `/api/social` | `POST /channel/:channelId/webhooks`, `DELETE,PATCH /channel/:channelId/webhooks/:id`, `GET /channel/:channelId/webhooks/:id/deliveries`, `POST /channel/:channelId/webhooks/:id/secret`, `POST /channel/:channelId/webhooks/:id/test`, `GET /feeds/:channelId/:file`, `GET /networks`, `GET /oauth/:network/callback`, `POST /webhooks/telegram` |
| `/api/studio` | `GET,POST /assets`, `DELETE,GET /assets/:assetId`, `GET,PUT /brand-kit` |
| `/api/telemetry` | `POST /batches` |
| `/api/tiers` | `GET /upgrade` |
| `/api/translate` | `POST .`, `GET /usage` |
| `/api/trending` | `GET .` |
| `/api/upload-defaults` | `GET,POST .`, `DELETE,GET,PUT /:id`, `PUT /:id/default` |
| `/api/users` | `GET /by-handle/:handle`, `GET /by-handle/:handle/playlists`, `GET /by-handle/:handle/subscriptions` |
| `/api/videos` | `GET,POST .`, `DELETE,GET,PUT /:id`, `GET /:id/audio`, `GET,PUT /:id/chapters`, `GET,POST /:id/comments`, `DELETE,PUT /:id/comments/:cid`, `POST /:id/comments/:cid/approve`, `DELETE,POST /:id/comments/:cid/dislikes`, `POST /:id/comments/:cid/heart`, `POST /:id/comments/:cid/hold`, `DELETE,POST /:id/comments/:cid/likes`, `POST /:id/comments/:cid/pin` |
| `/api/videos` | `GET /:id/comments/:cid/replies`, `POST /:id/comments/:cid/restore`, `DELETE,POST /:id/dislikes`, `POST /:id/downloads`, `DELETE,POST /:id/likes`, `DELETE /:id/permanent`, `GET /:id/play`, `GET /:id/playback`, `POST /:id/premiere`, `POST /:id/publish-now`, `POST /:id/qoe`, `POST /:id/restore` |
| `/api/videos` | `POST /:id/retention`, `POST /:id/review/appeal`, `POST /:id/review/resubmit`, `DELETE,GET,PATCH,POST /:id/schedule`, `POST /:id/thumbnail`, `GET /:id/upload-status`, `POST /:id/view`, `POST /:id/watch-time`, `GET,POST /:videoId/audio-tracks`, `DELETE,PATCH /:videoId/audio-tracks/:trackId`, `POST /:videoId/audio-tracks/:trackId/complete`, `POST /:videoId/audio-tracks/:trackId/retry` |
| `/api/videos` | `PUT /:videoId/audio-tracks/:trackId/upload`, `POST /:videoId/audio-tracks/detect`, `GET /:videoId/captions/drafts`, `DELETE,GET,PUT /:videoId/captions/drafts/:language`, `GET /:videoId/captions/drafts/:language/download`, `POST /:videoId/captions/drafts/:language/publish`, `POST /:videoId/captions/drafts/:language/transcript`, `GET,POST /:videoId/captions/jobs`, `POST /:videoId/captions/jobs/:jobId/cancel`, `GET /:videoId/captions/minutes`, `POST /:videoId/captions/translations`, `GET /:videoId/recitation` |
| `/api/videos` | `PUT /:videoId/recitation-metadata`, `POST /:videoId/renditions`, `DELETE /:videoId/renditions/:stagingId`, `POST /:videoId/renditions/:stagingId/complete`, `PUT /:videoId/renditions/:stagingId/files/:rung/:file`, `POST /:videoId/review/transcript/claim`, `GET,POST /:videoId/subtitles`, `DELETE,GET /:videoId/subtitles/:language`, `PUT /:videoId/subtitles/:language/default`, `GET /:videoId/subtitles/:language/download`, `GET /:videoId/translated-metadata`, `PATCH /bulk` |
| `/api/videos` | `POST /bulk-delete`, `POST /bulk-purge`, `POST /bulk-restore`, `POST /bulk-schedule`, `POST /bulk-update`, `POST /bulk/undo`, `GET,POST /category-suggestions`, `GET /scheduled`, `GET /search`, `GET /sections/by-category/:category`, `GET /sections/popular`, `GET /sections/recent` |
| `/api/videos` | `GET /sections/recommended`, `GET /sections/trending`, `OPTIONS,POST /tus`, `DELETE,GET,OPTIONS,PATCH /tus/:uploadId`, `POST /upload`, `POST /upload/batch/initiate`, `POST /upload/complete`, `POST /upload/failed/:videoId`, `POST /upload/initiate`, `GET /upload/resume/:videoId` |
| `/api/watch-history` | `DELETE,GET,POST .`, `DELETE /:videoId`, `GET,POST /:videoId/progress`, `GET,PUT /settings` |
| `/api/watch-state` | `GET .`, `PUT /:videoId` |
| `/api/youtube-import` | `GET /:importId`, `POST /:importId/cancel`, `POST /:importId/items/:itemId/retry`, `GET /:importId/link-back.csv`, `PUT /:importId/matches`, `PUT /:importId/selection`, `POST /:importId/start`, `GET /available`, `GET /oauth/callback`, `POST /oauth/finish`, `POST /oauth/start`, `GET /status` |
| `/internal/account-events` | `POST /retry` |
| `/internal/admin` | `GET /accounts`, `GET /analytics/visits`, `DELETE,PUT /captions/quran-translations/:lang`, `GET /captions/quran-translations/editions`, `GET,PUT /captions/settings`, `GET /channel-move-mails/:event/:id`, `POST /channel-move-mails/:event/:id/delivery`, `GET /channels`, `DELETE,GET,PATCH /channels/:id`, `POST /channels/:id/handle/release`, `POST /channels/:id/handle/take`, `POST /channels/:id/images/:kind` |
| `/internal/admin` | `GET /channels/:id/move-offers`, `POST /channels/:id/move-offers/:offerId/stop`, `POST /channels/:id/suspend`, `POST /channels/:id/transfer`, `POST /channels/:id/unsuspend`, `POST /comment-moderation`, `GET /comments`, `GET,POST /creator-tiers`, `DELETE,PUT /creator-tiers/:id`, `POST /creator-tiers/:id/purge-request`, `POST /creator-tiers/:id/restore`, `PUT /creator-tiers/default` |
| `/internal/admin` | `GET /creator-tiers/deleted`, `PUT /creator-tiers/order`, `POST /creator-tiers/purge`, `GET /creators`, `POST /creators/tier`, `GET /deletions`, `POST /deletions/:kind/:id/purge`, `POST /deletions/:kind/:id/restore`, `GET /features/state`, `POST /import/attach/retry`, `GET /import/channels/:channelId/delivery`, `POST /import/initiate` |
| `/internal/admin` | `GET /import/quran-index`, `GET,POST /import/sources`, `DELETE,GET,PATCH /import/sources/:id`, `POST /import/sources/:id/cancel`, `GET /import/sources/:id/items`, `POST /import/sources/:id/sync`, `GET /import/sources/:id/takeout`, `POST /import/sources/:id/takeout/files`, `POST /import/sources/:id/takeout/files/:fileId/confirm`, `POST /import/sources/:id/takeout/files/:fileId/upload`, `POST /import/sources/:id/takeout/files/:fileId/uploaded`, `GET /import/sources/channels/:channelId/connections` |
| `/internal/admin` | `POST /import/sources/retry`, `POST /import/status`, `POST /import/videos/:videoId/captions/:language/transcript`, `GET /import/videos/:videoId/delivery`, `POST /import/videos/:videoId/renditions`, `DELETE /import/videos/:videoId/renditions/:stagingId`, `POST /import/videos/:videoId/renditions/:stagingId/complete`, `PUT /import/videos/:videoId/renditions/:stagingId/files/:rung/:file`, `POST /import/videos/:videoId/sidecars`, `POST /import/videos/:videoId/translations`, `GET,POST /islamic-seasons`, `DELETE,GET,PUT /islamic-seasons/:id` |
| `/internal/admin` | `POST /islamic-seasons/:id/restore`, `POST /islamic-seasons/purge`, `GET /jobs`, `GET /jobs/:id`, `POST /jobs/:id/cancel`, `POST /jobs/:id/retry`, `GET /jobs/counts`, `GET /legacy-profiles/plan`, `POST /legacy-profiles/restore`, `POST /live-moderation`, `GET /live/compare`, `DELETE,PUT /live/overrides/:channelId` |
| `/internal/admin` | `GET /live/sessions`, `POST /live/sessions/:id/end`, `DELETE,GET,PUT /live/settings`, `POST /live/streams/:id/move`, `POST /lookup`, `GET /playlists`, `DELETE /playlists/:id`, `GET /posts`, `DELETE /posts/:channelId/:postId`, `POST /prayer-cache/purge`, `GET,PUT /prayer-settings`, `GET,POST /profile-emails/jobs` |
| `/internal/admin` | `GET /profile-emails/jobs/:id/report`, `GET /tier-changes/:id`, `POST /tier-changes/:id/delivery`, `GET /tier-requests`, `GET /tier-requests/:id`, `POST /tier-requests/:id/decide`, `POST /tier-requests/:id/delivery`, `POST /tier-requests/:id/notify`, `GET,PUT /tier-requests/settings`, `GET /users`, `GET,PATCH /users/:id`, `GET /users/:id/account-email` |
| `/internal/admin` | `POST /users/:id/account-notices`, `POST /users/:id/ban`, `GET /users/:id/caption-minutes`, `POST /users/:id/caption-minutes/grants`, `POST /users/:id/caption-minutes/grants/:grantId/revoke`, `POST /users/:id/channels`, `GET,PUT /users/:id/creator-tier`, `POST /users/:id/delete-data`, `GET /users/:id/email-settings`, `POST /users/:id/erase-revoked-invite`, `POST /users/:id/unban`, `POST /users/provision` |
| `/internal/admin` | `GET /users/search`, `GET /videos`, `DELETE,GET,PATCH /videos/:id`, `POST /videos/:id/move`, `POST /videos/:id/reprocess`, `POST /videos/:id/republish`, `POST /videos/:id/revoke-downloads`, `POST /videos/:id/thumbnail`, `POST /videos/:id/unpublish`, `DELETE /videos/:videoId/comments/:commentId` |
| `/internal/app-config` | `GET,PUT /:key`, `POST /evaluate`, `GET /releases`, `PUT /releases/available`, `POST /releases/refresh` |
| `/internal/audio-tracks` | `POST /:videoId/:trackId/prepared`, `POST /:videoId/detected`, `POST /:videoId/package`, `POST /retry` |
| `/internal/billing` | `POST /comps`, `POST /jobs/retry`, `GET /overview`, `POST /payments/:id/refund`, `PUT /prices`, `DELETE /prices/:id`, `GET,PUT /providers/:id`, `POST /providers/:id/credentials`, `POST /providers/:id/sync-prices`, `GET /subscriptions`, `GET /subscriptions/:id`, `POST /subscriptions/:id/cancel` |
| `/internal/billing` | `PUT /tax`, `GET /users/:id` |
| `/internal/captions` | `POST /jobs/:jobId/audio`, `POST /jobs/:jobId/finish`, `POST /jobs/:jobId/progress`, `POST /jobs/retry`, `POST /metadata-translations` |
| `/internal/categories` | `POST /invalidate` |
| `/internal/channel-comments` | `POST /retry` |
| `/internal/channels` | `POST /backfill-handles` |
| `/internal/csam` | `POST /accounts`, `DELETE /cases/:caseId/evidence`, `GET /cases/:caseId/files/:name`, `GET /cases/:caseId/job`, `GET /cases/:caseId/manifest`, `POST /contain`, `POST /report-evidence`, `DELETE,GET /report-evidence/:type/:id`, `POST /resolve`, `POST /resolve-by-hand`, `POST /retry` |
| `/internal/discovery` | `GET /preview`, `POST /rank`, `GET /status` |
| `/internal/downloads` | `GET,PUT /rate-limit` |
| `/internal/library` | `POST /backfill` |
| `/internal/media` | `GET /backfill/channels/:id/verification`, `POST /backfill/flip`, `POST /backfill/items/retry`, `GET /backfill/libraries`, `GET,POST /backfill/libraries/:id/removals`, `POST /backfill/libraries/:id/removals/cancel`, `GET /backfill/overview`, `POST /backfill/removals/retry`, `GET,POST /backfill/runs`, `GET /backfill/runs/:id`, `POST /backfill/runs/:id/:action{start\|pause\|cancel\|retry-failed}`, `GET /backfill/runs/:id/items` |
| `/internal/media` | `PUT /backfill/runs/:id/settings`, `POST /events`, `GET /failures`, `GET,POST /hdr-check`, `POST /health/check`, `GET /jobs`, `POST /mp4`, `GET,PUT /providers`, `GET /qoe-live`, `POST /retry`, `GET,PUT /settings`, `GET /source/:videoId` |
| `/internal/media` | `GET /summary`, `GET,PUT /transcode-limit`, `GET /troubleshoot`, `POST /troubleshoot/actions`, `POST /troubleshoot/jobs/retry`, `POST /troubleshoot/retry-now`, `PUT /videos/:id/override` |
| `/internal/notifications` | `GET,PUT /settings` |
| `/internal/playlist-adds` | `POST /retry` |
| `/internal/posts` | `GET /:channelId`, `GET /:channelId/:postId` |
| `/internal/privacy` | `GET /footprints`, `POST /footprints/backfill` |
| `/internal/processing` | `GET /errors`, `POST /index-rebuild`, `POST /index-repairs/retry`, `POST /mark-failed`, `POST /retry`, `POST /sync`, `GET,POST /thumbnails`, `POST /thumbnails/:jobId/retry`, `GET /videos` |
| `/internal/review` | `POST /:videoId/decision`, `POST /:videoId/outcome`, `POST /:videoId/scan`, `GET /audio-track/:videoId/:trackId`, `GET /audio-track/:videoId/:trackId/audio`, `POST /audio-track/:videoId/:trackId/decision`, `POST /audio-track/:videoId/:trackId/outcome`, `POST /images/decision`, `POST /images/outcome`, `GET /livestream/:id`, `POST /livestream/:id/decision`, `POST /livestream/:id/media` |
| `/internal/review` | `POST /livestream/:id/outcome` |
| `/internal/scholars` | `DELETE,PUT /:userId/articles/:externalId`, `GET /:userId/channels`, `GET,PUT /:userId/posts/:externalId` |
| `/internal/search` | `POST /backfill`, `POST /ownership-backfill`, `GET /stats` |
| `/internal/sites` | `DELETE,GET,PATCH,POST /:channelId`, `POST /:channelId/domains`, `DELETE,PATCH /:channelId/domains/:host`, `GET /:channelId/editor`, `PUT /:channelId/primary`, `POST /:channelId/restore`, `GET /slug/:slug` |
| `/internal/social` | `GET /admin`, `DELETE,PUT /admin/credentials/:network`, `PUT /admin/settings`, `POST /channels/:channelId/erase`, `POST /deliveries/:id/attempt`, `POST /deliveries/:id/give-up`, `POST /deliveries/retry`, `POST /events` |
| `/internal/support` | `GET /batches`, `POST /batches/:id/approve`, `POST /batches/:id/stop`, `POST /batches/plan`, `GET /countries`, `PUT /countries/:country`, `GET,POST /fees`, `POST /jobs/retry`, `GET /overview`, `GET /settings`, `PUT /settings/apps`, `PUT /settings/fields` |
| `/internal/support` | `PUT /settings/policy` |
| `/internal/sync-r2` | `GET .` |
| `/internal/translate` | `POST /admin-fields` |
| `/internal/uploads` | `POST /delete`, `POST /keep`, `POST /mode`, `POST /retry`, `POST /scan`, `GET,POST /stale`, `GET,POST /test-library-purge` |
| `/internal/video-format` | `POST /backfill`, `GET /runs/:runId`, `GET /runs/latest` |
| `/internal/youtube-import` | `PUT /client-secret`, `POST /retry`, `GET,PUT /settings` |
| `/webhooks/auth` | `POST /account-events` |
| `/webhooks/billing` | `POST /:provider`, `GET /fake/checkout/:id`, `POST /fake/checkout/:id/cancel`, `POST /fake/checkout/:id/pay` |
| `/webhooks/support` | `POST /:side/:vendor`, `GET,POST /rail/test/onboard/:ref`, `GET,POST /test/checkout/:id` |

The outer fetch entry also serves `GET /robots.txt`. The live edge serves preflight, `GET /time`, `GET,HEAD /hls/{sessionId}/{optionalToken}/{file}`, and `PUT,POST,DELETE /ingest/{sessionId}/{key}/{file}`. The scheduled entry selects work from its Cloudflare cron event. This Worker defines no Durable Object class. Its calls to the realtime Worker are `POST /views/increment`, `POST /post-views/increment`, `POST /live-viewers/beat`, `GET /live-viewers/count`, `POST /qoe/beats`, `GET /qoe/recent`.
