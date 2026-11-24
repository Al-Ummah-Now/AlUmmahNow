/**
 * The approval workflow engine (wiki AUN-WORKFLOWS §5, §7; decision O44).
 *
 * A governed route calls `proposeChange`. The rule in force decides whether the change applies at once
 * (direct rule: no approver) or waits as a pending request for the people the rule names. Approvals,
 * rejections, withdrawals, expiry, the stale check and the apply step all go through here, and every
 * step is an append-only row in workflow_steps.
 *
 * Concurrency: every status change is a compare-and-set on workflow_requests.version, and each step row
 * is inserted in the same batch only if that version still holds, so two approvers racing for the last
 * approval produce one approval and one `version_conflict`. Applying moves the request to `applying`
 * with a compare-and-set first; only the winner applies. Search-D1 changes apply in one batch with the
 * `applied` status, so they happen exactly once.
 *
 * Every query uses an index from search migration 0085 (see the tests' EXPLAIN QUERY PLAN checks).
 */
import {
  WORKFLOW_ACTIONS,
  WORKFLOW_FLOOR_SUPERSEDED,
  WORKFLOW_RULE_CHANGE_MONEY_SCOPE,
  isMoneyRule,
  WORKFLOW_DECIDING_STEPS,
  WORKFLOW_LIMITS,
  checkWorkflowFloor,
  workflowDefaultRuleFor,
  workflowFloorFor,
  isWorkflowOpen,
  WORKFLOW_OPEN_STATUSES,
  workflowApprovalBlocks,
  workflowExpiresAt,
  workflowOpenKey,
  workflowProposeBlocks,
  type WorkflowActionType,
  type WorkflowActor,
  type WorkflowApprovalBlock,
  type WorkflowErrorCode,
  type WorkflowField,
  type WorkflowFloor,
  type WorkflowLocalized,
  type WorkflowRequestView,
  type WorkflowRuleConfig,
  type WorkflowStatus,
  type WorkflowStepKind,
} from '@al-ummah/shared-types';
import type { D1PreparedStatement } from '../types';
import { logger } from '../logger';
import type { WorkflowCtx, WorkflowEvent, WorkflowExecutor, WorkflowStoredRequest } from './types';

export class WorkflowError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: WorkflowErrorCode | 'not_found' | 'invalid_request',
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'WorkflowError';
  }
}

// ---------------------------------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------------------------------

const executors = new Map<WorkflowActionType, WorkflowExecutor<any, any>>();

export function registerWorkflowExecutor<P, R>(executor: WorkflowExecutor<P, R>): void {
  if (!executor.applyStatements === !executor.applyJob) throw new Error(`Workflow executor ${executor.type} needs exactly one of applyStatements or applyJob`);
  executors.set(executor.type, executor);
}

/** Whether a feature has connected this action type to the engine (its rule then really gates it). */
export function hasWorkflowExecutor(type: WorkflowActionType): boolean {
  return executors.has(type);
}

/** Tests only. */
export function clearWorkflowExecutors(): void {
  executors.clear();
}

function executorFor(type: WorkflowActionType): WorkflowExecutor<unknown, unknown> {
  const e = executors.get(type);
  if (!e) throw new WorkflowError(400, 'invalid_request', { reason: 'unknown_action' });
  return e;
}

// ---------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------

export interface RuleInForce {
  id: string | null;
  version: number;
  scope: string;
  config: WorkflowRuleConfig;
}

/** The default for a scope that has no row: money rule changes have their own seed. */
export function defaultRuleFor(type: WorkflowActionType, scope: string): WorkflowRuleConfig {
  return workflowDefaultRuleFor(type, scope);
}

/**
 * The rule in force: the newest version for the scope, else the newest for the default scope, else the
 * seed. A version approved through a money rule change ('money' scope) no longer applies once its scope
 * isn't a money rule (WORKFLOW_FLOOR_SUPERSEDED: creatorSupport, owner 2026-11-24): it was written
 * under a floor that is gone.
 */
export async function ruleInForce(ctx: WorkflowCtx, type: WorkflowActionType, scope: string): Promise<RuleInForce> {
  const read = (s: string) =>
    ctx.db
      .prepare(
        `SELECT r.id, r.version, r.config FROM workflow_rules r LEFT JOIN workflow_requests q ON q.id = r.request_id
         WHERE r.action_type = ? AND r.scope = ? AND (? = 1 OR q.scope IS NULL OR q.scope <> ?) ORDER BY r.version DESC LIMIT 1`,
      )
      .bind(type, s, isMoneyRule(type, s) ? 1 : 0, WORKFLOW_RULE_CHANGE_MONEY_SCOPE)
      .first<{ id: string; version: number; config: string }>();
  const scoped = await read(scope);
  if (scoped) return { id: scoped.id, version: scoped.version, scope, config: JSON.parse(scoped.config) as WorkflowRuleConfig };
  const seeded = defaultRuleFor(type, scope);
  if (scope && seeded !== WORKFLOW_ACTIONS[type].defaultRule) return { id: null, version: 0, scope, config: seeded };
  const base = scope ? await read('') : null;
  if (base) return { id: base.id, version: base.version, scope: '', config: JSON.parse(base.config) as WorkflowRuleConfig };
  return { id: null, version: 0, scope: '', config: seeded };
}

