/**
 * /api/workflows/* — approvals for sensitive admin changes (wiki AUN-WORKFLOWS §8, decision O44).
 *
 * Who may do what:
 *   see requests and rules                   any admin role, or anyone on the finance list; money requests
 *                                            also need support:read or the finance list
 *   approve, reject                          whoever the request's rule names (engine), with a step-up when
 *                                            the rule says (middleware/step-up-routes.ts)
 *   withdraw                                 the proposer
 *   propose a rule change                    super admins; money rules: the finance list (rule-change.ts)
 *   retry a failed apply                     super admins; money: the finance list
 *
 * Governed changes themselves are proposed by their own routes (for example POST /api/support/fees),
 * which call the engine's proposeChange. Every step is mirrored into the admin audit log
 * (site_settings_log, key content:workflow:<request id>); workflow_steps stays the record of truth.
 */
import { Hono, type Context } from 'hono';
import {
  WORKFLOW_ACTIONS,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_SEEDED_SCOPES,
  WORKFLOW_STATUSES,
  isMoneyRule,
  workflowFloorFor,
  hasContentPermission,
  isWorkflowActionType,
  type WorkflowActor,
  type WorkflowStatus,
} from '@al-ummah/shared-types';
import type { AdminBindings, AuthContext } from '../base/types';
import { apiError } from '../lib/api-error';
import { logger } from '../lib/logger';
import { writeAudit } from '../lib/content/audit';
import { hasAdminRole } from '../lib/roles';
import { stepUpAnswer } from '../middleware/passkeys';
import {
  WorkflowError,
  approveRequest,
  commentOnRequest,
  getRequestView,
  listRequests,
  rejectRequest,
  retryRequest,
  ruleInForce,
  proposeChange,
  waitingCount,
  withdrawRequest,
  type RequestListView,
} from '../lib/workflows/engine';
import { createWorkflowDirectory, ownerIdsFrom } from '../lib/workflows/directory';
import { registerRuleChangeExecutor } from '../lib/workflows/rule-change';
import { registerSupportFinanceExecutors } from '../lib/workflows/support-finance-actions';
import type { WorkflowCtx, WorkflowEvent } from '../lib/workflows/types';
import type { D1Database } from '../lib/types';

type Env = { Bindings: AdminBindings & { PLATFORM_OWNER_USER_IDS?: string }; Variables: { auth?: AuthContext } };
type C = Context<Env>;

registerRuleChangeExecutor();
registerSupportFinanceExecutors();

const app = new Hono<Env>();
const ok = (c: C, result: unknown, status: 200 | 202 = 200) => c.json({ success: true, result }, status);
const actorId = (c: C) => c.get('auth')?.userId ?? 'unknown';
const body = async (c: C): Promise<Record<string, unknown>> => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
};

class Refused extends Error {
  constructor(readonly status: 403 | 503, readonly code: string) {
    super(code);
  }
}

function searchDb(c: C): D1Database {
  if (!c.env.SEARCH_DB) throw new Refused(503, 'service_unavailable');
  return c.env.SEARCH_DB as D1Database;
}

/** Mirrors each step into the general audit log; a failed mirror write is logged, never undoes the step. */
export function auditMirror(reports: D1Database | undefined): (e: WorkflowEvent) => Promise<void> {
  return async (e) => {
    if (!reports) return;
    await writeAudit(reports, { kind: 'workflow', id: e.requestId, action: e.kind, actorId: e.actor, details: { type: e.type } }).catch((error) =>
      logger.error('[Workflows] Audit mirror write failed', { requestId: e.requestId, kind: e.kind, error: String(error) }),
    );
  };
}

/** The engine context for a request (or the cron, with `system`). */
export function workflowCtx(env: Env['Bindings'], opts: { steppedUp?: boolean; onEvent?: (e: WorkflowEvent) => Promise<void> } = {}): WorkflowCtx {
  const db = env.SEARCH_DB as D1Database;
  const reports = env.REPORTS_DB as D1Database | undefined;
  return {
    db,
    directory: createWorkflowDirectory({ searchDb: db, reportsDb: reports ?? null, ownerIds: ownerIdsFrom(env.PLATFORM_OWNER_USER_IDS) }),
    now: () => new Date(),
    steppedUp: opts.steppedUp,
    onEvent: opts.onEvent ?? auditMirror(reports),
    env,
  };
}

function ctxFor(c: C): WorkflowCtx {
  searchDb(c);
  return workflowCtx(c.env, { steppedUp: stepUpAnswer(c as never) === null });
}

async function actorFor(c: C, ctx: WorkflowCtx): Promise<WorkflowActor> {
  return ctx.directory.actor(actorId(c), c.get('auth')?.roles ?? []);
}

