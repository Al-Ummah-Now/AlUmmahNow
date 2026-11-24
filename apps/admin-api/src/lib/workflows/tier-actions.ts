/**
 * `tiers.change` on the approval workflow (wiki AUN-WORKFLOWS WF-10, owner WF-D1: tiers are registered
 * direct). Every tier route builds one operation; while its scope's rule is direct (the default) the
 * route runs it at once, exactly as before. Once an admin gives the scope approvers on the rules page,
 * the route proposes the operation instead and this executor runs it on approval, under the proposer's
 * name, with the same checks, audit rows and notices.
 *
 * Scopes (TIER_CHANGE_SCOPES): `assign` (a creator's tier, one or many, or a tier request approved),
 * `default` (the default tier) and `tiers` (add, edit, delete, reorder).
 */
import {
  cleanTrashReason,
  creatorTierOrigin,
  hasContentPermission,
  MAX_BULK_CREATOR_TIER,
  TIER_REQUEST_ERRORS,
  type CreatorTierAssignment,
  type CreatorTierBulkResult,
  type TierChangeScope,
  type WorkflowField,
  type WorkflowLocalized,
} from '@al-ummah/shared-types';
import { callVideos, VideosError, type VideosCall, type VideosClientEnv } from '../content/videosClient';
import { dropAudit, setAuditSubject, writeAudit, type AuditAction } from '../content/audit';
import { enqueueTierRequestMail, flagTierRequestFailure, tierRequestMailJob } from '../tier-request-mail';
import { pendingInvitesForTier } from '../invites';
import { logger } from '../logger';
import type { AdminBindings } from '../../base/types';
import { registerWorkflowExecutor } from './engine';
import type { WorkflowExecutor } from './types';

/** The audit id of default-tier changes (kind 'creator-tier', action 'set-default') */
export const DEFAULT_TIER_AUDIT_ID = 'default';
/** The audit id of rank changes (kind 'creator-tier', action 'reorder') */
export const TIER_ORDER_AUDIT_ID = 'order';

export type TierOp =
  | { op: 'assign'; userId: string; tierId: string; source: 'admin' | 'subscription'; confirmSuperAdmin: boolean }
  | { op: 'bulk'; userIds: string[]; tierId: string }
  | { op: 'approveRequest'; requestId: string }
  | { op: 'setDefault'; tierId: string; undo: boolean }
  | { op: 'create'; input: Record<string, unknown> }
  | { op: 'edit'; id: string; input: Record<string, unknown> }
  | { op: 'delete'; id: string; reason: string | null }
  | { op: 'reorder'; ids: string[]; undo: boolean };

export function tierScope(op: TierOp): TierChangeScope {
  if (op.op === 'assign' || op.op === 'bulk' || op.op === 'approveRequest') return 'assign';
  if (op.op === 'setDefault') return 'default';
  return 'tiers';
}

/** A refusal the route answers as is (status, code, message, extra fields). */
export class TierOpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'TierOpError';
  }
}

type TierEnv = AdminBindings & VideosClientEnv;
type TierAssignment = Pick<CreatorTierAssignment, 'tierId' | 'source'> & Partial<Pick<CreatorTierAssignment, 'assignedBy' | 'assignedAt'>>;
type TierRequestRow = { id: string; userId: string; tierId: string; status: string; currentTierId: string; currentIsDefault?: boolean; decidedAt: string | null };
type TierRow = Record<string, unknown> & { id: string; name?: string; nameAr?: string | null };

