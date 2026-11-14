# Channel roles: plan

**Spec:** [CHANNEL-ROLES.md](CHANNEL-ROLES.md)
**Status:** Steps 1 to 3 shipped in #625 and later PRs. Steps 4 to 7 are package CH-1 (2026-11-14).

Each step is one PR into `main`, tests first (`BEFORE_YOU_CODE.md`). QA follows `main`.

## Done

| Step | What | Where |
|---|---|---|
| 1 | Matrix, `can()`, `canManageRole`, `canDeleteVideo`, `channelRoleOf` | `packages/shared-types/src/channel-roles.ts` |
| 2 | Members on the R2 channel record, members API, `GET /api/channels/access`, `channel_access` index | `endpoints/channel/channelMembers.ts`, `migrations/search/0008_channel_access.sql` |
| 3 | Channel id header allow-list; channel, video, upload, schedule, subtitle, chapter, thumbnail, comment approve and remove, playlist, analytics and trash checks; `uploadedBy`; account menu groups; Team page | `lib/channelAccess.ts`, `middleware/auth.ts`, `apps/web` |

## CH-1

### 4. The last owner-only areas (API, no UI change)

- Community posts: create, edit, delete as the channel need `post.manage`; `post.userId` is the owner, `post.authorId` the member.
- Post comments: remove, pin and heart need `comment.moderate`.
- Live: create, edit, ingest, start, end, delete and private visibility need `live.manage`; the stream's `userId` is the owner, `createdBy` the member.
- `video.uploadedBy`, `post.authorId`, live `createdBy` and channel `members` feed the privacy footprints, so erasure finds them.

### 5. Invitations, activity log, notifications, limits (API)

- `migrations/search/00NN_channel_invites_audit.sql`: `channel_invites`, `channel_audit`, snapshot refreshed.
- Routes in spec §13. `POST /api/channels/:id/members` removed.
- Seat limit from `studio.teamSeats` (Free value 50, capped at 50), pending, shared-channel and rate limits.
- Removing a `live.manage` holder ends the channel's unstarted live sessions (new key on next start).
- Notification keys `channelInviteReceived`, `channelInviteAccepted`, `channelRoleChanged`, `channelMemberRemoved`, `channelMemberLeft` (account category).
- Daily cron: expire invitations after 14 days, delete activity rows after a year.
- Erasure removes memberships, cancels invitations, anonymizes activity rows; export includes memberships and invitations; channel delete cancels its invitations.

### 6. Web

- Team page: invite by @handle or email, pending invitations with Cancel, Activity tab.
- Invitations page `/settings/channel-invites` with Accept and Decline; invitation count in the account menu; notification rows for the new keys.
- en and ar, light and dark, phone and desktop, axe clean. Visual: held for the owner's screenshots.

### 7. E2E and docs

- `apps/web/e2e/release/channel-roles.spec.ts` follows spec §15 (invite, accept, act, change, remove, activity).
- `TCCHAN002` to `007` updated per spec §15. Wiki epic and feature registry updated.

## After CH-1

- PR #460 (transfer) removes the new owner's member entry, cancels their invitations, and can keep the old owner as channel admin.
- AlUmmahNowAuth delivers `account.deleted` to Videos (spec §12).

## Risks

| Risk | Mitigation |
|---|---|
| A route is opened to members by accident | Unlisted writes stay owner only, with a test |
| A missed check keeps owners only | Fails safe; per-area tests and the E2E find it |
| Code assumes `userId` is the caller | Create paths set the owner and record the member; tests assert the stored value |
| Channel roles confused with site roles | Separate names and storage, nothing in tokens, separation tests |
| R2 change and D1 log disagree | The R2 change wins; a failed log write is reported to the Errors page |
