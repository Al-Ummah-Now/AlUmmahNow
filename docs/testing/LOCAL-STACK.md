# Local E2E stack

Most E2E specs run against a stack that each CI job boots for itself, not against the shared QA
environment. That keeps them isolated, so jobs run in parallel and shard. the placement table (`node --experimental-strip-types --no-warnings scripts/e2e/placement-doc.ts`, also in the Local E2E build job's summary)
lists which specs run here (**local**) and which still need QA/stage (**deployed**).

## What runs

One Miniflare instance (`scripts/local-stack/boot.ts`) runs every worker, so queues, Durable Objects,
D1, R2, KV and the Secrets Store are shared exactly as in a deployed environment. Miniflare's own
warnings and errors (a queue batch whose dispatch threw, a message retried, dead-lettered or dropped)
and one `[mf:info] QUEUE <name> acked/total (ms)` line per queue batch go to the stack log with the
workers' output (#1128). Miniflare is patched (`patches/miniflare@4.20260706.0.patch`) so that its
Durable Objects' log requests to Node are best effort: one failed request used to freeze a queue's
broker for the rest of the run (contact mail stuck "queued", #1128). Re-check the patch when
wrangler bumps Miniflare (pnpm refuses an install whose patched version is gone). Each worker listens
on its own port:

| App | Port | Source |
|---|---:|---|
| web (OpenNext build) | 3001 | `apps/web` |
| api-videos | 3086 | `apps/api-videos` |
| websocket-server | 3087 | `apps/websocket-server` |
| processor | 3088 | `apps/processor` |
| admin-api | 3090 | `apps/admin-api` |
| admin-web (OpenNext build) | 3091 | `apps/admin-web` |
| short-links | 3092 | `apps/short-links` (the web app's `SHORT_LINK_URL`) |
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
- **The CMS and www, when their bundles exist.** AlUmmahNowCMS and AlUmmahNowUI publish the same
  kind of bundle for every released commit (their `local-stack-bundle.yml`: the prebuilt CMS Worker
  with its config and migrations; the prebuilt www Worker with its config and static assets).
  `fetch-auth.ts --repo cms|www --optional` fetches them into `.local-stack/repos/cms|www`; boot then
  runs the CMS on `http://localhost:3402` and www on `http://localhost:3401` (www reads the CMS
  through its service binding, the CMS reads api-videos with the shared internal key), and the
  processor's scholar reference outbox (`CMS_INTERNAL_URL`) points at the local CMS. Without a
  bundle the stack runs without them, the outbox stays off and `78-scholar-refs` skips. A sibling's
  `compatibility_date` newer than this repo's workerd is lowered to the newest it supports (logged).
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
  - **Cloudflare API** (`api.cloudflare.com`): only the read calls of the transcode troubleshooting panel
    (containers, queues, queue backlog, Observability logs; admin-api `lib/media-troubleshoot/cloudflare.ts`),
    and only with an `e2e-fake-cloudflare-token-…` token. `PUT /__fake/cloudflare { logVideo }` names the
    video its log lines mention; `DELETE /__fake/cloudflare` forgets it.
  - **The R2 media pipeline** (the transcoder Container and the media Worker are not in the stack):
    `POST /__fake/media/transcode/<videoId>` checks the record's queued job and its kept original, then
    sends the job events a real transcode sends (`started`, then `ready` with the result, or with
    `?outcome=fail` a final failure) to api-videos `/internal/media/events`. `media.local-stack.test`
    serves the landscape player fixture for renditions it made ready (`/pub/…`, and `/priv/…` with a
    token-shaped segment; the real token check is unit tested in `apps/media`).
    `POST /__fake/media/down|up` makes the host answer 503, for fallback specs.
  - **Google and YouTube** (Move from YouTube, `scripts/local-stack/fake-google.ts`):
    `accounts.google.com` (the consent screen, which sends the browser straight back with a code, or
    with `error=access_denied`), `oauth2.googleapis.com` (`/token` checks the PKCE verifier and the
    redirect URI, refreshes, `/revoke`), `www.googleapis.com` / `youtube.googleapis.com` (the
    YouTube Data API v3 reads: channels, playlistItems in pages of 2, videos, playlists, captions and
    caption downloads as WebVTT) and `i.ytimg.com` (every thumbnail is
    `apps/web/e2e/test-fixtures/e2e-thumbnail.jpg`). api-videos runs with the feature on
    (`YOUTUBE_IMPORT_DEFAULT_ENABLED`, a fake client id; the client secret is the local Secrets Store
    value) until an admin saves settings. The fixture channel `UCaunFixtureChannel0001`:
    | YouTube id | On YouTube | Takeout file |
    |---|---|---|
    | `AUNytPUB001` | public, captions ar + en (an automatic en track too, never imported), maxres custom thumbnail, tags, en/ar localizations, chapters in the description | `Fixture public talk [AUNytPUB001].mp4` |
    | `AUNytUNL002` | unlisted, made for kids, no captions | `Fixture unlisted kids video.mp4` (no id: matched by title) |
    | `AUNytPRV003` | private, scheduled 30 days after the request (`publishAt`) | `Fixture scheduled video [AUNytPRV003].mp4` |

    The playlist `PLaunFixture0001` "Fixture playlist" holds `AUNytPUB001` and `AUNytUNL002`. A spec
    zips any MP4 fixture under those names to stand in for a Takeout download.
- **Control API.** `http://127.0.0.1:3190` (loopback only) has:
  - `GET /__fake/bunny/videos[/<guid>]`;
  - `POST /__fake/bunny/videos/<guid>/encode|fail|hold`;
  - `POST /__fake/media/transcode/<videoId>[?outcome=fail]`, `POST /__fake/media/down|up`;
  - `GET /__fake/resend/emails`;
  - `GET /__fake/google` (consent mode, quota switch, outstanding codes and refresh tokens, revocations,
    the last 200 calls such as `consent`, `token:code`, `api:captions`, `revoke`),
    `POST /__fake/google/consent?mode=allow|deny|no-channel|no-captions` (`no-channel`: the account has no
    YouTube channel; `no-captions`: the consent grants only the read-only scope),
    `POST /__fake/google/quota?on=1|0` (captions calls answer `quotaExceeded`), `POST /__fake/google/reset`;
  - `PUT|DELETE /__fake/cloudflare`: the video the fake Cloudflare log lines name;
  - `POST /__stack/d1/<database name>`, which runs the request body as SQL. The seed uses it for roles
    and creator tiers, and specs that are not about auth can use it as a fast path;
  - `GET|PUT|DELETE /__stack/r2/<bucket name>/<key>`: one object of a stack R2 bucket (fixtures a spec
    seeds in R2, such as the admin suite's legacy profile record); without a key,
    `GET /__stack/r2/<bucket name>?prefix=<p>[&cursor=<c>]` lists keys (`{ keys, cursor }`, 1000 a page).
  - `GET /__stack/leftovers?marker=<run id>`, which lists every D1 row, R2 object, KV entry and fake
    Bunny video or image that still holds the run id or a run user's id;
  - `POST /__stack/scheduled/<app>?cron=<expr>[&time=<ISO>]`, which runs that worker's scheduled handler now,
    with that scheduled time (default now; hourly-tick work needs the top of an hour). Teardowns
    use it for purges that the APIs only queue for the hourly cron.
  - `POST /__stack/queue/<app>/<binding>` with a JSON message, which sends it through that worker's
    queue producer (the teardown re-runs the erasure's last step with it).
- **Teardown.** The admin suite tears down in its global teardown (`apps/admin-web/e2e/support/cleanup.ts`);
  the web and release jobs run `scripts/local-stack/run-teardown.ts` after deleting the run accounts. It
  runs the crons the deployed environments run on their own (api-videos' run-account sweep, which erases
  accounts that signed up on the web page, and the deletion and trash purges), waits until the
  erasures' queued steps are done, sends the processor's erasure step (`UserDataErased`) once more for
  every run user id, then deletes this run's rows from the stores kept as history (admin jobs and
  deletions, admin logs, the queue-message archive).
- **Leftover check.** `scripts/local-stack/leftovers.ts --marker "$E2E_RUN_ID"` runs at the end of every
  local job (admin, web and release), after the teardown, and fails the job when anything the run
  created is still there. It writes every hit to `$RUNNER_TEMP/leftovers.json`, uploaded as the job's
  `local-<suite>-leftovers-<n>` artifact. The only allowances, none personal: revocations
  (`user_revocations`, `TOKEN_REVOCATIONS`, user id only) and search tombstones (entity + id).
  Personal or user-linked data is never allowed: a hit there is a cleanup or erasure bug to fix
  (`scripts/local-stack/__tests__/leftovers-strict.test.ts` keeps the list closed).
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
(`.local-stack/`).

`LOCAL_STACK_NEXTJS_ENV` sets web's and admin-web's `NEXTJS_ENV` (default `qa`, which shows the header's QA badge).
Pictures people see boot with `production` (the Help pictures and owner review shots, `help-pictures.yml`), so no
QA pill shows in them.

**The CMS or www from a branch or a local checkout.** To try a cross-app change before the sibling
repo releases it, build that repo's bundle yourself instead of fetching the released one, then boot:

```bash
node --experimental-strip-types --no-warnings scripts/local-stack/sibling-build.ts --repo cms --checkout ../AlUmmahNowCMS   # a checkout as it is
node --experimental-strip-types --no-warnings scripts/local-stack/sibling-build.ts --repo www --ref feat/page-builder       # a branch, tag or commit
```

It runs that repo's own `scripts/release/local-stack-bundle.sh` (the one its release workflow runs;
www is built first) and puts the result where boot looks (`.local-stack/repos/cms|www`, or
`LOCAL_STACK_CMS_DIR` / `LOCAL_STACK_WWW_DIR`). `--ref` fetches into `.local-stack/src/<repo>` and runs
`npm ci` there. Local only: CI on `main` and in releases uses released bundles alone. In the stack,
CMS staff sign in through the local issuer (the production `AUTH_CLIENT_ID`, its redirect URI pointed
at `localhost:3402`); a run account promoted with `/test/promote` has the Admin role the CMS accepts.
The videos site's About page reads the stack's CMS (`CMS_URL`) and links to its www (`WWW_URL`).
`79-page-builder-cross-app` (CMS page builder → www and the videos About page) runs on such a build
and skips on CMS or www bundles that predate the page builder. Every boot starts from empty databases. To stop a stack, use Ctrl-C or kill its
PID. Never kill processes by name.

## Run the specs

CI: `.github/workflows/local-e2e.yml` (check **Local E2E**). One build job makes the OpenNext
builds and prints the placement table. Every suite job boots its own stack through
`.github/actions/local-stack-up` (fetch the Auth bundle, boot, smoke, seed translations, seed), then
runs its specs with `E2E_ENV=local`. It runs on every pull request, every push to `main`, nightly, and
in every release (`release.yml` job `local-e2e`). Production waits for it.

The release suite's **WebKit** job runs from a standalone, newer Playwright (`PLAYWRIGHT_WEBKIT_VERSION`
in `local-e2e.yml`, 1.65.1); every other project stays on `apps/web`'s pinned version. Playwright
1.56.1's WebKit build (webkit-2215) aborts its web process on the Studio Comments flow (a libstdc++
assertion on an empty `std::optional<size_t>` while rendering): 8 of 36 runs against 0 of 36 on
1.65.1's (webkit-2388), same batch (#1382). Drop the split once `apps/web` moves past it.

Locally, against a running stack (one stack and one Playwright run at a time):

```bash
cd apps/web
E2E_ENV=local pnpm exec playwright test -c playwright.release.config.ts --project=chrome
```

With `E2E_ENV=local` the release config runs only the specs placed `local` and sends the browser
through the proxy. Against QA or stage it runs only the `deployed` ones.

- **Placement.** Every spec is listed in `apps/web/e2e/test-utils/placement.ts` as `local` or
  `deployed`, with a reason for each deployed one. `scripts/qa/__tests__/e2e-placement.test.ts` fails
  on a spec that is missing there or listed twice. The table is generated
  (`node --experimental-strip-types --no-warnings scripts/e2e/placement-doc.ts`), never committed.
- **Own data.** A spec creates everything it reads or changes through the builders in
  `apps/web/e2e/release/builders.ts`: users, creator tiers, channels, videos, playlists, posts and
  comments. Release videos come from `useOwnVideos(test)` (`own-videos.ts`). Names carry the run
  namespace (`ns()`). `scripts/qa/__tests__/own-data.test.ts` fails on seed titles, demo data or
  hard-coded ids outside its allow list.
- **Cleanup.** Builders register teardown as they create. Teardown always runs, even on failure, and
  is idempotent (a 404 counts as gone). It deletes only what carries the run id. The leftover check
  above fails the job on anything left.
- **Quarantine.** A spec still red on the stack gets
  `test.fixme(releaseEnv() === 'local', 'quarantined: #<issue> @<owner> ...')`, with one issue per
  cause (`scripts/ci/check-quarantine.ts`). Fix it in a small follow-up and lift the fixme.

### A busy runner: waits and idle connections (#1941)

The WebKit admin job runs four browsers beside the whole stack on four cores. When it is short of
CPU the stack still answers every request, only late: on 24 Nov a sign-in's issuer step took 5.7 s
(each D1 call 0.5 to 1 s instead of a few ms) and the admin pages 6 to 17 s to render. Two rules
follow for specs and for the stack:

- **Wait for the thing, with the navigation budget.** A click that starts a navigation is held by
  Playwright for the action timeout (15 s) while it "waits for scheduled navigations to finish". A
  redirect chain or a server-rendered page can take longer on a busy runner, so `uiLogin` clicks with
  `noWaitAfter` and then waits for the page it signs in to (or the form's own error), and a link
  click is followed by `page.waitForURL` (45 s, `navigationTimeout`) instead of a 15 s
  `toHaveURL`. AUTH-16 and OPS-05 hold the answer back for 17 s to keep that true.
- **Idle connections.** workerd closes an idle keep-alive connection after about 4.7 s and Node's
  HTTP server after 5 s. A process that was descheduled for a few seconds sends its next request on a
  connection the other side has already closed (`fetch failed`, `SocketError: other side closed`,
  ECONNRESET), although nothing is wrong with the stack. The stack's own Node servers (control API,
  fake CDN, browser proxy) keep idle connections for 65 s (`IDLE_CONNECTION_MS` in `stack.ts`), and
  the admin suite's `fetch` keeps its own for 1 s (`e2e/support/keep-alive.ts`), so it closes them
  before workerd can.

### The admin suite's WebKit project (#1941)

The admin WebKit job runs from a standalone Playwright 1.65.1 (webkit-2388), the way the release
suite's does (`PLAYWRIGHT_WEBKIT_VERSION` in `local-e2e.yml`): with 1.56.1's WebKit (webkit-2215) the job
lost its browser mid-run (`page.goto: Connection terminated unexpectedly`, run 45553082083, A11Y-01)
while the stack kept answering. The job copies what the suite reads (`e2e/`, the config, `apps/web`'s
run-account and placement modules, the processor's wrangler config) into a temporary directory with the
same layout and installs Playwright and axe there. Every other admin project, the type check and
`apps/web` stay on the pinned 1.56.1: two Playwright versions in one hoisted install break
`AxeBuilder({ page })` in `apps/web`'s specs, so `apps/admin-web`'s `package.json` is not bumped. A
file the suite starts to read must be added to that copy.
