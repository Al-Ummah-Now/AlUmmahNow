# Local E2E stack

Most E2E specs run against a stack that each CI job boots for itself, not against the shared QA
environment. That keeps them isolated, so jobs run in parallel and shard. `docs/testing/E2E-PLACEMENT.md`
lists which specs run here (**local**) and which still need QA/stage (**deployed**).

## What runs

One Miniflare instance (`scripts/local-stack/boot.ts`) runs every worker, so queues, Durable Objects,
D1, R2, KV and the Secrets Store are shared exactly as in a deployed environment. Each worker
listens on its own port:

| App | Port | Source |
|---|---:|---|
| web (OpenNext build) | 3001 | `apps/web` |
| api-videos | 3086 | `apps/api-videos` |
| websocket-server | 3087 | `apps/websocket-server` |
| processor | 3088 | `apps/processor` |
| admin-api | 3090 | `apps/admin-api` |
| admin-web (OpenNext build) | 3091 | `apps/admin-web` |
| Auth issuer | 3301 | AlUmmahNowAuth `apps/auth`, at its last released commit |
| Auth profile app | 3302 | AlUmmahNowAuth `apps/profile` |
| Auth admin dashboard | 3303 | AlUmmahNowAuth `apps/admin` (React Router build) |

- **Configs.** `scripts/local-stack/configs.ts` generates a local-only wrangler config per app
  (`wrangler.local-stack.json`, gitignored) from the app's top-level wrangler file. It keeps the
  binding shapes (shared databases stay shared) and drops every `remote` flag, preview id, route,
  environment, Workers AI binding and container. Var overrides point every URL at the stack
  (`scripts/local-stack/stack.ts`). A unit test fails when a generated config still names a
  deployed host or a remote resource.
- **Sign-in is real.** The Auth repo's issuer runs with local D1/KV. Boot applies openauth's and the
  Auth app's migrations and rewrites every OAuth client's redirect URIs to the localhost apps. The
  E2E code sink is on (`X-E2E-Secret: local-stack-sink-secret`), as are the test routes
  (`TEST_PROMOTE_SECRET=local-stack-promote-secret`) and run-user marking.
- **Released versions of the sibling repos.** `scripts/local-stack/resolve-refs.ts` finds the commit
  each sibling repo last released: Auth from its last successful Release run on `main`, and the CMS
  and www from their newest successfully released `v*` tag. CI checks that commit out.
- **Nothing leaves the machine.** Every outbound fetch from a worker goes through
  `scripts/local-stack/outbound.ts`:
  - local hosts are passed through;
  - third parties with a fake are answered by the fake;
  - everything else is refused with 502 and logged. That covers QA, production and paid AI.

  The processor's AI steps are off.
- **Values.** Every secret is a local test value (`LOCAL_SECRETS` in `stack.ts`).

## Run it

CI: `.github/workflows/local-stack.yml` builds the web apps and the Auth admin app, boots the
stack, runs `scripts/local-stack/smoke.ts` and puts the boot timings in the job summary.

Locally (one boot at a time; it needs a full `pnpm install`, built shared packages, and for web
and admin-web their OpenNext builds, which are otherwise skipped):

```bash
git clone https://github.com/Al-Ummah-Now/AlUmmahNowAuth .local-stack/repos/auth
git -C .local-stack/repos/auth checkout "$(node --experimental-strip-types --no-warnings scripts/local-stack/resolve-refs.ts auth | sed -n 's/^auth_sha=//p')"
(cd .local-stack/repos/auth && pnpm install)   # needs a GitHub Packages token for @al-ummah-now/openauth
node --experimental-strip-types --no-warnings scripts/local-stack/boot.ts              # runs until Ctrl-C
node --experimental-strip-types --no-warnings scripts/local-stack/boot.ts --check      # boot, health-check, stop
node --experimental-strip-types --no-warnings scripts/local-stack/boot.ts --only api-videos,auth
node --experimental-strip-types --no-warnings scripts/local-stack/smoke.ts             # against a running stack
```

`LOCAL_STACK_AUTH_DIR` points at another Auth checkout, and `LOCAL_STACK_DIR` moves the state dir
(`.local-stack/`). Every boot starts from empty databases. To stop a stack, use Ctrl-C or kill its
PID. Never kill processes by name.