/**
 * The floor for an action and scope. Changes to money rules (rule-change scope 'money') carry the money
 * floor, so the finance list, never tech staff or the owner, decides on them.
 */
export function floorFor(type: WorkflowActionType, scope: string): WorkflowFloor {
  return workflowFloorFor(type, scope);
}

/**
 * Whether a change of this type and scope waits for approvers under the rule in force (with its floor).
 * Routes that keep their own direct write for direct rules (the Features page) ask this first.
 */
export async function ruleNeedsApproval(ctx: WorkflowCtx, type: WorkflowActionType, scope: string): Promise<boolean> {
  const inForce = await ruleInForce(ctx, type, scope);
  return enforceFloor(type, scope, inForce.config, 0).approvalsNeeded > 0;
}

/** The rule a new request of this type and scope would get (the rule in force with its floor applied). */
export async function ruleForProposal(ctx: WorkflowCtx, type: WorkflowActionType, scope: string): Promise<WorkflowRuleConfig> {
  const inForce = await ruleInForce(ctx, type, scope);
  return enforceFloor(type, scope, inForce.config, 0);
}

/** The rule with its floor applied: a stored rule can never be weaker than the floor (§4.3). */
function enforceFloor(type: WorkflowActionType, scope: string, rule: WorkflowRuleConfig, minApprovals: number): WorkflowRuleConfig {
  const floor = floorFor(type, scope);
  const problems = checkWorkflowFloor(floor, rule, minApprovals);
  if (!problems.length) return rule;
  const out: WorkflowRuleConfig = JSON.parse(JSON.stringify(rule));
  out.approvalsNeeded = Math.max(out.approvalsNeeded, floor.minApprovals, minApprovals);
  out.exclusions.subject = true;
  if (floor.money) {
    out.exclusions.techStaff = true;
    out.exclusions.owner = true;
    const finance = out.approvers.filter((a) => a.kind === 'finance');
    out.approvers = finance.length ? finance : [{ kind: 'finance' }];
  }
  if (problems.includes('below_floor_step_up')) out.stepUp = floor.minStepUp;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------

interface RequestRow {
  id: string;
  action_type: WorkflowActionType;
  scope: string;
  domain: string;
  rule: string;
  target_kind: string;
  target_id: string;
  subject_user_id: string | null;
  payload: string;
  diff: string;
  base_version: string;
  reason: string;
  proposed_by: string;
  proposed_at: string;
  expires_at: string;
  status: WorkflowStatus;
  approvals_needed: number;
  approvals_count: number;
  version: number;
  applied_at: string | null;
  result: string | null;
  error: string | null;
}

interface StepRow {
  seq: number;
  actor: string;
  kind: WorkflowStepKind;
  note: string | null;
  step_up: number;
  at: string;
}

const REQUEST_COLUMNS =
  'id, action_type, scope, domain, rule, target_kind, target_id, subject_user_id, payload, diff, base_version, reason, proposed_by, proposed_at, expires_at, status, approvals_needed, approvals_count, version, applied_at, result, error';

async function loadRow(ctx: WorkflowCtx, id: string): Promise<RequestRow> {
  const row = await ctx.db.prepare(`SELECT ${REQUEST_COLUMNS} FROM workflow_requests WHERE id = ?`).bind(id).first<RequestRow>();
  if (!row) throw new WorkflowError(404, 'not_found');
  return row;
}

async function loadSteps(ctx: WorkflowCtx, id: string): Promise<StepRow[]> {
  const { results } = await ctx.db.prepare('SELECT seq, actor, kind, note, step_up, at FROM workflow_steps WHERE request_id = ? ORDER BY seq').bind(id).all<StepRow>();
  return results ?? [];
}

const stored = (r: RequestRow, steps: StepRow[]): WorkflowStoredRequest => ({
  id: r.id,
  actionType: r.action_type,
  scope: r.scope,
  payload: JSON.parse(r.payload),
  proposedBy: r.proposed_by,
  approvedBy: steps.filter((s) => s.kind === 'approve').map((s) => s.actor),
  status: r.status,
  version: r.version,
});

/**
 * A step row, inserted only while the request still has `version` (so a lost race writes nothing).
 * The seq is the next one for the request, read through the primary key.
 */
function stepStatement(ctx: WorkflowCtx, requestId: string, version: number | null, actor: string, kind: WorkflowStepKind, note: string | null, at: string): D1PreparedStatement {
  const stepUp = ctx.steppedUp ? 1 : 0;
  const origin = actor === 'system' || ctx.origin === undefined ? null : JSON.stringify(ctx.origin);
  const guard = version === null ? '' : ' AND EXISTS (SELECT 1 FROM workflow_requests WHERE id = ? AND version = ?)';
  const args: unknown[] = [requestId, requestId, actor, kind, note, stepUp, origin, at];
  if (version !== null) args.push(requestId, version);
  return ctx.db
    .prepare(
      `INSERT INTO workflow_steps (request_id, seq, actor, kind, note, step_up, origin, at)
       SELECT ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM workflow_steps WHERE request_id = ?), ?, ?, ?, ?, ?, ?
       WHERE 1 = 1${guard}`,
    )
    .bind(...args);
}

const changes = (r: unknown) => Number((r as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);

function newId(): string {
  return `wfr_${crypto.randomUUID().replace(/-/g, '')}`;
}

function cleanText(v: unknown, max: number, required: boolean): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new WorkflowError(400, 'invalid_request', { field: 'reason' });
    return null;
  }
  if (typeof v !== 'string') throw new WorkflowError(400, 'invalid_request');
  const t = v.trim();
  if (required && !t) throw new WorkflowError(400, 'invalid_request', { field: 'reason' });
  if (t.length > max) throw new WorkflowError(400, 'invalid_request', { field: 'reason', max });
  return t || null;
}

