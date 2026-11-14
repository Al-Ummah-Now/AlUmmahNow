# Moderation requests to auth

Auth and videos are separate apps. The videos admin manages videos users itself:
banning or deleting a videos profile never touches auth. When the **auth
identity** needs action (suspend it, delete it, sign it out everywhere, force a
password reset), videos admins **ask** auth. Auth admins decide and act in the
auth admin (`admin.auth.*` → Moderation). The full auth contract is in
AlUmmahNowAuth [`docs/MODERATION_REQUESTS.md`](https://github.com/Al-Ummah-Now/AlUmmahNowAuth/blob/main/docs/MODERATION_REQUESTS.md).

```
admin-web ──server action──▶ admin-api /api/auth-requests ── row 'sending' + audit ──▶ queue auth-moderation-requests
                                                                                         │ send (Basic client auth, Idempotency-Key)
                                                                                         ▼
admin-web ◀── Sending… / Sent / Failed — Retry, auth's status ── mirror ◀── status reads ── auth /moderation/requests
```

Nothing talks to auth inside an admin's request (owner rule: async, queues,
retry, errors flag an admin).

## Who can do what

| Role (videos admin RBAC) | See requests and status | Send a request / answer auth |
| --- | --- | --- |
| super_admin, admin | yes | yes |
| moderator | yes | no (403) |

## UI

- **User page panel** `UserAuthRequestsPanel` (`apps/admin-web/src/components/auth-requests/`): the
  "Request action from Auth" button (action, reason category, what happened, an optional note) and the
  user's requests: **Sending…** (with the attempt and last error while retrying), **Sent** with auth's
  status and decision note, or **Failed** with the error and **Retry**. It refreshes every 10 s while a
  request is sending or open.
  Self-contained: `<UserAuthRequestsPanel subjectUserId={id} canRequest={isAdmin} />`. It is hosted at
  `/auth-requests/users/[userId]` and can be dropped into the users page.
- **Auth requests** (`/auth-requests`, nav "Auth requests"): every request, newest first, with status and
  delivery filters and a banner when requests need attention.
- When auth asks for more information (`info_requested`), admins answer from the panel.

Evidence is attached automatically: the user's videos admin page (`$ADMIN_WEB_URL/users/<id>`) and the
reports on content the user owns (reports joined with `content_ownership` in the search index, newest 10,
`$ADMIN_WEB_URL/moderation/reports/<id>`).

## admin-api `/api/auth-requests`

Bearer token of a videos admin (the usual admin-api auth). Every write only queues.

| Method | Path | Body / query | Result |
| --- | --- | --- | --- |
| GET | `/api/auth-requests` | `subject_user_id`, `status`, `delivery` (`sending`/`sent`/`failed`), `limit` (≤100), `offset` | `result: Request[]`, `total`, `needsAttention`, `canRequest`; queues status reads of the open ones |
| GET | `/api/auth-requests/evidence` | `subject_user_id` | `result: { reports, evidence }` |
| POST | `/api/auth-requests` | `subject_user_id`, `action`, `reason_category`, `reason`, `note?`, `evidence?`, `report_ids?`, `idempotency_key?` | 202 `result: Request` (`delivery.status: "sending"`); the same key answers the existing request |
| GET | `/api/auth-requests/:id` | | `result: Request`; queues a status read if open |
| POST | `/api/auth-requests/:id/retry` | | 202: a failed send is queued again; a failed status read or answer is retried. 409 if there is nothing to retry |
| POST | `/api/auth-requests/:id/info` | `note`, `evidence?` | 202: the answer is queued (`answerPending`) |

`action`: `suspend_account`, `delete_account`, `revoke_sessions`, `require_password_reset`, `other`.
`reason_category`: `spam`, `harassment`, `hate_speech`, `violent_content`, `sexual_content`,
`impersonation`, `copyright`, `fraud`, `compromised_account`, `other`.

