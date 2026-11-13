# Error reporting and the admin Errors page

Users never see raw errors. Every app reports what went wrong; admins see it,
grouped, on the videos admin **Errors** page (admin-web `/errors`), together
with **needs-action items**: failed jobs, dead-lettered queue messages, emails
that were not sent, AI steps or admin jobs that failed. Each item links to the
thing that failed and, where possible, has a **Retry** button.

Standing rule: *always async, queues, retry; errors flag an admin for action.*
If your feature can fail in a way someone has to look at, report it here
(see [Reporter API](#reporter-api)).

## Pipeline

```
browser (web, admin-web)        Workers (api-videos, processor, scheduler,
  createErrorReporter             websocket, web/admin-web SSR, admin-api;
                                  Auth (AlUmmahNowAuth) with its own copy, app 'auth')
  batched, deduped, sampled       reportServerError / withErrorReporting
  → same-origin POST /api/errors  reportNeedsAction / resolveNeedsAction
  (sendBeacon on page hide)            │
        │ (app route adds key,         │ X-API-Key: INTERNAL_API_KEY
        │  X-Client-IP, UA)            │
        └──────────► admin-api POST /internal/errors ◄──┘
                     key check, ≤ 20 events / 64 KB, scrub again,
                     browser batches: app/user only as the proxy vouches
                     (X-Report-App, X-Client-User-Id), counts capped, test
                     only outside production, items namespaced, no retry;
                     per-IP rate limit (60/min) → 202
                            │
                     queue al-ummah-now-errors[-stage|-qa]
                            │  consumer: admin-api (max_retries 5, backoff 10 s → 5 min)
                     D1 REPORTS_DB: groups, samples, items, alerts
                            │  after 5 failures
                     queue al-ummah-now-errors-dlq[-env] (admin-api, every 15 min, 10 tries)
```

Without an `ERRORS_QUEUE` binding (local `wrangler dev`) the batch is written
inline. admin-api's own errors go through the same queue.

## What is stored (admin-api migration `0012_error_groups.sql`)

| Table | What |
| --- | --- |
| `error_groups` | One row per fingerprint per environment: app, kind, message, culprit (first app frame), normalised route, status (`new`, `acknowledged`, `resolved`, `ignored`), occurrences, affected users, first/last seen, first/last release, resolved release, assignee, last alert, `test` flag. |
| `error_events` | Raw samples (scrubbed), at most 50 per group, 30 days: reference, release, Worker version, route, method, status, locale, theme, browser, OS (parsed; the user agent is never stored), `usr_` id, request id, stack and symbolicated stack. |
| `error_refs` | Every reference → its group (30 days), so a quoted reference is found after its sample was trimmed. |
| `error_group_users` | Distinct accounts / anonymous visitors (keyed hash of IP + browser), capped at 10 000 per group. |
| `error_group_releases` | Occurrences per release. |
| `error_hourly` | Occurrences per UTC hour (sparklines, timeline, spikes), 30 days. |
| `error_releases` | When each release was first seen: orders releases for "recurred in a newer release". |
| `error_actions` | Needs-action items: one per item key, link, retry spec (server side only), status (`open`, `retrying`, `resolved`, `dismissed`), attempts and last result. |
| `error_group_activity` | Audit log and timeline: created, status changes, assignment, notes, automatic reopenings, alerts, retries, item changes (actor id and email). |
| `error_rate` | Fixed-window counters (client rate limit, per-group sample cap, alert mail limit). |

**Fingerprint** = app + error name + normalised message (ids, numbers, quoted
values and URLs replaced) + top 3 app stack frames (function + file without
build hashes or line numbers; original sources when symbolicated) +
normalised route (`/:locale/video/:id`). Needs-action items group by
source + title instead.

**Resolve** remembers the newest release the group was seen in. A later
occurrence from a release first seen after that one reopens the group
(`reopened` in the timeline); an old tab still on the resolved release does
not. A needs-action item that fails again reopens its group too.

**Retention** (admin-api cron `17 3 * * *`): samples, references, hourly
counts and user keys after 30 days; groups not seen for 90 days; E2E test
groups after a day; source maps in R2 after 90 days.

**Alerts**: production only, to `ERRORS_ALERT_TO` (else `CONTACT_INBOX`), for
new groups and spikes (this hour ≥ 50 and ≥ 10× the previous 24 h average),
at most one per group per 6 hours and 10 mails an hour in all. Never for
test errors. Each alert is recorded in the group's timeline.

**Scrubbing** (`@al-ummah/shared-types` `scrubText`/`scrubUrl`/`scrubEvent`),
in the reporter and again on ingest: emails, bearer tokens, JWTs, secret-like
`key=value` pairs, OAuth `code`/`state`, long opaque strings and IPv4
addresses become placeholders; URLs keep only their path and a few harmless
parameters (`v`, `t`, `list`, `tab`, `page`, `sort`, `q`, `lang`, `theme`).
The only user identifier is the `usr_` account id.

## Reporter API

Everything is exported from `@al-ummah/shared-types`.

### In a Worker

Every Worker binds `INTERNAL_API_KEY` and gets the ingest URL as the var
`ERRORS_INGEST_URL` (`https://admin.api[.stage|.qa].alummahnow.net/internal/errors`).
Reporting never throws and never delays the response (it uses `waitUntil`).

```ts
import { withErrorReporting, reportServerError, reportNeedsAction, resolveNeedsAction } from '@al-ummah/shared-types';

// 1. Uncaught exceptions and 5xx answers of a fetch handler: wrap it.
//    A crash is answered with { error: 'Internal server error', reference } and X-Error-Ref.
export default { fetch: withErrorReporting('api-videos', app.fetch) };

// 2. An error you caught and handled but someone should know about:
const ref = reportServerError('scheduler', env, ctx, error, { route: 'cron:publish', extra: { videoId } });

// 3. Something an admin must act on (a job gave up, a message dead-lettered, a mail bounced):
reportNeedsAction('processor', env, ctx, {
  key: `dlq:${messageId}`,          // stable: reporting the same key again updates one item
  source: 'dlq',                    // queue | dlq | processing | email | ai | admin-job | scheduler | upload | other
  title: 'Queue message dead-lettered',
  message: failureReason,           // why (scrubbed), shown on the item
  itemType: 'dead-letter',
  itemId: messageId,
  itemUrl: `/videos/${videoId}`,    // admin-web path, or https URL on alummahnow.net
  retry: { kind: 'service', service: 'processor', path: '/dlq/replay', body: { id: deadLetterId } },
  retryLabel: 'Replay message',
});

// 4. The feature fixed it itself (a later attempt worked): close the item.
resolveNeedsAction(env, ctx, `dlq:${messageId}`);
```

Queue consumers: report in the branch where a message is given up
(`attempts >= max_retries`, or the DLQ consumer), not on every retry.

### In the browser (web, admin-web)

**Every client-side error path reports.** Each app has one reporter, created
in `src/lib/errors/reporter.ts` with the app's context (release
`NEXT_PUBLIC_RELEASE`, Worker version, environment, route, locale, theme,
`usr_` id) and installed by `ErrorReportingProvider` in the root layout.
These are wired in already:

| Path | How it reports |
| --- | --- |
| Uncaught errors, unhandled rejections, failed `/_next/` chunk loads | window listeners (`install()`) |
| `logger.error()` from `@/lib/logger-client` or `@/lib/logger` (browser) | forwarded automatically (`forwardLoggedError`, kind `caught`): the Error in `data` (or `data.error`), plus the log message and primitive fields of `data` as context |
| Error boundaries (`FriendlyError`) | kind `boundary`; a server render error keeps the digest reference |
| Version skew | `lib/version-skew/report.ts` `reportVersionSkew` (kind `skew`), then the skew recovery |
| Uploads (`useBatchUpload`, `BatchUploadManager`, `components/videoUpload`) | `lib/upload/report-upload-error.ts`: step (`auth`, `resume`, `initiate`, `queue`, `start`, `tus`, `retry`, `complete`, `schedule`), file count, total and file size, MIME type, HTTP status, the API's own reference, bytes sent; never file names |
| API helpers (`lib/api/api-client.ts`, `lib/api/upload-client.ts`) | kind `fetch` with endpoint, method, status and the API's `X-Error-Ref` (401/404 are not errors) |
| Server side (render, route handlers, Server Actions) | `src/instrumentation.ts` `onRequestError` |

Delivery: shown errors are sent at once; background ones are batched,
deduplicated (3 in full, then counted) and sampled (network failures 25%),
at most 30 a page, and flushed with `sendBeacon` when the page is hidden.
They go to the same-origin `/api/errors` route, which adds the internal key,
the IP (per-IP rate limit in admin-api, never stored) and user agent, and
queues them in admin-api.

```ts
import { reportError, reportNeedsAction, withoutErrorForwarding } from '@/lib/errors/reporter';

// A failure the UI handles: report it and show the reference with your own friendly message.
const ref = reportError(error, { kind: 'fetch', shown: true, status: res.status, extra: { endpoint: 'comments' } });

// You report it yourself with better context: keep your own log line local.
withoutErrorForwarding(() => logger.error('[comments] post failed', { ref, error }));

// Something only an admin can fix (no Retry from the browser: retry specs from browsers are dropped).
reportNeedsAction({ key: `upload-finalise:${videoId}`, source: 'upload', title: 'Upload could not be finalised', itemUrl: `/videos/${videoId}` });
```

Do not show `error.message` to users. Show the friendly screen
(`FriendlyError`) or your own copy plus the reference
(`uploadErrorMessage(friendly, ref, lang)` for uploads).

### Retry actions

Retry specs run only in admin-api (`apps/admin-api/src/lib/errors-actions.ts`),
and only what is registered there:

- `{ kind: 'builtin', handler, args }` — a handler in `BUILTIN_RETRIES`
  (today: `contact-email` queues a Contact us email that failed for good
  again; `lib/contact-mail-queue.ts` raises that item when the mail queue gives
  up, and the inbox's own Retry closes it).
- `{ kind: 'service', service, path, body }` — POST with the internal API key
  to an allowlisted path of a Worker admin-api has a service binding to
  (`SERVICE_RETRIES`; today: `processor` `/dlq/replay` replays a dead letter,
  `scheduler` `/failed/retry` puts a failed scheduled publish back on the schedule).

To add a retry: register the handler or the service path, add the service
binding to `apps/admin-api/wrangler*.jsonc` (production, stage and QA) and to
`scripts/release/apps.ts`, then report items with that spec. A successful
retry resolves the item; a failed one keeps it open with the reason; a 404
dismisses it. Every attempt is in the group's timeline.

## Users see

- Error boundaries (`app/global-error.tsx`, `app/error.tsx`, per-segment
  `error.tsx`, `not-found.tsx`) in web and admin-web render `FriendlyError`:
  themed, en/ar with RTL, an action that fits (Try again, Reload, Go home,
  Sign in again), the reference `ERR-XXXX-XXXX` with a copy button and, on
  the videos site, a link to `/[locale]/contact`. Never a stack, a framework
  URL or an internal id.
- Server-rendering errors: the server reports from `instrumentation.ts`
  `onRequestError` with a reference derived from Next's digest
  (`errorRefFromDigest`); the browser boundary computes the same reference
  from the digest it receives, so the user's reference finds the server
  event.
- Version skew (a deploy while the tab was open: failed server action,
  missing chunk) is reported with kind `skew`, then handed to the
  skew-recovery flow (event `aun:version-skew`): reload, but never during an
  upload.

## Release wiring

- `scripts/release/ensure-resources.ts --env <env>` creates the error queues
  and the source-map bucket when missing (QA deploy, stage, production).
- `scripts/release/upload-sourcemaps.ts` uploads the web apps' browser source
  maps to `al-ummah-now-sourcemaps[-env]` as `<app>/<release>/_next/static/...js.map`
  and deletes them from the deployed assets (never public). `<release>` is
  `NEXT_PUBLIC_RELEASE`, the first 12 characters of the build commit.
- admin-api binds `ERRORS_QUEUE` (producer and consumer), the errors DLQ
  consumer, `SOURCEMAPS`, `PROCESSOR` (service) and runs the retention cron;
  all checked by `scripts/release/apps.ts`.
- Release E2E `apps/web/e2e/release/errors.spec.ts` triggers a controlled
  client error and a server 500 through the test-only page
  `/[locale]/dev/error-test` (stage and QA only), checks the friendly page in
  en and ar, finds the group by the reference on the admin Errors page,
  resolves it and deletes the test group.