const videos = <T>(env: TierEnv, actorId: string, path: string, call: VideosCall = {}) => callVideos<T>(env, path, { actorId, ...call });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Audits then performs a change; the row is dropped again when the change fails (content.router's rule). */
async function audited<T>(env: TierEnv, actorId: string, entry: Omit<AuditAction, 'actorId'>, run: () => Promise<T>): Promise<T> {
  const db = env.REPORTS_DB;
  const auditId = await writeAudit(db, { ...entry, actorId });
  try {
    const result = await run();
    logger.info('[Tiers] Action', { kind: entry.kind, id: entry.id, action: entry.action, actorId });
    return result;
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[Tiers] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
}

async function tierList(env: TierEnv, actorId: string): Promise<{ items: TierRow[]; defaultTierId?: string }> {
  return videos<{ items: TierRow[]; defaultTierId?: string }>(env, actorId, '/creator-tiers', { query: { counts: '0' } });
}

/**
 * Reads a route's input into an operation; throws TierOpError for input the route refuses (400).
 * The same shapes are the request payloads, so the executor validates with it too.
 */
export function readTierOp(raw: unknown): TierOp {
  const i = (raw ?? {}) as Record<string, unknown>;
  switch (i.op) {
    case 'assign': {
      const userId = str(i.userId);
      const tierId = str(i.tierId);
      // Every account has a tier: there is no "remove"
      if (!userId || !tierId) throw new TierOpError(400, 'tier_required', 'tierId is required: every account has a tier');
      return { op: 'assign', userId, tierId, source: i.source === 'subscription' ? 'subscription' : 'admin', confirmSuperAdmin: i.confirmSuperAdmin === true };
    }
    case 'bulk': {
      const userIds = Array.isArray(i.userIds) ? [...new Set(i.userIds.filter((v): v is string => typeof v === 'string' && v.length > 0))] : [];
      const tierId = str(i.tierId);
      if (!userIds.length || userIds.length > MAX_BULK_CREATOR_TIER || !tierId) {
        throw new TierOpError(400, 'invalid_request', `userIds (1 to ${MAX_BULK_CREATOR_TIER}) and tierId are required`);
      }
      return { op: 'bulk', userIds, tierId };
    }
    case 'approveRequest': {
      const requestId = str(i.requestId);
      if (!requestId) throw new TierOpError(400, 'invalid_request', 'requestId is required');
      return { op: 'approveRequest', requestId };
    }
    case 'setDefault': {
      const tierId = str(i.tierId);
      if (!tierId) throw new TierOpError(400, 'invalid_request', "tierId is required (a tier id, or 'none')");
      return { op: 'setDefault', tierId, undo: i.undo === true };
    }
    case 'create': {
      const { id: _ignored, ...input } = (i.input ?? {}) as Record<string, unknown>;
      return { op: 'create', input };
    }
    case 'edit': {
      const id = str(i.id);
      if (!id) throw new TierOpError(400, 'invalid_request', 'id is required');
      return { op: 'edit', id, input: (i.input ?? {}) as Record<string, unknown> };
    }
    case 'delete': {
      const id = str(i.id);
      if (!id) throw new TierOpError(400, 'invalid_request', 'id is required');
      return { op: 'delete', id, reason: cleanTrashReason(i.reason) };
    }
    case 'reorder': {
      const ids = Array.isArray(i.ids) ? i.ids.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
      if (!ids.length) throw new TierOpError(400, 'invalid_request', 'ids: every tier id, lowest rank first');
      return { op: 'reorder', ids, undo: i.undo === true };
    }
    default:
      throw new TierOpError(400, 'invalid_request', 'Unknown tier change');
  }
}

/** The checks a change must pass before it is proposed or run (and again when it runs after approval). */
export async function checkTierOp(env: TierEnv, actorId: string, op: TierOp): Promise<void> {
  if (op.op === 'assign') {
    const current = await videos<{ assignment: TierAssignment | null }>(env, actorId, `/users/${encodeURIComponent(op.userId)}/creator-tier`);
    // A super admin's automatic Unlimited is never changed by mistake: the admin confirms it explicitly
    if (creatorTierOrigin(current.assignment as CreatorTierAssignment | null) === 'super_admin' && !op.confirmSuperAdmin) {
      logger.warn('[Tiers] Refused a change to a super admin tier', { userId: op.userId, actorId });
      throw new TierOpError(409, 'super_admin_tier', 'This user is a super admin: their Unlimited tier is automatic');
    }
  } else if (op.op === 'approveRequest') {
    const { request } = await videos<{ request: TierRequestRow }>(env, actorId, `/tier-requests/${encodeURIComponent(op.requestId)}`);
    if (request.status !== 'pending') throw new TierOpError(409, TIER_REQUEST_ERRORS.notPending, 'This request was already decided');
  } else if (op.op === 'delete') {
    // Pending invites carry the tier to their account: move or revoke them first (api-videos checks the users and the default)
    const invites = await pendingInvitesForTier(env.REPORTS_DB, op.id);
    if (invites > 0) throw new TierOpError(409, 'tier_has_invites', `${invites} pending invites carry this tier; change or revoke them first`, { invites });
  }
}

/**
 * Runs a change now: checks, audit rows, the api-videos call, notices. `workflowRequest` marks a run
 * after approval: it is safe to repeat (the engine may run it again after a failure or a crash).
 */
export async function runTierOp(env: TierEnv, actorId: string, op: TierOp, workflowRequest?: string): Promise<unknown> {
  const via = workflowRequest ? { workflowRequest } : {};
  switch (op.op) {
    case 'assign': {
      await checkTierOp(env, actorId, op);
      const current = await videos<{ assignment: TierAssignment | null }>(env, actorId, `/users/${encodeURIComponent(op.userId)}/creator-tier`);
      const superAdmin = creatorTierOrigin(current.assignment as CreatorTierAssignment | null) === 'super_admin';
      if (workflowRequest && current.assignment?.tierId === op.tierId && current.assignment?.source === op.source) return current;
      return audited(env, actorId, {
        kind: 'user', id: op.userId, action: 'creator-tier',
        details: { tierId: op.tierId, source: op.source, ...(superAdmin ? { overrodeSuperAdmin: true } : {}), ...via },
        previous: { tierId: current.assignment?.tierId ?? null, source: current.assignment?.source ?? null },
      }, () => videos(env, actorId, `/users/${encodeURIComponent(op.userId)}/creator-tier`, { method: 'PUT', json: { tierId: op.tierId, source: op.source } }));
    }
    case 'bulk':
      return runBulk(env, actorId, op, via);
    case 'approveRequest': {
      const { request } = await videos<{ request: TierRequestRow }>(env, actorId, `/tier-requests/${encodeURIComponent(op.requestId)}`);
      // Approved before a crash: done
      if (workflowRequest && request.status === 'approved') return { request };
      if (request.status !== 'pending') throw new TierOpError(409, TIER_REQUEST_ERRORS.notPending, 'This request was already decided');
      const result = await audited(env, actorId, {
        kind: 'user', id: request.userId, action: 'creator-tier',
        details: { tierId: request.tierId, source: 'admin', tierRequest: op.requestId, ...via },
        // On the default tier the user had no assignment: null, as the tier control audits it
        previous: { tierId: request.currentIsDefault ? null : request.currentTierId, source: null },
      }, () => videos<{ request: TierRequestRow }>(env, actorId, `/tier-requests/${encodeURIComponent(op.requestId)}/decide`, { method: 'POST', json: { decision: 'approve' } }));
      await writeAudit(env.REPORTS_DB, { kind: 'tier-request', id: op.requestId, action: 'approve', actorId, details: { userId: request.userId, tierId: request.tierId, ...via } })
        .catch((e) => logger.warn('[Tiers] Could not write the tier request audit row', { id: op.requestId, error: String(e) }));
      if (result.request.decidedAt) {
        const job = tierRequestMailJob(op.requestId, result.request.decidedAt);
        if (!(await enqueueTierRequestMail(env, job))) await flagTierRequestFailure(env, job, 'could not queue the delivery');
      }
      return result;
    }
    case 'setDefault': {
      const current = await tierList(env, actorId);
      if (workflowRequest && current.defaultTierId === op.tierId) return { defaultTierId: op.tierId };
      return audited(env, actorId, {
        kind: 'creator-tier', id: DEFAULT_TIER_AUDIT_ID, action: 'set-default',
        details: { tierId: op.tierId, ...(op.undo ? { undo: true } : {}), ...via },
        previous: { tierId: current.defaultTierId ?? null },
      }, () => videos(env, actorId, '/creator-tiers/default', { method: 'PUT', json: { tierId: op.tierId } }));
    }
    case 'create': {
      // api-videos makes the id from the name: a run after a crash finds the tier it already made
      if (workflowRequest && typeof op.input.name === 'string') {
        const made = (await tierList(env, actorId)).items.find((t) => t.name === op.input.name);
        if (made) return { tier: made };
      }
      const db = env.REPORTS_DB;
      // The audit row goes in first (no unaudited change) and moves to the new tier's id once it exists
      const auditId = await writeAudit(db, { kind: 'creator-tier', id: 'new', action: 'create', details: { ...op.input, ...via }, actorId });
      try {
        const result = await videos<{ tier: { id: string } }>(env, actorId, '/creator-tiers', { method: 'POST', json: op.input });
        await setAuditSubject(db, auditId, 'creator-tier', result.tier.id);
        logger.info('[Tiers] Action', { kind: 'creator-tier', id: result.tier.id, action: 'create', actorId });
        return result;
      } catch (error) {
        await dropAudit(db, auditId).catch((e) => logger.error('[Tiers] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
        throw error;
      }
    }
    case 'edit': {
      const current = (await tierList(env, actorId)).items.find((t) => t.id === op.id);
      return audited(env, actorId, {
        kind: 'creator-tier', id: op.id, action: 'edit', details: { ...op.input, ...via },
        previous: current ? Object.fromEntries(Object.keys(op.input).map((k) => [k, current[k] ?? null])) : undefined,
      }, () => videos(env, actorId, `/creator-tiers/${encodeURIComponent(op.id)}`, { method: 'PUT', json: op.input }));
    }
    case 'delete': {
      await checkTierOp(env, actorId, op);
      try {
        return await audited(env, actorId, { kind: 'creator-tier', id: op.id, action: 'delete', details: { ...(op.reason ? { reason: op.reason } : {}), ...via } }, () =>
          videos(env, actorId, `/creator-tiers/${encodeURIComponent(op.id)}`, { method: 'DELETE', json: { reason: op.reason } }));
      } catch (error) {
        // Deleted before a crash: done
        if (workflowRequest && error instanceof VideosError && error.status === 404) return { deleted: op.id };
        throw error;
      }
    }
    case 'reorder': {
      const current = await tierList(env, actorId);
      return audited(env, actorId, {
        kind: 'creator-tier', id: TIER_ORDER_AUDIT_ID, action: 'reorder',
        details: { ids: op.ids, ...(op.undo ? { undo: true } : {}), ...via },
        previous: { ids: current.items.map((t) => t.id) },
      }, () => videos(env, actorId, '/creator-tiers/order', { method: 'PUT', json: { ids: op.ids } }));
    }
  }
}

/**
 * One tier for the selected users: plans first (dry run), audits each user who changes, then applies;
 * a failed apply drops the audit rows. Super admins are skipped and users already on the tier are left
 * alone, so running it again is safe.
 */
async function runBulk(env: TierEnv, actorId: string, op: Extract<TierOp, { op: 'bulk' }>, via: Record<string, string>): Promise<CreatorTierBulkResult> {
  const plan = await videos<CreatorTierBulkResult>(env, actorId, '/creators/tier', { method: 'POST', json: { userIds: op.userIds, tierId: op.tierId, dryRun: true } });
  if (!plan.changed.length) return plan;
  const db = env.REPORTS_DB;
  const runId = crypto.randomUUID();
  const auditIds = new Map<string, string>();
  const drop = (ids: string[]) => Promise.all(ids.map((auditId) => dropAudit(db, auditId).catch((e) => logger.error('[Tiers] Could not drop the audit row of a failed action', { auditId, error: String(e) }))));
  try {
    for (const change of plan.changed) {
      auditIds.set(change.userId, await writeAudit(db, {
        kind: 'user', id: change.userId, action: 'creator-tier',
        details: { tierId: op.tierId, source: 'admin', bulk: runId, ...via },
        previous: { tierId: change.previous?.tierId ?? null, source: change.previous?.source ?? null },
        actorId,
      }));
    }
    const result = await videos<CreatorTierBulkResult>(env, actorId, '/creators/tier', { method: 'POST', json: { userIds: plan.changed.map((ch) => ch.userId), tierId: op.tierId } });
    // Someone else changed a user between the plan and the change: no row for a change that did not happen
    const changed = new Set(result.changed.map((ch) => ch.userId));
    await drop([...auditIds].filter(([userId]) => !changed.has(userId)).map(([, auditId]) => auditId));
    logger.info('[Tiers] Action', { kind: 'user', action: 'creator-tier-bulk', tierId: op.tierId, users: result.changed.length, runId, actorId });
    return { ...result, unchanged: [...plan.unchanged, ...result.unchanged], skippedSuperAdmin: [...plan.skippedSuperAdmin, ...result.skippedSuperAdmin] };
  } catch (error) {
    await drop([...auditIds.values()]);
    throw error;
  }
}

/** A short, stable fingerprint (FNV-1a) of what a change was proposed against. */
function fingerprint(value: unknown): string {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(value ?? null)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const TITLES: Record<TierOp['op'], WorkflowLocalized> = {
  assign: { en: 'Change a creator’s tier', ar: 'تغيير مستوى صانع محتوى' },
  bulk: { en: 'Change the tier of several creators', ar: 'تغيير مستوى عدة صنّاع محتوى' },
  approveRequest: { en: 'Approve a tier request', ar: 'الموافقة على طلب مستوى' },
  setDefault: { en: 'Change the default tier', ar: 'تغيير المستوى الافتراضي' },
  create: { en: 'Add a tier', ar: 'إضافة مستوى' },
  edit: { en: 'Edit a tier', ar: 'تعديل مستوى' },
  delete: { en: 'Delete a tier', ar: 'حذف مستوى' },
  reorder: { en: 'Reorder the tiers', ar: 'إعادة ترتيب المستويات' },
};

const TIER_FIELD: WorkflowLocalized = { en: 'Tier', ar: 'المستوى' };
const FIELD_KIND = (v: unknown): WorkflowField['kind'] => (typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'count' : Array.isArray(v) ? 'list' : 'text');

export function tierChangeExecutor(): WorkflowExecutor<TierOp, unknown> {
  const envOf = (ctx: { env?: unknown }) => ctx.env as TierEnv;
  const nameOf = (tiers: TierRow[], id: string | null | undefined) => {
    const t = id ? tiers.find((x) => x.id === id) : undefined;
    return t ? `${t.name ?? t.id}` : (id ?? null);
  };
  const versionOf = async (env: TierEnv, actorId: string, op: TierOp): Promise<string> => {
    switch (op.op) {
      case 'assign':
        return fingerprint((await videos<{ assignment: TierAssignment | null }>(env, actorId, `/users/${encodeURIComponent(op.userId)}/creator-tier`)).assignment);
      case 'approveRequest':
        return fingerprint((await videos<{ request: TierRequestRow }>(env, actorId, `/tier-requests/${encodeURIComponent(op.requestId)}`)).request.status);
      // Many users, planned again when it runs (users already moved are left alone): never stale
      case 'bulk':
        return 'bulk';
      default: {
        const list = await tierList(env, actorId);
        return fingerprint({ items: list.items, defaultTierId: list.defaultTierId ?? null });
      }
    }
  };
  return {
    type: 'tiers.change',
    scope: tierScope,
    target: (op) => {
      if (op.op === 'assign') return { kind: 'user', id: op.userId };
      if (op.op === 'approveRequest') return { kind: 'tier-request', id: op.requestId };
      if (op.op === 'bulk') return { kind: 'tier-bulk', id: `${op.tierId}:${fingerprint([...op.userIds].sort())}` };
      if (op.op === 'edit' || op.op === 'delete') return { kind: 'creator-tier', id: op.id };
      if (op.op === 'create') return { kind: 'creator-tier', id: `new:${str(op.input.name) || fingerprint(op.input)}` };
      return { kind: 'creator-tiers', id: op.op };
    },
    canPropose: async (_ctx, actor) => hasContentPermission(actor.roles, 'creators:manage'),
    // A refusal (TierOpError) passes through as is: the content router answers it like a direct change
    async validate(ctx, input) {
      const op = readTierOp(input);
      // The same refusals as a direct change, before anyone is asked to approve
      await checkTierOp(envOf(ctx), 'workflow', op);
      return op;
    },
    async describe(ctx, op) {
      const env = envOf(ctx);
      const fields: WorkflowField[] = [];
      let subjectUserId: string | null = null;
      {
        const tiers = (await tierList(env, 'workflow')).items;
        if (op.op === 'assign') {
          const current = await videos<{ assignment: TierAssignment | null }>(env, 'workflow', `/users/${encodeURIComponent(op.userId)}/creator-tier`);
          subjectUserId = op.userId;
          fields.push({ key: 'user', label: { en: 'Creator', ar: 'صانع المحتوى' }, kind: 'person', before: op.userId, after: op.userId });
          fields.push({ key: 'tier', label: TIER_FIELD, kind: 'text', before: nameOf(tiers, current.assignment?.tierId), after: nameOf(tiers, op.tierId) });
        } else if (op.op === 'bulk') {
          fields.push({ key: 'users', label: { en: 'Creators', ar: 'صنّاع المحتوى' }, kind: 'count', before: null, after: op.userIds.length });
          fields.push({ key: 'tier', label: TIER_FIELD, kind: 'text', before: null, after: nameOf(tiers, op.tierId) });
        } else if (op.op === 'approveRequest') {
          const { request } = await videos<{ request: TierRequestRow }>(env, 'workflow', `/tier-requests/${encodeURIComponent(op.requestId)}`);
          subjectUserId = request.userId;
          fields.push({ key: 'user', label: { en: 'Creator', ar: 'صانع المحتوى' }, kind: 'person', before: request.userId, after: request.userId });
          fields.push({ key: 'tier', label: TIER_FIELD, kind: 'text', before: nameOf(tiers, request.currentTierId), after: nameOf(tiers, request.tierId) });
        } else if (op.op === 'setDefault') {
          const current = await tierList(env, 'workflow');
          fields.push({ key: 'default', label: { en: 'Default tier', ar: 'المستوى الافتراضي' }, kind: 'text', before: nameOf(tiers, current.defaultTierId), after: op.tierId === 'none' ? null : nameOf(tiers, op.tierId) });
        } else if (op.op === 'reorder') {
          fields.push({ key: 'order', label: { en: 'Order, lowest first', ar: 'الترتيب، من الأدنى' }, kind: 'list', before: tiers.map((t) => nameOf(tiers, t.id)), after: op.ids.map((id) => nameOf(tiers, id)) });
        } else if (op.op === 'edit') {
          const current = tiers.find((t) => t.id === op.id);
          fields.push({ key: 'tier', label: TIER_FIELD, kind: 'text', before: nameOf(tiers, op.id), after: nameOf(tiers, op.id) });
          for (const [k, v] of Object.entries(op.input)) fields.push({ key: k, label: { en: k, ar: k }, kind: FIELD_KIND(v), before: current?.[k] ?? null, after: v });
        } else if (op.op === 'delete') {
          fields.push({ key: 'tier', label: TIER_FIELD, kind: 'text', before: nameOf(tiers, op.id), after: null });
        } else {
          for (const [k, v] of Object.entries(op.input)) fields.push({ key: k, label: { en: k, ar: k }, kind: FIELD_KIND(v), before: null, after: v });
        }
      }
      return { title: TITLES[op.op], fields, baseVersion: await versionOf(env, 'workflow', op), subjectUserId };
    },
    currentVersion: (ctx, op) => versionOf(envOf(ctx), 'workflow', op),
    async applyJob(ctx, op, request) {
      try {
        return await runTierOp(envOf(ctx), request.proposedBy, op, request.id);
      } catch (error) {
        // A check that no longer holds fails the apply with its reason (Retry once it holds again)
        if (error instanceof TierOpError) throw new Error(`${error.code}: ${error.message}`);
        throw error;
      }
    },
  };
}

export function registerTierExecutor(): void {
  registerWorkflowExecutor(tierChangeExecutor());
}