// ---------------------------------------------------------------------------------------------------
// Approvers
// ---------------------------------------------------------------------------------------------------

/** Accounts that may approve this request right now (for the inbox and notices), excluding the proposer. */
async function eligibleApprovers(ctx: WorkflowCtx, floor: WorkflowFloor, rule: WorkflowRuleConfig, proposedBy: string, subject: string | null, decidedBy: string[], approvedBy: string[]): Promise<string[]> {
  const ids = await ctx.directory.candidates(rule.approvers);
  const out: string[] = [];
  for (const id of ids) {
    if (id === proposedBy || id === subject) continue;
    const facts = await ctx.directory.facts(id);
    if (!workflowApprovalBlocks(rule, floor, { proposedBy, subjectUserId: subject, decidedBy, approvedBy }, facts).length) out.push(id);
  }
  return out;
}

async function emit(ctx: WorkflowCtx, event: Omit<WorkflowEvent, 'recipients'> & { recipients?: string[] }): Promise<void> {
  if (!ctx.onEvent) return;
  await ctx.onEvent({ ...event, recipients: [...new Set(event.recipients ?? [])] });
}

// ---------------------------------------------------------------------------------------------------
// Propose
// ---------------------------------------------------------------------------------------------------

export interface ProposeInput {
  type: WorkflowActionType;
  payload: unknown;
  reason: unknown;
}

export type ProposeOutcome = { status: 'applied'; requestId: string; result: unknown } | { status: 'pending_approval' | 'failed'; request: WorkflowRequestView };

