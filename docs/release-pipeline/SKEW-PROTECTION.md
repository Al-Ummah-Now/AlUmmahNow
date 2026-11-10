# Deploys and open pages (skew protection)

**Rule:** a deploy never breaks a page that is already open. Uploads in particular keep going.

## Incident (2026-11-09)

The owner was bulk uploading on videos.alummahnow.net when production was deployed. The page then failed with
`Server Action "78646d34…" was not found on the server`.

Root cause, in three parts:

1. **Every build renamed every Server Action.** Next 16 salts Server Action ids with `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.
   When it is unset, Next generates a new key for each build (CI never keeps `.next/cache`), so even an action whose code
   did not change got a new id on every deploy.
2. **Nothing routed an old page to its own build.** After the deploy, the page's next action call reached the new build,
   which had no action with the old id.
3. **The upload flow depended on Server Actions.** Initiate, batch initiate, complete, status and schedule were Server
   Actions, so the call made after the TUS transfer ("complete") failed.

## What protects an open page now

| Layer | Where | What it does |
|---|---|---|
| Stable action ids | `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (GitHub secret, build time) | An unchanged action keeps its id across deploys. |
| Skew protection | `open-next.config.ts`, `worker.ts`, wrangler configs, `scripts/release/skew-mapping.ts` | A request from an old page goes to the Worker version that built it. |
| Uploads use plain API calls | `apps/web/src/lib/api/upload-client.ts` | Upload steps call api-videos over HTTP, which has stable URLs. The bytes already went to the TUS endpoint directly. |
| Client recovery | `src/lib/version-skew/` (web and admin-web) | Detects version skew, shows "A new version is available", then reloads. It never reloads during an upload. |

### Stable action ids

| Secret | Build | Used by |
|---|---|---|
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | `release.yml` | stage and production. They run the same build, so they share the key. |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY_QA` | `deploy.yml` | QA. PR builds get no key, and a random key is fine for them. |

Each build step fails if its key is missing. Both keys are listed in `BUILD_SECRETS` in
`scripts/release/secrets-manifest.ts`, and a test checks that the workflows read and guard them. Rotating a key renames
every action once, like the old behaviour did on every deploy, so rotate only with a release.

### Skew protection (OpenNext Cloudflare)

- **Deployment id per build.** CI sets `NEXT_DEPLOYMENT_ID=<sha12>-<run id>-<attempt>` for the build. Next adds it to
  every RSC request and Server Action (`x-deployment-id`) and to every chunk URL (`?dpl=`). OpenNext bakes it into the
  Worker (`.open-next/cloudflare/init.js`).
- **Mapping.** Each upload of web or admin-web carries `CF_DEPLOYMENT_MAPPING` (`--var`), a map from deployment id to
  Worker version id. `skew-mapping.ts` builds it from the version serving now: the new build is `current`, the serving
  build is pinned to its version id, and older entries are kept while their versions are in the retention window. The
  window is 20 versions or 7 days (`SKEW_RETENTION` in `open-next.config.ts`, which a test keeps equal to `RETENTION` in
  `skew-mapping.ts`). It is computed in:
  - `promote.ts`, for stage and production (the version serving 100% before the candidate upload)
  - `deploy.yml`, for QA and for the manual production job
- **Routing.** When a request's deployment id is not current, OpenNext fetches it from that version's preview URL,
  `<version>-<worker>.mahmoud-s-darwish.workers.dev`. That needs `preview_urls: true`, plus `CF_WORKER_NAME` and
  `CF_PREVIEW_DOMAIN` vars, in every serving config.
- **Fetching the old version.** A Worker's `fetch()` to a workers.dev URL of its own account is refused (`error code: 1042`). On the custom domain that shows as a **522**. The `global_fetch_strictly_public` compatibility flag lifts this, so every web and admin-web config sets it. Release v2026.11.10.4 failed at stage without it: it was the first release with an older skew-protected build to route to.
- **Chunks.** `assets.run_worker_first: ["/_next/static/*"]` sends chunk requests through the Worker, so `?dpl=<old>`
  reaches the old version's assets. Other static files are served directly as before. The OpenNext build reads this
  setting from `wrangler.jsonc`, so every config must carry the same value.
- **Public host.** The old version is reached on a workers.dev host. `worker.ts` stamps the public host on each request
  (`x-aun-public-host`) and restores it on the old version. Without this, middleware redirects and the sign-in
  `redirect_uri`, which are built from `host`, would point at workers.dev. Only `*.alummahnow.net` is accepted.
- **Retention and rollback.** Old versions are never deleted. A rollback (`rollback.ts`) re-deploys a version together
  with its own mapping, so pages from older builds still route. A page opened on a rolled-back candidate falls back to
  the client recovery.
- **Limits.** A page older than the retention window, or a gradual split (a request may land on the other side), gets
  the current build. The client recovery covers both.

`pnpm check:config` (`scripts/release/skew-config.ts`) fails if any of the settings above is missing or differs.

### Client recovery

`VersionSkewProvider` is mounted once in each root layout. It recognises these errors with `isVersionSkewError(err)`:

- Next's `x-nextjs-action-not-found` answer, observed on `fetch`, so it is caught even when the caller catches the error
- `UnrecognizedActionError`
- `ChunkLoadError`
- a failed dynamic import

It reports the event through `reportVersionSkew` in `report.ts`. **The error-reporting pipeline hooks in there.** It then
shows a small themed notice in English or Arabic, and reloads after about 1.5 s. The raw Next.js message is never shown.

- **Uploads hold the reload.** `useHoldReloadWhile(active)` (single upload and batch queue) and `holdReload()` (each
  batch "complete" call) keep the page as it is. The notice says "Your uploads keep going", and the reload runs once the
  last hold is released.
- **No reload loop.** A second skew within 60 s of a skew reload shows a Reload button instead of reloading again.
- **Catch blocks and error boundaries** should call `recoverFromVersionSkew(err)` first. When it returns `true`, they
  should render nothing of their own.

## Tests

| What | Where |
|---|---|
| Recovery logic, provider, upload client, public host | `apps/web/src/lib/version-skew/__tests__`, `apps/web/src/lib/api/__tests__/upload-client.test.ts` |
| admin-web copies and their parity with web | `apps/admin-web/test/version-skew.test.ts` |
| Mapping, retention, config check, build secrets, promote wiring | `scripts/release/__tests__/skew-mapping.test.ts`, `skew-check.test.ts`, `promote.test.ts` |
| End to end (QA on PRs, stage in releases) | `apps/web/e2e/release/deploy-skew.spec.ts` |

The end-to-end test makes the server answer like a newer build. It checks two cases: an action the server lacks shows
the notice and reloads into a working page, and a skew during an upload lets the upload finish before the reload.

On every release, `promote.ts` also checks real routing (`skew-check.ts`). Before the candidates are deployed at 0%, it
records the serving page's deployment id and chunks. That version is at 100%, so it has served traffic. Builds of
cancelled or rolled-back runs never served traffic, so they are never in the mapping or the snapshot. The candidate is
then checked twice:

1. **At 0%, through the version override.** The candidate must serve those chunks with `?dpl=<old id>` by fetching them
   from the old version. A failure rolls back before anyone moves, in stage and in production.
2. **At 100%, again.** A failure rolls back stage. In production it raises a warning.
