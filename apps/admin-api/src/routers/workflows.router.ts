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
  ADMIN_NAMES_MAX,
  WORKFLOW_ACTIONS,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_SEEDED_SCOPES,
  WORKFLOW_LISTED_SCOPES,
  WORKFLOW_STATUSES,
  isMoneyRule,
  workflowDomainVisible,
  workflowFloorFor,
  isWorkflowActionType,
  isFeatureKey,
  type WorkflowActionType,
  type WorkflowActor,
  type WorkflowStatus,
} from '@al-ummah/shared-types';
import type { AdminBindings, AuthContext } from '../base/types';
import { apiError } from '../lib/api-error';
import { logger } from '../lib/logger';
import { writeAudit } from '../lib/content/audit';
import { stepUpAnswer } from '../middleware/passkeys';
import {
  WorkflowError,
  approveRequest,
  ruleForProposal,
  hasWorkflowExecutor,
  commentOnRequest,
  getRequestView,
  listRequests,
  OPEN_DOMAINS_SQL,
  openRequests,
  rejectRequest,
  retryRequest,
  ruleInForce,
  proposeChange,
  waitingCount,
  withdrawRequest,
  type RequestListView,
} from '../lib/workflows/engine';
import { resolveNames } from '../lib/audit/names';
import { createWorkflowDirectory, ownerIdsFrom } from '../lib/workflows/directory';
import { registerRuleChangeExecutor } from '../lib/workflows/rule-change';
import { registerSupportFinanceExecutors } from '../lib/workflows/support-finance-actions';
import { registerFeatureExecutor } from '../lib/workflows/feature-actions';
import { registerTierExecutor } from '../lib/workflows/tier-actions';
import { FEATURE_PRECONDITIONS } from '../lib/feature-preconditions';
import type { WorkflowCtx, WorkflowEvent } from '../lib/workflows/types';
import { enqueueWorkflowNotify } from '../lib/workflows/notify';
import { mayReadWorkflows, readerSeesMoney } from '../lib/workflows/visibility';
import type { D1Database } from '../lib/types';

type Env = { Bindings: AdminBindings & { PLATFORM_OWNER_USER_IDS?: string }; Variables: { auth?: AuthContext } };
type C = Context<Env>;

registerRuleChangeExecutor();
registerSupportFinanceExecutors();
registerFeatureExecutor(FEATURE_PRECONDITIONS);
registerTierExecutor();

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
    onEvent:
      opts.onEvent ??
      (async (e) => {
        await auditMirror(reports)(e);
        await enqueueWorkflowNotify(env, e);
      }),
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
  if (!mayReadWorkflows(actor)) throw new Refused(403, 'forbidden');
  return actor;
}
/** Money is decided by the finance list, never tech staff or the owner (the engine's money floor). */
const moneyPerson = (actor: WorkflowActor) => actor.financePermissions.length > 0 && !actor.techStaff && !actor.owner;
/** May this person propose a change to this rule? The same checks as rule-change.ts and the engine. */
const mayEditRule = (actor: WorkflowActor, type: WorkflowActionType, scope: string) =>
  hasWorkflowExecutor(type) && (isMoneyRule(type, scope) ? moneyPerson(actor) : actor.roles.includes('super_admin'));
/** May this person retry a failed apply? The same check as POST /requests/:id/retry. */
const mayRetry = (actor: WorkflowActor, domain: string | undefined) => (domain === 'money' ? moneyPerson(actor) : actor.roles.includes('super_admin'));
/** Who sees money requests: the finance list and support:read. */
export const seesMoney = (c: { get(key: 'auth'): AuthContext | undefined }, actor: WorkflowActor) => readerSeesMoney({ ...actor, roles: c.get('auth')?.roles ?? [] });

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
    // The default scope, the seeded scopes (money rule changes), the listed
    // ones (tiers.change: assign, default, tiers) and any edited one
    const scopes = [...new Set(['', ...(WORKFLOW_SEEDED_SCOPES[type] ?? []), ...(WORKFLOW_LISTED_SCOPES[type] ?? []), ...(results ?? []).map((r) => r.scope)])];
    const rules = [];
    for (const scope of scopes) {
      // Money rules (by their floor, not only the action's domain) are for people who can see money
      if (isMoneyRule(type, scope) && !money) continue;
      const r = await ruleInForce(ctx, type, scope);
      rules.push({ scope, version: r.version, config: r.config, floor: workflowFloorFor(type, scope), canEdit: mayEditRule(actor, type, scope) });
    }
    if (!rules.length) continue;
    // connected: false = registered for later; its rule can't be changed yet (rule-change.ts)
    out.push({ type, domain: def.domain, label: def.label, scoped: def.scoped, floor: def.floor, connected: hasWorkflowExecutor(type), rules });
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

/**
 * Who a rule can name for its emails: active admins and the finance list, by name (the picker of the rule
 * editor; it opens with all of them). For whoever may change a rule. Names only, never an email.
 */
