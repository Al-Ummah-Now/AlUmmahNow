# Channel roles

**Status:** Draft for owner review. Not implemented.
**Date:** 2026-11-08
**Plan:** [CHANNEL-ROLES-PLAN.md](CHANNEL-ROLES-PLAN.md)
**Related:** `docs/native-apps/EPICS.md` 18.6 and 19.8, `docs/test-cases/channel-management/TCCHAN002` to `007`, channel claim and transfer spec (PR #460)

## 1. Summary

A channel owner can give other accounts a role on one channel: **admin**, **editor**, **moderator** or **analytics viewer**. The person must accept an invitation. They then see the channel in their switcher, with their role, and can do what that role allows.

There is still exactly one owner per channel. The owner can add admins and every other role. Only a super admin can change who the owner is, through the admin site (PR #460).

### Goals

- One permission check for everything a channel role can do, replacing the scattered `userId ===` comparisons.
- Nothing changes for today's owners, or for anyone without a role.
- Every membership change is audited, and a removal takes effect on the next request.

### Non-goals

- Changing ownership. No channel role can do it, and no endpoint in this spec touches `channel.userId`.
- Institution mode (Epics 19.9: many channels under one organisation). It can be built on this later.
- Public "join this channel", bulk invitations and member messaging, which `TCCHAN004` assumes. Subscribers are not members.
- Custom roles or per-person permission overrides.

## 2. Channel roles and site roles are separate

**Channel roles have nothing to do with site roles.** This supersedes the "(uses auth RBAC)" note in Epics 19.8, which this PR updates.

| | Site roles | Channel roles |
|---|---|---|
| Examples | user, moderator, admin, super admin | owner, admin, editor, moderator, analytics viewer |
| Scope | The whole platform | One channel |
| Stored in | AlUmmahNowAuth | The videos side: `channel.userId` in R2 for the owner, `api-videos` D1 for the rest |
| In tokens | Yes (`roles`) | **Never** |
| Changes in this spec | None | All of it |

Rules that follow, each enforced and tested:

- A channel role is never written to auth, never added to a token, and never grants or implies a site role. A channel admin is not a site admin.
- A site role never grants or implies a channel role. A site admin is not an admin of any channel. `can()` (§6) doesn't read token roles at all.
- Site staff powers that exist today, such as `isAdminRole` in `channelOwnerFetch.ts` and content moderation, stay exactly as they are, at their own call sites. They are not modelled as channel roles.
- "Moderator" and "admin" appear on both sides. In the UI and in code the channel ones are always "channel admin" and "channel moderator".

**The only two cross-overs:**

1. A super admin (site role) can transfer ownership on the admin site (PR #460).
2. Auth's `account.deleted` event removes the deleted account's channel memberships (§12).

Everything else from auth is identity only: api-videos reads the verified token's subject and email to know who is calling, as it does today.

## 3. What exists today

| Area | Today | Consequence |
|---|---|---|
| Owner | `channel.userId` in the `channels` R2 bucket | Stays the source of truth. The owner has no membership row |
| Video owner | `video.userId`, set to the caller at creation (`videoCreate.ts:87`) | Meaning is pinned in §8 |
| Permission checks | 119 comparisons with a `userId` across `api-videos`, for example `channelSectionCreate.ts:168`, `videoDelete.ts:92`, `commentApprove.ts:47`, `analyticsGet.ts:165`, `liveStreamUpdate.ts:118`. Not all are ownership checks: watch history and a person's own comments stay as they are | §6 sorts them |
| Acting as a channel | The channel id header middleware (`middleware/auth.ts:249`) refuses anyone but the owner. Some routes, such as `videoCreate`, rely on it alone | Must not be loosened globally (§6.3) |
| My channels | `channelList.ts` and `ownedChannelIds` read `content_ownership` by `owner_id` | Stays owner-only. Shared channels are a separate read (§7) |
| Web session | Channel list stored in an HttpOnly cookie, trimmed by `toSessionChannel` because about four full channels hit the 4KB limit | Shared channels can't go in the cookie (§7) |
| Web checks | `isOwnChannel` and `userId` comparisons in about 15 web components | Switch to the role from the API |
| Old test cases | `TCCHAN002` to `007` assume Channel Admin, Moderator and Member | Mapped in §15 |

## 4. Roles and permission matrix

`owner` comes from `channel.userId`. The rest are rows in `channel_members`.

Epics 19.8 calls the second role "manager". This spec uses **admin** (open question 1).

| Capability | Owner | Admin | Editor | Moderator | Analytics viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| **Channel** | | | | | |
| `channel.view_private`: settings and private fields | Yes | Yes | No | No | No |
| `channel.edit`: name, description, avatar, cover, sections, tabs, contact email, privacy | Yes | Yes | No | No | No |
| `channel.handle`: change or release the @handle | Yes | No | No | No | No |
| `channel.delete` | Yes | No | No | No | No |
| `channel.speak`: comment, react or subscribe as the channel | Yes | Yes | Yes | Yes | No |
| **Videos** | | | | | |
| `video.upload` | Yes | Yes | Yes | No | No |
| `video.view_private`: private, draft and processing videos | Yes | Yes | Yes | No | No |
| `video.edit`: metadata, thumbnail, subtitles, chapters | Yes | Yes | Yes | No | No |
| `video.delete` | Yes | Yes | Own uploads | No | No |
| `video.schedule`: schedule, change, publish now | Yes | Yes | Yes | No | No |
| `post.manage`: community posts, playlists | Yes | Yes | Yes | No | No |
| **Comments** | | | | | |
| `comment.moderate`: approve, delete, on videos and posts | Yes | Yes | No | Yes | No |
| **Live** | | | | | |
| `live.manage`: create, start, stop, see or rotate stream keys | Yes | Yes | No | No | No |
| `live.moderate`: live chat moderation | Yes | Yes | No | Yes | No |
| **Analytics** | | | | | |
| `analytics.view` | Yes | Yes | No | No | Yes |
| **Members** | | | | | |
| `members.view`: member list and activity log | Yes | Yes | No | No | No |
| `members.manage`: invite, change, remove editor, moderator, analytics viewer | Yes | Yes | No | No | No |
| `members.manage_admins`: invite, change, remove channel admins | Yes | No | No | No | No |
| Leave the channel | No | Yes | Yes | Yes | Yes |
| Change the owner | **No. Super admin only, on the admin site** | No | No | No | No |

The owner can't leave. To stop owning a channel they ask a super admin, or delete it.

An admin can't touch another admin or the owner. This stops one admin removing everyone else.

## 5. Invite, accept, remove, leave

```text
Owner or admin              Invitee                      Result
 Invite (email or @handle) ->  sees invitation
                               Accept ------------------> member row, channel in switcher
                               Decline -----------------> invite closed
 Cancel (while pending) -----------------------------------> invite closed
                               nothing for 14 days -------> invite expired
 Change role / Remove ------------------------------------> applies on next request
                               Leave ---------------------> member row removed
```

### 5.1 Who can be invited

An invitation names one account, by one of these, and always needs the invitee to accept:

- **Exact @handle.** Resolved through `channel-handles/{handle}` to that channel's owner. An unknown handle gives an inline error, since handles are public anyway.
- **Exact email**, compared case-insensitively.

Email invitations need no lookup in auth. The row stores the normalized email, and it is matched against the **verified email in the invitee's own token** when they next load their invitations. So:

- Every email gets the same response, so the form can't be used to find out who has an account.
- The inviter's list shows "Pending" either way. If no account matches, it expires and nothing is sent (open question 7).
- The stored email is cleared when the invitation closes, and expires with it after 14 days. On first match, `invitee_user_id` is filled in and the invitee's notification is created.

If a token has no email claim, only @handle invitations can match for that account. The plan confirms on QA that web tokens carry it.

### 5.2 Accept

One D1 batch closes the invitation and inserts the member, guarded on `status = 'pending'` and not expired, so a double click or a race can't create two results. Before it, the server re-checks that the channel exists and isn't deleted, that the caller is the invitee, and the limits (§13).

| Condition | Error |
|---|---|
| Inviting yourself, or the owner | `cannot_invite_owner` |
| @handle's owner is already a member, or a pending invitation exists | `already_member`, `already_invited` |
| Role is `owner`, or unknown | `invalid_role` |
| Inviter lacks the capability for that role | 403 |
| Over a limit | `member_limit`, `pending_limit`, 429 |
| Invitation expired, closed, or not yours | `invite_not_found` (the same for all three) |

An email invitee who turns out to be a member already gets the invitation closed, and their role doesn't change.

### 5.3 Change role, remove, leave

- Changing a role or removing someone updates the row, and takes effect on the next request, because roles are read from D1 and never cached in a token.
- Removing a member also cancels any pending invitations they sent. Cancelling invitations is not needed when someone changes role, unless they lose `members.manage`, which also cancels.
- Content a removed member uploaded stays with the channel (§8).
- Live stream keys are rotated when a member with `live.manage` is removed or leaves, since they have seen them.
- A member's active-channel selection falls back on the next refresh (§7).

## 6. One permission helper

### 6.1 The helper

`apps/api-videos/src/lib/channelAccess.ts`, with the pure parts in `packages/shared-types/src/channel-roles.ts` so clients share them:

```ts
export type ChannelRole = 'owner' | 'admin' | 'editor' | 'moderator' | 'analytics_viewer';

// Pure: the matrix in §4. Takes no token and no site role.
export function can(role: ChannelRole | null, capability: ChannelCapability): boolean;

// channel.userId === userId is 'owner', with no D1 read. Otherwise one read
// of channel_members, memoized per request. Throws if D1 fails.
export function getChannelRole(env, userId: string, channel: { id: string; userId: string }): Promise<ChannelRole | null>;

export async function requireChannelAccess(c, channel, capability): Promise<ChannelRole>;
```

- **Owners cost nothing.** The owner path never touches D1, so today's traffic has no new read and owners keep working if D1 is down.
- **Fail closed.** If D1 fails for a non-owner, the request gets 503, never access.
- `video.delete` for an editor is `can(...)` plus `video.uploadedBy === userId`, in one helper, `canDeleteVideo`.

### 6.2 Sorting the existing checks

| Kind of check | Examples | Becomes |
|---|---|---|
| Channel or its content | Channel update, sections, tabs, videos, schedules, subtitles, chapters, posts, channel playlists, comment moderation, live, analytics | `requireChannelAccess` with the §4 capability |
| A person's own record | Their comment (edit), watch history, likes, upload templates, notifications, a TUS session | Unchanged |
| Erasure and export (`lib/privacy/user-data.ts`) | Finds what belongs to a user | Unchanged, plus §12 |
| Listing "mine" | `ownedChannelIds`, `channelCreate`'s count | Unchanged (owned only) |

For content with a `channelId`, the check uses the **channel's** owner and the member table, and not `video.userId`. Videos with no `channelId` (legacy) keep the plain owner comparison.

### 6.3 Channel id header: allow-list, not a global change

`middleware/auth.ts:249` guards routes that have no check of their own. Letting any member through globally would silently open them. So:

- The middleware resolves the role and stores it on the context.
- Each route opts in by declaring the capability it needs. A route with no declaration stays **owner only**, exactly as today.
- Migration is therefore safe to do one area at a time, and a missed route stays closed.

## 7. Channel switcher and web

New endpoint `GET /api/channels/access` returns channels where the caller has any role: owned first, then shared, each with `role` and the capability list, `private, no-store`. The same filters as today apply (deleted and hidden channels are left out).

- **The session cookie stays as it is, for owned channels.** Shared channels are fetched when the switcher opens, because the cookie has no room for them. The active channel keeps its id and role.
- The switcher shows the role next to shared channels ("Editor"). Owned channels show no label.
- The default active channel stays the main owned channel. Someone with only shared channels defaults to the first one, and is never made to create their own.
- A stale selection gets 403 and falls back to the main or first channel. The `channels_changed` realtime event (shared with PR #460) is sent on accept, role change, removal and leave.
- Web checks use capabilities from the API, for display only. The server remains the enforcer.
- `channelCreate`'s rules and `isMain` only ever consider owned channels.

## 8. Video ownership

**`video.userId` means "the owner of the channel this video is in", and never "who uploaded it".** The server sets it to `channel.userId` regardless of who is calling.

A new optional field records the person:

| Field | Meaning | Visibility |
|---|---|---|
| `video.userId` | The channel owner | As today |
| `video.uploadedBy` | The account that uploaded it. Absent on existing videos, which means the owner | Never in public views. Shown to `members.view` |

Why:

- `content_ownership`, plan limits, GDPR erasure, publish notices and the PR #460 transfer all key on `video.userId`. All of them stay correct with no changes.
- An editor's departure, or their account deletion, doesn't delete or orphan the channel's videos.
- A transfer rewrites one value on every video, and the "anything else is an anomaly" rule in the transfer spec stays true.

The same applies to community posts (`post.userId` is the owner, new `post.authorId`), and to channel playlists and live streams (`userId` is the owner, new `createdBy`).

An upload session (`TUS_SESSIONS`) keeps the person's `userId` for its own checks, and adds `channelId`. `uploadComplete.ts` then uses `requireChannelAccess`. Plan limits and quotas are always those of the **channel owner's** plan, not the editor's.

Comments and reactions made as the channel keep the real person's `userId` and the channel's `channelId`, and display as the channel (open question 10).

## 9. Storage and migration

**The R2 channel record is unchanged.** It stays the source of truth for the owner. Membership is new data, in a new D1 database for `api-videos`, `CHANNEL_ROLES_DB` (open question 8), migrations in `apps/api-videos/migrations/channel-roles/`.

```sql
-- 0001_channel_roles.sql
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','moderator','analytics_viewer')),
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members (user_id);

CREATE TABLE IF NOT EXISTS channel_invites (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','moderator','analytics_viewer')),
  invitee_user_id TEXT,
  invitee_email TEXT,             -- normalized; cleared when the invite closes
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  responded_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_user ON channel_invites (channel_id, invitee_user_id) WHERE status = 'pending' AND invitee_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_email ON channel_invites (channel_id, invitee_email) WHERE status = 'pending' AND invitee_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invites_invitee_user ON channel_invites (invitee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_invites_invitee_email ON channel_invites (invitee_email, status);
CREATE INDEX IF NOT EXISTS idx_invites_expiry ON channel_invites (status, expires_at);

CREATE TABLE IF NOT EXISTS channel_audit (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,           -- see §10
  target_user_id TEXT,
  old_role TEXT,
  new_role TEXT,
  detail_json TEXT,               -- never email addresses
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channel_audit_channel ON channel_audit (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_audit_actor ON channel_audit (actor_id);
```

**Migration.** New tables only, so expand-only and rollback-safe. No backfill: every channel has its owner already, and no one has a membership on day one. `uploadedBy`, `authorId` and `createdBy` are optional and only appear on new content.

If D1 is lost, owners are unaffected and members lose access until a restore. Nothing else depends on these tables.

**Interaction with a transfer (PR #460).** A transfer changes only the owner, and leaves every other row alone. If the new owner already had a member row, the transfer deletes it, because owners have no row. Their pending invitations for that channel are cancelled. If the super admin ticks "keep the old owner as channel admin", the transfer inserts that row. The new owner then manages members normally.

## 10. Audit log

`channel_audit`, written in the **same D1 batch** as the change, so a change and its record can't disagree.

- **Membership actions, always:** `invite_sent`, `invite_cancelled`, `invite_accepted`, `invite_declined`, `invite_expired`, `role_changed`, `member_removed`, `member_left`, `member_removed_account_deleted`, `transfer_kept_old_owner`.
- **Content actions, only when the actor isn't the owner:** `video_deleted`, `video_published`, `channel_edited`, `stream_key_rotated`, `comment_removed`. These writes come after the R2 change and don't block it, since R2 and D1 can't share a batch. A failure is logged.

Owner and admins see it on the Activity tab. Actors appear by name. Rows are kept for one year and then deleted by the daily cron (open question 11). On account deletion, `actor_id` and `target_user_id` become `DELETED_USER_ID`.

## 11. Notifications

Stored as keys and params, in the `account` category (always delivered, no toggle), which this feature or PR #460 adds, whichever ships first. `dedupeKey` is the invitation or membership event id.

| Key | To | English | Arabic |
|---|---|---|---|
| `channelInviteReceived` | Invitee | {inviter} invited you to {channel} as {role}. | دعاك {inviter} إلى قناة {channel} بدور {role}. |
| `channelInviteAccepted` | Inviter | {member} joined {channel} as {role}. | انضم {member} إلى قناة {channel} بدور {role}. |
| `channelRoleChanged` | Member | Your role on {channel} is now {role}. | أصبح دورك في قناة {channel} الآن {role}. |
| `channelMemberRemoved` | Member | You no longer have access to {channel}. | لم يعد بإمكانك الوصول إلى قناة {channel}. |
| `channelMemberLeft` | Owner | {member} left {channel}. | غادر {member} قناة {channel}. |

Declines and expiries notify nobody. The Members page shows them. Nobody is notified about their own action.

## 12. Account and channel deletion

**Account deleted.** Auth's `account.deleted` event reaches api-videos at `POST /internal/events/account-deleted` (`INTERNAL_API_KEY`, constant-time compare, repeat calls are safe), carrying the user id only. It:

1. Deletes that user's `channel_members` rows, writing `member_removed_account_deleted` to each channel's audit.
2. Cancels pending invitations to or from them.
3. Sets `uploadedBy`, `authorId` and `createdBy` to `DELETED_USER_ID`, through a resumable job like the privacy ones.
4. Anonymizes their audit rows.

**This needs work in auth.** On AlUmmahNowAuth today, `auth.account.deleted` exists only as a constant in `apps/auth/src/audit-events.ts`, and nothing emits it or delivers it to Videos (open question 9). Until it's delivered, a deleted account can't use its memberships anyway, because it has no valid token. Stale rows would only appear in member lists.

The account's own channels are outside this event. `eraseUserData` handles those, and its channel step also removes those channels' members and invitations. `DELETE /api/privacy/data` runs the steps above too, so someone erasing their data doesn't wait for auth.

**Channel deleted.** `channelDelete.ts` deletes the channel's members and invitations and keeps the audit rows until they age out. A daily cron removes any membership whose channel no longer exists.

Data export (`collectUserData`) gains the user's memberships and invitations.

## 13. Limits

| Limit | Value | Enforced |
|---|---|---|
| Members per channel | New entitlement `channel.members_max` (admin-managed, on the **channel owner's** plan). Open question 6 | On invite and accept |
| Pending invitations per channel | 50 | On invite |
| Shared channels per account | 50 | On accept |
| Invitations | 30 per actor per hour, 100 per channel per day (`RATE_LIMIT_KV`) | On invite |
| Invitation lifetime | 14 days | Daily cron, and checked at accept |

Declared in `packages/shared-types/src/entitlements.ts` and `lib/entitlements.ts`. On a downgrade, existing members stay and new invitations are refused, the same as `channel.max`.

## 14. API and screens

Under `api-videos`, all authenticated:

| Method and path | Capability | Purpose |
|---|---|---|
| `GET /api/channels/access` | Signed in | Channels with a role (§7) |
| `GET /api/channels/:id/members` | `members.view` | Members and pending invitations |
| `POST /api/channels/:id/invites` | `members.manage` or `manage_admins`, by role | Invite. Body: `email` or `handle`, and `role` |
| `DELETE /api/channels/:id/invites/:inviteId` | Same | Cancel |
| `PUT /api/channels/:id/members/:userId` | Same, for old and new role | Change role |
| `DELETE /api/channels/:id/members/:userId` | Same, by the member's role | Remove |
| `POST /api/channels/:id/leave` | Any non-owner role | Leave |
| `GET /api/channels/:id/audit` | `members.view` | Activity |
| `GET /api/channel-invites` | Signed in | My invitations (matched by user id or token email) |
| `POST /api/channel-invites/:id/accept`, `/decline` | The invitee | Respond |
| `POST /internal/events/account-deleted` | Internal key | §12 |

**Web.** `settings/channel/[id]/members` (Members and Activity tabs), and a `settings/channel-invites` page reached from the notification.

```text
Team                                                [Invite someone]
Name             Role                              
You              Owner
Sara             [ Editor v ]              [Remove]
Moderator One    [ Moderator v ]           [Remove]
new@example.com  Pending, editor, 12 days  [Cancel]

Invite: Email or @handle [            ]  Role [ Editor v ]  [Send]
Admins can do everything except change the handle, delete the channel, or add other admins.
```

States: empty, loading, member limit reached, sending, invitation sent, already invited, role saving, removed, forbidden.

Theme and layout follow the web app's semantic tokens with no hex values, and logical properties so Arabic mirrors. Emails and handles are wrapped in `dir="ltr"`. Strings go in `packages/shared-types/src/i18n-static`.

| Key | English | Arabic |
|---|---|---|
| `channelRoles.owner` | Owner | المالك |
| `channelRoles.admin` | Channel admin | مشرف القناة |
| `channelRoles.editor` | Editor | محرر |
| `channelRoles.moderator` | Channel moderator | مراقب القناة |
| `channelRoles.analytics_viewer` | Analytics viewer | مشاهد الإحصاءات |
| `channelRoles.invite` | Invite someone | دعوة شخص |
| `channelRoles.inviteHint` | Email or @handle | البريد الإلكتروني أو المعرّف @ |
| `channelRoles.pending` | Pending | قيد الانتظار |
| `channelRoles.accept` | Accept | قبول |
| `channelRoles.decline` | Decline | رفض |
| `channelRoles.leave` | Leave this channel | مغادرة هذه القناة |
| `channelRoles.remove` | Remove | إزالة |

## 15. Tests

**Unit**
- `can()`, table-driven over every role and every capability in §4, including `null`. The table is the spec.
- `getChannelRole`: owner path makes no D1 call, D1 failure throws for a non-owner and doesn't for the owner.
- `canDeleteVideo`: an editor's own upload and someone else's, and a legacy video with no `uploadedBy`.
- Editing roles: an admin can't change an admin or the owner.
- Invitation rules: expiry, double accept, wrong account, email matched case-insensitively, email cleared on close, same response for known and unknown emails.
- The server sets `video.userId` to the channel owner when an editor uploads.

**Separation (§2)**
- A token with `Super Admin` and no membership gets no channel capability.
- A token with a channel role and no site role gets 403 on every admin-api route.
- Accepting an invitation makes no call to auth, and the token's `roles` are unchanged.

**API**
- A sample of each area in §4, per role, against the real routes.
- A route with no declared capability refuses a member through the channel id header (§6.3).
- Removal takes effect on the next request. The account-deleted route is safe to repeat and refuses a bad key.

**E2E on QA** (`apps/web/e2e/release/channel-roles.spec.ts`, throwaway `@e2e.alummahnow.net` users)
1. A creates a channel and invites B as editor, by email.
2. B accepts. The switcher shows the channel with "Editor".
3. B switches, uploads a video with the existing helper, and edits it.
4. B gets 403 on deleting the channel. The video is listed under the channel and A can manage it.
5. A changes B to moderator: B can no longer edit the video.
6. A removes B. B gets 403, and the channel leaves B's switcher after a refresh. Notifications arrived. The Activity tab lists it all.
7. The Arabic page renders mirrored. Clean up.

**Old test cases.** `TCCHAN002` to `007` are updated: Channel Admin is admin, Channel Moderator is moderator, and "Channel Member" means a subscriber with no role. Public joining, bulk invitations and member messaging are removed as out of scope.

## 16. Cost

One D1 read per request by a non-owner on a channel route, and none for owners or for public pages. Writes are rare. This is far inside the $500 per month cap.

## 17. Open questions for the owner

1. **Name of the second role.** Epics says "manager", you said "admins". *Recommended: "Channel admin" in the UI, `admin` in code.*
2. **Can a channel admin add or remove other admins?** *Recommended: no, owner only, so one admin can't lock out the others.*
3. **Can an editor delete videos?** *Recommended: only their own uploads. Admins and the owner can delete any.*
4. **Do editors see analytics?** *Recommended: no. Add the analytics viewer role to them if it's needed. A person holds one role per channel, so this would be a new combined role later.*
5. **Live for editors.** Stream keys let someone broadcast as the channel. *Recommended: owner and admin only. Editors can't go live.*
6. **Plan limit.** Every feature is tiered. *Recommended: `channel.members_max` seeded to 2 on Free and a higher number on paid plans, all editable by admins, with a hard cap of 50.*
7. **An email with no account.** *Recommended: same response as any other, and nothing is sent. Telling the inviter would reveal who has an account.*
8. **Where the tables live.** *Recommended: a new `CHANNEL_ROLES_DB`. `SEARCH_DB` needs no new binding, but it holds rebuildable index data, while this is the only copy of who has access.*
9. **Delivery of `account.deleted`.** Auth doesn't emit it today. *Recommended: auth posts to `/internal/events/account-deleted`, retried until accepted. It's a small AlUmmahNowAuth change, and no role data crosses.*
10. **Commenting as the channel.** *Recommended: it shows as the channel. The real person is recorded and visible only to the owner and admins.*
11. **Audit retention.** *Recommended: one year.*
