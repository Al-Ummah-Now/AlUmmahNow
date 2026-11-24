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
import type { WorkflowExecutor, WorkflowStoredRequest } from './types';

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
type TierRequestRow = { id: string; userId: string; tierId: string; status: string; currentTierId: string; currentIsDefault?: boolean; decidedAt: string | null; decidedBy?: string | null };
type TierRow = Record<string, unknown> & { id: string; name?: string; nameAr?: string | null; updatedAt?: string | null; updatedBy?: string | null };

/**
 * The approved change request a run belongs to. `retry`: an earlier attempt failed, so it may already have
 * made the change, or written its audit rows, without the request learning it.
 */
export interface TierRun {
  requestId: string;
  proposedAt: string;
  retry: boolean;
}

const videos = <T>(env: TierEnv, actorId: string, path: string, call: VideosCall = {}) => callVideos<T>(env, path, { actorId, ...call });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** One audit row id per approved request (and part of it), so a retry never writes a second row. */
const auditIdOf = (run: TierRun, part = '') => `wf:${run.requestId}${part ? `:${part}` : ''}`;

/** Writes the audit row, unless an earlier attempt of the same request already did (read by primary key). */
async function auditOnce(env: TierEnv, entry: AuditAction, id: string): Promise<void> {
  const db = env.REPORTS_DB;
  const { results } = await db.prepare('SELECT id FROM site_settings_log WHERE id = ?').bind(id).all<{ id: string }>();
  if (!results?.length) await writeAudit(db, entry, undefined, id);
}

/** An answer that was lost or broke off (not a refusal): the change may have been made all the same. */
const answerLost = (error: unknown) => !(error instanceof VideosError && error.status < 500);

/**
 * Audits then performs a change; the row is dropped again when the change fails (content.router's rule).
 * `recover` (runs after approval): when the answer was lost, what the change made after all, so its row stays.
 */