app.get('/recipients', async (c) => {
  const ctx = ctxFor(c);
  const actor = await needRead(c, ctx);
  if (!actor.roles.includes('super_admin') && !moneyPerson(actor)) throw new Refused(403, 'forbidden');
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 100);
  const ids = await ctx.directory.candidates([{ kind: 'role', role: 'admin' }, { kind: 'finance' }]);
  const { users } = await resolveNames(c.env as never, { users: ids.slice(0, ADMIN_NAMES_MAX), items: [] });
  const items = ids
    .map((id) => ({ id, name: users[id]?.found ? (users[id].name ?? '').trim() : '' }))
    .filter((p) => p.name && p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ kind: 'user' as const, id: p.id, label: p.name, secondary: null, imageUrl: null }));
  return ok(c, { items });
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
    money: seesMoney(c, actor),
  });
  return ok(c, page);
});

/** The open request of each `target` (kind:id, repeated), for the pages that change them: { items: { target: requestId } }. */
app.get('/pending', async (c) => {
  const ctx = ctxFor(c);
  const actor = await needRead(c, ctx);
  const type = c.req.query('type');
  if (!type || !isWorkflowActionType(type)) return apiError(c, 404, 'not_found');
  const money = seesMoney(c, actor);
  const open = await openRequests(ctx, type, c.req.queries('target') ?? []);
  return ok(c, { items: Object.fromEntries(open.filter((r) => workflowDomainVisible(r.domain, money)).map((r) => [r.target, r.id])) });
});

/**
 * Live autocomplete over requests: the newest 200 the reader sees (one index range, idx_workflow_requests_proposed)
 * matched on their title in either language. Never a LIKE over the table.
 */
app.get('/requests/suggest', async (c) => {
  const ctx = ctxFor(c);
  const actor = await needRead(c, ctx);
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const { results } = await ctx.db
    .prepare(`SELECT r.id, r.action_type, r.diff, r.status, r.proposed_at FROM workflow_requests r${seesMoney(c, actor) ? '' : ` WHERE ${OPEN_DOMAINS_SQL}`} ORDER BY r.proposed_at DESC LIMIT 200`)
    .all<{ id: string; action_type: string; diff: string; status: WorkflowStatus; proposed_at: string }>();
  const items = [];
  for (const r of results ?? []) {
    if (!isWorkflowActionType(r.action_type)) continue;
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
  return ok(c, { waitingForMe: await waitingCount(ctx, actor.userId, seesMoney(c, actor)) });
});

async function visible(c: C, ctx: WorkflowCtx, id: string): Promise<WorkflowActor> {
  const actor = await needRead(c, ctx);
  const row = await ctx.db.prepare('SELECT domain FROM workflow_requests WHERE id = ?').bind(id).first<{ domain: string }>();
  if (!row) throw new WorkflowError(404, 'not_found');
  if (!workflowDomainVisible(row.domain, seesMoney(c, actor))) throw new Refused(403, 'forbidden');
  return actor;
}

app.get('/requests/:id', async (c) => {
  const ctx = ctxFor(c);
  const actor = await visible(c, ctx, c.req.param('id'));
  const view = await getRequestView(ctx, c.req.param('id'), actor);
  if (view.can) view.can.retry = view.status === 'failed' && mayRetry(actor, view.domain);
  return ok(c, view);
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
  const allowed = mayRetry(actor, row?.domain);
  if (!allowed) throw new Refused(403, 'forbidden');
  return ok(c, await retryRequest(ctx, actor, c.req.param('id')));
});

/** Whether the rule in force asks for a step-up to propose (a direct rule can too: its change is proposed and applied at once). */
async function proposalNeedsStepUp(env: AdminBindings, type: WorkflowActionType, scope: string): Promise<boolean> {
  if (!env.SEARCH_DB) return false;
  return (await ruleForProposal(workflowCtx(env as never), type, scope)).stepUp === 'propose_and_approve';
}

/** Step-up `when` for PUT /api/features/:key: only when the switch's rule asks for a step-up to propose. */
export async function featureProposalNeedsStepUp(c: Context): Promise<boolean> {
  const key = c.req.param('key');
  return !!key && isFeatureKey(key) && proposalNeedsStepUp(c.env as AdminBindings, 'features.set', key);
}

/**
 * Step-up `when` for the tier routes (WF-10): only when the scope's rule asks for a step-up to propose.
 * `scopeOf` names the route's scope (tiers.change: assign, default, tiers), or reads it from the route
 * (PUT /creator-tiers/:id is also /creator-tiers/default and /creator-tiers/order).
 */
export function tierProposalNeedsStepUp(scopeOf: string | ((c: Context) => string)) {
  return (c: Context): Promise<boolean> => proposalNeedsStepUp(c.env as AdminBindings, 'tiers.change', typeof scopeOf === 'string' ? scopeOf : scopeOf(c));
}

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
