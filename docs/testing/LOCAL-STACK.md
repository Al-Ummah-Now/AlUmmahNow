# Local E2E stack

Most E2E specs run against a stack that each CI job boots for itself, not against the shared QA
environment. That keeps them isolated, so jobs run in parallel and shard. the placement table (`node --experimental-strip-types --no-warnings scripts/e2e/placement-doc.ts`, also in the Local E2E build job's summary)
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
| Fake CDN + control API | 3190 | `scripts/local-stack/fake-external.ts` |
| Browser proxy | 3191 | `scripts/local-stack/browser-proxy.ts` |

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
- **Released versions of the sibling repos, as built artifacts.** `scripts/local-stack/resolve-refs.ts`
  finds the commit each sibling repo last released: Auth from its last successful Release run on
  `main`, and the CMS and www from their newest successfully released `v*` tag. For every released
  commit, the Auth repo publishes `local-stack.tar.gz` and its sha256 on the prerelease
  `local-stack-<sha12>` (its `local-stack-bundle.yml` workflow). The tarball holds the prebuilt auth,
  profile and admin workers, their wrangler configs and every migration.
  `scripts/local-stack/fetch-auth.ts` downloads the newest one, verifies the sha256 and unpacks it.
  Nothing of that repo is checked out or installed. That is what lets the local suites run on pushes
  to `main` and in releases without CodeQL's cache-poisoning finding.
- **Nothing leaves the machine.** Every outbound fetch from a worker goes through
  `scripts/local-stack/outbound.ts`:
  - local hosts are passed through;
  - third parties with a fake are answered by the fake;
  - everything else is refused with 502 and logged. That covers QA, production and paid AI.

  The processor's AI steps are off.
- **Fakes** (`scripts/local-stack/fake-external.ts`), registered with the outbound router:
  - **Bunny Stream** (`video.bunnycdn.com`): videos and TUS uploads, with offsets kept for resumes.
    A completed upload is "processing", then becomes encoded after `FAKE_BUNNY_ENCODE_MS` (default
    2000), with the duration and size read from the MP4. `FAKE_BUNNY_ENCODE=manual` holds encodes
    until a test asks for one.
  - **Bunny CDN** (`vz-local-stack.b-cdn.net`): the player's HLS fixtures (the short one for vertical
    videos), thumbnails and MP4s. Encoded videos only; before the encode it answers 404, like Bunny.
  - **Bunny Storage and the image host** (`images.alummahnow.net`).
  - **Resend**: emails are kept, never sent.
- **Control API.** `http://127.0.0.1:3190` (loopback only) has:
  - `GET /__fake/bunny/videos[/<guid>]`;
  - `POST /__fake/bunny/videos/<guid>/encode|fail|hold`;
  - `GET /__fake/resend/emails`;
  - `POST /__stack/d1/<database name>`, which runs the request body as SQL. The seed uses it for roles
    and creator tiers, and specs that are not about auth can use it as a fast path.
  - `GET|PUT|DELETE /__stack/r2/<bucket name>/<key>`: one object of a stack R2 bucket (fixtures a spec
    seeds in R2, such as the admin suite's legacy profile record); without a key,
    `GET /__stack/r2/<bucket name>?prefix=<p>[&cursor=<c>]` lists keys (`{ keys, cursor }`, 1000 a page).
- **The browser's proxy** (`scripts/local-stack/browser-proxy.ts`, `http://127.0.0.1:3191`): Playwright
  runs on the local stack with `proxy` set to it and with `ignoreHTTPSErrors`. HTTPS to a faked host is
  terminated there with a throwaway self-signed certificate and answered by the same fakes. Localhost
  is passed through, and everything else is refused. Pages keep their real CDN URLs, no spec changes,
  in every browser, and a local run can never load QA or production.
- **Fixtures.** The QA seed (`apps/web/e2e/seed/seed-qa.ts`) runs against the stack. Its accounts sign
  up through the real local issuer, with codes from the sink. Its videos are real TUS uploads that the
  fake Bunny encodes. Roles and tiers go through `SEED_D1_URL`. The data is the same on every run (see
  the Seed step in `local-stack.yml` for the environment).
- **Values.** Every secret is a local test value (`LOCAL_SECRETS` in `stack.ts`).

## Run it

CI: `.github/workflows/local-stack.yml` builds the web apps and the Auth admin app, boots the
stack, runs `scripts/local-stack/smoke.ts` and puts the boot timings in the job summary.

Locally (one boot at a time; it needs a full `pnpm install`, built shared packages, and for web
and admin-web their OpenNext builds, which are otherwise skipped):

```bash
node --experimental-strip-types --no-warnings scripts/local-stack/fetch-auth.ts   # Auth's last released bundle into .local-stack/repos/auth
node --experimental-strip-types --no-warnings scripts/local-stack/boot.ts              # runs until Ctrl-C
node --experimental-strip-types --no-warnings scripts/local-stack/boot.ts --check      # boot, health-check, stop
node --experimental-strip-types --no-warnings scripts/local-stack/boot.ts --only api-videos,auth
node --experimental-strip-types --no-warnings scripts/local-stack/smoke.ts             # against a running stack
```

`LOCAL_STACK_AUTH_DIR` points at another Auth checkout, and `LOCAL_STACK_DIR` moves the state dir
(`.local-stack/`). Every boot starts from empty databases. To stop a stack, use Ctrl-C or kill its
PID. Never kill processes by name.
