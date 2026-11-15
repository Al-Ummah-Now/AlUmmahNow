# Public status page

`status.alummahnow.net` (stage: `status.stage.alummahnow.net`, QA: `status.qa.alummahnow.net`) shows
whether Al Ummah Now works right now, 90 days of uptime per component, open incidents and scheduled
maintenance, in English (`/`) and Arabic (`/ar`, right to left).

It is its own Worker (`apps/status`, `al-ummah-status[-stage|-qa]`) with its own D1
(`al-ummah-now-status[-stage|-qa]`). Serving a page never calls the services it watches, so the page
stays up when the API, sign-in or the admin are down.

## Components and checks

A cron runs every 2 minutes in production (every 5 on QA and stage). Each check is an anonymous,
read-only request; nothing is created anywhere.

**Public and internal (owner, 2026-11-13: "You shouldn't show admin status unless this page is only
for admins").** The public page, its JSON and feeds show only the user-facing services: website,
videos site, sign-in, profile, uploads, playback, live streaming, notifications and realtime, and
search. The internal components (videos API, CMS, videos admin, admin API, accounts admin, email)
are checked and alerted on the same way but shown only on the videos admin's Status page, which
lists every component with its last result and 90-day uptime. `public` in
`packages/shared-types/src/status-page.ts` decides. An incident shows publicly only with its public
components; one that affects only internal components stays in the admin (its page is a 404).
The public page never shows check details or internal hostnames.

| Component | Public | Checks |
|---|---|---|
| Website | yes | `www/healthz` (`ok: true`) and `www/en/` (200) |
| Videos site | yes | `videos/en` (200) |
| Videos API | no | `videos.api/health` (`healthy`) and `/api/videos?limit=1` (JSON) |
| Sign-in | yes | `auth/health` (`ok`) and the OAuth metadata (`issuer`) |
| Profile | yes | `profile.auth/login` redirects to the issuer's `/authorize` |
| CMS | no | `cms/healthz?deep=1` (config + D1) |
| Videos admin | no | `admin/login` redirects to sign-in |
| Admin API | no | `admin.api/health` (`healthy`) |
| Accounts admin | no | `admin.auth/` redirects to its `/login` |
| Uploads | yes | `POST videos.api/api/videos/tus` without a token answers 401 (the route is up; no video is created), and status.bunny.net |
| Playback | yes | from the newest public videos: the R2 master playlist on `media.<env>` and the Bunny playlist (their signed `playUrl`) start with `#EXTM3U`. Skipped (unknown) when the API is down |
| Live streaming | yes | `/api/live-streams?limit=1` and the live edge host answering |
| Notifications & realtime | yes | `realtime/health` and a WebSocket handshake to `/ws` (101, closed at once) |
| Search | yes | `/api/search?q=a&limit=1` (JSON) |
| Email | no | Resend's status page (`resend-status.com`): none → operational, minor → degraded, major/critical → down |

**Result of one run** (`src/checks.ts classify`): every check passed → operational (degraded if one took
over 4 s or a provider reports a minor problem); some failed → partial outage; all failed → major
outage; none could run → unknown (ignored). A check that gets no answer in 10 s failed.

**Debounce** (`src/state.ts advance`): the public state changes only when two runs in a row agree, in
either direction, so one failed request never shows an outage and an outage needs two good runs to
clear. Unknown runs change nothing.

**What the page shows** for a component: the debounced state, made worse by any open incident that
lists it (never better). During a maintenance window it shows "Under maintenance" unless the checks
see a partial or major outage. The headline is the worst component.

## Uptime

`daily` holds one row per component per UTC day with how many runs ended in each state.
Uptime = 1 − (major + 0.3 × partial) / (all checked runs); degraded counts as up, maintenance and
unknown runs are left out. It rounds down, so a short outage never shows 100.00%. A day's bar takes
the worst state of that day. Rows older than 100 days are pruned daily (03:40 UTC). Phones show the
last 30 days.

## Incidents and maintenance

Admins (super admins and admins; `status:manage`) post them on the videos admin **Status** page
(`/status`, Operations group), in English and Arabic:

- **Incident**: title, message, status (investigating → identified → monitoring → resolved),
  impact (no impact / degraded / partial / major) and the affected components. Each update adds to
  the timeline; "resolved" closes it.
- **Scheduled maintenance**: a start and end time and the affected components; scheduled →
  in progress → completed. Upcoming maintenance is listed on the page; while the window runs the
  components show "Under maintenance" and no outage alert is sent.
- **Delete** hides it from the page and the feeds; it can be restored for 30 days, then the status
  Worker purges it. "Delete permanently now" removes a deleted one at once.

Writes go through admin-api `/api/status/*` (`STATUS_DB` binding to the same D1) and are recorded in
`admin_audit_log`. The page is edge-cached for 30 seconds, so a change shows within a minute.

## Alerts

When a component reaches a partial or major outage (after the debounce), the run reports a
needs-action item on the admin **Errors** page (`reportNeedsAction`, key `status:<component>`,
source `status`), which admin-api emails in production like every other critical item. It is
resolved automatically when the component is back. Nothing is sent during a maintenance window for
that component. When the **admin API** itself is out (it is the Errors ingest), the production run also mails the
alert directly through Resend to `ALERT_EMAIL_TO`. Internal components alert like public ones.

## Public endpoints

| Path | What |
|---|---|
| `/`, `/ar` | the page |
| `/incidents/<id>`, `/ar/incidents/<id>` | one incident with its full timeline |
| `/api/status.json` | overall state, public components (state, 90-day uptime, daily bars), active / upcoming / recent incidents with their public components (both languages); CORS open |
| `/feed.atom`, `/feed.rss` (`/ar/…`) | incidents and maintenance, newest update first |
| `/healthz` | the Worker and its D1 (not cached) |
| `/subscribe`, `/subscribe/confirm`, `/unsubscribe` (`/ar/…`) | email subscriptions (see [Subscriptions](#subscriptions)); never cached |

Light and dark follow the device on the first visit; the "Dark mode" button's choice is remembered
on the device (`localStorage aun_status_mode`, no "System" option). Colours are the Fawanees tokens.

## Deploy and release

- **QA**: `deploy.yml` → `Deploy Status Page to QA` migrates the QA D1 (before admin-api, which writes
  to it), deploys `wrangler.qa.jsonc` and runs `scripts/release/status-smoke.ts --env qa`.
- **Stage and production**: `release.yml` migrates the D1 with the others (`d1-migrate.ts`), deploys
  with `wrangler deploy` after the promote, runs the smoke and rolls back if it fails.
- **New custom domain**: the first deploy of an env attaches `status.<env>` and its DNS and
  certificate take a few minutes. The smoke waits up to ~3 minutes for the host to answer at all;
  if it never does, it skips with a warning (the Worker is deployed). A wrong answer always fails.
  A first deploy has no earlier version, so a failed smoke there has nothing to roll back to and
  the rollback step only warns (v2026.11.13.5 stage hit both).
- The custom domains are declared in the wrangler configs (`routes` with `custom_domain: true`);
  `wrangler deploy` attaches them and creates their DNS records.
- Cost: one cron run (~20 small subrequests, one D1 batch of 26 writes) every 2 minutes in
  production; well inside the Workers and D1 included usage.

## Local

```bash
pnpm --filter @al-ummah/status test        # state machine, uptime math, probes, run + alerts on SQLite, HTML, feeds, subscriptions
cd apps/status && pnpm dev                  # wrangler dev on :3095 with a local D1 (no cron: trigger it with /__scheduled)
```

The local E2E stack runs the status Worker on port 3095, sharing its D1 with admin-api's
`STATUS_DB`; `apps/admin-web/e2e/status-page.spec.ts` posts an incident in the admin and reads it on
the public page in English and Arabic; `23-status-subscriptions.spec.ts` subscribes, confirms, gets
an incident by email (the stack's Resend fake) and by a signed webhook (the stack's receiver,
`https://webhooks.local-stack.test/…`, `GET /__fake/webhooks`) and unsubscribes.

## Subscriptions

[#1193](https://github.com/Al-Ummah-Now/AlUmmahNow/issues/1193). Every incident or scheduled
maintenance with at least one **public** component is sent to subscribers when it is posted, at
each update and when it is resolved or completed (events `created`, `updated`, `resolved`). Edits
(title, components, window) are not sent. Incidents on internal components only are never sent,
and what is sent lists only the public components.

**Email (public, double opt-in).** `/subscribe` (`/ar/subscribe`), linked from a card at the
bottom of the page and the footer. The visitor gives an address and the one language of the emails
(English or Arabic). Answering never tells whether the address was already subscribed.

| Path | What |
|---|---|
| `GET /subscribe`, `POST /subscribe` | the form; a post stores a **pending** subscriber and queues the confirmation email, then 303 → `/subscribe/sent` |
| `GET /subscribe/confirm?t=` | a page with a **Confirm subscription** button (GET changes nothing: mail scanners open links) |
| `POST /subscribe/confirm` | pending → **active** |
| `GET /unsubscribe?t=` | a page with an **Unsubscribe** button |
| `POST /unsubscribe?t=` | deletes the subscriber and its delivery records; also the RFC 8058 one-click target of `List-Unsubscribe-Post` |

- Abuse limits: 5 subscribe posts per IP per hour (a keyed hash of the IP, kept for a day; no IPs
  stored), one confirmation email per address per 10 minutes, nothing at all for an active address,
  a honeypot field, and posts from another origin are refused (403). Pending subscriptions nobody
  confirmed are deleted after 7 days (`STATUS_CONFIRM_DAYS`) by the daily prune.
- Each email address has one random token in its confirm and unsubscribe links (`subscribers.token`).
  It is stored as is because every email carries the unsubscribe link; it controls only that one
  subscription. Unsubscribing deletes the row, so the address is kept only while subscribed.
- Every incident email is in the subscriber's language on the shared branded layout
  (`admin-api lib/email/layout.ts`): status, affected public components, the maintenance window,
  the message, a link to the incident page and an unsubscribe link, with `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. Sent through Resend from
  `support@alummahnow.net` like the other platform mail. Outside production, subjects start with
  `[qa]`/`[stage]` and `@e2e.alummahnow.net` addresses are not sent (status `sunk`).

**Webhooks (admins).** Admins add and delete them on the videos admin's Status page
(**Subscriptions** card): a name and an `https` URL with a public host name (no IP literals,
localhost, internal names or credentials; at most 20). A signing secret (`whsec_…`) is shown once
when it is added. Each delivery is a `POST` of JSON (`StatusWebhookPayload` in
`packages/shared-types/src/status-page.ts`):

```json
{ "type": "incident.created", "id": "<notification id, same on every retry>", "environment": "production", "sentAt": "…",
  "incident": { "id": "…", "kind": "incident", "title": { "en": "…", "ar": "…" }, "status": "investigating", "impact": "partial",
                "components": ["playback"], "startsAt": "…", "endsAt": null, "resolvedAt": null, "url": "https://status.alummahnow.net/incidents/…" },
  "update": { "status": "investigating", "body": { "en": "…", "ar": "…" }, "at": "…" } }
```

Headers: `x-aun-event` (the type), `x-aun-delivery` (the id), `x-aun-timestamp` (Unix seconds) and
`x-aun-signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with the secret>`. Receivers
should check the signature, refuse timestamps more than 5 minutes old and treat `id` as the dedupe
key (a retry can repeat a delivery). Redirects are not followed; 10 s timeout; any 2xx is success.

**Delivery (queued).** Nothing is sent on a request path. The status Worker (confirmations) and
admin-api (incident posts and updates, `announce()`) queue jobs on `al-ummah-now-status-notify[-env]`
(`STATUS_NOTIFY_QUEUE`), consumed by admin-api (`lib/status-notify.ts`):

1. `status-fanout`: one `deliveries` row (`queued`) and one `status-deliver` job per active subscriber.
2. `status-deliver`: one email or webhook POST. Network errors, 408/429 and 5xx retry with backoff
   (30 s doubling, at most 15 min, 6 attempts); a webhook 4xx or a refused address fails at once.
   A subscriber who left or an incident deleted since is `skipped`. A delivery that is no longer
   `queued` is never sent again, and Resend gets an Idempotency-Key per email.
3. `status-confirm`: the confirmation email of a pending subscriber.

A final failure marks the delivery `failed`, goes to the platform DLQ (`al-ummah-now-dlq[-env]`,
also the queue's own dead-letter queue) and raises one needs-action item per notification on the
admin **Errors** page (`status-notify:<id>`, Retry "Send again" queues every failed delivery of it;
`status-confirm:<id>` for a confirmation email). The Subscriptions card shows the email counts
(confirmed, waiting; never addresses), each webhook's last delivery, and the last 20 notifications
with recipients, delivered and failed counts and **Send failed again**. An admin can remove one
email address on request (a deletion request); the audit log records that one was removed, never
the address. Every admin change is in `admin_audit_log` (`status.webhook.create|delete`,
`status.subscriber.remove`, `status.notification.retry`).

Tables (`migrations/0002_subscriptions.sql`): `subscribers`, `notifications`, `deliveries`,
`subscribe_limits`. The daily prune also deletes notification and delivery records older than 30 days.

Admin endpoints (admin-api `/api/status`, `status:manage`): `GET /subscriptions`,
`POST /webhooks`, `DELETE /webhooks/:id`, `POST /subscribers/remove`, `POST /notifications/:id/retry`.

**Cost.** Resend volume is the only real cost: one email per subscriber per incident post or
update. Queue operations (about 3 per delivery) and D1 writes stay inside the included usage at any
realistic subscriber count; nothing runs while there are no incidents.
