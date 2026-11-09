# Channel claim and transfer: plan

**Spec:** [CHANNEL-CLAIM-AND-TRANSFER.md](CHANNEL-CLAIM-AND-TRANSFER.md)
**Status:** Waiting on owner review of the spec. Nothing below has started.

Each step is one PR into `main`, with tests written first (`BEFORE_YOU_CODE.md`). QA follows `main`. Nothing reaches users until the last UI step, because the new routes have no caller before then.

## Prerequisites

| # | Item | Repo | Notes |
|---|---|---|---|
| P1 | Owner answers the seven questions in spec §14 | | Questions 1 to 4 affect steps 3 and 7, and questions 5 to 7 affect steps 9 and 10. Should come first |
| P2 | M2M client with scope `admin:users`, one per environment (QA, stage, production), stored as `ADMIN_CLIENT_ID` and `ADMIN_CLIENT_SECRET` in the Secrets Store | AlUmmahNowAuth and Cloudflare | Confirm `/admin/users` accepts `X-Acting-User-Id` for `Super Admin` on QA |
| P3 | `/test/promote` takes an optional role, so E2E can create a `Super Admin`. It only grants `role_admin` today | AlUmmahNowAuth | QA and stage only, behind the existing `TEST_PROMOTE_SECRET` |

## Steps

### 1. Foundations

- `apps/admin-api/migrations/0006_channel_ownership_audit.sql`, `apps/api-videos/migrations/search/0003_channel_transfers.sql`, snapshots from `pnpm schema:snapshot`.
- `hasSuperAdminRole` in `apps/admin-api/src/lib/roles.ts`, and `base/SuperAdminRoute.ts`.
- `packages/shared-types`: `ChannelTransferAdvance` message type and payload; the `account` notification category and three keys; `channels_changed` realtime type; en and ar strings in `i18n-static`.
- Processor and `NotificationRow`: `account` is always delivered and has no settings toggle. Check how native clients treat an unknown category.

Check: `pnpm check:migrations`, `pnpm check:schema`, role unit tests.

### 2. Handle operations in api-videos

- `claimHandleExclusive` in `lib/channelHandles.ts`.
- `lib/channelAdminHandles.ts`: set, take, release, all pure over injected buckets.
- `/internal/channels/*` guard: constant-time key compare, actor token verified, `canClaimOfficialHandles`, subject equals `actorId`.
- Routes for handle set, take and release, and `GET /internal/channels/search` (id, handle, owner, then the search index).

### 3. Transfer engine in api-videos

- `lib/channelTransfer/`: `plan.ts` (preview and hash), `apply.ts` (pure record changes), `phases.ts` (the runner), `verify.ts`.
- `channelVideoIdsForTransfer` in `lib/search/ownership.ts`: all rows for a `channel_id`, with no flag filter.
- Reuse `pickNewMainChannel`, `OperationBudget` and the wrapped bindings. Rotate stream keys in the `live` phase.
- Routes: preview, commit, `advance`, status, `ownership-check`.
- Daily cron in `src/index.ts`: re-enqueue expired leases, and re-verify jobs completed in the last 48 hours.

Check: the unit list in spec §11, against the in-memory R2 and D1 helpers in `apps/api-videos/test/helpers.ts`.

### 4. Processor driver

- `ChannelTransferAdvance` handler: call `advance`, re-enqueue while unfinished, write the terminal audit row to `REPORTS_DB`, leave failures to the existing retry and DLQ.
- Add the api-videos URL var to the processor's wrangler configs (all environments).

### 5. admin-api routes

- Endpoints in spec §9, under `endpoints/channels/`. `API_VIDEOS_URL` var, and the M2M client in `lib/authAdmin.ts` with a cached token.
- Audit-first flow, `Idempotency-Key` handling, rate limits from the audit table, actor role re-check at commit.

Check: API permission matrix in spec §11. Add `test/channel-admin-permissions.test.ts`.

### 6. Web client and notification rendering

- `apps/web`: `NotificationRow` cases, and a listener for `channels_changed` that calls `reloadUserChannels()`.

