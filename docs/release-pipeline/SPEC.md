# Release pipeline: spec

> **Current state (2026-11-08):** production releases are triggered by pushing a `vYYYY.MM.DD` tag on `main` (`.github/workflows/release.yml`, PR #286). Pushes to `main` deploy QA only, and `workflow_dispatch` deploys stage only. GitHub enforces this with a `v*` tag ruleset and a `production` environment that accepts only `v*` tags. Where this document says releases run on push to `main` or by dispatch, the tag model in CLAUDE.md "Deploy Rules" supersedes it.

Status: proposed, 2026-11-07. Owner review needed for section 11 (decisions).
Applies to: `Al-Ummah-Now/AlUmmahNow` and `Al-Ummah-Now/AlUmmahNowAuth`.
Auth-specific notes: `AlUmmahNowAuth/docs/release-pipeline.md`.
Phased delivery: [PLAN.md](./PLAN.md).

## 1. Why

On 2026-11-07 we shipped five bugs to production. Each one would have been caught by a test or check that already existed somewhere, or was cheap to add:

| Incident | What would have caught it |
|---|---|
| Web `/api/callback` exchanged the code with a different `redirect_uri` than `login()` sent, so every prod sign-in ended on `/en/auth/error` | A real sign-up → code → sign-in → session E2E against a prod-shaped environment |
| Auth prod job ran bare `wrangler deploy`: localhost issuer and no Secrets Store bindings, so registration failed with `Missing required secret: RESEND_API_KEY` | A config check before deploy and an issuer-metadata smoke check after it |
| Forgot-password crashed on an unknown email (Auth #179) | An E2E (and unit) test for that path |
| Web callback page returned raw `{}` (AlUmmahNow #188) | An E2E that visits `/api/callback` with no code |
| Quality menu didn't open | The player E2E, which never ran: CI Chromium cannot play H.264, so the spec always skipped |

Two more facts shape this design:

- AlUmmahNow's `deploy-production` job has failed on every run since 2026-01 (issue #185). Prod web and api-videos have been deployed by hand since then. Prod processor/websocket are a year behind `main`, and admin-api/admin-web have never been deployed to prod.
- Neither repo has a place where the exact prod build runs with prod config before users get it.

## 2. Goals

1. **Every fix ships with a test that runs in CI.** Unit tests on every PR. E2E against QA on every PR. E2E against stage on every release.
2. **Data changes ship with a migration or a check.** CI fails if a schema or stored-record shape changes without one. Before promote, a check runs against the target environment's real data.
3. **Prod has a stage slot.** A release is built once, deployed to stage, fully tested there, and only then promoted. Rollback is one command (or one click in GitHub Actions).
4. **Nothing reaches prod without passing stage.** No manual `wrangler deploy` to prod workers. The pipeline is the only path, except for the documented break-glass procedure.

Non-goals: replacing QA, per-PR preview environments, load testing.

## 3. Environments

| | dev | QA | stage | prod |
|---|---|---|---|---|
| Purpose | Local work | Integration of in-progress features | The exact release candidate, prod-shaped | Users |
| Code | Your branch | The PR head, or `main` after merge (both repos, once AlUmmahNow has converged: section 3.1) | `main` at the release commit | Promoted from stage |
| Config | top-level wrangler config | `wrangler.qa.json(c)` | `env.stage` in the same file as `env.production` | `env.production` |
| Data | local D1/KV/R2 | QA stores | **Separate stage stores** (section 6.4) | prod stores |
| Email | console/local sink | test sink for `@e2e.alummahnow.net` | test sink for `@e2e.alummahnow.net` | real email only; the sink cannot be enabled |
| Deployed by | you | CI on PR and on merge to `main` | release workflow | release workflow (promote) |

Hostnames:

| App | QA | stage (new) | prod |
|---|---|---|---|
| web | videos.qa.alummahnow.net | videos.stage.alummahnow.net | videos.alummahnow.net |
| api-videos | videos.api.qa.alummahnow.net | videos.api.stage.alummahnow.net | videos.api.alummahnow.net |
| websocket | (QA host) | realtime.stage.alummahnow.net | realtime.alummahnow.net |
| admin-web / admin-api | (QA hosts) | admin.stage.alummahnow.net / admin.api.stage.alummahnow.net | (not yet deployed, #185) |
| auth issuer | auth.qa.alummahnow.net | auth.stage.alummahnow.net | auth.alummahnow.net |
| profile | profile.auth.qa.alummahnow.net | profile.auth.stage.alummahnow.net | profile.auth.alummahnow.net |
| auth admin | admin.auth.qa.alummahnow.net | admin.auth.stage.alummahnow.net | admin.auth.alummahnow.net |

Stage workers are named `<prod-worker-name>-stage`, for example `al-ummah-now-auth-stage` and `al-ummah-now-production-stage`.

### 3.1 One codebase: `main` is the only trunk

**Today (AlUmmahNow only).** QA and prod run different code:

| Branch | Runs on | State |
|---|---|---|
| `integrate/qa-features` | QA | 177 commits ahead of `main`, 20 behind; 867 files differ |
| `main` | prod | Deployed by hand; main's Deploy workflow hasn't deployed since Jan 2026 (#185) |
| `develop` | nothing | Stale |

A fix tested on QA isn't the code users get, and prod hotfixes made on `main` are missing from QA. AlUmmahNowAuth already uses `main` for both QA (PRs) and prod, and stays that way.

**Target (both repos):** PR → CI → QA (deployed from the PR, or from `main` after merge) → stage → promote to prod. There are no long-lived integration branches.

**Branch rule (owner, binding).** Always fix on `main` and always deploy from `main`, QA included. No fix lands on `integrate/qa-features` or `develop`. Stage-then-promote is the target path to prod, but main's fixes and deploys never wait for it. Prod switches to it once it works (phase 7).

**Getting there** (PLAN phase C):

1. **Converge now: land integrate into `main`.** A single PR into `main` (#217) merges `integrate/qa-features` together with main's hotfixes (#188, #197, #205, #209, #214, #211, #218, Bunny signing, bulk-delete ownership). Where both branches fixed the same thing, integrate's version stays, but only if the behaviour matches. Where main changed later (for example, #218's admin role helpers), the merge resolves toward main. Merging deploys nothing, because prod deploy is manual (`workflow_dispatch`).
2. **QA deploys from `main`.** Once main contains integrate's code, the QA deploy builds from `main`, on merge or as PR previews. Then `integrate/qa-features` and `develop` are frozen, tagged (`archive/integrate-qa-features`, `archive/develop`), removed from every workflow trigger, and deleted.
3. **Prod from converged `main`.** Each app deploys to prod from `main`. The prod data steps below run first. Until stage-then-promote works, a prod deploy is gated by the QA E2E and the release regressions passing on `main`, plus the prod smoke. After that, every prod deploy goes through stage.

**Prod data integrate needs.** Both are expand-only: the code serving prod today doesn't read either one, so they can run before the promote and survive a rollback.

| Data | Prod today | Step (rehearsed on stage first) | Pre-promote check |
|---|---|---|---|
| Search D1 with the API ownership index (`apps/api-videos/migrations/search/`: `0001_search_index`, `0002_content_ownership`) | Doesn't exist | Create the prod `SEARCH_DB`, apply the migrations, run the rebuild pass (`POST /internal/search/backfill`, `scripts/search-backfill.sh`) until it reports `complete`. Readers fall back to bucket scans until then, so an incomplete index is slow, not wrong. | The index reports `complete`, and the row counts match the bucket object counts |
| Translations in R2 (`translationsGet` reads them; `translationsSync` seeds them) | No stored translations (#214 made the web app quiet about the 404s) | Seed with `translationsSync` | Every supported locale's object exists with the expected version |

Both steps become part of AlUmmahNow's data-contract checks (section 6.3). The release workflow runs them against stage first and against prod before shifting traffic.

## 4. How stage and promote work

### 4.1 Options considered

**A. Workers versions only.** `wrangler versions upload` a new prod version without traffic, test it on its version preview URL, then `wrangler versions deploy <id>@100%`.

We rejected this as the *test* slot:
- Preview URLs exist only on `*.workers.dev`. OAuth clients register exact redirect URIs, and openauth 1.0.17 compares them exactly, so each version would need a new registration. Session cookies are scoped to `.alummahnow.net`, and auth CORS allows `*.alummahnow.net`. A sign-in on a `workers.dev` URL doesn't exercise the real flow. That flow is exactly where the redirect_uri bug lived.
- Cloudflare does not generate preview URLs for Workers that use Durable Objects (websocket-server).
- Calls from one worker to another (web → auth token exchange, web → api) reach the other worker's *active* version, not its candidate. A multi-worker release can't be tested as a unit.
- The candidate shares prod D1/KV/R2. A sign-up E2E would write test users into prod data.

**B. Separate stage workers on stage hostnames (chosen for testing).** Each prod worker gets a `-stage` twin. It's deployed from the same release commit and the same wrangler file (`env.stage` next to `env.production`), with its own data stores. Real hostnames, real cookies, real OAuth clients, real cross-worker calls, Durable Objects. The full E2E suite runs here.

**C. Workers versions for the switch (chosen for promote).** Once stage passes, the pipeline uploads the prod version and smoke-tests it *on the prod hostnames before it takes traffic*:

1. `wrangler versions upload --env production` (the new version gets no traffic).
2. `wrangler versions deploy <new>@0% <current>@100%`. Users are still on `<current>`, but `<new>` is now part of the deployment, which makes it addressable.
3. Pre-traffic smoke: requests to the real prod hostname with `Cloudflare-Workers-Version-Overrides: <worker>="<new>"` run on `<new>` with prod bindings and secrets. This catches the "bare `wrangler deploy`" class of bug (wrong env, missing bindings) before any user sees it.
4. `wrangler versions deploy <new>@100%`.
5. Post-promote smoke. On failure: automatic rollback to `<current>`.

Durable Object workers (websocket-server) skip steps 2–3, so two versions never serve the same live Durable Object instances. They promote with `versions deploy @100%` and rely on the post-promote smoke and rollback.

We'll revisit Cloudflare's newer "Previews" feature (`wrangler preview`, custom-domain previews, per-preview bindings) once it's out of beta. It could replace the stage workers, but promotion would still be a redeploy rather than a version switch.

### 4.2 Build once

The release workflow builds each app once and uploads the build as a GitHub Actions artifact. Stage and prod both deploy from that artifact.

- **Workers without a framework build** (auth, profile, audit-consumer, api-videos, admin-api, processor, websocket-server): `wrangler deploy --dry-run --outdir dist` bundles once. Stage and prod both deploy `dist/` with `--no-bundle`. Config differences between stage and prod are bindings and vars only, resolved at runtime. The bundle hash is recorded in the release summary.
- **auth admin** (React Router on Workers): built once with `vite build`. Runtime config comes from bindings.
- **web and admin-web** (Next 16 + OpenNext): Next inlines `NEXT_PUBLIC_*` at build time, and web inlines host-specific values (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEBSOCKET_URL`, Bunny URLs). Until those move to runtime config (PLAN phase 8), the release job builds web **twice, in one job, from one checkout and one lockfile**: once with stage public env, once with prod public env. Both builds are uploaded. Every non-`NEXT_PUBLIC` value is already runtime. Moving the host values to runtime config makes it truly build-once.

### 4.3 How stage and prod auth relate

The issuer URL is baked into every token (`iss`), so web cannot test against prod auth from stage hosts without minting prod tokens for stage. **Stage web uses stage auth.**

- Stage auth has its own D1/KV and its own registered clients. Each client mirrors its prod client (same client ID scheme, stage redirect URIs).
- Stage web, stage profile and stage auth-admin are clients of `https://auth.stage.alummahnow.net`.
- Rule: **outside a release, stage = prod for every worker.** Each release ends by redeploying stage to whatever was promoted. When auth releases, stage web is the current prod web, and the reverse. A release therefore always tests its candidate against the versions of the other repo's apps that users actually run.
- Releases in the two repos must not overlap on stage. GitHub concurrency groups are per-repo, so the release workflow takes a lock in the stage KV (`release-lock`, 2h TTL) and waits for it. PLAN phase 7 adds it.

## 5. The flow

### 5.1 On a pull request (into `main`)

Required checks, both repos:

1. Install with `packages: read`. Lint, typecheck.
2. Unit tests for every app. **No `continue-on-error`.** (AlUmmahNow `deploy.yml` currently has `continue-on-error: true` on tests, so a failing test never blocks.)
3. Data checks (section 6): migration immutability, schema snapshot, data-contract snapshot.
4. Config checks (section 8): every `env.production` and `env.stage` has the right `ENVIRONMENT`, issuer, routes and required bindings, and no test-only bindings in production.
5. Build every deployable app (catches build-only breakage).
6. E2E against QA (auth: the existing `qa-e2e.yml`, now including the regression specs; AlUmmahNow: `e2e-tests.yml` and `release-e2e.yml`. PRs target `main`. The `integrate/*` triggers go away in phase C3).

Runners: `ubuntu-24.04` for anything that installs Playwright browsers (`ubuntu-latest` = 26.04 has no builds). Node 22 everywhere (wrangler requires ≥ 22).

### 5.2 On merge to `main`: the release workflow (`release.yml`)

One workflow per repo, `concurrency: release-<repo>, cancel-in-progress: false`.

```
build ──► data-compat (prod, read-only) ──► stage: migrate ─► deploy ─► smoke ─► E2E
                                                                         │
     ┌───────────────────────────────────────────────────────────────────┘
     ▼
 prod: migrate (expand-only) ─► upload versions ─► @0% + override smoke ─► @100% ─► smoke
                                                                                   │ fail
                                                                                   ▼
                                                                        auto-rollback + alert
     then: redeploy stage = prod, release summary
```

1. **build**: section 4.2. Output: bundles, the version ids of what prod runs now (`wrangler deployments list --json`), release manifest.
2. **data-compat**: runs the new code's record validators against a read-only sample of **prod** data (section 6.3). It also lists pending D1 migrations for prod. They must all be migrations that are about to be applied to stage in step 3.
3. **stage**: take the stage lock. Apply D1 migrations to stage, run data migrations on stage. Deploy all stage workers (consumers before producers). Smoke-check stage. Run the full E2E suite against stage.
4. **prod migrate**: apply D1 migrations and data migrations to prod. Migrations must be backward compatible with the code currently in prod (expand/contract, section 6.1), so this is safe before promote and safe to roll back across.
5. **promote**: section 4.1 C, per worker, consumers before producers.
6. **prod smoke**: section 7.3. On failure: `wrangler rollback` every worker promoted in this run to its recorded previous version, mark the run failed, open an issue labelled `incident`.
7. **sync stage**: redeploy stage to what prod now runs. Release the lock.

GitHub environments: `stage` (no approval) and `production`. Whether `production` requires a manual approval click is an owner decision (section 11). The default proposal is no approval: stage E2E is the gate.

### 5.3 Rollback

- **One click**: run the `Rollback` workflow (`workflow_dispatch`). Pick the repo and either "previous release" (default) or a release tag. It runs `wrangler rollback <version-id>` for every worker in that release's manifest, in producer-to-consumer order, then runs prod smoke.
- **One command** (locally, with wrangler auth): `pnpm release:rollback [--to <release-tag>]` does the same thing.
- **What rollback does not undo**: D1 and data migrations. They are expand-only, so the previous code runs fine on the migrated schema. That's the reason for the expand/contract rule.
- A rollback drill runs once when the pipeline goes live and again quarterly (PLAN phase 8).

### 5.4 Break-glass

When the pipeline itself is broken and prod is down: `workflow_dispatch` on `release.yml` with `skip_stage_e2e: true`. It requires the `production` environment's approval, is logged in the release summary, and still runs config checks and prod smoke. A manual `wrangler deploy` from a laptop is not part of the process.

## 6. Data: migrations and compatibility

### 6.1 The rule: expand, then contract

Every data change that ships with a release must work with **both** the new code and the code currently in prod:

- Adding a table, column (nullable or with default), index, or new optional field in a stored record is fine in one release.
- Renaming or removing something, tightening a type, or making a field required takes two releases. Release 1: new code reads both shapes and writes the new one, and a migration backfills. Release 2 (after release 1 is promoted and verified): remove the old shape.
- This is why rollback never needs a down-migration.

### 6.2 D1 (auth `al-ummah-now-d1`; AlUmmahNow reports, search, processor, notifications DBs)

CI checks on every PR:
1. **Migrations are append-only.** Any file under a `migrations*/` dir that exists on the base branch must be unchanged. New files must sort after the last existing one.
2. **Schema snapshot.** CI applies every migration, in deploy order, to an empty in-memory SQLite database (`node:sqlite`; D1 is SQLite) and renders the resulting schema (`sqlite_master`, normalized) as `schema.snapshot.sql` next to (not inside) the migrations dir. Wrangler applies every `.sql` file inside it. If the dump differs from the committed snapshot, CI fails. The snapshot changes only when a migration is added, so reviewers see the schema diff in the PR.
3. **Code runs against migrated schema.** The repository-layer tests run against that freshly migrated database, not hand-written fixtures. Code that uses a column no migration creates fails here.
4. **openauth package bumps.** `@al-ummah-now/openauth` ships its own schema (`openauth migrate`). A lockfile change to that package requires the schema snapshot to be regenerated, which includes the openauth tables.

Prod and QA migration dirs: auth currently has `migrations/` (prod) and `migrations-qa/` (QA) with diverging histories. Stage uses `migrations/`, the prod history, so a migration is proven on stage before prod. QA's separate history stays as is, but each new migration must be added to both.

### 6.3 KV and R2 records (data contracts)

Much of AlUmmahNow's data is JSON in R2 (`videos`, `channels`, `profiles`, `playlists`, `global-settings`, `translations/<locale>.json`). Auth keeps sessions, rate-limit and openauth state in KV.

- **Contracts.** Each stored record type has a schema (zod/valibot, whatever the app already uses) in `packages/data-contracts` (AlUmmahNow) or `apps/auth/src/contracts` (auth), keyed by prefix: e.g. `r2:channels:channels/<id>.json` → `ChannelRecordV3`.
- **Versioned readers.** New record shapes add a version. The reader accepts the current and previous versions.
- **Contract snapshot.** CI generates a JSON Schema snapshot of all contracts (`data-contracts.snapshot.json`). If it changes, the PR must also add a file under `data-migrations/` (an idempotent script, or a `noop` file explaining why existing records are already valid). Otherwise CI fails.
- **Pre-promote compatibility check** (`check-data-compat --env <stage|production>`): read-only. For every contract it lists up to N keys per prefix (default 200, newest first, plus a random sample), fetches them, and validates them with the *new* code's readers. Any failure blocks the release and is reported with key names only, never values. It runs against prod in step 2 (before anything changes) and against stage after stage migrations.
- **Translations.** `translations/<locale>.json` in R2 is validated against the key set of the web's bundled `messages/en.json`. Keys used by the new code but missing from stored translations fail the check unless the code has a bundled fallback for them.
- **Data migrations** (`data-migrations/NNNN_name.ts`) run via `pnpm data:migrate --env <stage|production>`. They're idempotent, record completion in a `_data_migrations` marker (D1 table or KV key), and run stage-first in the release workflow.

### 6.4 Stage data

Stage has its own D1 databases, KV namespaces, R2 buckets and queues (`*-stage`), with the prod schema from prod's migration history plus seed fixtures (roles, clients, a catalogue of test channels and videos). It does **not** copy prod user data by default. Whether to load an anonymized prod snapshot periodically is an owner decision (section 11). Compatibility against real prod data is covered by the read-only check in 6.3.

## 7. Tests

### 7.1 Test matrix

| App | Unit (PR) | E2E on QA (PR) | E2E on stage (release) | Pre-traffic smoke (prod, override header) | Post-promote smoke (prod) |
|---|---|---|---|---|---|
| auth | vitest, incl. handlers against migrated D1 | existing qa-e2e + regression specs | sign-up → code → sign-in → session; forgot-password (known + unknown email); token refresh/revoke | issuer metadata, JWKS, `/health` reports bindings OK, `/test/*` = 404 | same, plus authorize page renders for each registered prod client |
| profile | vitest | login, profile edit | full sign-up/sign-in through profile client | `/` 200 | `/` 200, login redirect goes to prod issuer with exact registered redirect_uri |
| auth admin | vitest | existing admin suites | admin sign-in, list users, audit view | `/` 200 | same |
| audit-consumer | vitest | via auth E2E (audit view) | audit event appears after sign-in | n/a (queue consumer) | queue backlog not growing |
| web | vitest + RTL | `e2e-tests.yml` suite (5 browser projects, shared user pools) | sign-up → code → sign-in → session; callback without code shows localized error; player plays and quality menu opens; core browse/watch | `/en` 200, `/api/callback` (no code) → localized error page, not JSON | same, plus optional synthetic password sign-in (section 11) |
| api-videos | vitest | via web E2E | via web E2E + API contract tests | `/health` | `/health`, list endpoint 200 |
| admin-api / admin-web | vitest | `admin-e2e.yml` | admin sign-in and moderation smoke | `/health` / `/` 200 | same |
| processor / websocket | vitest | via web E2E (notifications, realtime) | via web E2E | n/a | connect + ping (websocket) |

E2E suites take their targets from env vars (`E2E_ENV=qa|stage`, hostnames, client ids), so the same specs run on QA and stage.

### 7.2 Player tests must actually run

CI Chromium (Playwright's build) has no proprietary codecs, so H.264 fixtures never play and the player spec skipped itself. Two changes:
1. The player project runs with Playwright `channel: 'chrome'` (Google Chrome, which has H.264), installed with `npx playwright install --with-deps chrome`.
2. A VP9/WebM fixture is added so the spec can also run on Chromium and Firefox.

A spec that cannot play media now **fails** instead of skipping when `CI=true`.

### 7.3 Smoke checks (`scripts/smoke.ts`, per repo)

Small, fast, no sign-up, safe against prod:
- auth: `GET /.well-known/oauth-authorization-server`: `issuer` equals the expected issuer for the env (prod: `https://auth.alummahnow.net`); `token_endpoint` and `authorization_endpoint` are on the same host. `GET /.well-known/jwks.json` returns ≥ 1 key. `GET /health` returns `{ status: "ok" }` with every required binding present. `GET /test/email/x` returns 404 in prod.
- auth clients: for each registered prod client, `GET /authorize?client_id=…&redirect_uri=<registered>&response_type=code` renders the login page (200, not an error page).
- web: `/en` and `/ar` return 200 with the expected `<html lang dir>`. `/api/callback` with no code redirects to `/<locale>/auth/error`, and the response is HTML, not `{}`. The login action's authorize URL has `redirect_uri` exactly equal to what `/api/callback` will exchange with.
- api-videos: `/health` 200.

## 8. Config checks

`scripts/check-wrangler-config.ts` in each repo runs in CI and as the first step of every deploy job. For every deployable app it parses the wrangler file and asserts:
- `env.production` and `env.stage` exist (once the app is in the pipeline), and every deploy command names one of them explicitly. A bare `wrangler deploy` in a workflow or package script for a pipeline app fails the check.
- `vars.ENVIRONMENT` is `production` / `stage`. Auth: `OPENAUTH_ISSUER` matches the env's expected host.
- Required bindings exist in both envs. The same binding names and kinds appear in stage and prod; only resource ids, names and routes may differ (parity check). Auth: `CLIENT_SECRET_SALT`, `KEY_ENCRYPTION_MASTER_KEY`, `RESEND_API_KEY` from Secrets Store, plus `AUTH_DB`, `AUTH_STORAGE`, `AUDIT_QUEUE`.
- `env.production` contains no test-only binding (`E2E_CODE_SINK_SECRET`, `TEST_PROMOTE_SECRET`) and no `localhost` value.
- Routes in `env.production` are only prod hostnames; routes in `env.stage` are only `*.stage.alummahnow.net`.

## 9. Reading email codes in E2E

### 9.1 Today

Auth's E2E lists recent emails through the Resend API and parses the code out of the HTML. That needs a full-access Resend key in CI, sends real email for every test, and hits Resend rate limits under parallel runs. A KV `test:email:<addr>` sink also exists, but only for `localhost`.

### 9.2 Design: a test code sink, stage/QA only

When **all** of these hold, auth does not send the email. It stores `{ code, at }` in KV under `test:email:<addr>` (10-minute TTL) and returns as if sent:
1. The recipient's domain is exactly `e2e.alummahnow.net`. This subdomain has no MX record, so a code sent there could never be delivered anyway.
2. `ENVIRONMENT` is `qa` or `stage` (or `development` on localhost).
3. The `E2E_CODE_SINK_SECRET` binding is present.
4. The issuer host is not `auth.alummahnow.net`.

Before storing, auth still resolves `RESEND_API_KEY`. A missing secret fails exactly as it would for a real user, so the incident's failure mode is still exercised.

Tests read the code with `GET /test/email/<addr>` and the header `X-E2E-Secret: <secret>`. A wrong or missing secret gets 404 (not 401, so the route isn't discoverable).

Why it cannot be enabled in prod (four independent layers):
- Prod config does not bind `E2E_CODE_SINK_SECRET`. The config check (section 8) fails CI and any deploy if it ever does.
- The code requires `ENVIRONMENT ∈ {qa, stage, development}` *and* an issuer that isn't the prod host. Prod has `ENVIRONMENT=production` and the prod issuer.
- Unit tests cover every combination, including "prod env with secret bound" → real send.
- Pre-traffic and post-promote prod smoke assert `GET /test/email/…` returns 404 with a valid-looking secret.

One stage test per release still sends a real email through Resend to `delivered@resend.dev` (Resend's test address) and checks that the send succeeded, so actual delivery is covered.

The same change puts all other `/test/*` and `/test/debug/*` routes behind the same secret. Today `/test/debug/kv`, `/test/debug/clients` and `/test/debug/roles` are unauthenticated on QA, and `/test/debug/kv` returns KV values.

## 10. Secrets

| Secret | Where | Used by |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub env `stage` and `production` (separate tokens if possible) | wrangler. Scopes: Workers Scripts/Routes, D1, KV, R2, Queues, Secrets Store read |
| `CLOUDFLARE_ACCOUNT_ID` | repo var | wrangler |
| `E2E_CODE_SINK_SECRET` | Secrets Store `E2E_CODE_SINK_SECRET_STAGE` / `_QA`, and GitHub env `stage` / QA | auth sink (bound in stage/QA only), E2E |
| `RESEND_API_KEY` | Secrets Store (prod, `_QA`, `_STAGE`); GitHub only for the one delivery test | auth |
| `CLIENT_SECRET_SALT`, `KEY_ENCRYPTION_MASTER_KEY` | Secrets Store, a separate `_STAGE` value | auth |
| Web/admin client secrets for stage | Secrets Store / worker secrets on stage workers | web, auth admin |
| `PROD_SMOKE_USER` / `PROD_SMOKE_PASSWORD` (optional) | GitHub env `production` | synthetic prod sign-in (section 11) |
| `GITHUB_TOKEN` with `packages: read` | automatic | installs `@al-ummah-now/*` |

Stage never uses a prod secret value. Stage signing keys are separate, so a stage token is never valid in prod.

## 11. Decisions for the owner

1. **Approval click before prod.** Proposed: none (stage E2E is the gate), with break-glass requiring approval. Alternative: require a reviewer on the `production` environment for every release.
2. **Stage hostnames.** Proposed: as in section 3, `*.stage.alummahnow.net`. Workers custom domains issue a certificate per hostname, so the nested names (`profile.auth.stage…`) need no extra certificate purchase.
3. **Stage data.** Proposed: seeded fixtures only, no prod PII. Alternative: weekly anonymized prod snapshot into stage D1/R2 (more realistic, needs an anonymization script and a PII sign-off).
4. **Synthetic prod sign-in.** A dedicated prod account (`smoke@alummahnow.net`, password login, no content) used by post-promote smoke for a full sign-in → session check in prod. This is the only check that would have caught the redirect_uri bug *in prod* if stage had somehow differed. Needs: the account, its password in the `production` environment, and acceptance that it shows up in prod analytics. It can be excluded by user id.
5. **AlUmmahNow prod catch-up (#185).** The pipeline will promote every app it manages. Processor and websocket in prod are a year behind and admin apps were never deployed. Proposed: at first the pipeline manages **web and api-videos** only (what's actually deployed and changing). Processor, websocket and admin apps join after #163/#185 are resolved, with a one-time verified catch-up release. The admin apps' first prod deploy is done from `main` by a separate workstream (#218), outside this pipeline.
6. **Cost.** Stage adds about 10 workers, 4 D1 databases, 2–3 KV namespaces, 6 R2 buckets and 3 queues. On the Workers Paid plan these fit in included usage at E2E volume. Bunny already has `*-staging` zones. Resend: stage sends use the sink, so no extra volume. Expected extra cost: approximately $0. Confirm the account is on Workers Paid.
7. **One trunk (decided by the owner).** `main` is the single trunk for AlUmmahNow, as it already is for auth. Fixes land on `main` and every deploy, QA included, is built from `main`. `integrate/qa-features` and `develop` are retired after convergence (section 3.1, PLAN phase C).
8. **First prod deploy of converged `main`.** This deploy takes integrate's 177 commits to prod, the largest change prod will see. Stage doesn't block main deploys, so the gate is QA E2E plus the release regressions on `main`. Proposed: deploy app by app (api-videos first, then web) at a low-traffic time, with `wrangler rollback` ready. A rollback restores code only; the expand-only data steps stay. The owner picks the window, and whether to wait for stage instead.

## 12. Incident regressions

Each has a named test that runs where it would have caught the bug:

| # | Incident | Test | Runs in |
|---|---|---|---|
| R1 | Callback redirect_uri mismatch | `e2e/release/signup-signin.spec.ts` in AlUmmahNow (web) and in AlUmmahNowAuth (profile, auth admin). Unit: `actions.test.ts` asserts the authorize `redirect_uri` equals the exchange `redirect_uri` | QA PR E2E, stage E2E; unit on every PR; smoke checks the authorize URL in prod |
| R2 | Bare `wrangler deploy` (dev config to prod) | `check-wrangler-config` (fails on bare deploy commands, wrong `ENVIRONMENT`/issuer, missing Secrets Store bindings); auth `smoke.ts` issuer check | every PR; before every deploy; pre-traffic and post-promote |
| R3 | Forgot-password crash, unknown email | `e2e/release/forgot-password.spec.ts` (known and unknown email); unit `send-code-handler.test.ts` | QA PR E2E, stage E2E, every PR |
| R4 | Callback returns `{}` | `e2e/release/callback-errors.spec.ts` (no code, bad code, provider error); smoke checks `/api/callback` | QA PR E2E, stage E2E, prod smoke |
| R5 | Quality menu doesn't open, player E2E always skipped | `31-video-player.spec.ts` on `channel: 'chrome'` + VP9 fixture; fails instead of skipping under CI | QA PR E2E, stage E2E |
