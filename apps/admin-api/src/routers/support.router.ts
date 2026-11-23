/**
 * /api/support/* — the videos admin's Support pages (wiki AUN-MEMBERS §9.6; MEM-8).
 *
 * Who may do what:
 *   read (overview, settings, batches, countries, finance list)  support:read (super admins) or anyone on the finance list
 *   finance list and tech-staff marks                             super admins, two-person changes on the approval workflow
 *                                                                 (lib/workflows/support-finance-actions.ts); removal and marking are immediate
 *   countries                                                     support:manage (super admins)
 *   owner decisions, organization formed, holds, payout batches   the finance list only: support:providers for settings,
 *                                                                 support:payouts for batches. A super admin role alone is not
 *                                                                 enough, and tech staff (the owner) never qualify.
 *
 * Every change is audited (admin audit log, kind support-*) with the values it replaced, and every
 * change here needs a step-up (middleware/step-up-routes.ts). The work itself happens in api-videos
 * (/internal/support/*), which checks the finance list again where money moves (batch approval).
 */
import { Hono, type Context } from 'hono';
import { hasContentPermission, type SupportPermission } from '@al-ummah/shared-types';
import type { AdminBindings, AuthContext } from '../base/types';
import { callVideos, VideosError, type VideosCall, type VideosClientEnv } from '../lib/content/videosClient';
import { dropAudit, setAuditPrevious, writeAudit, type AuditAction } from '../lib/content/audit';
import { apiError } from '../lib/api-error';
import { logger } from '../lib/logger';
import { approveFinanceMember, FinanceError, financeAllows, financeMember, isTechStaff, listFinanceMembers, markTechStaff, removeFinanceMember } from '../lib/support-finance';
import { normalizeRoles } from '../lib/roles';
import { approveRequest, proposeChange, WorkflowError } from '../lib/workflows/engine';
import { registerSupportFinanceExecutors } from '../lib/workflows/support-finance-actions';
import { workflowCtx } from './workflows.router';
import { stepUpAnswer } from '../middleware/passkeys';

registerSupportFinanceExecutors();

type Env = { Bindings: AdminBindings & VideosClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const ok = (c: C, result: unknown) => c.json({ success: true, result });
const body = async (c: C): Promise<Record<string, unknown>> => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
};
const videos = <T>(c: C, path: string, call: VideosCall = {}) => callVideos<T>(c.env, path, { actorId: actorOf(c), base: '/internal/support', ...call });
const enc = encodeURIComponent;

class Refused extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    readonly code: string,
  ) {
    super(code);
  }
}

const isSuperAdmin = (c: C) => normalizeRoles(c.get('auth')?.roles ?? []).includes('super_admin');
const db = (c: C) => {
  if (!c.env.SEARCH_DB) throw new Refused(503, 'service_unavailable');
  return c.env.SEARCH_DB;
};

async function needRead(c: C) {
  if (hasContentPermission(c.get('auth')?.roles, 'support:read')) return;
  const member = await financeMember(db(c), actorOf(c));
  if (member && member.approvedBy && !member.removedAt && !(await isTechStaff(db(c), actorOf(c)))) return;
  throw new Refused(403, 'forbidden');
}
function needSuperAdmin(c: C) {
  if (!isSuperAdmin(c)) throw new Refused(403, 'forbidden');
}
async function needFinance(c: C, permission: SupportPermission) {
  if (!(await financeAllows(db(c), actorOf(c), permission))) throw new Refused(403, 'support_not_finance');
}