### 7. admin-web screen

- `/channels` route with a super admin guard, `AdminNav` item for super admins only, server actions in `lib/api`, components for the search, handle tab, owner tab, confirm dialog, progress and history.
- Copy from spec §10 in `i18n/messages/en.ts` and `ar.ts`.
- Theme rules from spec §10. Add a check to review: `git grep -nE '#[0-9a-fA-F]{3,8}|admin-(primary|danger)' -- 'apps/admin-web/src/app/(protected)/channels'` returns nothing.
- Extend `10-accessibility.spec.ts` and `08-i18n-rtl.spec.ts` to cover the page.

### 8. Verify tool, E2E and docs

- `scripts/ops/verify-channel-ownership.ts`.
- `apps/web/e2e/release/channel-transfer.spec.ts` (spec §11). Add it to the table in `CLAUDE.md`, under Release regressions.
- Short runbook in `docs/guides/`: how to retry a stuck transfer and read the audit trail.

Done when the E2E passes on QA after merge to `main`.

### 9. Self-service API in api-videos (spec §13)

No auth changes and no new secrets.

- `lib/accountMove/proof.ts`: two-token check using the existing verification and revocation code, with `auth_time` only (no `iat` fallback), 600 seconds, and the RFC 9470 challenge. Confirm on QA that web tokens carry `auth_time` after a refresh and that `aud` equals `env.ClientId`.
- `/api/account-moves/preview`, `/api/account-moves` (commit), `/:id` (status), `/:id/retry`. Do not add `X-Target-Authorization` to CORS.
- `REPORTS_DB` binding on api-videos in all wrangler configs. Audit, rate limits, and the §13.5 refusals.
- Engine: `kind = 'user_data'` phases (subscriptions, playlists, watch later, saved posts, notification settings, upload templates), and `move_id` sequencing with user data last.
- Entitlement `account.move` in `packages/shared-types/src/entitlements.ts` and `lib/entitlements.ts`. New notification keys with en and ar.

Check: the unit and API lists in spec §13.9.

### 10. Self-service web UI

- A section on `settings/channel/[id]/edit`, and a new `settings/account-move` page.
- Server actions that read both tokens with `SessionManager.getValidAccessToken`. Tokens never reach client components.
- Step-up through the existing add-account flow with `prompt=login&max_age=0`, returning with selections kept.
- Copy from spec §13.6 and §13.8. Theme, RTL and accessibility as step 7.

### 11. Self-service E2E and docs

- `apps/web/e2e/release/account-move.spec.ts`, added to the Release regressions table in `CLAUDE.md`.
- Runbook from step 8 gains the §13.7 lost-access paths, for support.

Done when the E2E passes on QA after merge to `main`.

## Rollout

1. Merge steps 1 to 6 in order. Run migrations through the normal CI path.
2. Merge step 7. The screen is live on QA.
3. Owner tries it on QA with a throwaway channel.
4. Merge steps 9 to 11. Self-service depends on the engine from steps 1 to 4, but not on the admin screen.
5. Owner tries a Move everything on QA with two throwaway accounts.
6. A tagged release takes it to production. There is no hand deploy, and no production data or role changes outside the feature itself.

## Risks

| Risk | Mitigation |
|---|---|
| A concurrent edit writes back an old `userId` | Etag checks in the job, verify phase, 48-hour re-verify |
| Playlist scan is slow on a large bucket | Bounded by `OperationBudget`, resumes by cursor, and transfers are rare |
| M2M client is over-privileged | Scope limited to `admin:users`. Auth still re-reads the acting user's roles |
| `/internal` key leak | Actor token required on every state-changing route except `advance`, which can't change an outcome |
| Arabic copy needs review | Owner or a native speaker reviews the strings in spec §6.7, §10, §13.6 and §13.8 before steps 7 and 10 merge |
| A stolen session empties an account | Step-up needs a fresh sign-in on both accounts, and both are notified |
| Self-service used to escape moderation | Hidden or moderated channels are refused, and auth's revocation list covers suspended accounts |
