# Channel roles

**Status:** Approved for build (package CH-1, 2026-11-14). Members, the access list, the Team page and most capability checks are live (#625). This spec now describes the shipped design plus the remaining work: invitations, the activity log, notifications, the team-seat limit and the last owner-only areas (community posts, post comment moderation, live).
**Date:** 2026-11-08, revised 2026-11-14 to match the code on `main`
**Plan:** [CHANNEL-ROLES-PLAN.md](CHANNEL-ROLES-PLAN.md)
**Related:** `docs/native-apps/EPICS.md` 18.6 and 19.8, `docs/test-cases/channel-management/TCCHAN002` to `007`, channel claim and transfer spec (PR #460), wiki decision O16

## 1. Summary

A channel owner can give other accounts a role on one channel: **channel admin**, **editor** or **channel moderator**. The person must accept an invitation. They then see the channel in their account menu under "Channels you manage", with their role, and can do what that role allows.

There is still exactly one owner per channel. The owner can add channel admins and every other role. Only a super admin can change who the owner is, through the admin site (PR #460, wiki O16).

### Goals

- One permission matrix for everything a channel role can do, shared by the API (enforcement) and the clients (display).
- Nothing changes for today's owners, or for anyone without a role.
- Every membership change is recorded in the channel's activity log, and a removal takes effect on the next request.

### Non-goals

- Changing ownership. No channel role can do it, and no endpoint in this spec touches `channel.userId`.
- Institution mode (Epics 19.9: many channels under one organisation).
- Public "join this channel", bulk invitations and member messaging, which `TCCHAN004` assumes. Subscribers are not members.
- Custom roles or per-person permission overrides. The four roles below are the whole set.

## 2. Channel roles and site roles are separate

**Channel roles have nothing to do with site roles** (wiki O16). This supersedes the "(uses auth RBAC)" note in Epics 19.8.

| | Site roles | Channel roles |
|---|---|---|
| Examples | user, moderator, admin, super admin | owner, channel admin, editor, channel moderator |
| Scope | The whole platform | One channel |
| Stored in | AlUmmahNowAuth | The videos side: `channel.userId` (owner) and `channel.members` on the R2 channel record |
| In tokens | Yes (`roles`) | **Never** |

Rules, each enforced and tested:

- A channel role is never written to auth, never added to a token, and never grants or implies a site role. A channel admin is not a site admin.
- A site role never grants or implies a channel role. A site admin is not an admin of any channel. `can()` (§6) doesn't read token roles.
- Site staff powers that exist today (the videos admin, content moderation, `isAdminRole` in `channelOwnerFetch.ts`) stay at their own call sites. They are not modelled as channel roles.
- "Moderator" and "admin" exist on both sides. In the UI and in code the channel ones are always "channel admin" and "channel moderator".

**The only cross-overs:** a super admin transfers ownership on the admin site (PR #460), and account erasure removes the account's memberships (§12).

## 3. Roles and permission matrix

`owner` comes from `channel.userId`. The other roles are entries in `channel.members`. The matrix lives in `packages/shared-types/src/channel-roles.ts`; its unit test is table-driven over this table.

Epics 19.8 called the second role "manager". The owner asked for "admins", so it is `admin` in code and "Channel admin" in the UI. The "viewer-of-analytics" role was dropped by the owner on 2026-11-09.

| Capability | Owner | Channel admin | Editor | Channel moderator |
|---|:-:|:-:|:-:|:-:|
| **Channel** | | | | |
| `channel.view_private`: settings and private fields | Yes | Yes | No | No |
| `channel.edit`: name, description, avatar, cover, sections, tabs, contact email, privacy | Yes | Yes | No | No |
| `channel.handle`: change or release the @handle | Yes | No | No | No |
| `channel.delete` | Yes | No | No | No |
| `channel.speak`: comment, react or subscribe as the channel | Yes | Yes | Yes | Yes |
| **Videos** | | | | |
| `video.upload` | Yes | Yes | Yes | No |
| `video.view_private`: private, draft and processing videos | Yes | Yes | Yes | No |
| `video.edit`: metadata, thumbnail, subtitles, chapters | Yes | Yes | Yes | No |
| `video.delete` (and restore from trash) | Yes | Yes | Own uploads | No |
| `video.schedule`: schedule, change, publish now | Yes | Yes | Yes | No |
| `post.manage`: community posts | Yes | Yes | Yes | No |
| `playlist.manage`: the channel's playlists | Yes | Yes | Yes | No |
| **Comments** | | | | |
| `comment.moderate`: approve, remove, pin, heart, on videos and posts | Yes | Yes | No | Yes |
| **Live** | | | | |
| `live.manage`: create, edit, start, end, delete streams, see stream keys | Yes | Yes | No | No |
| `live.moderate`: live chat moderation | Yes | Yes | No | Yes |
| **Analytics** | | | | |
| `analytics.view` | Yes | Yes | No | No |
| **Members** | | | | |
| `members.view`: team, pending invitations and activity log | Yes | Yes | No | No |
| `members.manage`: invite, change, remove editors and channel moderators | Yes | Yes | No | No |
| `members.manage_admins`: invite, change, remove channel admins | Yes | No | No | No |
| Leave the channel | No | Yes | Yes | Yes |
| Change the owner | **No. Super admin only, on the admin site** | No | No | No |

- The owner can't leave. To stop owning a channel they ask a super admin, or delete it.
- A channel admin can't touch another channel admin or the owner, so one admin can't remove the others.
- An editor deletes only videos they uploaded (`video.uploadedBy`). A video with no `uploadedBy` was uploaded by the owner.
- `live.moderate` has no route yet: live chat moderation is not built. When it is, it checks this capability.
- Plan limits and quotas are always the **channel owner's**, whoever acts.

## 4. Invite, accept, remove, leave

```text
Owner or channel admin        Invitee                        Result
 Invite (email or @handle) ->  sees the invitation
                               Accept -------------------->   member entry, channel in the menu
                               Decline ------------------->   invitation closed
 Cancel (while pending) ------------------------------------>  invitation closed
                               nothing for 14 days -------->   invitation expired
 Change role / Remove -------------------------------------->  applies on the next request
                               Leave --------------------->    member entry removed
```

Nobody gets a role without accepting it. There is no direct grant.

### 4.1 Who can be invited

An invitation names one account, by one of:

- **Exact @handle** of one of their channels, resolved through `channel-handles/{handle}` to that channel's owner. An unknown handle gives an inline error, since handles are public anyway. The invitee is known at once and is notified.
- **Exact email**, compared case-insensitively. No lookup in auth. The invitation stores the normalized email and is matched against the email in the invitee's own token when they load their invitations. Auth only issues an email claim it has verified (email code or passkey sign-in).
  - Every email gets the same response, so the form can't reveal who has an account. The inviter's list shows "Pending" either way. If no account ever matches, the invitation expires and nothing is sent.
  - On the first match, `invitee_user_id` is filled in. Email invitations create no notification (the invitee's account isn't known when it is sent); they appear on the invitee's Invitations page and in the account menu's invitation count.
  - The stored email is cleared when the invitation closes.

### 4.2 Rules

| Condition | Result |
|---|---|
| Inviting yourself, or the owner | 409 `cannot_invite_owner` |
| The person already has a role, or a pending invitation exists | 409 `already_member`, `already_invited` |
| Role is `owner`, or unknown | 400 `invalid_role` |
| Inviter lacks the capability for that role | 403 `forbidden` |
| Team full (members + pending invitations at the seat limit) | 409 `member_limit` |
| 50 pending invitations on the channel | 409 `pending_limit` |
| Over 30 invitations by one person in an hour, or 100 on one channel in a day | 429 `rate_limited` |
| Accepting: expired, closed, or not yours | 404 `invite_not_found` (the same for all three) |
| Accepting with 50 shared channels already | 409 `shared_limit` |

Accept re-checks the channel exists and isn't deleted, that the caller is the invitee, the seat limit and the shared-channel limit. Then it adds the member entry on the R2 record (conditional write, a no-op if they are already a member) and closes the invitation with a guarded update (`status = 'pending'`). A double click or a retry can't create two results.

### 4.3 Change role, remove, leave

- Roles are read from the R2 channel record on every request and never cached in a token, so a change or removal takes effect on the next request.
- Removing a member, or changing them to a role without `members.manage`, cancels the pending invitations they sent.
- Content a removed member uploaded stays with the channel (§7).
- When a member who held `live.manage` is removed, leaves or loses it, the channel's live sessions that haven't started are ended, so the next start provisions a fresh session with a new stream key. A broadcast already on air is left running. Its session ends with the broadcast.
- A member whose active channel is no longer theirs gets 403 and the web moves the session back to their own channel (shipped in #625).

## 5. Storage

**Members** stay where they shipped: the `members` array on the R2 channel record (`{ userId, role, addedBy, addedAt, updatedAt? }`, at most 50). Writes are conditional puts, so a membership change never drops a concurrent channel update. Channel views never include `members`.

**The access index.** `channel_access` in SEARCH_DB (migration `0008_channel_access.sql`) lists who holds a role where, so "my channels" doesn't scan. It is projected by the shared ownership sync and is rebuildable. Readers re-check the role on the R2 record, so a stale row grants nothing.

**Invitations and the activity log** are new tables in SEARCH_DB, which already holds other source data on the videos side (creator tiers, caption-minute grants, admin jobs). No new database, binding or running cost.

```sql
CREATE TABLE IF NOT EXISTS channel_invites (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','moderator')),
  invitee_user_id TEXT,
  invitee_email TEXT,             -- normalized; cleared when the invitation closes
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  responded_at TEXT
);
-- one pending invitation per person per channel, plus lookups by invitee, inviter and expiry

CREATE TABLE IF NOT EXISTS channel_audit (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,           -- §9
  target_user_id TEXT,
  old_role TEXT,
  new_role TEXT,
  created_at TEXT NOT NULL        -- never email addresses
);
```

**Migration.** New tables only: expand-only and rollback-safe. No backfill.

**Interaction with a transfer (PR #460).** A transfer changes only the owner. If the new owner had a member entry it is removed, because owners have no entry, and their pending invitations for that channel are cancelled. If the super admin ticks "keep the old owner as channel admin", the transfer adds that entry and logs `transfer_kept_old_owner`.

## 6. Enforcement

### 6.1 The helpers

- `packages/shared-types/src/channel-roles.ts`: `can(role, capability)`, `canManageRole`, `canDeleteVideo`, `channelRoleOf(channel, userId)`. Pure, no token, no site role.
- `apps/api-videos/src/lib/channelAccess.ts`: `roleOnChannel`, `canOnVideo`, `canManagePlaylist`, `canManageLiveStream`, `uploadIdentity`. A failed channel read refuses access (fail closed).
- Owners cost nothing extra: the role comes from the channel record the route reads anyway.

### 6.2 Acting as a channel: an allow-list

The `channelId` header middleware (`middleware/auth.ts`) resolves the caller's role. An owner passes as before. A member passes a read, or a write that `MEMBER_WRITE_ROUTES` lists with a capability their role grants. **A write that isn't listed stays owner only**, so a missed route fails closed. Listed routes still run their own check on the record they change.

### 6.3 Where each capability is checked

| Area | Routes |
|---|---|
| Channel | channel update, avatar, cover, tabs, sections (`channel.edit`); handle (`channel.handle`); delete (`channel.delete`); owner view (`channel.view_private`) |
| Videos | create, upload, TUS, update, thumbnail, chapters, subtitles, schedule, publish now, delete, restore, Studio content and trash lists |
| Posts | create, edit, delete, image and GIF uploads (`post.manage`) |
| Comments | video comment approve and remove; post comment remove, pin and heart (`comment.moderate`) |
| Playlists | the channel's playlists (`playlist.manage`) |
| Live | create, edit, ingest (stream key), start, end, delete, and seeing the channel's private streams (`live.manage`) |
| Analytics | channel and per-video analytics (`analytics.view`) |
| Members | §13 |

A person's own records (their comments, watch history, likes, upload templates, notifications) keep their plain owner checks.

## 7. Content ownership

**`video.userId` means "the owner of the channel this video is in", never "who uploaded it".** The server sets it to `channel.userId` whoever calls, and records the member in `video.uploadedBy` (never in public views). The same holds for community posts (`post.userId` is the owner, `post.authorId` the member who wrote it) and live streams and channel playlists (`createdBy`).

So the ownership index, plan limits, erasure, publish notices and the PR #460 transfer keep keying on the owner, and an editor's departure doesn't orphan the channel's videos.

## 8. Account menu and web

- `GET /api/channels/access` returns owned channels, then channels with a role, each with `role` and `capabilities`, `private, no-store`. The menu shows "Your channels" and "Channels you manage", with a role badge on managed channels.
- The menu shows a count of pending invitations, linking to the Invitations page.
- Web checks use capabilities for display only. The server enforces.

## 9. Activity log

`channel_audit` rows:

- **Membership, always:** `invite_sent`, `invite_cancelled`, `invite_accepted`, `invite_declined`, `invite_expired`, `role_changed`, `member_removed`, `member_left`, `member_removed_account_deleted`, `transfer_kept_old_owner`.
- **Content, when the actor isn't the owner:** `video_deleted`, `channel_edited`, `stream_key_rotated`, `comment_removed`, `post_deleted`.

Rows are written right after the change they record. R2 and D1 can't share a transaction, so a failed log write never undoes the change: it is logged and reported to the admin Errors page.

The owner and channel admins see the log on the Team page's **Activity** tab, newest first, actors by name. Rows older than one year are deleted by the daily cron. On account erasure, `actor_id` and `target_user_id` become `deleted-user`.

## 10. Notifications

Stored as keys and params in the always-on `account` category, so every client renders them in the reader's language. `dedupeKey` is the invitation or event id.

| Key | To | English | Arabic |
|---|---|---|---|
| `channelInviteReceived` | Invitee (handle invitations) | {inviter} invited you to {channel} as {role}. | دعاك {inviter} إلى قناة {channel} بدور {role}. |
| `channelInviteAccepted` | Inviter | {member} joined {channel} as {role}. | انضم {member} إلى قناة {channel} بدور {role}. |
| `channelRoleChanged` | Member | Your role on {channel} is now {role}. | أصبح دورك في قناة {channel} الآن {role}. |
| `channelMemberRemoved` | Member | You no longer have access to {channel}. | لم يعد بإمكانك الوصول إلى قناة {channel}. |
| `channelMemberLeft` | Owner | {member} left {channel}. | غادر {member} قناة {channel}. |

`{role}` is sent as the role code and rendered with the reader's `channelRoles.roles` string. Declines and expiries notify nobody; the Team page shows them. Nobody is notified about their own action.

## 11. Limits

| Limit | Value | Enforced |
|---|---|---|
| Members per channel | `studio.teamSeats` on the **channel owner's** plan, capped at 50. Plans aren't built yet (Epic 27), so every owner gets the Free value, 50 | On invite (members + pending) and on accept (members) |
| Pending invitations per channel | 50 | On invite |
| Shared channels per account | 50 | On accept |
| Invitations | 30 per inviter per hour, 100 per channel per day, counted from `channel_invites` | On invite |
| Invitation lifetime | 14 days | Checked at accept, closed by the daily cron |

On a downgrade, existing members stay and new invitations are refused, the same as `channel.max`.

## 12. Account and channel deletion

- **Account erasure** (`eraseUserData`, behind `DELETE /api/privacy/data` and the admin erasure) removes the account's member entries from every channel, cancels invitations to or from it, rewrites `uploadedBy`, `authorId` and `createdBy` naming it to `deleted-user`, and anonymizes its activity rows. Channel records and videos it is named in are found through the privacy footprints, like subscriptions and comments.
- **Auth's `account.deleted`.** AlUmmahNowAuth defines the event but doesn't deliver it to Videos yet (tracked in AlUmmahNowAuth). Until it does, a deleted account still can't use a membership, because its tokens are revoked. Its entry stays in the member list until the owner removes it or the account's videos data is erased.
- **Channel deleted.** `channelDelete` cancels the channel's pending invitations. The member entries go with the record. Activity rows age out.
- **Export.** `collectUserData` includes the account's memberships and invitations.

## 13. API

Under `api-videos`, all authenticated, `private, no-store`:

| Method and path | Capability | Purpose |
|---|---|---|
| `GET /api/channels/access` | Signed in | My channels with roles (§8) |
| `GET /api/channels/:id/members` | `members.view` | Owner, members and pending invitations |
| `POST /api/channels/:id/invites` | `members.manage`, or `members.manage_admins` for `admin` | Invite. Body: `handle` or `email`, and `role` |
| `DELETE /api/channels/:id/invites/:inviteId` | The same, for the invitation's role | Cancel |
| `PUT /api/channels/:id/members/:userId` | The same, for the old and the new role | Change role |
| `DELETE /api/channels/:id/members/:userId` | The same, for the member's role; anyone for themselves (leave) | Remove or leave |
| `GET /api/channels/:id/audit` | `members.view` | Activity, newest first, cursor paged |
| `GET /api/channel-invites` | Signed in | My pending invitations (by user id or token email) |
| `POST /api/channel-invites/:id/accept`, `/decline` | The invitee | Respond |

`POST /api/channels/:id/members` (the direct grant from #625) is removed.

## 14. Screens

**Team page** (`/settings/channel/[id]/team`), two tabs for the owner and channel admins: **Team** and **Activity**. Editors and channel moderators see their own role and "Leave this channel".

```text
Team | Activity
Invite someone
  Email or @handle [              ]  Role [ Editor v ]  [Send invitation]
  Uploads, edits and schedules videos.                     Up to 50 people

Team
  You              Owner
  Sara             [ Editor v ]              [Remove]
Pending invitations
  new@example.com  Editor · expires in 12 days  [Cancel]
```

**Invitations page** (`/settings/channel-invites`), reached from the notification and the account menu: each invitation with the channel, the inviter, the role and what it allows, and **Accept** / **Decline**.

States: empty, loading, team full, sending, invitation sent, already invited, role saving, removed, forbidden, accepted, declined, expired.

Semantic theme tokens only, no hex values; logical properties so Arabic mirrors; emails and handles in `dir="ltr"`. Strings are in `packages/shared-types/src/i18n-channel-roles.ts`, en and ar.

## 15. Tests

**Unit:** `can()` table-driven over §3 including `null`; `canManageRole`; `canDeleteVideo` (own upload, someone else's, legacy); invitation rules (expiry, double accept, wrong account, email case, email cleared on close, same answer for known and unknown emails, limits, rate limits); the allow-list (an unlisted write refuses a member); `video.userId`, `post.userId` and live `userId` are the owner when a member creates them; key rotation on removal; erasure removes memberships.

**Separation:** a token with `Super Admin` and no membership gets no channel capability; accepting an invitation makes no call to auth and changes no token.

**E2E on QA** (`apps/web/e2e/release/channel-roles.spec.ts`, throwaway users): A invites B as editor by @handle; B accepts from the Invitations page and the channel shows under "Channels you manage" with "Editor"; B uploads and edits; B can't delete the channel; A changes B to channel moderator and B can no longer edit; A removes B and B loses access; the Activity tab lists it all; the Arabic page mirrors.

**Old test cases.** `TCCHAN002` to `007`: Channel Admin is channel admin, Channel Moderator is channel moderator, "Channel Member" means a subscriber with no role. Public joining, bulk invitations and member messaging are out of scope.

## 16. Cost

No new resources. Owners pay nothing extra (the role comes from the record already read). Invitations, the log and the access index are a few SEARCH_DB rows and reads per team action. The daily cron runs two indexed deletes and updates, adding negligible cost.

## 17. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Name of the second role | "Channel admin" in the UI, `admin` in code (owner said "admins") |
| 2 | Can a channel admin manage other admins? | No: owner only (O16: owners add admins) |
| 3 | Can an editor delete videos? | Only their own uploads |
| 4 | Do editors see analytics? | No |
| 5 | Live for editors | No: owner and channel admins |
| 6 | Plan limit | `studio.teamSeats` (owner, 2026-11-09), capped at 50 |
| 7 | An email with no account | Same answer as any other; nothing is sent |
| 8 | Where data lives | Members on the R2 channel record (shipped); invitations and the log in SEARCH_DB |
| 9 | Delivery of `account.deleted` | Auth posts it to Videos; tracked in AlUmmahNowAuth |
| 10 | Commenting as the channel | Shows as the channel; the real person is recorded |
| 11 | Activity log retention | One year |