export async function proposeChange(ctx: WorkflowCtx, actor: WorkflowActor, input: ProposeInput): Promise<ProposeOutcome> {
  const executor = executorFor(input.type);
  const action = WORKFLOW_ACTIONS[input.type];
  const reason = cleanText(input.reason, WORKFLOW_LIMITS.maxReasonLength, true) as string;
  // Money is refused before anything else is read; the payload decides the scope (and so the floor).
  if (workflowProposeBlocks(action.floor, actor).length) throw new WorkflowError(403, 'propose_not_allowed', { blocks: workflowProposeBlocks(action.floor, actor) });
  const payload = await executor.validate(ctx, input.payload);
  const scope = executor.scope?.(payload) ?? '';
  if (scope.length > WORKFLOW_LIMITS.scopeMaxLength) throw new WorkflowError(400, 'invalid_request');
  const floor = floorFor(input.type, scope);
  const blocks = workflowProposeBlocks(floor, actor);
  if (blocks.length || !(await executor.canPropose(ctx, actor, payload))) throw new WorkflowError(403, 'propose_not_allowed', { blocks });
  const inForce = await ruleInForce(ctx, input.type, scope);
  const rule = enforceFloor(input.type, scope, inForce.config, (await executor.minApprovals?.(ctx)) ?? 0);
  if (rule.stepUp === 'propose_and_approve' && !ctx.steppedUp) throw new WorkflowError(403, 'propose_not_allowed', { stepUp: true });

  const now = ctx.now();

  const target = executor.target(payload);
  const description = await executor.describe(ctx, payload);
  const subject = description.subjectUserId ?? null;
  const id = newId();
  const at = now.toISOString();
  const direct = rule.approvalsNeeded === 0;
  // An approved change takes effect at once: there are no scheduled dates (owner, WF-D6)
  const status: WorkflowStatus = direct ? 'applying' : 'pending';
  const openKey = workflowOpenKey(input.type, target.kind, target.id);

  const insert = ctx.db
    .prepare(
      `INSERT INTO workflow_requests (id, action_type, scope, domain, rule_id, rule, target_kind, target_id, open_key, subject_user_id, payload, diff, base_version, reason,
         proposed_by, proposed_at, expires_at, status, approvals_needed, approvals_count, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
    )
    .bind(
      id,
      input.type,
      scope,
      floor.money ? 'money' : action.domain,
      inForce.id,
      JSON.stringify(rule),
      target.kind,
      target.id,
      openKey,
      subject,
      JSON.stringify(payload),
      JSON.stringify({ title: description.title, fields: description.fields }),
      description.baseVersion,
      reason,
      actor.userId,
      at,
      workflowExpiresAt(now, rule).toISOString(),
      status,
      rule.approvalsNeeded,
      at,
    );
  const approvers = direct ? [] : await eligibleApprovers(ctx, floor, rule, actor.userId, subject, [actor.userId], []);
  const inbox = approvers.map((u) => ctx.db.prepare('INSERT OR IGNORE INTO workflow_inbox (user_id, request_id, created_at) VALUES (?, ?, ?)').bind(u, id, at));
  try {
    await ctx.db.batch([insert, stepStatement(ctx, id, null, actor.userId, 'propose', null, at), ...inbox]);
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String((e as Error)?.message ?? e))) {
      const open = await ctx.db.prepare('SELECT id FROM workflow_requests WHERE open_key = ?').bind(openKey).first<{ id: string }>();
      throw new WorkflowError(409, 'change_pending', { requestId: open?.id ?? null });
    }
    throw e;
  }
  await emit(ctx, { kind: 'proposed', requestId: id, type: input.type, actor: actor.userId, recipients: [actor.userId, ...approvers] });

  if (status === 'applying') {
    const row = await loadRow(ctx, id);
    const applied = await runApply(ctx, row);
    if (applied.status === 'applied') return { status: 'applied', requestId: id, result: applied.result };
    // A direct change that failed (or went stale) is not waiting for anyone: say what happened
    return { status: 'failed', request: await getRequestView(ctx, id, actor) };
  }
  const view = await getRequestView(ctx, id, actor);
  return { status: 'pending_approval', request: view };
}

// ---------------------------------------------------------------------------------------------------
// Approve, reject, withdraw, comment
// ---------------------------------------------------------------------------------------------------

function facts(row: RequestRow, steps: StepRow[]) {
  return {
    proposedBy: row.proposed_by,
    subjectUserId: row.subject_user_id,
    decidedBy: steps.filter((s) => WORKFLOW_DECIDING_STEPS.includes(s.kind)).map((s) => s.actor),
    approvedBy: steps.filter((s) => s.kind === 'approve').map((s) => s.actor),
  };
}

async function blocksFor(ctx: WorkflowCtx, row: RequestRow, steps: StepRow[], actor: WorkflowActor): Promise<(WorkflowApprovalBlock | string)[]> {
  const rule = JSON.parse(row.rule) as WorkflowRuleConfig;
  const blocks: (WorkflowApprovalBlock | string)[] = workflowApprovalBlocks(rule, floorFor(row.action_type, row.scope), facts(row, steps), actor);
  const extra = (await executors.get(row.action_type)?.approverBlocks?.(ctx, JSON.parse(row.payload), actor.userId)) ?? [];
  return [...blocks, ...extra.filter((b) => !blocks.includes(b))];
}

/** Marks a request stale (the target changed): nobody can approve it, the proposer proposes again. */
async function markStale(ctx: WorkflowCtx, row: RequestRow): Promise<void> {
  const at = ctx.now().toISOString();
  const [, upd] = await ctx.db.batch([
    stepStatement(ctx, row.id, row.version, 'system', 'stale', null, at),
    ctx.db.prepare("UPDATE workflow_requests SET status = 'stale', open_key = NULL, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(at, row.id, row.version),
    ctx.db.prepare('DELETE FROM workflow_inbox WHERE request_id = ?').bind(row.id),
  ]);
  if (changes(upd)) await emit(ctx, { kind: 'stale', requestId: row.id, type: row.action_type, actor: 'system', recipients: [row.proposed_by] });
}

async function isStale(ctx: WorkflowCtx, row: RequestRow): Promise<boolean> {
  const executor = executorFor(row.action_type);
  return (await executor.currentVersion(ctx, JSON.parse(row.payload))) !== row.base_version;
}

function needVersion(row: RequestRow, version: unknown): void {
  if (version !== undefined && version !== row.version) throw new WorkflowError(409, 'version_conflict', { version: row.version });
}

export async function approveRequest(ctx: WorkflowCtx, actor: WorkflowActor, id: string, input: { version?: number; note?: unknown }): Promise<WorkflowRequestView> {
  const row = await loadRow(ctx, id);
  if (row.status !== 'pending') throw new WorkflowError(409, 'request_closed', { status: row.status });
  needVersion(row, input.version);
  const note = cleanText(input.note, WORKFLOW_LIMITS.maxNoteLength, false);
  const steps = await loadSteps(ctx, id);
  const blocks = await blocksFor(ctx, row, steps, actor);
  if (blocks.length) throw new WorkflowError(403, 'approval_not_allowed', { blocks });
  const rule = JSON.parse(row.rule) as WorkflowRuleConfig;
  if (rule.stepUp !== 'none' && !ctx.steppedUp) throw new WorkflowError(403, 'approval_not_allowed', { stepUp: true });
  if (await isStale(ctx, row)) {
    await markStale(ctx, row);
    throw new WorkflowError(409, 'request_stale');
  }

  const now = ctx.now();
  const at = now.toISOString();
  const count = row.approvals_count + 1;
  const done = count >= row.approvals_needed;
  const next: WorkflowStatus = done ? 'applying' : 'pending';
  const results = await ctx.db.batch([
    stepStatement(ctx, id, row.version, actor.userId, 'approve', note, at),
    ctx.db
      .prepare('UPDATE workflow_requests SET approvals_count = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .bind(count, next, at, id, row.version),
    ctx.db.prepare(done ? 'DELETE FROM workflow_inbox WHERE request_id = ?' : 'DELETE FROM workflow_inbox WHERE request_id = ? AND user_id = ?').bind(...(done ? [id] : [id, actor.userId])),
  ]).catch((e: unknown) => {
    // the one-approval-per-person index: a double click
    if (/UNIQUE|constraint/i.test(String((e as Error)?.message ?? e))) throw new WorkflowError(409, 'approval_not_allowed', { blocks: ['already_approved'] });
    throw e;
  });
  if (!changes(results[1])) throw new WorkflowError(409, 'version_conflict');
  await emit(ctx, { kind: 'approved', requestId: id, type: row.action_type, actor: actor.userId, recipients: [row.proposed_by, ...steps.filter((s) => s.kind === 'approve').map((s) => s.actor)] });
  if (next === 'applying') await runApply(ctx, await loadRow(ctx, id));
  return getRequestView(ctx, id, actor);
}

async function close(ctx: WorkflowCtx, row: RequestRow, actorId: string, kind: 'reject' | 'withdraw' | 'expire', to: WorkflowStatus, note: string | null): Promise<boolean> {
  const at = ctx.now().toISOString();
  const results = await ctx.db.batch([
    stepStatement(ctx, row.id, row.version, actorId, kind, note, at),
    ctx.db.prepare('UPDATE workflow_requests SET status = ?, open_key = NULL, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').bind(to, at, row.id, row.version),
    ctx.db.prepare('DELETE FROM workflow_inbox WHERE request_id = ?').bind(row.id),
  ]);
  return changes(results[1]) > 0;
}

export async function rejectRequest(ctx: WorkflowCtx, actor: WorkflowActor, id: string, input: { version?: number; reason?: unknown }): Promise<WorkflowRequestView> {
  const row = await loadRow(ctx, id);
  if (row.status !== 'pending') throw new WorkflowError(409, 'request_closed', { status: row.status });
  needVersion(row, input.version);
  const reason = cleanText(input.reason, WORKFLOW_LIMITS.maxReasonLength, true);
  const steps = await loadSteps(ctx, id);
  // Anyone who may approve may reject; having approved already doesn't stop a later rejection of a
  // multi-approver request (they changed their mind), so 'already_approved' is not a block here.
  const blocks = (await blocksFor(ctx, row, steps, actor)).filter((b) => b !== 'already_approved' && b !== 'one_step_per_person');
  if (blocks.length) throw new WorkflowError(403, 'approval_not_allowed', { blocks });
  if (!(await close(ctx, row, actor.userId, 'reject', 'rejected', reason))) throw new WorkflowError(409, 'version_conflict');
  await emit(ctx, { kind: 'rejected', requestId: id, type: row.action_type, actor: actor.userId, recipients: [row.proposed_by, ...steps.filter((s) => s.kind === 'approve').map((s) => s.actor)] });
  return getRequestView(ctx, id, actor);
}

export async function withdrawRequest(ctx: WorkflowCtx, actor: WorkflowActor, id: string, input: { version?: number }): Promise<WorkflowRequestView> {
  const row = await loadRow(ctx, id);
  if (row.proposed_by !== actor.userId) throw new WorkflowError(403, 'approval_not_allowed', { blocks: ['not_proposer'] });
  if (!['pending', 'failed'].includes(row.status)) throw new WorkflowError(409, 'request_closed', { status: row.status });
  needVersion(row, input.version);
  const recipients = (await ctx.db.prepare('SELECT user_id FROM workflow_inbox WHERE request_id = ?').bind(id).all<{ user_id: string }>()).results?.map((r) => r.user_id) ?? [];
  if (!(await close(ctx, row, actor.userId, 'withdraw', 'withdrawn', null))) throw new WorkflowError(409, 'version_conflict');
  await emit(ctx, { kind: 'withdrawn', requestId: id, type: row.action_type, actor: actor.userId, recipients });
  return getRequestView(ctx, id, actor);
}

export async function commentOnRequest(ctx: WorkflowCtx, actor: WorkflowActor, id: string, input: { note?: unknown }): Promise<WorkflowRequestView> {
  const row = await loadRow(ctx, id);
  const note = cleanText(input.note, WORKFLOW_LIMITS.maxNoteLength, true);
  await stepStatement(ctx, id, null, actor.userId, 'comment', note, ctx.now().toISOString()).run();
  await emit(ctx, { kind: 'commented', requestId: id, type: row.action_type, actor: actor.userId, recipients: [row.proposed_by] });
  return getRequestView(ctx, id, actor);
}

// ---------------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------------

/**
 * Applies an approved request. Moves it to `applying` with a compare-and-set first (unless it is
 * already there from the step that approved it), so only one caller applies.
 */
async function runApply(ctx: WorkflowCtx, row: RequestRow): Promise<{ status: 'applied'; result: unknown } | { status: 'failed' | 'stale' | 'skipped' }> {
  let current = row;
  if (current.status !== 'applying') {
    const at = ctx.now().toISOString();
    const r = await ctx.db.prepare("UPDATE workflow_requests SET status = 'applying', version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status = 'failed'").bind(at, row.id, row.version).run();
    if (!changes(r)) return { status: 'skipped' };
    current = await loadRow(ctx, row.id);
  }
  // From here the request is `applying` and holds its target's lock: every error ends in `failed`
  // (Retry on the request page and the Errors page), never a request stuck in `applying`.
  const at = ctx.now().toISOString();
  const people = async () => {
    const steps = await loadSteps(ctx, current.id).catch(() => [] as StepRow[]);
    return [current.proposed_by, ...steps.filter((s) => s.kind === 'approve').map((s) => s.actor)];
  };
  try {
    if (await isStale(ctx, current)) {
      await markStale(ctx, current);
      return { status: 'stale' };
    }
    const executor = executorFor(current.action_type);
    const finish = (result: unknown) =>
      ctx.db
        .prepare("UPDATE workflow_requests SET status = 'applied', open_key = NULL, applied_at = ?, result = ?, error = NULL, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status = 'applying'")
        .bind(at, JSON.stringify(result ?? null), at, current.id, current.version);
    let result: unknown;
    if (executor.applyStatements) {
      const out = await executor.applyStatements(ctx, JSON.parse(current.payload), stored(current, await loadSteps(ctx, current.id)));
      result = out.result;
      // Exactly once: `finish` moves applying → applied (version + 1). If it changed nothing (someone else
      // finished first), the guard matches the row and breaks the approvals_needed >= 0 CHECK, which
      // aborts the whole batch, so the executor's statements never commit twice.
      const guard = ctx.db
        .prepare("UPDATE workflow_requests SET approvals_needed = -1 WHERE id = ? AND NOT (status = 'applied' AND version = ?)")
        .bind(current.id, current.version + 1);
      try {
        await ctx.db.batch([finish(result), guard, ...out.statements, stepStatement(ctx, current.id, null, 'system', 'apply', null, at)]);
      } catch (e) {
        if (/CHECK constraint/i.test(String((e as Error)?.message ?? e))) {
          const now = await loadRow(ctx, current.id);
          if (now.status === 'applied') return { status: 'skipped' };
        }
        throw e;
      }
    } else {
      result = await executor.applyJob!(ctx, JSON.parse(current.payload), stored(current, await loadSteps(ctx, current.id)));
      const results = await ctx.db.batch([finish(result), stepStatement(ctx, current.id, null, 'system', 'apply', null, at)]);
      if (!changes(results[0])) return { status: 'skipped' };
    }
    await emit(ctx, { kind: 'applied', requestId: current.id, type: current.action_type, actor: 'system', recipients: await people() });
    return { status: 'applied', result };
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 500);
    await ctx.db.batch([
      ctx.db.prepare("UPDATE workflow_requests SET status = 'failed', error = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'applying'").bind(message, at, current.id),
      stepStatement(ctx, current.id, null, 'system', 'fail', message, at),
    ]);
    await emit(ctx, { kind: 'failed', requestId: current.id, type: current.action_type, actor: 'system', recipients: await people() });
    return { status: 'failed' };
  }
}

/** Retry a failed apply (Errors page or the request page). */
export async function retryRequest(ctx: WorkflowCtx, actor: WorkflowActor, id: string): Promise<WorkflowRequestView> {
  const row = await loadRow(ctx, id);
  if (row.status !== 'failed') throw new WorkflowError(409, 'request_closed', { status: row.status });
  await stepStatement(ctx, id, null, actor.userId, 'retry', null, ctx.now().toISOString()).run();
  await runApply(ctx, row);
  return getRequestView(ctx, id, actor);
}

// ---------------------------------------------------------------------------------------------------
// Cron: expiry
// ---------------------------------------------------------------------------------------------------

export async function runDueWorkflows(ctx: WorkflowCtx, limit = 50): Promise<{ expired: number; errors: number; superseded: number }> {
  const now = ctx.now().toISOString();
  const out = { expired: 0, errors: 0, superseded: 0 };
  // Requests opened under a money floor that no longer applies (WORKFLOW_FLOOR_SUPERSEDED): withdrawn by
  // the system with the reason. Idempotent: only open ones still stored as money are read.
  for (const gone of WORKFLOW_FLOOR_SUPERSEDED) {
    const open = await ctx.db
      .prepare(`SELECT ${REQUEST_COLUMNS} FROM workflow_requests WHERE action_type = ? AND status IN ('pending', 'failed') AND scope = ? AND domain = 'money' ORDER BY proposed_at LIMIT ?`)
      .bind(gone.type, gone.scope, limit)
      .all<RequestRow>();
    for (const row of open.results ?? []) {
      try {
        const recipients = (await ctx.db.prepare('SELECT user_id FROM workflow_inbox WHERE request_id = ?').bind(row.id).all<{ user_id: string }>()).results?.map((r) => r.user_id) ?? [];
        if (await close(ctx, row, 'system', 'withdraw', 'withdrawn', `${gone.note.en}\n${gone.note.ar}`)) {
          out.superseded++;
          logger.info('[Workflows] Closed a request whose money floor is gone', { requestId: row.id, type: row.action_type, scope: row.scope });
          await emit(ctx, { kind: 'withdrawn', requestId: row.id, type: row.action_type, actor: 'system', recipients: [row.proposed_by, ...recipients] });
        }
      } catch (error) {
        out.errors++;
        logger.error('[Workflows] Closing a superseded request failed', { requestId: row.id, error: String(error) });
      }
    }
  }
  const expiring = await ctx.db.prepare(`SELECT ${REQUEST_COLUMNS} FROM workflow_requests WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at LIMIT ?`).bind(now, limit).all<RequestRow>();
  for (const row of expiring.results ?? []) {
    try {
      const recipients = (await ctx.db.prepare('SELECT user_id FROM workflow_inbox WHERE request_id = ?').bind(row.id).all<{ user_id: string }>()).results?.map((r) => r.user_id) ?? [];
      if (await close(ctx, row, 'system', 'expire', 'expired', null)) {
        out.expired++;
        await emit(ctx, { kind: 'expired', requestId: row.id, type: row.action_type, actor: 'system', recipients: [row.proposed_by, ...recipients] });
      }
    } catch (error) {
      out.errors++;
      logger.error('[Workflows] Expiring a request failed', { requestId: row.id, error: String(error) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------

export async function getRequestView(ctx: WorkflowCtx, id: string, viewer?: WorkflowActor): Promise<WorkflowRequestView> {
  const row = await loadRow(ctx, id);
  const steps = await loadSteps(ctx, id);
  const diff = JSON.parse(row.diff) as { title: WorkflowLocalized; fields: WorkflowField[] };
  const view: WorkflowRequestView = {
    id: row.id,
    type: row.action_type,
    scope: row.scope,
    domain: row.domain as WorkflowRequestView['domain'],
    title: diff.title,
    target: { kind: row.target_kind, id: row.target_id },
    fields: diff.fields,
    reason: row.reason,
    proposedBy: row.proposed_by,
    proposedAt: row.proposed_at,
    expiresAt: row.expires_at,
    status: row.status,
    approvalsNeeded: row.approvals_needed,
    approvalsCount: row.approvals_count,
    version: row.version,
    appliedAt: row.applied_at,
    steps: steps.map((s) => ({ seq: s.seq, actor: s.actor, kind: s.kind, note: s.note, stepUp: s.step_up === 1, at: s.at })),
  };
  if (viewer) {
    const blocks = row.status === 'pending' ? await blocksFor(ctx, row, steps, viewer) : [];
    const open = row.status === 'pending';
    view.can = {
      approve: open && !blocks.length,
      reject: open && !blocks.filter((b) => b !== 'already_approved' && b !== 'one_step_per_person').length,
      withdraw: viewer.userId === row.proposed_by && ['pending', 'failed'].includes(row.status),
      blocks: blocks as WorkflowApprovalBlock[],
    };
  }
  return view;
}

export type RequestListView = 'waiting' | 'mine' | 'open' | 'history';

export interface RequestListItem {
  id: string;
  type: WorkflowActionType;
  /** 'money' also for changes to money rules */
  domain: string;
  title: WorkflowLocalized;
  status: WorkflowStatus;
  proposedBy: string;
  proposedAt: string;
  expiresAt: string;
  approvalsNeeded: number;
  approvalsCount: number;
}

/**
 * One index per view: waiting (workflow_inbox by user), mine (proposer), open (status), history
 * (proposed_at). Cursor = the last item's proposed_at|id; 50 per page.
 */
export async function listRequests(ctx: WorkflowCtx, userId: string, opts: { view: RequestListView; status?: WorkflowStatus; type?: WorkflowActionType; cursor?: string | null; limit?: number }): Promise<{ items: RequestListItem[]; next: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 50);
  const [cAt, cId] = opts.cursor ? opts.cursor.split('|') : [null, null];
  const cursorSql = cAt ? ' AND (r.proposed_at < ? OR (r.proposed_at = ? AND r.id < ?))' : '';
  const cursorArgs = cAt ? [cAt, cAt, cId ?? ''] : [];
  // The action filter applies to every view; each view still starts from its own index.
  const typeSql = opts.type ? ' AND r.action_type = ?' : '';
  const typeArgs = opts.type ? [opts.type] : [];
  let sql: string;
  let args: unknown[];
  const cols = 'r.id, r.action_type, r.domain, r.diff, r.status, r.proposed_by, r.proposed_at, r.expires_at, r.approvals_needed, r.approvals_count';
  switch (opts.view) {
    case 'waiting':
      sql = `SELECT ${cols} FROM workflow_inbox i JOIN workflow_requests r ON r.id = i.request_id WHERE i.user_id = ?${typeSql}${cursorSql} ORDER BY r.proposed_at DESC, r.id DESC LIMIT ?`;
      args = [userId, ...typeArgs, ...cursorArgs, limit + 1];
      break;
    case 'mine':
      sql = `SELECT ${cols} FROM workflow_requests r WHERE r.proposed_by = ?${typeSql}${cursorSql} ORDER BY r.proposed_at DESC, r.id DESC LIMIT ?`;
      args = [userId, ...typeArgs, ...cursorArgs, limit + 1];
      break;
    case 'open': {
      const statuses = opts.status && isWorkflowOpen(opts.status) ? [opts.status] : [...WORKFLOW_OPEN_STATUSES];
      sql = `SELECT ${cols} FROM workflow_requests r WHERE r.status IN (${statuses.map(() => '?').join(', ')})${typeSql}${cursorSql} ORDER BY r.proposed_at DESC, r.id DESC LIMIT ?`;
      args = [...statuses, ...typeArgs, ...cursorArgs, limit + 1];
      break;
    }
    default:
      if (opts.type) {
        const statusSql = opts.status ? ' AND r.status = ?' : '';
        sql = `SELECT ${cols} FROM workflow_requests r WHERE r.action_type = ?${statusSql}${cursorSql} ORDER BY r.proposed_at DESC, r.id DESC LIMIT ?`;
        args = [opts.type, ...(opts.status ? [opts.status] : []), ...cursorArgs, limit + 1];
      } else if (opts.status) {
        sql = `SELECT ${cols} FROM workflow_requests r WHERE r.status = ?${cursorSql} ORDER BY r.proposed_at DESC, r.id DESC LIMIT ?`;
        args = [opts.status, ...cursorArgs, limit + 1];
      } else {
        sql = `SELECT ${cols} FROM workflow_requests r WHERE 1 = 1${cursorSql} ORDER BY r.proposed_at DESC, r.id DESC LIMIT ?`;
        args = [...cursorArgs, limit + 1];
      }
  }
  const { results } = await ctx.db.prepare(sql).bind(...args).all<RequestRow>();
  const rows = results ?? [];
  const page = rows.slice(0, limit);
  const items = page.map((r) => ({
    id: r.id,
    type: r.action_type,
    domain: r.domain,
    title: (JSON.parse(r.diff) as { title: WorkflowLocalized }).title,
    status: r.status,
    proposedBy: r.proposed_by,
    proposedAt: r.proposed_at,
    expiresAt: r.expires_at,
    approvalsNeeded: r.approvals_needed,
    approvalsCount: r.approvals_count,
  }));
  const last = page[page.length - 1];
  return { items, next: rows.length > limit && last ? `${last.proposed_at}|${last.id}` : null };
}

export async function waitingCount(ctx: WorkflowCtx, userId: string): Promise<number> {
  const r = await ctx.db.prepare('SELECT COUNT(*) AS n FROM workflow_inbox WHERE user_id = ?').bind(userId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

// ---------------------------------------------------------------------------------------------------
// Rule changes (the rules page proposes `workflows.rule.set`; this writes the approved version)
// ---------------------------------------------------------------------------------------------------

export function ruleVersionStatement(ctx: WorkflowCtx, input: { type: WorkflowActionType; scope: string; version: number; config: WorkflowRuleConfig; requestId: string | null; by: string }): D1PreparedStatement {
  return ctx.db
    .prepare('INSERT INTO workflow_rules (id, action_type, scope, version, config, request_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(`wfrule_${crypto.randomUUID().replace(/-/g, '')}`, input.type, input.scope, input.version, JSON.stringify(input.config), input.requestId, input.by, ctx.now().toISOString());
}
