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

| Component | Checks |
|---|---|
| Website | `www/healthz` (`ok: true`) and `www/en/` (200) |
| Videos site | `videos/en` (200) |
| Videos API | `videos.api/health` (`healthy`) and `/api/videos?limit=1` (JSON) |
| Sign-in | `auth/health` (`ok`) and the OAuth metadata (`issuer`) |
| Profile | `profile.auth/login` redirects to the issuer's `/authorize` |
| CMS | `cms/healthz?deep=1` (config + D1) |
| Admin | `admin/login` redirects to sign-in, `admin.api/health` (`healthy`) |
| Uploads | `POST videos.api/api/videos/tus` without a token answers 401 (the route is up; no video is created), and status.bunny.net |
| Playback | from the newest public videos: the R2 master playlist on `media.<env>` and the Bunny playlist (their signed `playUrl`) start with `#EXTM3U`. Skipped (unknown) when the API is down |
| Live streaming | `/api/live-streams?limit=1` and the live edge host answering |
| Notifications & realtime | `realtime/health` and a WebSocket handshake to `/ws` (101, closed at once) |
| Search | `/api/search?q=a&limit=1` (JSON) |
| Email | Resend's status page (`resend-status.com`): none → operational, minor → degraded, major/critical → down |

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
that component. When the **admin** component itself is out (the Errors ingest may be down too), the
production run also mails the alert directly through Resend to `ALERT_EMAIL_TO`.

## Public endpoints

| Path | What |
|---|---|
| `/`, `/ar` | the page |
| `/incidents/<id>`, `/ar/incidents/<id>` | one incident with its full timeline |
| `/api/status.json` | overall state, components (state, 90-day uptime, daily bars), active / upcoming / recent incidents (both languages); CORS open |
| `/feed.atom`, `/feed.rss` (`/ar/…`) | incidents and maintenance, newest update first |
| `/healthz` | the Worker and its D1 (not cached) |

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
pnpm --filter @al-ummah/status test        # state machine, uptime math, probes, run + alerts on SQLite, HTML, feeds
cd apps/status && pnpm dev                  # wrangler dev on :3095 with a local D1 (no cron: trigger it with /__scheduled)
```

The local E2E stack runs the status Worker on port 3095, sharing its D1 with admin-api's
`STATUS_DB`; `apps/admin-web/e2e/status-page.spec.ts` posts an incident in the admin and reads it on
the public page in English and Arabic.

Subscriptions (email / webhook) are not built yet: [#1193](https://github.com/Al-Ummah-Now/AlUmmahNow/issues/1193).