async function audited<T>(env: TierEnv, entry: AuditAction, call: () => Promise<T>, run?: TierRun, recover?: () => Promise<{ result: unknown } | null>): Promise<{ result: T; auditId: string }> {
  const db = env.REPORTS_DB;
  const auditId = run ? auditIdOf(run) : crypto.randomUUID();
  if (run) await auditOnce(env, entry, auditId);
  else await writeAudit(db, entry, undefined, auditId);
  try {
    const result = await call();
    logger.info('[Tiers] Action', { kind: entry.kind, id: entry.id, action: entry.action, actorId: entry.actorId });
    return { result, auditId };
  } catch (error) {
    const made = run && recover && answerLost(error) ? await recover().catch(() => null) : null;
    if (made) {
      logger.warn('[Tiers] The answer was lost but the change was made', { kind: entry.kind, id: entry.id, action: entry.action, error: String(error) });
      return { result: made.result as T, auditId };
    }
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
    // `reason` is the change request's, never a tier field (api-videos refuses fields it doesn't know)
    case 'create': {
      const { id: _id, reason: _reason, ...input } = (i.input ?? {}) as Record<string, unknown>;
      return { op: 'create', input };
    }
    case 'edit': {
      const id = str(i.id);
      if (!id) throw new TierOpError(400, 'invalid_request', 'id is required');
      const { reason: _reason, ...input } = (i.input ?? {}) as Record<string, unknown>;
      return { op: 'edit', id, input };
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

const readAssignment = async (env: TierEnv, actorId: string, userId: string) =>
  (await videos<{ assignment: TierAssignment | null }>(env, actorId, `/users/${encodeURIComponent(userId)}/creator-tier`)).assignment;
const readTierRequest = async (env: TierEnv, actorId: string, id: string) =>
  (await videos<{ request: TierRequestRow }>(env, actorId, `/tier-requests/${encodeURIComponent(id)}`)).request;
const isSuperAdminTier = (a: TierAssignment | null) => creatorTierOrigin(a as CreatorTierAssignment | null) === 'super_admin';

function needAssignable(actorId: string, op: Extract<TierOp, { op: 'assign' }>, current: TierAssignment | null): void {
  // A super admin's automatic Unlimited is never changed by mistake: the admin confirms it explicitly
  if (isSuperAdminTier(current) && !op.confirmSuperAdmin) {
    logger.warn('[Tiers] Refused a change to a super admin tier', { userId: op.userId, actorId });
    throw new TierOpError(409, 'super_admin_tier', 'This user is a super admin: their Unlimited tier is automatic');
  }
}

function needUndecided(request: TierRequestRow): void {
  if (request.status !== 'pending') throw new TierOpError(409, TIER_REQUEST_ERRORS.notPending, 'This request was already decided');
}

async function needNoInvites(env: TierEnv, tierId: string): Promise<void> {
  // Pending invites carry the tier to their account: move or revoke them first (api-videos checks the users and the default)
  const invites = await pendingInvitesForTier(env.REPORTS_DB, tierId);
  if (invites > 0) throw new TierOpError(409, 'tier_has_invites', `${invites} pending invites carry this tier; change or revoke them first`, { invites });
}

/** The checks a change must pass before it is proposed (they run again when it runs). */
export async function checkTierOp(env: TierEnv, actorId: string, op: TierOp): Promise<void> {
  if (op.op === 'assign') needAssignable(actorId, op, await readAssignment(env, actorId, op.userId));
  else if (op.op === 'approveRequest') needUndecided(await readTierRequest(env, actorId, op.requestId));
  else if (op.op === 'delete') await needNoInvites(env, op.id);
}

/**
 * Whether an earlier attempt of this approved request already made the change. Every answer but `default`
 * and `order` (a value and a list, which are theirs or the same thing) also names the proposer, so a change
 * someone else made is never taken for this one. Bulk is planned again instead.
 */
export async function tierOpDone(env: TierEnv, actorId: string, op: TierOp, run: TierRun): Promise<{ result: unknown } | null> {
  switch (op.op) {
    case 'assign': {
      const a = await readAssignment(env, actorId, op.userId);
      return a?.tierId === op.tierId && a.source === op.source && a.assignedBy === actorId && str(a.assignedAt) >= run.proposedAt ? { result: { assignment: a } } : null;
    }
    case 'approveRequest': {
      const request = await readTierRequest(env, actorId, op.requestId);
      return request.status === 'approved' && request.decidedBy === actorId ? { result: { request } } : null;
    }
    case 'setDefault':
      return (await tierList(env, actorId)).defaultTierId === op.tierId ? { result: { defaultTierId: op.tierId } } : null;
    case 'create': {
      // api-videos makes the id, so it is found by what it stored: the trimmed name, the proposer's stamp, since the request
      const name = str(op.input.name);
      const tier = (await tierList(env, actorId)).items.find((t) => t.name === name && t.updatedBy === actorId && str(t.updatedAt) >= run.proposedAt);
      return tier ? { result: { tier } } : null;
    }
    case 'edit': {
      const tier = (await tierList(env, actorId)).items.find((t) => t.id === op.id);
      return tier && tier.updatedBy === actorId && str(tier.updatedAt) >= run.proposedAt ? { result: { tier } } : null;
    }
    case 'delete': {
      const { items } = await videos<{ items: { id: string; deletedAt: string; deletedBy: string | null }[] }>(env, actorId, '/creator-tiers/deleted');
      return items.some((t) => t.id === op.id && t.deletedBy === actorId && t.deletedAt >= run.proposedAt) ? { result: { deleted: op.id } } : null;
    }
    case 'reorder': {
      const order = (await tierList(env, actorId)).items.map((t) => t.id);
      return JSON.stringify(order) === JSON.stringify(op.ids) ? { result: { order } } : null;
    }
    default:
      return null;
  }
}

/** A tier request's decision: its own audit row, and the notice and email job (both safe to repeat). */
async function afterRequestApproved(env: TierEnv, actorId: string, op: Extract<TierOp, { op: 'approveRequest' }>, request: TierRequestRow, run?: TierRun): Promise<void> {
  const entry: AuditAction = {
    kind: 'tier-request', id: op.requestId, action: 'approve', actorId,
    details: { userId: request.userId, tierId: request.tierId, ...(run ? { workflowRequest: run.requestId } : {}) },
  };
  if (run) await auditOnce(env, entry, auditIdOf(run, 'decision'));
  else await writeAudit(env.REPORTS_DB, entry).catch((e) => logger.warn('[Tiers] Could not write the tier request audit row', { id: op.requestId, error: String(e) }));
  if (request.decidedAt) {
    const job = tierRequestMailJob(op.requestId, request.decidedAt);
    if (!(await enqueueTierRequestMail(env, job))) await flagTierRequestFailure(env, job, 'could not queue the delivery');
  }
}

/**
 * Runs a change now: checks, audit rows, the api-videos call, notices. `run` marks a run after approval,
 * which is safe to repeat: a change an earlier attempt made is not made again, and whatever that attempt
 * had left to do (its audit row, the notices) is finished.
 */
export async function runTierOp(env: TierEnv, actorId: string, op: TierOp, run?: TierRun): Promise<unknown> {
  const via = run ? { workflowRequest: run.requestId } : {};
  const done = run?.retry ? await tierOpDone(env, actorId, op, run) : null;
  const change = async <T>(entry: Omit<AuditAction, 'actorId'>, call: () => Promise<T>): Promise<{ result: T; auditId: string }> => {
    if (!run || !done) return audited(env, { ...entry, actorId }, call, run, run && (() => tierOpDone(env, actorId, op, run)));
    // Made by the earlier attempt: only its audit row may be missing (what was there before is not known any more)
    const auditId = auditIdOf(run);
    await auditOnce(env, { ...entry, actorId, previous: undefined }, auditId);
    return { result: done.result as T, auditId };
  };
  switch (op.op) {
    case 'assign': {
      const current = await readAssignment(env, actorId, op.userId);
      if (!done) needAssignable(actorId, op, current);
      return (await change({
        kind: 'user', id: op.userId, action: 'creator-tier',
        details: { tierId: op.tierId, source: op.source, ...(!done && isSuperAdminTier(current) ? { overrodeSuperAdmin: true } : {}), ...via },
        previous: { tierId: current?.tierId ?? null, source: current?.source ?? null },
      }, () => videos(env, actorId, `/users/${encodeURIComponent(op.userId)}/creator-tier`, { method: 'PUT', json: { tierId: op.tierId, source: op.source } }))).result;
    }
    case 'bulk':
      return runBulk(env, actorId, op, run);
    case 'approveRequest': {
      const request = await readTierRequest(env, actorId, op.requestId);
      if (!done) needUndecided(request);
      const { result } = await change({
        kind: 'user', id: request.userId, action: 'creator-tier',
        details: { tierId: request.tierId, source: 'admin', tierRequest: op.requestId, ...via },
        // On the default tier the user had no assignment: null, as the tier control audits it
        previous: { tierId: request.currentIsDefault ? null : request.currentTierId, source: null },
      }, () => videos<{ request: TierRequestRow }>(env, actorId, `/tier-requests/${encodeURIComponent(op.requestId)}/decide`, { method: 'POST', json: { decision: 'approve' } }));
      await afterRequestApproved(env, actorId, op, result.request, run);
      return result;
    }
    case 'setDefault': {
      const current = await tierList(env, actorId);
      return (await change({
        kind: 'creator-tier', id: DEFAULT_TIER_AUDIT_ID, action: 'set-default',
        details: { tierId: op.tierId, ...(op.undo ? { undo: true } : {}), ...via },
        previous: { tierId: current.defaultTierId ?? null },
      }, () => videos(env, actorId, '/creator-tiers/default', { method: 'PUT', json: { tierId: op.tierId } }))).result;
    }
    case 'create': {
      // The audit row goes in first (no unaudited change) and moves to the new tier's id once it exists
      const { result, auditId } = await change({ kind: 'creator-tier', id: 'new', action: 'create', details: { ...op.input, ...via } }, () =>
        videos<{ tier: { id: string } }>(env, actorId, '/creator-tiers', { method: 'POST', json: op.input }));
      await setAuditSubject(env.REPORTS_DB, auditId, 'creator-tier', result.tier.id);
      return result;
    }
    case 'edit': {
      const current = (await tierList(env, actorId)).items.find((t) => t.id === op.id);
      return (await change({
        kind: 'creator-tier', id: op.id, action: 'edit', details: { ...op.input, ...via },
        previous: current ? Object.fromEntries(Object.keys(op.input).map((k) => [k, current[k] ?? null])) : undefined,
      }, () => videos(env, actorId, `/creator-tiers/${encodeURIComponent(op.id)}`, { method: 'PUT', json: op.input }))).result;
    }
    case 'delete': {
      if (!done) await needNoInvites(env, op.id);
      return (await change({ kind: 'creator-tier', id: op.id, action: 'delete', details: { ...(op.reason ? { reason: op.reason } : {}), ...via } }, () =>
        videos(env, actorId, `/creator-tiers/${encodeURIComponent(op.id)}`, { method: 'DELETE', json: { reason: op.reason } }))).result;
    }
    case 'reorder': {
      const current = await tierList(env, actorId);
      return (await change({
        kind: 'creator-tier', id: TIER_ORDER_AUDIT_ID, action: 'reorder',
        details: { ids: op.ids, ...(op.undo ? { undo: true } : {}), ...via },
        previous: { ids: current.items.map((t) => t.id) },
      }, () => videos(env, actorId, '/creator-tiers/order', { method: 'PUT', json: { ids: op.ids } }))).result;
    }
  }
}

/** Who a bulk change would move right now, and who it leaves alone (a dry run). */
export const planBulk = (env: TierEnv, actorId: string, op: Extract<TierOp, { op: 'bulk' }>) =>
  videos<CreatorTierBulkResult>(env, actorId, '/creators/tier', { method: 'POST', json: { userIds: op.userIds, tierId: op.tierId, dryRun: true } });

/**
 * One tier for the selected users: plans first (dry run), audits each user who changes, then applies; a
 * failed apply drops the audit rows of the users it did not move. Super admins are skipped and users
 * already on the tier are left alone, so running it again is safe.
 */
async function runBulk(env: TierEnv, actorId: string, op: Extract<TierOp, { op: 'bulk' }>, run?: TierRun): Promise<CreatorTierBulkResult> {
  const plan = await planBulk(env, actorId, op);
  if (!plan.changed.length) return plan;
  const db = env.REPORTS_DB;
  const runId = run?.requestId ?? crypto.randomUUID();
  const auditIds = new Map<string, string>();
  const drop = (ids: string[]) => Promise.all(ids.map((auditId) => dropAudit(db, auditId).catch((e) => logger.error('[Tiers] Could not drop the audit row of a failed action', { auditId, error: String(e) }))));
  try {
    for (const change of plan.changed) {
      const entry: AuditAction = {
        kind: 'user', id: change.userId, action: 'creator-tier',
        details: { tierId: op.tierId, source: 'admin', bulk: runId, ...(run ? { workflowRequest: run.requestId } : {}) },
        previous: { tierId: change.previous?.tierId ?? null, source: change.previous?.source ?? null },
        actorId,
      };
      const auditId = run ? auditIdOf(run, change.userId) : crypto.randomUUID();
      auditIds.set(change.userId, auditId);
      if (run) await auditOnce(env, entry, auditId);
      else await writeAudit(db, entry, undefined, auditId);
    }
    const result = await videos<CreatorTierBulkResult>(env, actorId, '/creators/tier', { method: 'POST', json: { userIds: plan.changed.map((ch) => ch.userId), tierId: op.tierId } });
    // Someone else changed a user between the plan and the change: no row for a change that did not happen
    const changed = new Set(result.changed.map((ch) => ch.userId));
    await drop([...auditIds].filter(([userId]) => !changed.has(userId)).map(([, auditId]) => auditId));
    logger.info('[Tiers] Action', { kind: 'user', action: 'creator-tier-bulk', tierId: op.tierId, users: result.changed.length, runId, actorId });
    return { ...result, unchanged: [...plan.unchanged, ...result.unchanged], skippedSuperAdmin: [...plan.skippedSuperAdmin, ...result.skippedSuperAdmin] };
  } catch (error) {
    // A lost answer (not a refusal) may have moved people. After approval the request is retried and can no
    // longer see them in its plan, so their rows stay; if that can't be read, every row stays for the retry
    const unmoved = run && answerLost(error) ? await planBulk(env, actorId, op).then((p) => new Set(p.changed.map((ch) => ch.userId)), () => new Set<string>()) : null;
    await drop([...auditIds].filter(([userId]) => !unmoved || unmoved.has(userId)).map(([, auditId]) => auditId));
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

const TIER_FIELD: WorkflowLocalized = { en: 'Tier', ar: 'الفئة' };
const PERSON_FIELD: WorkflowLocalized = { en: 'Creator', ar: 'صانع المحتوى' };

/** The tier fields' names in a diff, as the Tiers page shows them (admin-web `creators.tier*`). */
const FIELD_LABELS: Record<string, WorkflowLocalized> = {
  name: { en: 'Name', ar: 'الاسم' },
  nameAr: { en: 'Arabic name', ar: 'الاسم بالعربية' },
  description: { en: 'Description', ar: 'الوصف' },
  descriptionAr: { en: 'Arabic description', ar: 'الوصف بالعربية' },
  unlimited: { en: 'Unlimited (no limits at all)', ar: 'بلا حدود إطلاقًا' },
  uploads: { en: 'Upload videos', ar: 'رفع المرئيات' },
  channels: { en: 'Create channels', ar: 'إنشاء القنوات' },
  pages: { en: 'Can have pages', ar: 'يمكنه إنشاء الصفحات' },
  requestable: { en: 'Can be requested', ar: 'يمكن طلبها' },
  hidden: { en: 'Hidden', ar: 'مخفية' },
  sortOrder: { en: 'Rank', ar: 'الترتيب' },
  perHour: { en: 'Uploads per hour', ar: 'عمليات الرفع في الساعة' },
  perDay: { en: 'Uploads per day', ar: 'عمليات الرفع في اليوم' },
  maxConcurrent: { en: 'Uploads starting at once', ar: 'عمليات الرفع التي تبدأ معًا' },
  maxChannels: { en: 'Channels they may own', ar: 'القنوات التي يمكنه امتلاكها' },
  captionMinutesMonth: { en: 'Caption minutes per month', ar: 'دقائق الترجمة في الشهر' },
  importCountsAgainstLimits: { en: 'YouTube imports count against upload limits', ar: 'تُحتسب المرئيات المنقولة من يوتيوب ضمن حدود الرفع' },
  audioTracksPerVideo: { en: 'Audio tracks per video', ar: 'المسارات الصوتية لكل مرئي' },
  recitationMetadata: { en: 'Recitation details', ar: 'تفاصيل التلاوة' },
  notesMax: { en: 'Notes they may keep', ar: 'الملاحظات التي يمكنه حفظها' },
  supportReceive: { en: 'Can receive creator support', ar: 'يمكنه تلقّي دعم صنّاع المحتوى' },
  live: { en: 'Live streaming', ar: 'البث المباشر' },
  liveHoursMonth: { en: 'Live hours per month', ar: 'ساعات البث في الشهر' },
  liveMaxConcurrent: { en: 'Streams live at once', ar: 'البثوث المتزامنة' },
  liveMaxStreamMinutes: { en: 'Longest stream (minutes)', ar: 'أطول بث (بالدقائق)' },
  liveChat: { en: 'Live chat', ar: 'محادثة البث المباشر' },
  livePremieres: { en: 'Premieres', ar: 'العروض الأولى' },
  liveEvents: { en: 'Event tags', ar: 'وسوم المناسبات' },
};
export const TIER_DIFF_FIELDS: readonly string[] = Object.keys(FIELD_LABELS);

const valueKind = (v: unknown): WorkflowField['kind'] => (typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'count' : 'text');

/** Tier ids as people read them: a diff value with each tier's name in both languages. */
function tierNames(tiers: readonly TierRow[]): Record<string, WorkflowLocalized> {
  return Object.fromEntries(tiers.map((t) => [t.id, { en: t.name || t.id, ar: t.nameAr || t.name || t.id }]));
}

export function tierChangeExecutor(): WorkflowExecutor<TierOp, unknown> {
  const envOf = (ctx: { env?: unknown }) => ctx.env as TierEnv;
  const tierVersion = (list: { items: TierRow[]; defaultTierId?: string }) => fingerprint({ items: list.items, defaultTierId: list.defaultTierId ?? null });
  const runOf = (request: WorkflowStoredRequest): TierRun => ({ requestId: request.id, proposedAt: request.proposedAt, retry: request.failedAttempts > 0 });
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
      const list = await tierList(env, 'workflow');
      const names = tierNames(list.items);
      const named = (id: string): WorkflowLocalized => names[id] ?? { en: id, ar: id };
      const tierField = (before: string | null | undefined, after: string | null, key = 'tier', label = TIER_FIELD): WorkflowField => ({ key, label, kind: 'enum', before: before ?? null, after, enumLabels: names });
      const person = (userId: string): WorkflowField => ({ key: 'user', label: PERSON_FIELD, kind: 'person', before: userId, after: userId });
      switch (op.op) {
        case 'assign': {
          const current = await readAssignment(env, 'workflow', op.userId);
          return {
            title: { en: `Move a creator to the ${named(op.tierId).en} tier`, ar: `نقل صانع محتوى إلى فئة ${named(op.tierId).ar}` },
            fields: [person(op.userId), tierField(current?.tierId, op.tierId)],
            baseVersion: fingerprint(current),
            subjectUserId: op.userId,
          };
        }
        case 'approveRequest': {
          const request = await readTierRequest(env, 'workflow', op.requestId);
          return {
            title: { en: `Approve a request for the ${named(request.tierId).en} tier`, ar: `الموافقة على طلب فئة ${named(request.tierId).ar}` },
            fields: [person(request.userId), tierField(request.currentTierId, request.tierId)],
            baseVersion: fingerprint(request.status),
            subjectUserId: request.userId,
          };
        }
        case 'bulk': {
          // Everyone who would move, under the tier they hold now; the ones left alone are not part of the change
          const plan = await planBulk(env, 'workflow', op);
          const held = new Map<string | null, string[]>();
          for (const ch of plan.changed) held.set(ch.previous?.tierId ?? null, [...(held.get(ch.previous?.tierId ?? null) ?? []), ch.userId]);
          const people = [...held].map(([from, ids]): WorkflowField => ({
            key: `users:${from ?? ''}`,
            label: from ? { en: `Creators now on ${named(from).en}`, ar: `صنّاع المحتوى في فئة ${named(from).ar}` } : { en: 'Creators with no tier set', ar: 'صنّاع المحتوى بلا فئة محددة' },
            kind: 'person',
            before: null,
            after: ids,
          }));
          return {
            title: { en: `Move several creators to the ${named(op.tierId).en} tier`, ar: `نقل عدة صنّاع محتوى إلى فئة ${named(op.tierId).ar}` },
            fields: [{ key: 'count', label: { en: 'How many', ar: 'العدد' }, kind: 'count', before: null, after: plan.changed.length }, tierField(null, op.tierId), ...people],
            // Planned again when it runs (users already moved are left alone): never stale
            baseVersion: 'bulk',
            subjectUserId: op.userIds.length === 1 ? op.userIds[0] : null,
          };
        }
        case 'setDefault':
          return {
            title: { en: `Make ${named(op.tierId).en} the default tier`, ar: `جعل ${named(op.tierId).ar} الفئة الافتراضية` },
            fields: [tierField(list.defaultTierId, op.tierId === 'none' ? null : op.tierId, 'default', { en: 'Default tier', ar: 'الفئة الافتراضية' })],
            baseVersion: tierVersion(list),
          };
        case 'reorder':
          return {
            title: { en: 'Reorder the tiers', ar: 'إعادة ترتيب الفئات' },
            fields: [{ key: 'order', label: { en: 'Order, lowest first', ar: 'الترتيب، من الأدنى' }, kind: 'list', before: list.items.map((t) => t.id), after: op.ids, enumLabels: names }],
            baseVersion: tierVersion(list),
          };
        case 'delete':
          return {
            title: { en: `Delete the ${named(op.id).en} tier`, ar: `حذف فئة ${named(op.id).ar}` },
            fields: [tierField(op.id, null)],
            baseVersion: tierVersion(list),
          };
        default: {
          const current = op.op === 'edit' ? list.items.find((t) => t.id === op.id) : undefined;
          const added = str(op.input.name) || str(op.input.nameAr);
          return {
            title: op.op === 'edit'
              ? { en: `Edit the ${named(op.id).en} tier`, ar: `تعديل فئة ${named(op.id).ar}` }
              : { en: `Add the ${added} tier`, ar: `إضافة فئة ${str(op.input.nameAr) || added}` },
            fields: Object.entries(op.input).map(([key, after]) => ({ key, label: FIELD_LABELS[key] ?? { en: key, ar: key }, kind: valueKind(after ?? current?.[key]), before: current?.[key] ?? null, after })),
            baseVersion: tierVersion(list),
          };
        }
      }
    },
    async currentVersion(ctx, op) {
      const env = envOf(ctx);
      if (op.op === 'assign') return fingerprint(await readAssignment(env, 'workflow', op.userId));
      if (op.op === 'approveRequest') return fingerprint((await readTierRequest(env, 'workflow', op.requestId)).status);
      return op.op === 'bulk' ? 'bulk' : tierVersion(await tierList(env, 'workflow'));
    },
    // The person a change is about never approves it (§4.3); `subjectUserId` holds one person, a bulk change has many
    approverBlocks: async (_ctx, op, actorId) => (op.op === 'bulk' && op.userIds.includes(actorId) ? ['subject'] : []),
    alreadyApplied: async (ctx, op, request) => (await tierOpDone(envOf(ctx), request.proposedBy, op, runOf(request))) !== null,
    async applyJob(ctx, op, request) {
      try {
        return await runTierOp(envOf(ctx), request.proposedBy, op, runOf(request));
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
