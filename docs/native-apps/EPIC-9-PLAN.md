# Epic 9 plan: platform foundations for native clients

Spec: [EPICS.md](./EPICS.md) §4 (native on every platform, shared Rust core `aun-core`) and Epic 9.
This plan says, per story, which repo changes, the design, the API shape, security notes and
tests. Stories ship in this order, each as small PRs:

| # | Story | Repos | Depends on |
|---|---|---|---|
| 1 | 9.3 Versioned API, OpenAPI contract, `/api/app-config` | monorepo (`apps/api-videos`) | — |
| 2 | 9.1 Native public PKCE clients | openauth fork → auth | — |
| 3 | 9.2 Device authorization grant (RFC 8628) + activate page | openauth fork → auth | 9.1 (fork release) |
| 4 | 9.9 Watch-state sync, Continue watching | monorepo | 9.3 |
| 5 | 9.5 Remote config & feature flags | monorepo | 9.3 (`/api/app-config`) |
| 6 | 9.7 In-app account deletion & export | auth + monorepo | 9.1 |
| 7 | 9.8 Client telemetry ingest | monorepo | 9.5 (sampling flags) |
| 8 | 9.4 Push fan-out (APNs / FCM / WNS / web push) | monorepo | 9.5; owner credentials |
| 9 | 9.6 Playback authorization | monorepo | **D2** (Bunny vs R2) |

Conventions for every story:

- Endpoints are chanfana `OpenAPIRoute`s registered through `src/routers/`, so they appear in the
  generated OpenAPI document (9.3) and therefore in the `aun-api` client generated from it.
- All new endpoints answer under `/api/v1/...`; the unversioned `/api/...` path stays an alias of v1
  for the web apps (see 9.3).
- User-facing error strings go through the API i18n helpers (en/ar).
- Releases follow the monorepo Deploy Rules: merge to `main` deploys QA; the parent cuts `v*` tags.
  The auth repo deploys stage/prod from its own `release.yml` on merge.
- D1 changes are new, append-only migration files with the schema snapshot regenerated
  (`pnpm schema:snapshot`).

---

## 9.3 Public API contract & versioning (monorepo)

**Design**

- **Version prefix.** A small middleware at the top of the api-videos worker rewrites
  `/api/v1/<rest>` to `/api/<rest>` before routing and marks the request as v1 (`X-API-Version: 1`
  on the response). One set of handlers serves both paths, so nothing is duplicated and the web apps
  keep working. A future breaking change gets `/api/v2/...` handlers; v1 keeps its behaviour.
  Unknown versions (`/api/v9/...`) answer `404 unsupported_api_version`.
- **OpenAPI as the SDK source.** `GET /api/v1/openapi.json` serves chanfana's document with every
  `/api/...` path rewritten to `/api/v1/...`, `info.version` set to the contract version, and the
  internal routes (`/internal/*`, `/test*`, `/api/i18n/sync`) removed. The same function writes the
  checked-in file `apps/api-videos/openapi/v1.json` (`pnpm --filter @al-ummah/api-videos openapi:generate`).
