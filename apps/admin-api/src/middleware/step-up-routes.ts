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
import { featureProposalNeedsStepUp, requestNeedsStepUp } from '../routers/workflows.router';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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
  // Retiring a Bunny library: schedules permanent deletes of its verified videos from Bunny (docs/media-delivery/BACKFILL.md)
  { method: 'POST', path: '/api/media/backfill/libraries/:id/removals', what: 'Retire a Bunny library (delete verified videos from Bunny after the grace period)' },
  // CSAM cases (docs/specs/CSAM-RESPONSE.md): intake and mapping freeze an account like a ban does;
  // the report starts the retention clock; evidence, legal hold, retention, the webhook secret
  { method: 'POST', path: '/api/csam/intake', what: 'CSAM intake (takes down and freezes the uploader)' },
  { method: 'POST', path: '/api/csam/:id/map', what: 'CSAM hand mapping (takes down and freezes the uploader)' },
  { method: 'POST', path: '/api/csam/:id/retry', what: 'CSAM takedown retry' },
  { method: 'POST', path: '/api/csam/:id/reported', what: 'CSAM reported to NCMEC (starts the retention clock)' },
  { method: 'GET', path: '/api/csam/:id/files/:name', what: 'CSAM evidence download' },
  { method: 'POST', path: '/api/csam/:id/hold', what: 'CSAM legal hold' },
  { method: 'PUT', path: '/api/csam/settings', what: 'CSAM evidence retention' },
  { method: 'POST', path: '/api/csam/settings/webhook-secret', what: 'CSAM webhook secret' },
  // Payments (wiki AUN-SUBS): provider credentials, turning a provider on or off and live/test,
  // money back, ending a paid subscription and granting a tier for free
  { method: 'PUT', path: '/api/billing/providers/:id/credentials', what: 'Payment provider credentials' },
  { method: 'PUT', path: '/api/billing/providers/:id', what: 'Payment provider settings (enable, live/test mode)' },
  { method: 'POST', path: '/api/billing/payments/:id/refund', what: 'Refund a payment' },
  { method: 'POST', path: '/api/billing/subscriptions/:id/cancel', what: 'Cancel a subscription' },
  { method: 'POST', path: '/api/billing/comps', what: 'Grant a complimentary tier' },
  // Creator support (wiki AUN-MEMBERS §9.6): the finance list, tech-staff marks, owner decisions and holds,
  // payout batches and country rules
  { method: 'POST', path: '/api/support/finance', what: 'Propose someone for the finance list' },
  { method: 'POST', path: '/api/support/finance/:userId/approve', what: 'Approve a finance-list change' },
  { method: 'DELETE', path: '/api/support/finance/:userId', what: 'Remove someone from the finance list' },
  { method: 'POST', path: '/api/support/tech-staff', what: 'Mark an account as tech staff' },
  { method: 'DELETE', path: '/api/support/tech-staff/:userId', what: 'Remove a tech-staff mark' },
  { method: 'PUT', path: '/api/support/settings/policy', what: 'Record creator-support decisions' },
  { method: 'PUT', path: '/api/support/settings/fields', what: 'Organization formed, emergency stop, hold all payouts' },
  { method: 'POST', path: '/api/support/batches/plan', what: 'Plan a payout batch' },
  { method: 'POST', path: '/api/support/batches/:id/approve', what: 'Approve a payout batch' },
  { method: 'POST', path: '/api/support/batches/:id/stop', what: 'Stop a payout batch' },
  { method: 'PUT', path: '/api/support/countries/:country', what: 'Change a creator-support country rule' },
  // Approval workflows (wiki AUN-WORKFLOWS §8): deciding on a request whose rule asks for a step-up,
  // and proposing a change to an approval rule
  { method: 'POST', path: '/api/workflows/requests/:id/approve', what: 'Approve a change request (when its rule asks for a step-up)', when: requestNeedsStepUp },
  { method: 'POST', path: '/api/workflows/requests/:id/reject', what: 'Reject a change request (when its rule asks for a step-up)', when: requestNeedsStepUp },
  { method: 'POST', path: '/api/workflows/rules/:type', what: 'Propose a change to an approval rule' },
  { method: 'PUT', path: '/api/features/:key', what: 'Switch a feature whose approval rule asks for a step-up to propose', when: featureProposalNeedsStepUp },
  { method: 'POST', path: '/api/support/fees', what: 'Change a creator-support fee setting' },
];

export function registerStepUpRoutes(app: Hono): void {
  for (const route of STEP_UP_ROUTES) app.on(route.method, route.path, stepUp(route.when));
}
