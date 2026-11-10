# Logging policy

One policy for every Worker (web, admin-web, api-videos, admin-api, processor,
scheduler, websocket-server) and the browser. It lives in
`packages/logger/src/policy.ts` and is enforced by `pnpm check:config` and lint.

## Levels by environment

| Environment | Default `LOG_LEVEL` | Allowed in config | Emitted |
|---|---|---|---|
| production | `warn` | `warn`, `error` | warnings, errors, slow requests/jobs |
| stage | `info` | `info`, `warn`, `error` | + one summary line per request/job |
| QA / dev / preview | `debug` | any | + diagnostic detail |

- Every deployed wrangler env sets `vars.LOG_LEVEL`; `pnpm check:config` fails
  when it is missing or not allowed for the tier (production, `env.stage`, and the
  QA file `wrangler.qa.jsonc`). To raise production to `info` for an incident,
  change the var and add an `accepted` entry in `scripts/release/apps.ts`.
- debug/trace are never emitted in production: the runtime caps production at
  `info` even if `LOG_LEVEL=debug` is deployed (`ENVIRONMENT` / `NEXTJS_ENV` tells
  it which environment it is in).
- Workers read the level from their `env` on each invocation (`withLogging` on the
  exported handlers, `configureLogging(c.env)` in the request middleware). Next.js
  apps read `process.env` (`nodejs_compat_populate_process_env`).

## What a line looks like

Every call writes one object: `{ level, app, msg, ...fields }`. Workers Logs
indexes the fields, so query by `videoId`, `status`, `route`, `ray`.

Data is redacted before it is written (`redact()` in the policy module):

- keys named like secrets (`password`, `*token`, `authorization`, `cookie`,
  `apiKey`, `x-api-key`, `*secret`, `signature`, `sessionId`, …) → `[redacted]`
- `email` keys and any email address inside text → `[email]`
- JWTs, `Bearer …` credentials and `?token=` / `?code=` / `?key=` URL params → `[redacted]`
- request bodies (`requestBody`, `rawBody`, `payload`, …) → `[body omitted]`;
  `Headers` are never logged; a `Request` logs only method and URL
- Errors keep `name`, `message`, `stack`, `code`, `status`, `cause`
  (`JSON.stringify` used to drop them to `{}`)
- size is bounded: depth 6, 50 keys, 50 array items, 2000 characters per string

## One summary per request or job

- **api-videos / admin-api**: `middleware/logging.ts` writes one line per request
  with `method`, `route`, `status`, `durationMs`, `ray`, `userId`: `info` when
  healthy (stage and below only), `warn` when slower than 1.5 s (30 s for upload
  data: TUS chunks, thumbnails, images), `error` on a 5xx. A thrown error is
  logged once by the error handler with its stack, and the summary stays quiet.
  4xx responses are part of the `info` summary, not warnings.
- **web / admin-web**: `worker.ts` writes the same summary for pages and API
  routes (static assets excluded).
- **processor**: one `job` line per queue batch (`messages`, `retried`,
  `deadLettered`, `retriedIds`); a message that fails for good is one `error`
  with its id, type and reason.
- **scheduler**: a tick with nothing due writes nothing; a tick with work writes
  one `job` line (`due`, `published`, `failed`, `r2Reads`).

Per-step "starting… / done" lines and object dumps are `debug` (QA only) or gone.

## Warnings and errors

`warn` = something went wrong and was handled; `error` = a failure. Both carry
the context needed to act: ids, step, status and the Error itself (for the stack).
Expected outcomes are not warnings: not found, hidden/deleted content, invalid
cursors, expired or invalid tokens (an ordinary 401), anonymous visitors without a
session, bots asking for unsupported locales.

`setLogSink()` in `@al-ummah/logger` receives every emitted warn/error entry
(after redaction, plus the original Error). The admin Errors reporter
(`feat/errors-*`, not on main yet) can register there to send them to the admin
Errors page.

## Browser

`lib/logger-client.ts` (web, admin-web): on a production host the console shows
nothing below `warn`, whatever `NEXT_PUBLIC_LOG_LEVEL` says; QA/stage/preview hosts
honour it (default `warn`); `next dev` shows `debug`. The service worker logs its
progress on localhost only. Client errors still go to the server reporter through
`logger.error`.

## Lint

`no-console` (allowing only `console.warn` / `console.error`) is an error in the
production sources of every app. Use the logger. Tests, scripts and e2e are exempt.

## Workers Logs sampling

Head sampling is decided when the invocation starts, before its outcome is known,
so Cloudflare cannot sample successes and keep every error. We therefore:

- keep `head_sampling_rate: 1` in production (checked by `pnpm check:config`), so
  every warn/error line is kept, and cut volume with levels instead;
- turn the automatic per-invocation log off (`logs.invocation_logs: false`) on the
  high-volume production workers: web, api-videos, websocket-server, processor and
  scheduler (every minute). The request/job summaries replace it for slow and
  failed invocations. admin-api and admin-web (admins only) keep it;
- leave stage and QA at `head_sampling_rate: 0.1` (unchanged), with invocation logs.

## Before / after (estimates, from code paths on main, 2026-11-10)

Log calls by level before → after (production sources):

| App | debug | info | warn | error |
|---|---|---|---|---|
| web | 166 → 504 | 353 → 1 | 165 → 158 | 422 → 421 |
| api-videos | 20 → 195 | 148 → 23 | 192 → 138 | 162 → 159 |
| processor | 37 → 107 | 80 → 7 | 29 → 28 | 21 → 21 |
| admin-api | 10 → 30 | 42 → 24 | 27 → 24 | 41 → 38 |
| scheduler | 6 → 14 | 14 → 2 | 5 → 5 | 22 → 22 |

Before, production ran at `info` (api-videos, web, websocket and scheduler had no
`LOG_LEVEL`; admin-api and processor set `info`) with every invocation logged.

**Typical watch-page view** (1 document request, ~6 API calls, a realtime
connection), production:

| | Before | After |
|---|---|---|
| web | 1 invocation log + 3–4 session lines (`getActiveSessionInfo`, incl. a warning for every anonymous visitor) + ~8 per server API call made through `lib/api/logger.ts` (start banner, timestamp, URL, auth, success, end) | 0 |
| api-videos | per call: 1 invocation log + 1–2 info lines; plus a warning per 4xx (with its body) and an error per expired token | 0 |
| websocket | 1 invocation log per connect/message | 0 |
| **Total** | **~25–30 lines** | **0** unless something is slow (> 1.5 s) or fails |

On stage the same view is ~7 summary lines (1 web + ~6 api-videos), 10 % sampled.

**One upload** (initiate, ~10 TUS chunks, processing checks, queue messages), production:

| | Before | After |
|---|---|---|
| api-videos initiate | ~5–8 info (collection, thumbnail, "Preparing to save…" with an object dump, "saved successfully") + invocation; QA also logged the first 8 characters of the Bunny API key (removed) | 0 |
| TUS chunks | 1 invocation + up to 3 info each → ~20–40 | 0 (warn only past 30 s or on failure) |
| processing loop | ~3 per check (loop started, synced, check done) + invocation → ~20–30 | 0 |
| processor queue | 3 info per message + 2 per batch + invocation → ~10–15 | 0 (1 warn per batch only if messages were retried) |
| **Total** | **~60–90 lines** | **0** on success; one line with full context per failure |

Scheduler: before 1 invocation log plus an info line every minute (~2,900
lines/day on QA's config); after 0 lines on idle ticks.