- **Drift fails CI.** A unit test (`test/openapi-contract.spec.ts`, part of `test:unit`, which runs in
  the required `validate-api` job) regenerates the document from the real routers and compares it
  with `openapi/v1.json`. Any route or schema change without a regenerated file fails the build,
  and the regenerated file shows every contract change in the PR diff for review. (Automatic
  breaking-change detection against `main`'s file is a later improvement.)
- **Deprecation policy** (documented in `apps/api-videos/API_VERSIONING.md`):
  additive changes (new endpoints, new optional fields) ship in v1; removals or type changes need v2.
  A deprecated operation is marked `deprecated: true` in OpenAPI and answers with `Deprecation` and
  `Sunset` headers (RFC 9745 / RFC 8594) from a single `DEPRECATIONS` table; it keeps working for at
  least 6 months after the first app release that no longer calls it, and until `/api/app-config`'s
  minimum versions exclude every app build that still calls it.
- **`GET /api/v1/app-config`** (public, cacheable 5 min). Query: `platform`
  (`ios|ipados|tvos|macos|android|androidtv|firetv|windows|linux|tizen|webos|web`), `app`
  (`viewer|studio|kids`), `version` (semver of the running build), optional `locale`.

  ```json
  {
    "api": { "current": "1", "supported": ["1"] },
    "update": { "status": "ok|recommended|required", "minimumVersion": "1.0.0",
                "latestVersion": "1.2.0", "storeUrl": "https://apps.apple.com/..." },
    "flags": { },
    "config": { }
  }
  ```

  `update.status` is `required` when `version < minimumVersion` (apps block with an update screen),
  `recommended` when `version < latestVersion`. Version rows come from the remote-config store
  (9.5) with built-in defaults (`minimumVersion: 0.0.0`) so a missing row never blocks anyone.
  `flags`/`config` are filled by 9.5.

**Security**: public, read-only, no user data; versions are validated (`^\d+\.\d+\.\d+`) and unknown
platforms rejected with 400. Store URLs come from config, never from the request.

**Tests**: rewrite middleware (v1 path reaches the same handler, unknown version 404, `/api` still
works); document generation (paths prefixed, internals removed, stable ordering); contract drift
test; app-config semver comparisons (`required` / `recommended` / `ok`, malformed input 400).

---

## 9.1 Native OAuth clients (openauth fork → auth)

**Facts found**

- The auth worker enforces the client registry (`CLIENT_REGISTRY_MODE=enforce` in dev, QA, stage,
  prod): `/authorize` needs a registered, enabled client with the exact `redirect_uri` (full-string
  match) and the `authorization_code` grant (`registryProblem` in the fork's enterprise issuer).
- The fork already supports `pkce.requireForPublicClients`, but turning it on would break existing
  secret-less clients that do not send PKCE (the Next.js web apps). PKCE must be required
  **per client**.
- The redirect allow check (`defaultAllowCheck`) only accepts `localhost` or a host on the issuer's
  domain, so `alummahnow://…` and `alummahnow-studio://…` are refused before the registry is
  consulted.
- Refresh tokens already rotate (each use returns a new refresh token, 60 s reuse window, reuse after
  that revokes the whole family).

**Design**

- Fork (one PR, published as the next `@al-ummah-now/openauth` patch):
  1. A client whose `metadata.pkce` is `"required"` (or `metadata.type` is `"native"`) must send
     `code_challenge` with `S256`; the code exchange then needs the verifier (already enforced when a
     challenge was stored). Applies in the base issuer and in the enterprise `/authorize` precheck.
  2. With the registry on, a redirect URI that is **registered exactly** for the client is allowed
     even when it is not on the issuer's domain. This is what lets custom schemes through; everything
     else keeps the domain rule. Schemes are limited to `https:`, `http:` (localhost only) and
     reverse-DNS/app custom schemes (`^[a-z][a-z0-9+.-]*$`, never `javascript:`/`data:`/`file:`).
- Auth: bump the fork version (separate PR), then a migration registering five public clients per
  environment (QA in `migrations-qa/`, prod in `migrations/`, stage replays prod's file and
  `scripts/stage/seed.ts` rewrites hosts; custom-scheme URIs are kept unchanged on stage).

  | Client | Grant types | Redirect URIs (prod) |
  |---|---|---|
  | viewer-mobile | authorization_code, refresh_token | `alummahnow://auth/callback`, `https://videos.alummahnow.net/app/auth/callback` |
  | viewer-tv | device_code, refresh_token | — (device flow, 9.2) |
  | viewer-desktop | authorization_code, refresh_token | `alummahnow://auth/callback`, `http://127.0.0.1/auth/callback` (RFC 8252 loopback) |
  | studio-mobile | authorization_code, refresh_token | `alummahnow-studio://auth/callback`, `https://videos.alummahnow.net/app/studio/auth/callback` |
  | studio-desktop | authorization_code, refresh_token | `alummahnow-studio://auth/callback`, `http://127.0.0.1/auth/callback` |

  Metadata: `{"type":"native","pkce":"required","platforms":[...]}`; `client_secret_hash` NULL;
  scopes `openid profile email offline_access`. QA uses the same schemes plus `.qa.` universal-link
  hosts; ids are fixed per environment so apps can hard-code them.
- Desktop loopback: RFC 8252 §7.3 lets the app pick any free port at run time, which exact matching
  can't express. Desktop apps register `http://127.0.0.1/auth/callback` and the fork treats a
  redirect as matching when it differs **only in the port** and the host is `127.0.0.1` or `[::1]`.
  Every other URI stays a full-string match.
- Universal / app links need `apple-app-site-association` and `assetlinks.json` on
  `videos.alummahnow.net`; those need the apps' team id / signing cert fingerprints, so they are a
  `queue` issue (owner input), not part of this epic's PRs.

**Security**: no secrets in apps; S256 only; exact redirect match; no wildcard schemes; refresh
rotation with reuse detection; the custom-scheme exception only applies to URIs an admin registered.

**Tests**: fork unit tests (native client without PKCE → `invalid_request`; `plain` → rejected;
S256 accepted; registered custom scheme allowed; unregistered custom scheme refused; loopback port
variance only for 127.0.0.1/[::1]); auth worker tests in `client-registry.test.ts` style for the new
rows (authorize with and without PKCE, exact redirect), and a migration test that every native row
is public, PKCE-required and has no localhost URIs in prod.

---

## 9.2 Device authorization grant, RFC 8628 (openauth fork → auth)

**Design (fork, base issuer)**

- `POST /device_authorization` (form: `client_id`, `scope`). The client must be registered with the
  `urn:ietf:params:oauth:grant-type:device_code` grant. Returns
  `device_code` (32 random bytes, base64url), `user_code` (8 characters from
  `BCDFGHJKLMNPQRSTVWXZ`, shown `XXXX-XXXX`), `verification_uri`, `verification_uri_complete`
  (`?user_code=…`, for the TV's QR code), `expires_in: 600`, `interval: 5`.
  Storage: `oauth:device:<hash(device_code)>` and `oauth:device_user:<user_code>`, both with a 600 s
  TTL (codes expire in 10 minutes).
- `POST /token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`: answers
  `authorization_pending`, `slow_down` (polled sooner than the interval; the interval grows by 5 s
  each time, per §3.5), `access_denied`, `expired_token`, or the tokens. Tokens are issued once; the
  record is deleted on success.
- **Approval reuses the normal sign-in.** `GET /activate` (bilingual en/ar, RTL) asks for the code
  (or takes `?user_code=` from the QR). After a valid code it shows a confirmation ("Sign in on
  *Al Ummah Now TV*? Code ABCD-EFGH") — required by §5.4 against remote phishing — and then starts
  `/authorize` for the device's client with the issuer's own `/activate/callback` as redirect and a
  PKCE pair kept server-side. Sign-in, SSO, the account picker and RBAC enrichment all run unchanged.
  The callback stores the authorization code on the device record (`approved`); the next poll
  exchanges it internally, exactly like the `authorization_code` grant. "Deny" marks it `denied`.
- **Rate limits**: `/device_authorization` per client and IP; `/activate` code checks per IP
  (wrong codes count, 10/min) so user codes cannot be brute-forced; polling is limited by `slow_down`.
- `verification_uri` is configurable; the auth worker serves `/activate` itself. The spec's
  `alummahnow.net/activate` needs a redirect on the public site (another repo): `queue` issue.

**Auth**: bump the fork, register `viewer-tv` with the device grant (QA + prod), add the
`/activate*` and `/device_authorization` routes to the auth router's issuer pass-through, translations.

**Tests**: fork unit tests for every RFC 8628 error, expiry at 10 min, `slow_down` growth, user-code
alphabet/format, wrong-code rate limit, deny, single use; auth worker test of the full flow (device
code → activate → sign in → poll → tokens) against the in-memory D1/KV test env.

---

## 9.9 Watch-state sync & Continue watching (monorepo)

**Facts**: watch history lives in the `watch_history` R2 bucket, key `<userId>:<videoId>`, with
`progress`, `percentageWatched`, `completed`, `lastWatchedAt`.

**Design**

- `PUT /api/v1/watch-state/{videoId}`: `{ position, duration, clientUpdatedAt, deviceId? }`.
  Last-writer-wins on `clientUpdatedAt` (client clock, clamped to server time + 5 min so a device
  with a wrong clock cannot pin a value forever); an older write returns `200` with the stored
  (newer) state and `applied: false`, so `aun-sync` converges without conflicts. Creates the entry
  when missing (unlike the existing progress endpoint, which 404s), honours "history paused".
  Writes use the R2 conditional put (etag) retry loop already used by `updateObject`.
- `GET /api/v1/watch-state?since=<iso>&limit=` : changes since a timestamp for incremental sync.
- `GET /api/v1/continue-watching?limit=20`: the user's entries with `5% ≤ percentageWatched < 95%`,
  newest `lastWatchedAt` first, joined with the public video card (skips deleted/private videos).
  Lists `watch_history` by the `<userId>:` prefix.

**Tests**: LWW (newer wins, older ignored, clock clamp), paused history, continue-watching filter
and order, private/deleted videos hidden, other users' entries never returned.

---

## 9.5 Remote config & feature flags (monorepo)

**Design**: a new KV namespace `APP_CONFIG` (QA, stage, prod). One JSON document per key:
`flags` (array of flag rules) and `versions` (per platform/app minimum and latest versions, store
URLs). A flag rule: `{ key, enabled, platforms?, apps?, minVersion?, maxVersion?, locales?,
rollout? (0–100, hashed on install id) , value? }`. Evaluation is a pure function
`evaluateFlags(rules, {platform, app, version, locale, installId})`; results go into
`/api/v1/app-config` (`flags`, `config`). Isolate cache 60 s; KV `cacheTtl` 60 s. Admin edits go
through an internal endpoint (`PUT /internal/app-config/{key}`, `X-API-Key`) validated with zod,
so a bad document can't be written. Admin-web UI is a later story (queue issue).

**Tests**: evaluator truth table (platform, version ranges, locale, rollout determinism), invalid
document rejected, missing KV falls back to defaults.

---

## 9.7 In-app account deletion & data export (auth + monorepo)

Apple 5.1.1(v) and Google Play need deletion that starts in the app.

**Design**

- Auth: `DELETE /account` (bearer access token of the user, not an admin token): marks the user
  deleted (`status='deleted'`, `deleted_at`), revokes all refresh tokens and SSO sessions, emits the
  `user.deleted` audit event; `GET /account/export` returns the auth-side data (profile, roles,
  sessions, audit trail of that user).
- api-videos: `POST /api/v1/account/deletion` starts deletion: erases content data with the existing
  resumable `eraseUserData` (Story 1.3), then calls auth `DELETE /account` with the same bearer
  token. `GET /api/v1/account/deletion` reports progress. `GET /api/v1/account/export` merges the
  existing `/api/privacy/export` with the auth export into one JSON download.
- Re-authentication: the request needs a token issued in the last 10 minutes (`iat`), so a stolen
  long-lived session can't delete the account silently; apps re-run sign-in first.

**Tests**: auth (deletes only the caller, revokes tokens, rejects stale `iat`), api-videos
(orchestration order, resumable erase, auth failure surfaces as retryable).

---

## 9.8 Client telemetry ingest (monorepo)

`POST /api/v1/telemetry/events` (batch ≤ 50 events, ≤ 64 KB). Accepted only with
`consent: { analytics: true }` in the batch envelope; otherwise `202` and dropped. Event types:
`qoe` (startup ms, rebuffer ratio, bitrate switches, fatal error code), `crash_breadcrumb`
(app/platform/version, breadcrumbs, no free text beyond 200 chars), `app_event` (allow-listed names).
No user id: an opaque, rotating install id; IP is not stored. Written to Workers Analytics Engine
(`CLIENT_TELEMETRY` dataset per environment), rate limited per install id. Sampling rates come
from remote config (9.5).

**Tests**: schema validation, consent gate, size limits, PII stripping, Analytics Engine row shape.

---

## 9.4 Push notification service (monorepo)

**Design**

- Device registration API: `PUT /api/v1/devices/{installId}` `{ platform, provider: apns|fcm|wns|webpush,
  token | subscription, locale, appVersion, categories? }`, `DELETE` to unregister,
  `GET/PUT /api/v1/notification-preferences` per category (`uploads`, `replies`, `live`,
  `prayer_reminders`). Stored in `NOTIFICATIONS_DB` (new migration `0003_push_devices.sql`).
- Fan-out: the existing notification events (processor) enqueue a `push` message per user on a new
  Queue; a consumer resolves devices + preferences and sends through provider adapters behind one
  `PushProvider` interface. Web push (VAPID, RFC 8291 encryption via WebCrypto) and FCM HTTP v1
  (service-account JWT) and APNs (token-based `.p8` JWT, HTTP/2 via fetch) and WNS (OAuth client
  credentials). Invalid tokens (410/`Unregistered`) delete the device row.
- **Owner input needed**: APNs key/team id, Firebase project service account, WNS package SID/secret,
  VAPID key pair. Adapters ship with tests against recorded responses; they stay disabled per
  provider until the secret exists in the Secrets Store.

**Tests**: registration validation and ownership, preferences, fan-out filtering by category and
locale, per-provider request signing, token pruning on 410.

---

## 9.6 Playback authorization (monorepo, blocked on D2)

Designed behind an interface so D2 (Bunny vs R2 + Cloudflare CDN) only changes the adapter:

```ts
interface PlaybackAuthorizer {
  playback(video, viewer, opts): Promise<{ manifestUrl; expiresAt; headers? }>;
  download(video, viewer, device, rendition): Promise<{ url; expiresAt; license }>;
}
```

- `POST /api/v1/videos/{id}/playback` → short-lived signed manifest URL (visibility rules from
  `lib/visibility.ts` applied first). Today's adapter wraps `lib/bunny-signing.ts` (Bunny token auth).
- `POST /api/v1/videos/{id}/downloads` → download entitlement: `{ entitlementId, deviceId,
  rendition, expiresAt (default 30 days), url }`, bound to the registered install id, max N active
  devices per user; `DELETE` revokes; apps re-validate entitlements when online.
- The R2 adapter (signed URLs via a Worker token check) is written only after D2.

**Tests**: visibility gate, expiry, device binding, entitlement limits; adapter contract tests run
against both the Bunny adapter and a fake.

---

## Out of scope here (filed as `queue` issues)

- `apple-app-site-association` / `assetlinks.json` (needs team id and signing fingerprints).
- `alummahnow.net/activate` redirect on the public site (other repo).
- Admin-web UI for remote config and flags.
- Provider credentials for push (APNs, FCM, WNS, VAPID).