app.onError((error, c) => {
  if (error instanceof Refused) {
    if (error.status === 403) logger.warn('[Support] Refused', { userId: actorOf(c as C), code: error.code, path: c.req.path });
    return apiError(c, error.status, error.code);
  }
  if (error instanceof FinanceError) return apiError(c, error.status, error.code);
  if (error instanceof WorkflowError) return apiError(c, error.status, error.code, error.extra as never);
  if (error instanceof VideosError) return apiError(c, (error.status >= 400 && error.status < 600 ? error.status : 502) as 400, error.code, error.details as never);
  logger.error('[Support] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return apiError(c, 500, 'internal_error');
});

/** Writes the audit row first and drops it when the change fails. */
async function audited<T>(c: C, entry: Omit<AuditAction, 'actorId'>, run: () => Promise<T>, previousFrom?: (result: T) => Record<string, unknown> | null | undefined): Promise<T> {
  const reports = c.env.REPORTS_DB;
  const auditId = await writeAudit(reports, { ...entry, actorId: actorOf(c) });
  try {
    const result = await run();
    const previous = previousFrom?.(result);
    if (previous) await setAuditPrevious(reports, auditId, previous).catch((e) => logger.warn('[Support] Could not record the previous value', { auditId, error: String(e) }));
    return result;
  } catch (error) {
    await dropAudit(reports, auditId).catch((e) => logger.error('[Support] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

app.get('/overview', async (c) => {
  await needRead(c);
  return ok(c, await videos(c, '/overview'));
});

app.get('/settings', async (c) => {
  await needRead(c);
  return ok(c, await videos(c, '/settings'));
});

app.get('/batches', async (c) => {
  await needRead(c);
  return ok(c, await videos(c, '/batches'));
});

app.get('/countries', async (c) => {
  await needRead(c);
  return ok(c, await videos(c, '/countries'));
});

app.get('/finance', async (c) => {
  await needRead(c);
  return ok(c, await listFinanceMembers(db(c)));
});

// ---------------------------------------------------------------------------
// Finance list and tech staff (super admins, two people)
// ---------------------------------------------------------------------------

/**
 * Adding someone (or changing their money permissions) is a change request on the approval workflow
 * (wiki AUN-WORKFLOWS WF-5, action support.financeList.add): 202 with the request; a second super admin
 * approves it on the Approvals page, or here. Nobody adds themselves.
 */
const wf = (c: C) => workflowCtx(c.env as never, { steppedUp: stepUpAnswer(c as never) === null });

app.post('/finance', async (c) => {
  needSuperAdmin(c);
  const input = await body(c);
  const userId = typeof input.userId === 'string' ? input.userId : '';
  if (userId && userId === actorOf(c)) throw new FinanceError(409, 'support_same_person', 'You can’t add yourself');
  const ctx = wf(c);
  const actor = await ctx.directory.actor(actorOf(c), c.get('auth')?.roles ?? []);
  const out = await proposeChange(ctx, actor, { type: 'support.financeList.add', payload: { userId, permissions: input.permissions }, reason: typeof input.reason === 'string' && input.reason.trim() ? input.reason : 'Finance list' });
  return c.json({ success: true, result: out }, out.status === 'applied' ? 200 : 202);
});

/**
 * Approves the open request for this person. A proposal made before the workflow existed (a member row
 * with no approver and no request) is still approved the old way, so nothing in flight is lost.
 */
app.post('/finance/:userId/approve', async (c) => {
  needSuperAdmin(c);
  const userId = c.req.param('userId');
  const ctx = wf(c);
  const open = await ctx.db.prepare('SELECT id FROM workflow_requests WHERE open_key = ?').bind(`support.financeList.add:finance-member:${userId}`).first<{ id: string }>();
  if (!open) return ok(c, await audited(c, { kind: 'support-finance', id: userId, action: 'approve' }, () => approveFinanceMember(db(c), userId, actorOf(c))));
  const actor = await ctx.directory.actor(actorOf(c), c.get('auth')?.roles ?? []);
  try {
    return ok(c, await approveRequest(ctx, actor, open.id, {}));
  } catch (e) {
    const blocks = e instanceof WorkflowError ? ((e.extra.blocks as string[] | undefined) ?? []) : [];
    if (blocks.includes('own_request') || blocks.includes('subject')) throw new FinanceError(409, 'support_same_person', 'A second person has to approve');
    throw e;
  }
});

app.delete('/finance/:userId', async (c) => {
  needSuperAdmin(c);
  const userId = c.req.param('userId');
  return ok(c, await audited(c, { kind: 'support-finance', id: userId, action: 'remove' }, () => removeFinanceMember(db(c), userId, actorOf(c), new Date())));
});

app.post('/tech-staff', async (c) => {
  needSuperAdmin(c);
  const input = await body(c);
  const userId = typeof input.userId === 'string' ? input.userId : '';
  await audited(c, { kind: 'support-tech-staff', id: userId || '-', action: 'mark' }, () => markTechStaff(db(c), userId, actorOf(c), new Date()));
  return ok(c, { userId, techStaff: true });
});

/** Removing a tech-staff mark is a change request (support.techStaff.unmark); whoever marked them never approves it. */
app.delete('/tech-staff/:userId', async (c) => {
  needSuperAdmin(c);
  const userId = c.req.param('userId');
  const ctx = wf(c);
  const actor = await ctx.directory.actor(actorOf(c), c.get('auth')?.roles ?? []);
  const out = await proposeChange(ctx, actor, { type: 'support.techStaff.unmark', payload: { userId }, reason: 'Remove tech-staff mark' });
  return c.json({ success: true, result: out }, out.status === 'applied' ? 200 : 202);
});

// ---------------------------------------------------------------------------
// Countries (super admins; sanctions rows included)
// ---------------------------------------------------------------------------

app.put('/countries/:country', async (c) => {
  if (!hasContentPermission(c.get('auth')?.roles, 'support:manage')) throw new Refused(403, 'forbidden');
  const country = c.req.param('country').toUpperCase();
  const input = await body(c);
  return ok(
    c,
    await audited(
      c,
      { kind: 'support-country', id: country, action: 'edit', details: input },
      () => videos<{ before: Record<string, unknown> | null }>(c, `/countries/${enc(country)}`, { method: 'PUT', json: { ...input, actorId: actorOf(c) } }),
      (r) => r.before ?? undefined,
    ),
  );
});

// ---------------------------------------------------------------------------
// Settings: owner decisions, organization, holds (finance list: support:providers)
// ---------------------------------------------------------------------------

app.put('/settings/policy', async (c) => {
  await needFinance(c, 'support:providers');
  const input = await body(c);
  return ok(
    c,
    await audited(
      c,
      { kind: 'support-settings', id: 'policy', action: 'edit', details: { patch: input.patch } },
      () => videos<{ before: Record<string, unknown> }>(c, '/settings/policy', { method: 'PUT', json: { patch: input.patch, expectedVersion: input.expectedVersion, actorId: actorOf(c) } }),
      (r) => r.before,
    ),
  );
});

app.put('/settings/fields', async (c) => {
  await needFinance(c, 'support:providers');
  const input = await body(c);
  return ok(
    c,
    await audited(
      c,
      { kind: 'support-settings', id: 'fields', action: 'edit', details: { fields: input.fields } },
      () => videos<{ before: Record<string, unknown> }>(c, '/settings/fields', { method: 'PUT', json: { fields: input.fields, expectedVersion: input.expectedVersion, actorId: actorOf(c) } }),
      (r) => r.before,
    ),
  );
});

// ---------------------------------------------------------------------------
// Payout batches (finance list: support:payouts)
// ---------------------------------------------------------------------------

app.post('/batches/plan', async (c) => {
  await needFinance(c, 'support:payouts');
  const input = await body(c);
  return ok(c, await audited(c, { kind: 'support-batch', id: String(input.period ?? '-'), action: 'plan' }, () => videos(c, '/batches/plan', { method: 'POST', json: { period: input.period, actorId: actorOf(c) } })));
});

app.post('/batches/:id/approve', async (c) => {
  await needFinance(c, 'support:payouts');
  const id = c.req.param('id');
  return ok(c, await audited(c, { kind: 'support-batch', id, action: 'approve' }, () => videos(c, `/batches/${enc(id)}/approve`, { method: 'POST', json: { actorId: actorOf(c) } })));
});

app.post('/batches/:id/stop', async (c) => {
  await needFinance(c, 'support:payouts');
  const id = c.req.param('id');
  const input = await body(c);
  return ok(c, await audited(c, { kind: 'support-batch', id, action: 'stop', details: { reason: input.reason } }, () => videos(c, `/batches/${enc(id)}/stop`, { method: 'POST', json: { reason: input.reason, actorId: actorOf(c) } })));
});

export default app;