/** Admins and finance-list members see the pages; money requests also need support:read or the finance list. */
async function needRead(c: C, ctx: WorkflowCtx): Promise<WorkflowActor> {
  const actor = await actorFor(c, ctx);
  if (!hasAdminRole(actor.roles) && !actor.financePermissions.length) throw new Refused(403, 'forbidden');
  return actor;
}
const seesMoney = (c: C, actor: WorkflowActor) => actor.financePermissions.length > 0 || hasContentPermission(c.get('auth')?.roles, 'support:read');

app.onError((error, c) => {
  if (error instanceof Refused) return apiError(c, error.status, error.code);
  if (error instanceof WorkflowError) {
    if (error.status === 403) logger.warn('[Workflows] Refused', { userId: actorId(c as C), code: error.code, path: c.req.path, ...error.extra });
    return apiError(c, error.status, error.code, error.extra as never);
  }
  logger.error('[Workflows] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return apiError(c, 500, 'internal_error');
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

app.get('/actions', async (c) => {
  const ctx = ctxFor(c);
  const actor = await needRead(c, ctx);
  const money = seesMoney(c, actor);
  const out = [];
  for (const type of WORKFLOW_ACTION_TYPES) {
    const def = WORKFLOW_ACTIONS[type];
    const { results } = await ctx.db
      .prepare('SELECT scope, MAX(version) AS version FROM workflow_rules WHERE action_type = ? GROUP BY scope LIMIT 100')
      .bind(type)
      .all<{ scope: string; version: number }>();
    // The default scope, the seeded scopes (WF-D9's creatorSupport switch, money rule changes) and any edited one
    const scopes = [...new Set(['', ...(WORKFLOW_SEEDED_SCOPES[type] ?? []), ...(results ?? []).map((r) => r.scope)])];
    const rules = [];
    for (const scope of scopes) {
      // Money rules (by their floor, not only the action's domain) are for people who can see money
      if (isMoneyRule(type, scope) && !money) continue;
      const r = await ruleInForce(ctx, type, scope);
      rules.push({ scope, version: r.version, config: r.config, floor: workflowFloorFor(type, scope) });
    }
    if (!rules.length) continue;
    out.push({ type, domain: def.domain, label: def.label, scoped: def.scoped, floor: def.floor, rules });
  }
  return ok(c, { actions: out });
});

app.get('/rules/:type/history', async (c) => {
  const ctx = ctxFor(c);
  const actor = await needRead(c, ctx);
  const type = c.req.param('type');
  if (!isWorkflowActionType(type)) return apiError(c, 404, 'not_found');
  const scope = c.req.query('scope') ?? '';
  if (isMoneyRule(type, scope) && !seesMoney(c, actor)) throw new Refused(403, 'forbidden');
  const before = Number(c.req.query('before') ?? '0');
  const { results } = await ctx.db
    .prepare(`SELECT id, version, config, request_id, created_by, created_at FROM workflow_rules WHERE action_type = ? AND scope = ?${before > 0 ? ' AND version < ?' : ''} ORDER BY version DESC LIMIT 50`)
    .bind(...(before > 0 ? [type, scope, before] : [type, scope]))
    .all<{ id: string; version: number; config: string; request_id: string | null; created_by: string; created_at: string }>();
  return ok(c, { versions: (results ?? []).map((r) => ({ ...r, config: JSON.parse(r.config) })) });
});

app.post('/rules/:type', async (c) => {
  const ctx = ctxFor(c);
  const actor = await needRead(c, ctx);
  const input = await body(c);
  const out = await proposeChange(ctx, actor, { type: 'workflows.rule.set', payload: { type: c.req.param('type'), scope: input.scope, config: input.config }, reason: input.reason });
  return ok(c, out, out.status === 'applied' ? 200 : 202);
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const VIEWS: readonly RequestListView[] = ['waiting', 'mine', 'open', 'history'];

app.get('/requests', async (c) => {
  const ctx = ctxFor(c);
  const actor = await needRead(c, ctx);
  const view = (VIEWS as readonly string[]).includes(c.req.query('view') ?? '') ? (c.req.query('view') as RequestListView) : 'waiting';
  const status = c.req.query('status');
  const type = c.req.query('type');
  const page = await listRequests(ctx, actor.userId, {
    view,
    status: status && (WORKFLOW_STATUSES as readonly string[]).includes(status) ? (status as WorkflowStatus) : undefined,
    type: type && isWorkflowActionType(type) ? type : undefined,
    cursor: c.req.query('cursor') ?? null,
  });
  const money = seesMoney(c, actor);
  return ok(c, { items: money ? page.items : page.items.filter((i) => i.domain !== 'money'), next: page.next });
});

/**
 * Live autocomplete over requests: the newest 200 (one index range, idx_workflow_requests_proposed)
 * matched on their title in either language. Never a LIKE over the table.
 */
app.get('/requests/suggest', async (c) => {
  const ctx = ctxFor(c);
  const actor = await needRead(c, ctx);
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const { results } = await ctx.db
    .prepare('SELECT id, action_type, domain, diff, status, proposed_at FROM workflow_requests ORDER BY proposed_at DESC LIMIT 200')
    .all<{ id: string; action_type: string; domain: string; diff: string; status: WorkflowStatus; proposed_at: string }>();
  const money = seesMoney(c, actor);
  const items = [];
  for (const r of results ?? []) {
    if (!isWorkflowActionType(r.action_type) || (r.domain === 'money' && !money)) continue;
    const title = (JSON.parse(r.diff) as { title: { en: string; ar: string } }).title;
    if (q && !title.en.toLowerCase().includes(q) && !title.ar.includes(q) && r.id !== q) continue;
    items.push({ id: r.id, type: r.action_type, title, status: r.status, proposedAt: r.proposed_at });
    if (items.length >= 10) break;
  }
  return ok(c, { items });
});

app.get('/counts', async (c) => {
  const ctx = ctxFor(c);
  const actor = await needRead(c, ctx);
  return ok(c, { waitingForMe: await waitingCount(ctx, actor.userId) });
});

async function visible(c: C, ctx: WorkflowCtx, id: string): Promise<WorkflowActor> {
  const actor = await needRead(c, ctx);
  const row = await ctx.db.prepare('SELECT domain FROM workflow_requests WHERE id = ?').bind(id).first<{ domain: string }>();
  if (!row) throw new WorkflowError(404, 'not_found');
  if (row.domain === 'money' && !seesMoney(c, actor)) throw new Refused(403, 'forbidden');
  return actor;
}

app.get('/requests/:id', async (c) => {
  const ctx = ctxFor(c);
  const actor = await visible(c, ctx, c.req.param('id'));
  return ok(c, await getRequestView(ctx, c.req.param('id'), actor));
});

app.post('/requests/:id/approve', async (c) => {
  const ctx = ctxFor(c);
  const actor = await visible(c, ctx, c.req.param('id'));
  const input = await body(c);
  return ok(c, await approveRequest(ctx, actor, c.req.param('id'), { version: typeof input.version === 'number' ? input.version : undefined, note: input.note }));
});

app.post('/requests/:id/reject', async (c) => {
  const ctx = ctxFor(c);
  const actor = await visible(c, ctx, c.req.param('id'));
  const input = await body(c);
  return ok(c, await rejectRequest(ctx, actor, c.req.param('id'), { version: typeof input.version === 'number' ? input.version : undefined, reason: input.reason }));
});

app.post('/requests/:id/withdraw', async (c) => {
  const ctx = ctxFor(c);
  const actor = await visible(c, ctx, c.req.param('id'));
  const input = await body(c);
  return ok(c, await withdrawRequest(ctx, actor, c.req.param('id'), { version: typeof input.version === 'number' ? input.version : undefined }));
});

app.post('/requests/:id/comment', async (c) => {
  const ctx = ctxFor(c);
  const actor = await visible(c, ctx, c.req.param('id'));
  const input = await body(c);
  return ok(c, await commentOnRequest(ctx, actor, c.req.param('id'), { note: input.note }));
});

app.post('/requests/:id/retry', async (c) => {
  const ctx = ctxFor(c);
  const actor = await visible(c, ctx, c.req.param('id'));
  const row = await ctx.db.prepare('SELECT domain FROM workflow_requests WHERE id = ?').bind(c.req.param('id')).first<{ domain: string }>();
  // Money (the stored domain follows the floor): the finance list, never tech staff or the owner
  const allowed = row?.domain === 'money' ? actor.financePermissions.length > 0 && !actor.techStaff && !actor.owner : actor.roles.includes('super_admin');
  if (!allowed) throw new Refused(403, 'forbidden');
  return ok(c, await retryRequest(ctx, actor, c.req.param('id')));
});

/** Step-up `when` for approve and reject: only when the request's rule asks for it. */
export async function requestNeedsStepUp(c: Context): Promise<boolean> {
  const id = c.req.param('id');
  const db = (c.env as AdminBindings).SEARCH_DB as D1Database | undefined;
  if (!id || !db) return true;
  const row = await db.prepare('SELECT rule FROM workflow_requests WHERE id = ?').bind(id).first<{ rule: string }>();
  if (!row) return false;
  try {
    return (JSON.parse(row.rule) as { stepUp?: string }).stepUp !== 'none';
  } catch {
    return true;
  }
}

export default app;
