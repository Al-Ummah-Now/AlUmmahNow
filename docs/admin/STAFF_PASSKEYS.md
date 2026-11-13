# Staff passkeys (admin-api and admin-web)

The videos admin's part of [AUTH-PASSKEYS](https://github.com/Al-Ummah-Now/AlUmmahNowWiki/blob/main/epics/AUTH-PASSKEYS-passkeys-everywhere.md): staff must sign in with a passkey once the owner switches enforcement on in Auth, and high-risk actions need a recent sign-in. Nothing is blocked until Auth puts `properties.passkey_deadline` in staff tokens.

## Token claims

| Claim | Meaning |
|---|---|
| `amr` (top level) | How the user signed in: `pwd`, `otp`, `passkey`, `fed`. Missing on old tokens: no passkey |
| `auth_time` (top level, s) | Last real sign-in |
| `properties.passkey_deadline` (s) | Staff only, while enforcement is on. In the future: grace end |

Staff roles: Super Admin, Admin, Moderator, Writer, Content Reviewer, Senior Reviewer. One reading for both apps: `packages/shared-types/src/staff-passkeys.ts` (`passkeyGate`, `stepUpVerdict`). The OpenAuth client's `verify` drops claims its subject schema does not list, so both apps read these from the verified token's payload.

## admin-api

- `middleware/passkeys.ts` `passkeyMiddleware` runs on every `/api/*` request after auth and the admin role check. Staff, a deadline, no passkey sign-in and `now >= deadline`: `403 { success: false, error: "passkey_required", code: "passkey_required", setup_url, reason: "deadline", deadline }`. `setup_url` is `<Issuer>/passkeys/setup?return_to=<ADMIN_WEB_URL>`. Before the deadline the request goes through.
- Step-up (`middleware/step-up-routes.ts`, `STEP_UP_ROUTES`): the sign-in must be under 900 s old, else `401 { success: false, error: "step_up_required", code: "step_up_required", max_age: 900 }`. A fresh sign-in without a passkey while the staff rule applies (grace period) gets `403 passkey_required` with `reason: "step_up"`, because signing in again with a password would not help.

| Action | Route |
|---|---|
| Moderation request to Auth (suspend, delete, revoke sessions, password reset) | `POST /api/auth-requests` |
| Ban / unban a user, delete a user's data | `POST /api/content/users/:id/ban`, `/unban`, `/delete-data` |
| Report outcome "banned" (bans the owner) | `POST /api/moderation/reports/:reportId/action` with `action: "banned"` |
| Delete permanently | `POST /api/content/deletions/:kind/:id/purge`, `/api/trash/:kind/:id/purge`, `/api/status/incidents/:id/purge`, `/api/invites/:id/purge` |

admin-api has no route that grants or removes staff roles (the auth admin does; invites can only add Scholar). Revealing a minor item and approving an escalated item (AUN-VIDEO-REVIEW) go in `STEP_UP_ROUTES` when they are built.

The local stack sets `STEP_UP_MAX_AGE_S=86400` for admin-api (the admin E2E run signs in once and cleans up later than 15 minutes); it is ignored on production and stage.

## admin-web

- `requireAdminRole` (`lib/auth.ts`) reads the session's own token: blocked → `/passkey-needed`; grace → `PasskeyGraceBanner` above every page ("Add a passkey by <date>", dismissible for the tab).
- `/passkey-needed` (`app/passkey-needed/page.tsx`, `components/PasskeyNeeded.tsx`): en/ar, follows the site theme. **Add a passkey** opens Auth's setup page, which comes back to this app's sign-in with `prompt=login`; **Sign in with a passkey** is `/login?prompt=login`.
- Server actions: every mutation wrapper calls `navigateForPasskey(error)` (`lib/api/request.ts`) first. `passkey_required` opens `/passkey-needed?reason=step_up`; `step_up_required` opens `/login?prompt=login&max_age=900&return=<page>`. The admin comes back to the page and repeats the action.
- `/login` and `/api/auth/start` pass `max_age` to `/authorize`.

Tests: `apps/admin-api/test/passkeys.test.ts`, `apps/admin-web/test/passkeys.test.ts`.
