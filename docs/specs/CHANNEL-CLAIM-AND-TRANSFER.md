# Channel claim and transfer

**Status:** Draft for owner review. Not implemented.
**Date:** 2026-11-08
**Plan:** [CHANNEL-CLAIM-AND-TRANSFER-PLAN.md](CHANNEL-CLAIM-AND-TRANSFER-PLAN.md)
**Related:** `apps/api-videos/src/lib/channelHandles.ts`, `packages/shared-types/src/search/ownership.ts`, `docs/design/THEMES.md`, `docs/compliance/GDPR.md`, channel roles spec (PR #462)

## 1. Summary

A super admin gets a **Channel ownership** screen on the admin site, with two operations:

1. **Set or release a channel's @handle**, on any channel, including the official handles (`alummah`, `lamahat` and so on).
2. **Transfer a channel to a user**, found by email or id. "Claiming" a channel for an official or staff account is the same operation with the target set to that account or to the super admin themselves.

Today a super admin can only set an official handle on a channel they already own, from the normal channel settings form. Nothing can move a channel between users.

A channel owner can add admins and other roles (channel roles spec, PR #462), but can't change who owns the channel. **Only a super admin can transfer ownership**, and only on the admin site. There is no user-facing transfer of any kind.

### Goals

- A transfer changes the owner and nothing else. Everything that hangs off the channel goes to the new owner, and the access of anyone else on the channel is untouched (§6.9).
- Every operation here is limited to super admins, enforced on the server.
- Every operation is confirmed twice, audited, safe to retry, and recoverable if it stops halfway.

### Non-goals

- Any transfer by a channel owner or other user, including moving a channel between someone's own accounts.
- Co-owners. A channel has exactly one owner.
- Moving comments, likes or watch history. Those record what a person did and stay with them.
- Plan gating. These are operator tools, so they have no entitlement key (see §6.6 for `channel.max`).

### Out of scope / related

- **Per-channel roles** (admins, editors, moderators, analytics viewers) are specified in the channel roles spec, [PR #462](https://github.com/Al-Ummah-Now/AlUmmahNow/pull/462). They are separate from site roles: stored on the videos side, never in auth or tokens. A channel role never allows a transfer. The one link between the two is that a super admin, which is a site role, performs the transfer here.

## 2. What exists today

| Area | Today | Consequence for this design |
|---|---|---|
| Channel owner | `channel.userId` in the `channels` R2 bucket. Also `channel.email`, a copy of the owner's email made at creation | Both change on transfer |
| Video owner | `video.userId`. Edit, delete, schedule, subtitles, chapters, comment moderation and analytics all compare it with the caller | Every video in the channel must be rewritten, or the new owner can't manage them and the old owner still can |
| Ownership index | `content_ownership` in `SEARCH_DB`, for videos and channels. R2 is the source of truth | Rows follow R2 writes (below). No direct SQL updates needed |
| Index sync | api-videos wraps its R2 bindings (`withSearchSync`), so every put updates the ownership row inline and the search row in the background | **The transfer must run in api-videos**, through the wrapped bindings |
| Handle index | `channel-handles/{handle}` in the `channel_tabs` bucket, holding `channelId` and `userId` | admin-api has no `channel_tabs` binding, which is a second reason to run in api-videos |
| Internal calls | `/internal/*` on api-videos requires `X-API-Key = INTERNAL_API_KEY` | Used for admin-api to api-videos, plus a check of the actor's token (§5) |
| Queue and workers | api-videos only produces queue messages. The processor consumes them and has `REPORTS_DB` and `INTERNAL_API_KEY` | The processor drives long transfers (§6.4) |
| Audit precedent | `channel_verification_log` in `REPORTS_DB`, written before the change (`ChannelVerificationPut`) | Same pattern. Workers Logs samples 10% of requests, so logs can't be the audit trail |
| User lookup | Auth has `GET /admin/users?email=` and `GET /admin/users/:id`, for M2M tokens with an `admin:*` scope plus `X-Acting-User-Id`. It reads the actor's roles from its own database | admin-api needs its own M2M client (§5.3). `email=` is a substring match, so results must be filtered to an exact match |
| Web session | The channel list is cached in the HttpOnly session cookie and reloaded at sign-in and on an account switch | Needs a realtime nudge (§6.8) |

## 3. Site roles

These are platform-wide roles from auth. They have nothing to do with channel roles: a channel admin gets 403 here unless they also hold the site role.

| Layer | Form seen | Check |
|---|---|---|
| Auth token | Display name, `"Super Admin"` | |
| admin-api | Normalized to `super_admin` when the token is read | New `hasSuperAdminRole()` in `lib/roles.ts` |
| admin-web | `normalizeRole()`, then `isSuperAdmin()` (exists) | Page guard and nav visibility only |
| api-videos | Raw token names, compared case-insensitively | Existing `canClaimOfficialHandles()` |

`Admin` and `Moderator` get 403 from every endpoint here, reads included, because user lookup exposes email addresses.

## 4. Operations

### 4.1 Set a handle

Input: channel, handle, reason.

- Validated with `validateHandleFormat(handle, { allowOfficial: true })`. Route and system words in `RESERVED_HANDLES` stay blocked for everyone, super admins included.
- The claim uses a new exclusive write, `claimHandleExclusive`: an R2 put with `onlyIf: { etagDoesNotMatch: '*' }`, so two simultaneous claims can't both win. The existing read-back in `claimHandle` remains for owner edits.
- The channel's previous handle is released afterwards.
- If the handle is free or already on this channel, it proceeds. If another channel holds it, see §4.2.

### 4.2 Take an official handle from another channel

If the handle is in `OFFICIAL_HANDLES` and another channel holds it, the screen shows the holder and offers **Take this handle**. This is the case of a channel that claimed the name before it was reserved. The holder is given a default handle (`claimDefaultHandle`) and its owner is notified. Any other taken handle returns `taken`, with no override.

This is open question 3.

### 4.3 Release a handle

The channel immediately gets a default handle from `claimDefaultHandle`, so its page keeps a working `/c/` URL. A released official handle remains reserved. Old `/c/{handle}` links stop working, and the confirm step says so.

### 4.4 Transfer a channel

Input: channel, target (`toUserId`, or "me"), reason, and the options in §6.3 and §6.9.

Refused with a specific error when:

| Condition | Error |
|---|---|
| Channel missing or soft-deleted | `channel_not_found` |
| Target is already the owner | `already_owner`, or a no-op success on an idempotent retry |
| Target missing, or auth status isn't active | `target_not_eligible` |
| Target has no profile in R2 (a channel needs one) | `target_has_no_profile` |
| A transfer is already running on this channel | `transfer_in_progress` |
| Channel has a live stream in progress | `channel_is_live` |
| Preview no longer matches (§5.2) | `preview_stale` |

A channel hidden by moderation can be transferred, with a warning. Its hidden state doesn't change.

### 4.5 Claim for staff

This is §4.4 with the target set to the signed-in super admin ("Assign to me") or to a named staff account. There is no separate code path. The super admin's account needs a profile, the same as any target.

## 5. Permissions and trust

### 5.1 Enforcement chain

```text
admin-web          page guard: isSuperAdmin (display only)
   | bearer token of the super admin
admin-api          SuperAdminRoute: verified token + hasSuperAdminRole
   |               re-reads the actor's roles from auth at commit, fails closed
   | X-API-Key + X-Actor-Authorization: Bearer <same token>
api-videos         /internal/channels/*: key + token verified + canClaimOfficialHandles
                   token subject must equal actorId in the body
```

The `INTERNAL_API_KEY` is shared by several workers. Requiring the actor's token as well means a leaked key alone can't move a channel. The new routes compare the key in constant time.

`POST /internal/channel-transfers/:id/advance` takes only a job id and no actor token. It can only continue a job that was already authorized, and accepts no parameters that change the outcome.

### 5.2 Two-step confirm

1. **Preview.** The server returns what will happen, plus `previewHash`: SHA-256 of channel id, current owner, target, current handle, `isMain`, options and the channel's `dateModified`.
2. **Commit.** The client sends `previewHash`, a reason of 10 to 500 characters, and the channel's current @handle typed by hand. The handle is Latin in both locales. If the channel somehow has no handle, the channel id is typed instead. The server recomputes the hash and checks the typed value.

### 5.3 User lookup

admin-api gets a new M2M client with scope `admin:users` only, one per environment, and calls auth with `X-Acting-User-Id` set to the super admin. An email search is an exact, case-insensitive match after the fetch, and returns id, name, email, status and roles. A partial match returns nothing, which avoids picking the wrong person. Each lookup writes an audit row.

## 6. Transfer behaviour

### 6.1 What moves

| Record | Change | How it's found |
|---|---|---|
| Channel object | `userId`, `email` (new owner's), `isMain` (§6.2), `contactEmail` (§6.3), `dateModified`, plus `transferredAt` | By id |
| Handle index entry | `userId` | By handle. Handle stays with the channel by default |
| `profiles/{old}`, `profiles/{new}` | `channels[]` loses or gains the id | By id |
| Videos and shorts, including hidden, soft-deleted, private and draft | `userId` | `content_ownership` by `channel_id`, no flag filter (new query). R2 scan if the index is incomplete |
| Live streams, `livestream:*` in `videos` | `userId`, and a new `streamKey` and `rtmpUrl` (§6.3) | Prefix scan, filtered on `channelId` |
| Schedule metadata in `scheduled-videos` | `userId`, so publish notices reach the new owner | From each scheduled video |
| Playlists whose `channelId` matches | `userId` | Bucket scan (no index), the same bounded scan channel deletion uses |
| Community posts, `posts/{channelId}/*.json` | `userId` | Prefix list |
| Subscriptions this channel made to other channels. Each is an entry in the other channel's `subscriptions[]`, with this channel's id as `channelId` | Entry `userId`, the `channel_subscribers` row (bell kept), and `profile.subscribedTo` on both accounts | `channel_subscribers` by the old owner, plus `profile.subscribedTo`, filtered on `channelId` |
| `content_ownership` and search rows | Follow automatically from the R2 writes | |

Only records whose `userId` equals the old owner are rewritten. Any other value is a data anomaly: it's left alone, counted, and shown in the result.

Unchanged: subscribers and bells, sections and tabs, views and analytics history (they follow the channel and videos), reports, verification log, comments and reactions.

### 6.2 Main channel and the two owners

**New owner**
- If they already have a main channel, the moved channel arrives with `isMain: false`.
- If they have no channels, it becomes their main channel.
- Their active channel doesn't change. If they had none, it follows the normal default.

**Old owner**
- If the channel was their main and they have others, the existing `pickNewMainChannel` picks the oldest remaining channel.
- If it was their only channel, they are left with none. That's already a supported state after a channel delete: they can browse and create another.
- If it was their active channel, the web client falls back to their main or first channel on the next refresh (§6.8).
- The server stops honouring them on the moved content as soon as each record is rewritten. They lose all access unless the super admin keeps them as channel admin (§6.9).

### 6.3 Options and security clean-up

| Item | Behaviour |
|---|---|
| Live stream keys | **Always rotated** on every stream that hasn't ended, since the old owner knows them |
| `contactEmail` | **Cleared by default**, because it's the old owner's public contact. A checkbox keeps it |
| Handle | Kept by default. Option: release it (§4.3) |
| Official handle going to a non-staff user | Warned. Needs a second tick, `allowOfficialToNonStaff`. "Staff" means the target has any admin role in auth, which is a site role. A channel role never counts |
| Scholar verification badge | **Removed unless the target is staff**. A tick box lets the super admin override this either way (open question 2) |

`email` and `contactEmail` aren't kept in the job or audit rows, so a transfer doesn't create a second copy of personal data. GDPR access and erasure run off `userId`, so after a transfer the content is treated as the new owner's.

### 6.4 Execution: a resumable job

A channel can have thousands of videos, which won't fit in one Worker request. So a transfer is a job in `SEARCH_DB`, run in phases:

```text
channel -> links -> videos -> live -> schedules -> playlists -> posts -> subscriptions -> notify -> verify -> done
```

- **`channel`** is the commit point. It writes the channel object with an etag check, retried three times. If it fails, nothing has happened and the operation fails cleanly.
- **`links`** updates the handle entry, both profiles and the old owner's main channel.
- The commit request runs `channel` and `links`, then as much as the budget allows, using the same `OperationBudget` as the privacy jobs. It returns 202 if work remains.
- Remaining work is driven by a queue message, `ChannelTransferAdvance`. The processor calls `/internal/channel-transfers/:id/advance` and re-enqueues until the job is finished. A lease on the job stops two advances overlapping.

The channel is flipped first on purpose. If the job stalls, the new owner already holds the channel and the rest can be completed. Moving content first could leave the channel with an owner who has none of its videos.

During a large transfer the two owners briefly each hold part of the content. That's minutes at most, and the channel-level checks already apply to the new owner.

### 6.5 Verify, repair, retry

The `verify` phase re-reads the truth from R2 and checks:

- the channel's owner, and the handle entry
- both profiles
- no `content_ownership` row for this channel with a different owner
- posts and playlists, from the counts recorded in earlier phases

A mismatch sends the job back to the affected phase, up to three times. After that the job becomes `needs_attention` and the screen offers **Retry**.

Two races can put an old `userId` back: an old owner's edit that read the record before the flip, and an upload that finishes after it. So completed jobs are verified again by the api-videos daily cron for 48 hours. The same cron re-enqueues any job whose lease expired without progress.

### 6.6 Effect of `channel.max`

The channel limit entitlement isn't enforced at channel creation yet. A super admin transfer can exceed it on purpose, now and once it is enforced (open question 5). The preview shows a note if the target would be over their plan's value.

### 6.7 Notifications

Stored as keys and params, per the notification centre design, and rendered in the reader's language. New keys go in a new `account` category that is always delivered and doesn't appear in the settings toggles.

| Key | To | English | Arabic |
|---|---|---|---|
| `channelTransferredOut` | Old owner | Your channel {channel} was moved to another account by the Al Ummah Now team. | نقل فريق الأمة الآن قناتك {channel} إلى حساب آخر. |
| `channelTransferredIn` | New owner | You are now the owner of the channel {channel}. | أصبحت الآن مالك قناة {channel}. |
| `channelHandleChanged` | Channel owner | The handle of your channel {channel} was changed to @{handle} by the Al Ummah Now team. | غيّر فريق الأمة الآن معرّف قناتك {channel} إلى @{handle}. |

The name of the acting admin is never shown. `dedupeKey` is `transfer:{jobId}:{role}`, so retries don't send duplicates. The old owner is always notified, and there is no silent option (open question 4). Nobody is notified about their own action: a super admin who sets a handle on their own channel, or who takes one to themselves, gets no notice for that side.

### 6.8 Caches, search and sessions

| Surface | Action |
|---|---|
| `content_ownership`, search rows | Automatic via the wrapped buckets |
| Edge cache (`videos/v1/first-page`, recommendations) and `public, max-age` responses | No purge. They live 10 to 120 seconds, per colo, and the Cache API can't purge across colos anyway. A public channel view does carry `userId`, but no permission check reads a cached response, so a stale value for up to two minutes is harmless |
| Handle resolution, channel pages | Read R2 on each request, so a new handle is live at once |
| Web session cookie and channel switcher | New realtime event `channels_changed` on `user:{id}` to both owners. The web client calls `reloadUserChannels()` and refreshes. An offline user picks it up at next sign-in or account switch. Until then, a stale entry can only produce a 403 |

### 6.9 Only the owner changes

A transfer replaces the owner and does not touch anyone else's access. This stays correct once channel roles (PR #462) exist:

| Who | After the transfer |
|---|---|
| Channel admins, editors, moderators, analytics viewers | Keep their roles, unchanged. The new owner can manage them afterwards |
| Pending invitations | Stay valid, except any addressed to the new owner, which are cancelled |
| New owner, if already a member | Their member row is removed, because an owner has no member row |
| Old owner | **Loses all access** (open question 6) |

The super admin can tick **Keep the old owner as channel admin**, option `keepOldOwnerAsAdmin`, which adds them as a channel admin. The option is hidden until channel roles exist. Until then the old owner always loses access.

Membership changes happen in the `links` phase and are checked in `verify`. Under the roles spec, `video.userId` always means the channel owner, and the uploader is recorded separately in `uploadedBy`. So the rule in §6.1 that only records on the old owner are rewritten still holds, and `uploadedBy` is never changed.

## 7. Data changes

**`apps/admin-api/migrations/0006_channel_ownership_audit.sql`** (`REPORTS_DB`), append-only:

```sql
CREATE TABLE IF NOT EXISTS channel_ownership_audit (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,     -- the Idempotency-Key
  event TEXT NOT NULL,            -- requested | succeeded | failed | needs_attention
  action TEXT NOT NULL,           -- handle_set | handle_take | handle_release | transfer | user_lookup
  channel_id TEXT,
  actor_id TEXT NOT NULL,
  from_user_id TEXT,
  to_user_id TEXT,
  old_handle TEXT,
  new_handle TEXT,
  reason TEXT,
  detail_json TEXT,               -- counts, error code; never email addresses
  created_at TEXT NOT NULL,
  UNIQUE (operation_id, event)
);
CREATE INDEX IF NOT EXISTS idx_channel_ownership_audit_channel ON channel_ownership_audit (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_ownership_audit_actor ON channel_ownership_audit (actor_id, created_at);
```

**`apps/api-videos/migrations/search/0003_channel_transfers.sql`** (`SEARCH_DB`):

```sql
CREATE TABLE IF NOT EXISTS channel_transfers (
  id TEXT PRIMARY KEY,            -- the operation id
  channel_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  options_json TEXT NOT NULL,
  status TEXT NOT NULL,           -- running | needs_attention | done
  phase TEXT NOT NULL,
  cursor TEXT,
  counts_json TEXT NOT NULL DEFAULT '{}',
  verify_attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_transfers_active
  ON channel_transfers (channel_id) WHERE status <> 'done';
CREATE INDEX IF NOT EXISTS idx_channel_transfers_status ON channel_transfers (status, updated_at);
```

Both are new tables, so they're expand-only and rollback-safe. Each needs `pnpm schema:snapshot` committed with it, to pass `check:migrations` and `check:schema`.

No backfill: no existing record changes shape. `transferredAt` on a channel is optional.

**Verify tool:** `GET /internal/channels/:id/ownership-check` is read-only and reports any disagreement between the channel, its handle entry, profiles, content and the index. `scripts/ops/verify-channel-ownership.ts` runs it for one channel or for every recent transfer, and prints a summary. The index itself is already rebuilt from R2 by the daily ownership pass.

## 8. Safety

| Concern | Design |
|---|---|
| Accidental action | Preview, then typed handle plus a required reason (§5.2) |
| Audit | `requested` row written first, and if that write fails the operation doesn't start. A terminal row follows. For jobs the processor writes it, since it has `REPORTS_DB` |
| Idempotency | The client creates an `Idempotency-Key` when the dialog opens. It's the job id and audit `operation_id`, so a repeat returns the first result |
| One at a time | Partial unique index, one unfinished job per channel. Handle edits on that channel return `transfer_in_progress` |
| Partial failure | §6.4 and §6.5. Every phase can be repeated safely, because a record already on the new owner is skipped |
| Rate limit | Counted from the audit table, so no new binding: 30 mutations per actor per hour, 120 lookups per actor per hour. Over the limit returns 429 |
| Undo | Transfer back through the same screen. Cleared `contactEmail` and the previous main flag aren't restored, and the preview says so |

## 9. API

admin-api, all `SuperAdminRoute`, under `/api/channels`:

| Method and path | Purpose |
|---|---|
| `GET /search?q=` | By `@handle`, channel id, owner email or name |
| `GET /:id/admin-state` | Owner, handle, main flag, content counts, active job, audit history |
| `GET /users/lookup?email=` or `?id=` | Target lookup |
| `GET /handles/:handle/availability?channelId=` | Availability, with the holder if taken |
| `POST /:id/handle/preview`, `PUT /:id/handle` | Set a handle, or take one with `takeFromHolder` |
| `DELETE /:id/handle` | Release |
| `POST /:id/transfer/preview`, `POST /:id/transfer` | Transfer; 202 with a job id |
| `GET /transfers/:operationId` | Job progress |
| `POST /transfers/:operationId/retry` | Resume a `needs_attention` job |

api-videos adds the matching `/internal/channels/*` and `/internal/channel-transfers/*` routes, which hold all of the logic. Errors are codes, translated in admin-web.

## 10. Screen

New route `/channels` in admin-web, in the nav for super admins only. Other roles who open the URL go to `/access-denied`.

```text
Channel ownership
[ Search by @handle, channel id, owner email or name      ] [Search]

+-- Channel ------------------------------------------------------+
| (avatar)  Lamahat   @lamahat   [Official] [Verified] [Hidden]   |
| Owner: Name <email>   id: u_123     Main channel: yes           |
| 1,204 videos, 12 playlists, 88 posts                            |
|                                                                 |
| [ Handle ]   [ Owner ]   [ History ]                            |
+-----------------------------------------------------------------+

Handle tab                         Owner tab
Handle  [ alummah      ] Available  ( ) Assign to me
[Set handle] [Release]              ( ) Assign to a user
                                    Email or user id [        ] [Find]
                                    Name <email>  Active  Roles: -
                                    [ ] Keep contact email
                                    [ ] Release the handle
                                    [ ] Keep scholar badge
                                    [ ] Keep the old owner as channel
                                        admin (once roles exist)
                                    [Review transfer]

Confirm dialog (focus trapped)
  Move Lamahat from A to B
  - 1,204 videos, 12 playlists and 88 posts will move
  - Private and draft videos move too
  - A has another channel; X becomes their main channel
  - Live stream keys will be replaced
  - Everyone else on the channel keeps their role
  - A loses access to this channel
  Reason [                                                ]
  Type @lamahat to confirm [          ]
  [Cancel]                            [Transfer channel]

Progress
  Moving videos 800 / 1,204  ...  Done | Needs attention [Retry]
```

**States:** empty, searching, no results, channel loaded, handle checking, handle taken (with holder), user not found, preview loading, preview stale, submitting, in progress, done, needs attention, rate limited, forbidden.

**Theme.** Only the semantic classes admin-web already maps (`bg-surface`, `bg-surface-2`, `text-fg`, `text-fg-muted`, `border-border`, `bg-accent`, `text-on-accent`, and the `danger-*`, `success-*` and `warning-*` tokens). These resolve to CSS variables in `globals.css`, the layer that moves onto the Fanous tokens under `docs/design/THEMES.md`. No hex values, no raw Tailwind palette colours, and not the old `admin.*` colours in `tailwind.config.ts`. If a colour is missing, it's added as a token.

**Layout.** Logical properties (`ms-`, `ps-`, `text-start`) so Arabic mirrors. Handles and ids are wrapped in `dir="ltr"`, and at phone width the tabs stack.

### Copy (`apps/admin-web/src/i18n/messages`)

| Key | English | Arabic |
|---|---|---|
| `channels.title` | Channel ownership | ملكية القنوات |
| `channels.search` | Search by @handle, channel id, owner email or name | ابحث بالمعرّف @ أو رقم القناة أو بريد المالك أو الاسم |
| `channels.noResults` | No channels found. | لم يُعثر على قنوات. |
| `channels.handleTab` | Handle | المعرّف |
| `channels.ownerTab` | Owner | المالك |
| `channels.historyTab` | History | السجل |
| `channels.setHandle` | Set handle | تعيين المعرّف |
| `channels.releaseHandle` | Release handle | تحرير المعرّف |
| `channels.handleAvailable` | Available | متاح |
| `channels.handleTaken` | Used by {channel} | مستخدم في {channel} |
| `channels.takeHandle` | Take this handle | أخذ هذا المعرّف |
| `channels.assignToMe` | Assign to me | تعيينها لي |
| `channels.assignToUser` | Assign to a user | تعيينها لمستخدم |
| `channels.findUser` | Find | بحث |
| `channels.userNotFound` | No account has that exact email or id. | لا يوجد حساب بهذا البريد أو الرقم تحديدًا. |
| `channels.review` | Review transfer | مراجعة النقل |
| `channels.reason` | Reason (kept in the audit log) | السبب (يُحفظ في سجل التدقيق) |
| `channels.typeToConfirm` | Type {handle} to confirm | اكتب {handle} للتأكيد |
| `channels.confirmTransfer` | Transfer channel | نقل القناة |
| `channels.cancel` | Cancel | إلغاء |
| `channels.warnPrivate` | Private and draft videos move too. | تُنقل أيضًا مقاطع الفيديو الخاصة والمسودات. |
| `channels.warnStreamKeys` | Live stream keys will be replaced. | سيتم استبدال مفاتيح البث المباشر. |
| `channels.warnOfficial` | This official handle would go to a non-staff account. | سينتقل هذا المعرّف الرسمي إلى حساب ليس من فريق العمل. |
| `channels.warnMembersKept` | Everyone else on this channel keeps their role. | يحتفظ بقية أعضاء القناة بأدوارهم. |
| `channels.warnOldOwner` | The old owner will lose access to this channel. | سيفقد المالك السابق إمكانية الوصول إلى هذه القناة. |
| `channels.keepOldOwner` | Keep the old owner as channel admin | الإبقاء على المالك السابق مشرفًا للقناة |
| `channels.keepBadge` | Keep the verification badge | الإبقاء على شارة التوثيق |
| `channels.inProgress` | Moving {done} of {total} | جارٍ نقل {done} من {total} |
| `channels.done` | Transfer complete. | اكتمل النقل. |
| `channels.needsAttention` | The transfer stopped before it finished. It is safe to retry. | توقف النقل قبل اكتماله. يمكن إعادة المحاولة بأمان. |
| `channels.retry` | Retry | إعادة المحاولة |
| `channels.previewStale` | This channel changed. Review it again. | تغيّرت هذه القناة. راجعها مرة أخرى. |
| `channels.rateLimited` | Too many actions. Try again later. | إجراءات كثيرة جدًا. حاول لاحقًا. |

## 11. Tests

**Unit**
- `applyTransferToChannel`: every main-channel case in §6.2, `contactEmail` kept and cleared, email replaced.
- Phase runner: resumes from a cursor, skips records already moved, leaves foreign `userId` alone and counts it, stops on budget, verify sends a mismatch back and ends in `needs_attention` after three attempts.
- Handle: official allowed, route words refused, exclusive write loses cleanly, take gives the holder a default handle, release leaves a working handle.
- `previewHash` changes when any input changes.
- Only the owner changes (§6.9): member rows are untouched, a new owner's own row is removed, `keepOldOwnerAsAdmin` adds the old owner, and `uploadedBy` isn't rewritten.

**API (admin-api and api-videos)**
- Each admin-api route: no token 401; Moderator and Admin 403; Super Admin passes. A channel owner or channel admin with no site role gets 403.
- Each internal route: no key 401; key without actor token 401; key with an Admin token 403; actor mismatch 403.
- Idempotent replay returns the first result and writes no second `requested` row.
- `requested` audit failure means no R2 write.
- 429 past each limit. Email lookup rejects partial matches.

**E2E on QA** (`apps/web/e2e/release/channel-transfer.spec.ts`, throwaway `@e2e.alummahnow.net` users, never production)
1. Create owner A and target B, and a super admin C.
2. A creates a channel and a community post. A video uses the existing upload helper, without waiting for encoding.
3. C transfers the channel to B on `/channels`, confirming through the dialog, in English, and checks the Arabic page renders mirrored.
4. B sees the channel and can edit it. A no longer lists it and gets 403 on an edit.
5. Notifications appear for A and B. The audit tab lists the transfer.
6. C sets a test handle (a non-official name, so QA's real handles are untouched), then releases it.
7. Clean up: B deletes the channel.

## 12. Cost

Writes are one R2 operation per moved object, on a rare, operator-only action, so a transfer costs fractions of a cent. There are two small new D1 tables, a handful of queue messages, and nothing that grows with viewers. It's far inside the $500 per month cap.

## 13. Open questions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | **Private and draft videos.** Do they move with the channel? | **Yes.** All content moves, and the confirm step says so. Otherwise content is orphaned under an account that no longer owns the channel |
| 2 | **Scholar or verification badge on transfer.** The badge vouches for the person or institution behind the channel. | **Remove it unless the target is staff.** The super admin can override either way |
| 3 | **Taking an official handle from its holder.** Acceptable without their agreement, given that they're notified and given a default handle? | **Yes, for the official list only** |
| 4 | **Notifying the old owner.** Always, or may a super admin stay silent in abuse cases? | **Always.** A silent option could be added later |
| 5 | **`channel.max` on the target.** May a transfer take the target over their plan's limit? | **Allow it.** It's a super admin action, and the preview shows a note |
| 6 | **Old owner's access after a transfer.** | **They lose all access.** Once channel roles exist, the super admin can tick "keep the old owner as channel admin". That option is hidden until then |
