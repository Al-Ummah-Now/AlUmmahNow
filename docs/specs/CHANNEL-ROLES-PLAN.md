# Channel roles: plan

**Spec:** [CHANNEL-ROLES.md](CHANNEL-ROLES.md)
**Status:** Waiting on owner review of the spec. Nothing below has started.

Each step is one PR into `main`, with tests written first (`BEFORE_YOU_CODE.md`). QA follows `main`. Nothing changes for users until step 6, because no one can hold a role before invitations exist. Steps 3 and 4 only widen access for accounts that have a role.

## Prerequisites

| # | Item | Repo | Notes |
|---|---|---|---|
| P1 | Owner answers the questions in spec §17 | | Questions 1 to 5 fix the matrix, so they come first |
| P2 | New D1 database `CHANNEL_ROLES_DB`, one per environment (QA, stage, production) | Cloudflare | Open question 8. Bind it in every `apps/api-videos/wrangler*.jsonc` |
| P3 | Auth emits `account.deleted` and posts it to `/internal/events/account-deleted`, with retries | AlUmmahNowAuth | Open question 9. Today it's only a constant in `audit-events.ts`. Not a blocker for steps 1 to 7, but it must land before production |
| P4 | Confirm on QA that web and native access tokens carry a verified `email` claim, including after a refresh | | Email invitations depend on it (spec §5.1). `AuthPayload.email` is optional today |

## Steps

### 1. Foundations

- `apps/api-videos/migrations/channel-roles/0001_channel_roles.sql`, snapshot from `pnpm schema:snapshot`, and add the new database to `check:migrations` and `check:schema` and to the CI migration step.
- `packages/shared-types/src/channel-roles.ts`: roles, capabilities, the matrix and `can()`.
- `apps/api-videos/src/lib/channelAccess.ts`: `getChannelRole`, `requireChannelAccess`, `canDeleteVideo`.
- Enforce the existing `studio.teamSeats` entitlement (`packages/shared-types/src/entitlements.ts`, `lib/entitlements.ts`). No new key.

Check: the matrix unit tests and the separation tests in spec §15.

### 2. Members API

- Routes in spec §14: members, invitations, role change, remove, leave, audit, my invitations. All in `endpoints/channel-members/`.
- Audit in the same D1 batch. Rate limits, limits and the daily expiry cron in `src/index.ts`.
- Notification keys with en and ar, the `account` category and `channels_changed` if PR #460 hasn't added them, and `NotificationRow` cases in `apps/web`.

### 3. Middleware and channel routes

- `middleware/auth.ts`: resolve the role and store it on the context, with an opt-in capability per route. Undeclared routes stay owner only (spec §6.3).
- Move channel, sections, tabs and community posts to `requireChannelAccess`.

Check: a test that fails if a route accepts a member without a declaration.

### 4. Video, comment, live and analytics routes

One PR per area:

- **Videos and uploads.** Server sets `video.userId` to the channel's owner and adds `uploadedBy`. `tusProxy` sessions get `channelId`. Covers create, update, delete, bulk, schedule, subtitles, chapters, thumbnails, `uploadComplete`.
- **Comments.** `commentApprove`, `commentDelete`, post comments, and `viewer.isVideoOwner` in `lib/comments.ts` become capability checks.
- **Live.** `live.manage`, and rotating keys when a member holding it leaves.
- **Analytics.** `analyticsGet`, `analyticsOwner` and per-channel reads in `lib/analytics.ts`. The cross-channel overview stays owned channels only.
- **Playlists and posts** with a `channelId`: `createdBy` and `authorId`.

Check: per-area API tests, and every existing owner test still passes unchanged.

### 5. Deletion and privacy

- `/internal/events/account-deleted` and the resumable anonymize job.
- `eraseUserData` and `channelDelete.ts` clean up memberships and invitations. Export includes them. Daily orphan sweep.

### 6. Web

- `GET /api/channels/access` and the switcher, with shared channels fetched on demand and the session cookie unchanged (spec §7).
- Replace `isOwnChannel` and component `userId` comparisons with capabilities.
- Members page, Activity tab and invitations page, with copy from spec §14. Theme, RTL and accessibility checks. Run the review check: `git grep -nE '#[0-9a-fA-F]{3,8}' -- 'apps/web/src/app/[locale]/settings/channel/[id]/members'` returns nothing.

### 7. E2E and docs

- `apps/web/e2e/release/channel-roles.spec.ts` (spec §15), added to the Release regressions table in `CLAUDE.md`.
- Update `TCCHAN002` to `007` per spec §15.

Done when the E2E passes on QA after merge to `main`.

### 8. Tie in with channel transfer

Once this and PR #460 are both on `main`:

- Transfer's `links` phase removes the new owner's member row, cancels their pending invitations, and inserts the old owner as admin when `keepOldOwnerAsAdmin` is set.
- Show that option on the admin screen. It stays hidden before this step.
- Extend the transfer E2E: an editor keeps their role after a transfer.

## Rollout

1. Merge steps 1 to 5 in order. Run migrations through the normal CI path.
2. Merge step 6. The feature is live on QA.
3. Owner tries it on QA with throwaway accounts.
4. Auth prerequisite P3 lands.
5. A tagged release takes it to production. No production data or role changes outside the feature itself.

## Risks

| Risk | Mitigation |
|---|---|
| A route is opened to members by accident | Undeclared routes stay owner only, with a test (spec §6.3) |
| A missed check keeps owners only, so a member gets a 403 | Fails safe. The E2E and per-area tests find it |
| Code assumes `video.userId` is the caller | `videoCreate` and upload paths are changed together, and the tests assert the stored value |
| Channel roles get confused with site roles | Separate names and tables, and no role data in tokens. Separation tests in spec §15 |
| D1 outage | Owners are unaffected. Members get 503 and no access is granted |
| Session cookie overflows | Shared channels never go in the cookie |
| Arabic copy needs review | Owner or a native speaker reviews the strings in spec §11 and §14 before step 6 merges |
