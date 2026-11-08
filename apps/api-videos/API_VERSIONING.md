# API versioning and the public contract

Native apps (Epic 9, `aun-core`'s `aun-api`) are generated from this API's OpenAPI document, so the
document is a contract.

## Paths

- Public routes answer under **`/api/v1/...`**. The worker rewrites `/api/v1/<rest>` to
  `/api/<rest>` (`src/lib/api-version.ts`), so one set of handlers serves both paths.
- The unversioned `/api/...` path is an alias of v1, kept for the web apps. New clients call `/api/v1`.
- Versioned responses carry `X-API-Version: 1`. An unknown version (`/api/v7/...`) answers
  `404 {"error":"unsupported_api_version"}`.

## The contract file

- `openapi/v1.json` is generated from the real chanfana routers:
  `pnpm --filter @al-ummah/api-videos openapi:generate`. Commit it with the route change.
- It is served at `GET /api/v1/openapi.json`.
- `test/openapi-contract.spec.ts` (in `test:unit`, the required `validate-api` CI job) fails when the
  file is out of date, when it documents an operation Hono does not serve, or when paths are not
  versioned. Internal routes (`/internal/*`, `/test*`, `/api/i18n/sync`, monitoring) are not part of it.
- Only chanfana `OpenAPIRoute`s are documented. Plain Hono handlers (TUS proxy, avatar/cover uploads)
  are not in the contract yet; give new public endpoints a chanfana route.

## What may change in v1

| Change | v1? |
|---|---|
| New endpoint, new optional request field, new response field | Yes (bump `CONTRACT_VERSION` minor) |
| Fix a description or example | Yes (patch) |
| Remove or rename an endpoint or field, change a type, make an optional field required, change error codes clients rely on | **No**: add `/api/v2/...` handlers |

Clients must ignore unknown response fields and unknown enum values.

## Deprecation policy

1. Add the operation to `DEPRECATIONS` in `src/lib/api-version.ts` (`"GET /api/v1/..."` → `since`,
   `sunset`, optional `link`) and regenerate the contract: it is marked `deprecated: true`, and
   responses carry `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers.
2. It keeps working for **at least 6 months** after the first app release that stops calling it,
   **and** until `/api/v1/app-config`'s minimum versions exclude every app build that still calls it.
3. Only then is it removed (and a v1 removal is a breaking change, so in practice it moves to v2).

## Minimum supported app version

`GET /api/v1/app-config?platform=ios&app=viewer&version=1.4.2` returns the API versions and
`update.status`: `required` (below `minimumVersion`: apps show a blocking update screen),
`recommended` (below `latestVersion`) or `ok`. Policies live in the `APP_CONFIG` KV namespace, key
`versions`: `{ "viewer/ios": { "minimumVersion": "1.2.0", "latestVersion": "1.4.0", "storeUrl": "https://..." }, "viewer/*": {...} }`.
Without that namespace or with an invalid document, nothing is blocked (minimum `0.0.0`).
