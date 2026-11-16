# Invite creators

An admin invites someone by email: **Users → Invite creator**
(`/users/invites/new`). The person's account exists immediately, so the admin
can give it a plan and channels straight away. When the person first signs in
with that email, they land in that account with everything already in place.
Nothing else is needed: the invite link signs them in, with no password and
no second code.

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
person: link → Continue → auth claims the account (active, email verified) and signs it in (active account
of the browser; others untouched) → "add a passkey" or Skip → videos sign-in finishes by single sign-on →
Studio of the invited channel (else /settings) with a first-run welcome → token carries usr_… → channels are theirs
```

The auth side is documented in AlUmmahNowAuth `docs/USER_INVITES.md`.

## Where the invite lands

`continueUrl` (`signInUrl` + `inviteLandingPath` in `apps/admin-api/src/lib/invites.ts`) is the videos
sign-in without `prompt`, returning to `/{locale}/studio/go/dashboard?welcome=invite` for a creator
with channels (the Studio picks their channel), else `/{locale}/settings?welcome=invite`. The web
`InviteWelcome` panel shows once while `?welcome=invite` is in the URL; Dismiss removes it. The plan
(creator tier) is set at invite time, so it is already in place. Invites created before this change
keep their old `continueUrl`; Auth drops `prompt` from it, so they still sign in directly.

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
| Email | Required. Normalised the same way as sign-in: trimmed, lower case. Gmail dots and `+tags` count as different addresses. The email is checked as soon as it is entered (`GET /api/invites/lookup`). If it already has an account, the form offers that user's page so the admin can give it a tier or channel there. If it has an open invite, the form links to it. |
| Display name, invite language (en/ar), note | The email is sent in both languages, with the chosen one first. |
| Tier | One of the admin-managed tiers (`GET /creator-tiers`), lowest rank first, names in the admin's language; it starts on the current default tier, and giving another needs `creators:manage`. There is no Creator/Viewer role: the tier alone decides what the account can do (uploads, channels, live …), and the account gets it as soon as the invite is made. Accepting the invite changes nothing else. |
| Video (English), Video (العربية) | Optional, one per email language, side by side. Each is a live search over public, ready, listed videos on the videos site (`GET /api/invites/videos`): the newest first, then by title, with picture, channel and length. Both start on the default video per language from **Admin › Settings › Emails › Creator invite** (when that page lands) and can be changed or cleared per invite. |
| Scholar | Optional. Adds the auth role "Scholar", from auth's allow-list (the only auth role an invite can add). |
| Link expiry | 1–90 days, default 14. An expired or used link offers "Email me a new link" while the account has no password or passkey, else Sign in. |
| Channels | New channels (name, optional @handle; needs `channels:manage`). Existing channels are chosen with the channel picker and moved with a transfer job (needs `channels:transfer`, super admins only). |

If a channel cannot be made (for example, the handle is taken), the invite is
still created and the problem is listed under "Some parts were not done".

## Video in the invite email

Owner decisions, 2026-11-16:

- **One video per email language.** The email is in one language and shows that language's video. It never falls back to the other language's video. A resend in the other language switches to that language's video.
- **A static card.** Email cannot play video, and there is no animated GIF. The card is the video's 16:9 picture with a play button, the title and the channel.
  - The picture is the web app's stable `/og/v/<id>.jpg`, never a signed URL.
  - The card links through the short link `alummahnow.link/v/<id>` (`?lang=ar` for Arabic emails; `qa.` / `stage.` hosts on QA and stage).
- **Read at every send.** admin-api reads the video again at each send and resend, so a changed title shows. A video that is gone, private, hidden or not ready leaves the card out.
- Auth renders the card (AlUmmahNowAuth#432, `details.video`; a resend passes `video` or `null`).
- Storage: `creator_invites.video_en_id` and `video_ar_id` (migration 0035).

The default video per language lives with the creator invite email settings (Admin › Settings › Emails › Creator invite, `lib/email-templates.ts`). Nothing is seeded: an admin sets them. A default only prefills the form, so an invite where the admin cleared a language has no card in that language.

## Invites list (`/users/invites`)

Each row shows the tier the invite gave (in the admin's language; an invite with no stored tier shows the current default tier), Scholar when added, and the channels.
Viewer invites from before migration 0035 show the default tier.

Statuses:

- **Creating account**: queued to auth.
- **Failed**: shows the error. **Retry** sends it again.
- **Invited**: the link works until a date.
- **Signed in**.
- **Link expired**: opening the link offers the person a fresh one.
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
sign-in. A 5-minute cron reads the rest as a backstop, paced by age like the auth
requests (every run for the first hour, then every 30 min, 3 h, and daily after a week).

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
transfer them first if they should go to someone else.

At the purge (#716, `apps/admin-api/src/lib/invite-erase.ts`), the hourly trash
cleanup handles an invite that was never accepted in four steps:

1. It asks auth, in one batched read, whether it still holds the invite. While
   it does, auth's own cleanup has not removed the account yet, and the mirror
   row waits for the next run.
2. It gives back every channel the invite moved from someone else (marked
   "transferred" in the invite's channels record) to its previous owner, read
   from the audit row of that move. The give-back is a queued
   `channel.transfer` job, audited as a transfer by `system:trash-cleanup`, so
   the invite waits for the next run, which finds the channel moved and goes
   on. If the previous owner is unknown, the give-back fails or has not landed
   two days later, the channel is in Recently deleted while still with the
   invited user, or the invite's own move job has not settled (still running,
   or failed and open to a Retry), nothing is erased for that invite and the
   admin is flagged: someone else's channel is never erased.
3. Once auth no longer has it (or it never reached auth), the user id goes to
   api-videos `POST /internal/admin/users/:id/erase-revoked-invite`. That runs
   the admin erase path: a soft delete by `system:trash-cleanup` and its purge
   at once (the `user.delete-data` job, with its retries and DLQ). It erases the
   provisioned profile and the channels with their videos, and frees their
   @handles. It also removes the creator tier the invite assigned.
4. Only then does the mirror row go, audited as a purge.

An accepted invite is never erased: the person signed in, so the data is theirs.
A step that fails keeps the mirror row, so the next hourly run tries again, and
flags the admin on the Errors page ("Revoked invite data not erased", with an
**Erase now** Retry). If auth still holds an invite two days after its purge
was due, that is flagged too. The Retry runs the same steps and only for an
invite the cleanup is due to purge; it never erases ahead of the 30-day window.

## Recently deleted

Revoked invites are an admin soft delete in the shared framework: the trash
kind `invite` (packages/shared-types `TRASH_KINDS`). They are listed on
**Recently deleted → Invites** with Restore and "Delete permanently now",
alongside contact messages, themes and creator tiers. The hourly trash cleanup
(`runTrashCleanup`) settles an invite 30 days after the revoke, or once auth has
received a "Delete permanently now" request, as described above. Auth's own cleanup
removes the account itself; on the auth side the account is an
`admin_deletions` row, so it also appears in the Auth admin's Recently deleted.

## Tables

`creator_invites` (REPORTS_DB, migration `0014`, additive; `0013` is the admin
soft delete) is the mirror of the invite: delivery state, auth status, pending
change, and the soft-delete fields `deleted_at`, `deleted_by`,
`deleted_reason` and `purge_requested_at`.
