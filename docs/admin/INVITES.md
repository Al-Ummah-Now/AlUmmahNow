# Invite creators

An admin invites someone by email: **Users → Invite creator**
(`/users/invites/new`). The person's account exists immediately, so the admin
can give it a plan and channels straight away. When the person first signs in
with that email, they land in that account with everything already in place.
Nothing else is needed: "they log in and that's it".

```
admin-web form ──▶ admin-api POST /api/invites
                     ├─ mint usr_… (user id) and inv_… (invite id)
                     ├─ api-videos: profile (create-only), creator tier, new channels / transfer jobs   ← at once
                     ├─ creator_invites row 'sending' + audit
                     └─ queue auth-moderation-requests { type: 'invite', op: 'create' }
                                     ▼
                     auth POST /provisioning/invites (client credentials, invites:provision)
                       users row status 'invited' (same id), email unverified, bilingual email with a single-use link
                                     ▼
person: link → Continue → videos sign-in → "Create account" (emailed code) ─▶ auth onSuccess finds the
invited row by email → claims it (status active, email verified) → token carries usr_… → channels are theirs
```

The auth side is documented in AlUmmahNowAuth `docs/USER_INVITES.md`.

## Why the ids are minted here

Nothing talks to auth inside an admin's request: the owner rule in
`docs/admin/AUTH_MODERATION_REQUESTS.md` (async, queues, retries, failures
flag an admin). Because admin-api mints the user id itself, everything keyed by
that id can be written at once:

- the videos profile (`POST /internal/admin/users/provision`, create-only),
  which makes the person searchable and a valid owner for a transfer;
- the creator tier;
- channels: either created (`POST /internal/admin/users/:id/channels`, the
  same object, @handle and queue message as `POST /api/channels`) or
  transferred (the existing `channel.transfer` job).

Ownership is written exactly as for any owner: `channel.userId` in R2, and the
ownership index through the R2 search sync. The auth account follows within
seconds, through the queue. When the person signs in, their token's `userId`
is the same id.

## Form

| Field | Notes |
| --- | --- |
| Email | Required. Normalised the same way as sign-in: trimmed, lower case. Gmail dots and `+tags` count as different addresses. The email is checked as soon as it is entered (`GET /api/invites/lookup`). If it already has an account, the form offers that user's page so the admin can assign the role or channel there. If it has an open invite, the form links to it. |
| Display name, invite language (en/ar), note | The email is sent in both languages, with the chosen one first. |
| Role | Creator (default) or Viewer. |
| Plan | A creator tier from the admin-managed tiers (`GET /creator-tiers`), never a hard-coded list. Needs `creators:manage`. |
| Scholar | Optional. Adds the auth role "Scholar", from auth's allow-list. |
| Link expiry | 1–90 days, default 14. After expiry the person can still sign in with the email and claim the account. |
| Channels | New channels (name, optional @handle; needs `channels:manage`). Existing channels are chosen with the channel picker and moved with a transfer job (needs `channels:transfer`, super admins only). |

If a channel cannot be made (for example, the handle is taken), the invite is
still created and the problem is listed under "Some parts were not done".

## Invites list (`/users/invites`)

Statuses:

- **Creating account**: queued to auth.
- **Failed**: shows the error. **Retry** sends it again.
- **Invited**: the link works until a date.
- **Signed in**.
- **Link expired**: signing in still works.
- **Revoked**: shows days left before it is removed, or "Queued for permanent
  deletion".

Actions:

- **Resend**: sends a new link. The old link stops working.
- **Copy invite link**: shows a new single-use link once, in an in-app dialog.
  Only its SHA-256 hash goes to auth, and nothing stores the link.
- **Revoke**: a soft delete with an optional reason. It can be restored for 30
  days. After that, auth's hourly cleanup removes the invite and its unused
  account.
- **Restore**.
- **Delete permanently now**: type the email to confirm. This only queues the
  invite for the cleanup.

All confirmations use in-app `<dialog>`s.

Invited users appear in the users list, on their user page, and in every user
picker (`/api/suggest/user`) with an **Invited** badge. The invites search box
autocompletes (suggest kind `invite`). Opening an invite, the invites list or an
invited user's page queues a status read from auth for each open invite shown
(at most every 15 s per invite; still only a queue message, never a call to
auth inside the request), so "Signed in" shows within seconds of the first
sign-in. A 5-minute cron reads the rest as a backstop.

## Security

- Every invite route needs `users:manage`. Reads are open to every admin role.
- Each admin can make at most 60 invite changes per hour, counted in
  `admin_audit_log` (`invite.*`).
- Every change is audited in `admin_audit_log` and in the user's content audit
  (`invite-*`). Auth audits its side too (`user.invite.*`).
- Link tokens are 32 random bytes and single use. Auth stores only their hash,
  and they are never logged.
- An invited account gets no tokens until it is claimed by a sign-in that
  proves the email.

## Revoked invites and their channels

A revoke soft-deletes the auth account. Channels that were made or moved for
the invite stay with that user id until the purge. The revoke dialog says so:
transfer them first if they should go to someone else. The videos-side profile
is not purged automatically yet (#716).

## Recently deleted

Revoked invites are an admin soft delete in the shared framework: the trash
kind `invite` (packages/shared-types `TRASH_KINDS`). They are listed on
**Recently deleted → Invites** with Restore and "Delete permanently now",
alongside contact messages, themes and creator tiers. The hourly trash cleanup
(`runTrashCleanup`) drops an invite's mirror row 30 days after the revoke, or
once auth has received a "Delete permanently now" request. Auth's own cleanup
removes the account itself; on the auth side the account is an
`admin_deletions` row, so it also appears in the Auth admin's Recently deleted.

## Tables

`creator_invites` (REPORTS_DB, migration `0014`, additive; `0013` is the admin
soft delete) is the mirror of the invite: delivery state, auth status, pending
change, and the soft-delete fields `deleted_at`, `deleted_by`,
`deleted_reason` and `purge_requested_at`.
