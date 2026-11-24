# Access-token audience (`aud`) allowlists

Auth signs every client's access tokens with the same key and sets `aud` to the OAuth client id
that obtained the token. openauth's `client.verify()` returns `aud` but never compares it, so
until 2026-11-14 a token issued to any client (the CMS, www, the Auth profile app) was accepted by
every service. Each service now names the clients it takes tokens from.

## Where it lives

- Registry and rules: `packages/shared-types/src/token-audience.ts`
  - `FIRST_PARTY_CLIENT_IDS`: client ids per Auth environment, copied from Auth's client
    registry (`AlUmmahNowAuth/apps/auth/migrations` for production and stage, whose rows are seeded
    from production, and `migrations-qa` for QA). The environment comes from the issuer host; the
    local stack's Auth runs the production migrations.
  - `SERVICE_AUDIENCES`: which clients each service takes.

| Service | Takes tokens from |
|---|---|
| api-videos | web, admin-web, www (profile read at sign-in), sites, every native app |
| admin-api | admin-web, web (Studio site domains, contact), every native app |
| websocket-server | web, admin-web, every native app |
| web | web only (its own session) |
| admin-web | admin-web only (its own session) |

- `ROUTE_AUDIENCES`: an extra client a service takes on one route only (`METHOD /path`, exact).
  Today:
  - `api-videos` takes Auth's profile site (`authProfile`, client id `109a1087-6626-40f7-8a7f-7f42f83f4f30` in QA, stage and production) on `DELETE /api/privacy/data` alone. Auth's self-service `/delete-account` flow sends the signed-in user's own token there to erase their Videos data before deleting their Auth account (AlUmmahNowAuth#532). Every other `api-videos` route (including `GET /api/privacy/export` and `PUT /api/privacy/consent`) refuses that token in `enforce`.
  - `admin-api` takes Auth's admin site (`authAdmin`) on `POST /api/translate/fields` alone. The Auth admin's server sends the signed-in staff member's own token there for the Translate buttons on its English/Arabic fields; `content:translate` (admin roles) still decides, and the per-staff daily cap and audit row carry that person's id. Every other `admin-api` route refuses that token in `enforce`.

The CMS checks `aud` itself (`AlUmmahNowCMS/src/lib/oidc.ts`, `audience: clientId`). The media
worker takes no access tokens (signed `/priv` URLs and the internal key only).

- Hooks: api-videos and admin-api `validateJWTWithSignature` (also admin-api `verifyAccessToken`),
  websocket-server `clientMayConnect`, web `getOpenAuthClient`, admin-web `getAuthClient`.

A new client (a new app, or a new native platform) needs its id for every environment here, in
the same PR that starts sending its tokens.

## Modes (`AUD_MODE` var)

- `log` (default): a token from another client is accepted and logged as a `warn` with
  `event: "aud_mismatch"`, the service, client id and name, issuer and route. Never the token.
- `enforce`: the token is refused (401; the websocket says `AUTH_FAILED`; a site treats the session
  as invalid).
- `off`: no check.

websocket-server keeps `ALLOWED_CLIENT_IDS`: when set it replaces the registry and is always
enforced (tests, local). It is unset on QA, stage and production.

## Rollout

1. Log only (this release). Read QA, stage and production Worker logs (Observability, read only)
   for `aud_mismatch` over a few days of real traffic.
2. When there are none (or each one is understood and added), a follow-up PR sets enforce.