`Request`: `id` (ours, `areq_…`), `authRequestId` (auth's `modreq_…` once sent), `subjectUserId`,
`action`, `reasonCategory`, `reason`, `evidence`, `requestedBy {id, name}`,
`delivery {status, attempts, error}`, `status` (auth's, once sent), `decisionNote`,
`history [{type, by, note, at}]`, `answerPending`, `syncError`, `syncedAt`, `createdAt`, `updatedAt`.

Errors (synchronous): 400 (validation), 403 (moderator writing), 404, 409.

## The queue: `auth-moderation-requests[-env]`

| Message | Does | On error |
| --- | --- | --- |
| `send` | POSTs the request to auth with its Idempotency-Key → `sent` + auth's id and status | permanent (400/404/409, not configured): `failed` at once. Transient (5xx, 429, network, our credentials refused): retried after 30 s, 60 s, 2, 4, 8, 15 min (`max_retries` 6), then `failed` |
| `sync` | reads auth's status into the mirror; a change is audit-logged | after the retries: `sync_error` (the next cron or read tries again) |
| `info` | delivers a queued answer to auth's "more info" | after the retries: `sync_error`, the answer stays queued for Retry |

- The cron (`*/5 * * * *`) queues a status read for open requests that are due, paced by age
  (`CRON_SYNC_STEPS` in `lib/authModeration.ts`): under 1 h old every run, under a day every 30 min,
  under a week every 3 h, then daily (oldest read first, 100 at most). Reads of a request queue one
  too, at most every 30 s per request, whatever its age. A read that finds nothing new in auth
  writes only `synced_at`. The panel refreshes every 10 s
  while a request is sending or open.
- The handler crashing repeatedly sends the message to `auth-moderation-requests-dlq[-env]`, whose
  consumer flags it the same way (`failed` / `sync_error`).
- **Flagged** = `delivery.status: "failed"`, or a `syncError` on an open request. The list page
  shows a banner with the count (`needsAttention`) and a **Not delivered** filter; the user panel
  shows the error and **Retry** (admins). Each flag is an `auth_request.failed` /
  `auth_request.info_failed` audit row with `needsAttention: true`.
- The same Idempotency-Key goes with every attempt, so retries never file a request twice in auth.

| Env | Queue | DLQ | Consumer |
| --- | --- | --- | --- |
| qa | `auth-moderation-requests-qa` | `auth-moderation-requests-dlq-qa` | `al-ummah-admin-api-qa` (its `wrangler deploy` registers it) |
| stage | `auth-moderation-requests-stage` | `auth-moderation-requests-dlq-stage` | `al-ummah-admin-api-stage` |
| production | `auth-moderation-requests` | `auth-moderation-requests-dlq` | `al-ummah-admin-api` |

The release's promote uploads versions, which never registers queue consumers, so `release.yml`
runs `pnpm release:queue-consumers --config apps/admin-api/wrangler.jsonc [--env stage]` after each
promote (`scripts/release/queue-consumers.ts`: adds the consumers the config declares that
Cloudflare lacks; idempotent).

## Statuses

Delivery (ours): `sending` → `sent`, or `failed` (Retry). Auth's status once sent: `pending` →
`approved` → `actioned`, or `rejected`; `info_requested` while auth waits for an answer. `rejected`
and `actioned` are final. On auth's side an approved action also runs from a queue with retries;
a failure there is flagged for the auth admins (AlUmmahNowAuth docs/MODERATION_REQUESTS.md).

## Data and audit (REPORTS_DB, migration `0011_auth_moderation_requests.sql`)

- `auth_moderation_requests`: what was sent, its delivery state, and the last status read from auth.
- `admin_audit_log`: the videos admin audit log. Rows: `auth_request.created`, `.retried`,
  `.info_provided` (actor = the videos admin); `.sent`, `.failed`, `.info_sent`, `.info_failed`
  (actor `queue`); `auth_request.<status>` when a status change from auth is first seen (actor `auth`).

## Configuration

| | prod | qa | stage |
| --- | --- | --- | --- |
| `Issuer` (auth URL) | `https://auth.alummahnow.net` | `https://auth.qa.alummahnow.net` | `https://auth.stage.alummahnow.net` |
| `AUTH_MODERATION_CLIENT_ID` | `d7464de8-363d-4fc1-b1af-7c71653f0afc` (same everywhere) | | |
| `AUTH_MODERATION_CLIENT_SECRET` | worker secret on `al-ummah-admin-api` | `al-ummah-admin-api-qa` | `al-ummah-admin-api-stage` |
| `ADMIN_WEB_URL` | `https://admin.alummahnow.net` | `https://admin.qa.alummahnow.net` | `https://admin.stage.alummahnow.net` |

The secret is per env; set or rotate it from AlUmmahNowAuth:

```bash
node --experimental-strip-types scripts/release/rotate-client-secret.ts \
  --db <auth D1 of the env> --client d7464de8-363d-4fc1-b1af-7c71653f0afc \
  --worker al-ummah-admin-api[-qa|-stage]:AUTH_MODERATION_CLIENT_SECRET
```

`scripts/release/secrets-manifest.ts` requires the secret and checks the client id in auth D1;
`scripts/release/apps.ts` pins the vars for production and stage.

## Tests

- `apps/admin-api/test/auth-moderation.test.ts`: validation, roles, evidence, the auth client
  (Basic auth, Idempotency-Key, replay, error mapping), mirror status changes.
- `apps/admin-api/test/auth-moderation-queue.test.ts` (migration 0011 on SQLite): send → sent; transient
  retries with the same key then failed; permanent errors flag at once; no queue → flagged; status reads
  (throttle, audit on change, sync_error); queued answers; the batch handler's ack/retry/DLQ.
- `scripts/release/__tests__/queue-consumers.test.ts`: the release registers only missing consumers.
- `apps/admin-web/test/auth-requests.test.ts`: en/ar labels, lists match admin-api.
- `apps/admin-web/e2e/12-auth-requests.spec.ts` (QA, chromium): registers a test user, sends a request,
  the auth admin rejects it (note shown here), sends "Delete account", the auth admin approves (auth
  deletes the test user), the videos admin shows "Actioned".
