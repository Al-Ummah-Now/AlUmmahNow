/**
 * High-risk admin-api actions that need a step-up (wiki AUTH-PASSKEYS, "High-risk
 * admin-api actions"): a sign-in under 900 s old, with a passkey when the staff
 * rule applies (middleware/passkeys.ts). Registered ahead of the routers, so the
 * check runs before the handler.
 *
 * Not here because admin-api has no such action: granting or removing staff
 * roles (done in the auth admin; invites can only add "Scholar"), revealing a
 * minor item and approving an escalated item (AUN-VIDEO-REVIEW, not built yet:
 * add them here when they are).
 */
import type { Context, Hono } from 'hono';
import { stepUp } from './passkeys';

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A report action that bans the content's owner (the body is read from a clone: the handler reads it again). */
async function reportActionBans(c: Context): Promise<boolean> {
  try {
    const body = (await c.req.raw.clone().json()) as { action?: unknown };
    return body?.action === 'banned';
  } catch {
    return false;
  }
}

export const STEP_UP_ROUTES: readonly { method: Method; path: string; what: string; when?: (c: Context) => Promise<boolean> }[] = [
  // Moderation requests to Auth: suspend, delete, sign out everywhere, password reset of the user's Auth account
  { method: 'POST', path: '/api/auth-requests', what: 'Moderation request to Auth (suspend / delete / revoke sessions / password reset)' },
  // Videos user: ban (suspend on the videos site), unban, delete the user's data
  { method: 'POST', path: '/api/content/users/:id/ban', what: 'Ban a user' },
  { method: 'POST', path: '/api/content/users/:id/unban', what: 'Unban a user' },
  { method: 'POST', path: '/api/content/users/:id/delete-data', what: "Delete a user's data" },
  { method: 'POST', path: '/api/moderation/reports/:reportId/action', what: "Report outcome \"banned\" (bans the owner)", when: reportActionBans },
  // Permanent deletes ("Delete permanently now")
  { method: 'POST', path: '/api/content/deletions/:kind/:id/purge', what: 'Delete permanently: videos content' },
  { method: 'POST', path: '/api/trash/:kind/:id/purge', what: 'Delete permanently: contact messages, themes, creator tiers' },
  { method: 'POST', path: '/api/status/incidents/:id/purge', what: 'Delete permanently: status incident' },
  { method: 'POST', path: '/api/invites/:id/purge', what: 'Delete permanently: invite' },
];

export function registerStepUpRoutes(app: Hono): void {
  for (const route of STEP_UP_ROUTES) app.on(route.method, route.path, stepUp(route.when));
}
