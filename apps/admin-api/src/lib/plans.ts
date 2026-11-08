/**
 * Plan administration (Epic 27). Plan values are versioned: an active plan's
 * edits go to the next version and take effect on publish, so subscribers stay
 * pinned to the version they were assigned until migrated. Every write records
 * an audit row in the same D1 batch and invalidates the entitlements cache.
 */
import { validateEntitlementValue, type EntitlementValue } from '@al-ummah/shared-types';
import { logger } from './logger';

/** Must match apps/api-videos/src/lib/entitlements.ts (asserted in tests). */
export const DEFAULT_PLAN_CACHE_KEY = 'entitlements:v1:default';
export const subjectCacheKey = (type: string, id: string) => `entitlements:v1:${type}:${id}`;

export interface PlansEnv {
  REPORTS_DB: any;
  RATE_LIMIT_KV?: any;
}
export interface Actor {
  id: string;
  now: string;
  newId: () => string;
}
export type Outcome<T = unknown> = { ok: true; result: T } | { ok: false; status: 400 | 404 | 409; error: string };

export type SubjectType = 'channel' | 'user';
export interface SubjectRef {
  type: SubjectType;
  id: string;
}

const fail = (status: 400 | 404 | 409, error: string): Outcome<never> => ({ ok: false, status, error });

export function parseSubject(raw: string): SubjectRef | null {
  const at = raw.indexOf(':');
  const type = raw.slice(0, at);
  const id = raw.slice(at + 1).trim();
  return at > 0 && id && (type === 'channel' || type === 'user') ? { type, id } : null;
}

async function invalidate(env: PlansEnv, keys: string[]): Promise<void> {
  if (!env.RATE_LIMIT_KV) return;
  await Promise.all(
    keys.map(async (key) => {
      try {
        await env.RATE_LIMIT_KV.delete(key);
      } catch (error) {
        // The 60 s TTL still applies, so a failed delete only delays the change
        logger.warn('[Plans] Cache invalidation failed', { key, error: error instanceof Error ? error.message : String(error) });
      }
    }),
  );
}

function auditStatement(env: PlansEnv, actor: Actor, action: string, entityType: string, entityId: string, before: unknown, after: unknown, reason?: string | null) {
  return env.REPORTS_DB.prepare(
    'INSERT INTO plan_audit_log (id, actor_id, action, entity_type, entity_id, before_json, after_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(actor.newId(), actor.id, action, entityType, entityId, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after), reason ?? null, actor.now);
}

const getRow = (env: PlansEnv, id: string): Promise<any> => env.REPORTS_DB.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();

async function values(env: PlansEnv, planId: string, version: number): Promise<Record<string, EntitlementValue>> {
  const { results } = await env.REPORTS_DB.prepare('SELECT key, value_json FROM plan_entitlements WHERE plan_id = ? AND plan_version = ?').bind(planId, version).all();
  return Object.fromEntries(results.map((r: any) => [r.key, JSON.parse(r.value_json)]));
}

/** The version edits go to: a draft edits in place, an active plan edits the next version. */
const editableVersion = (plan: any): number => (plan.status === 'draft' ? plan.version : plan.version + 1);

export function validateValues(input: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(input)) {
    const problem = validateEntitlementValue(key, value);
    if (problem) return problem;
  }
  return null;
}

export interface DiffEntry {
  key: string;
  before: EntitlementValue | null;
  after: EntitlementValue | null;
}

export function diffValues(a: Record<string, EntitlementValue>, b: Record<string, EntitlementValue>): DiffEntry[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .map((key) => ({ key, before: a[key] ?? null, after: b[key] ?? null }));
}

export async function listPlans(env: PlansEnv): Promise<Outcome> {
  const { results } = await env.REPORTS_DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status IN ('trialing','active','past_due')) AS subscribers
       FROM plans p ORDER BY p.sort_order, p.created_at`,
  ).all();
  return { ok: true, result: { plans: results } };
}

export async function getPlan(env: PlansEnv, id: string): Promise<Outcome> {
  const plan = await getRow(env, id);
  if (!plan) return fail(404, 'Plan not found');
  const editable = editableVersion(plan);
  const published = plan.status === 'draft' ? {} : await values(env, id, plan.version);
  const draft = await values(env, id, editable);
  return { ok: true, result: { plan, published, draft, editableVersion: editable, hasDraft: Object.keys(draft).length > 0, diff: plan.status === 'draft' ? [] : diffValues(published, Object.keys(draft).length ? draft : published) } };
}

export interface PlanInput {
  slug?: string;
  name_en?: string;
  name_ar?: string;
  description_en?: string | null;
  description_ar?: string | null;
  audience?: string;
  is_public?: boolean;
  sort_order?: number;
}

export async function createPlan(env: PlansEnv, actor: Actor, input: Required<Pick<PlanInput, 'slug' | 'name_en' | 'name_ar' | 'audience'>> & PlanInput, cloneFrom?: string): Promise<Outcome> {
  if (!/^[a-z0-9-]{2,40}$/.test(input.slug)) return fail(400, 'Slug must be 2-40 lowercase letters, digits or hyphens');
  if (await env.REPORTS_DB.prepare('SELECT 1 AS x FROM plans WHERE slug = ?').bind(input.slug).first()) return fail(409, 'A plan with this slug already exists');
  let copied: Record<string, EntitlementValue> = {};
  if (cloneFrom) {
    const source = await getRow(env, cloneFrom);
    if (!source) return fail(404, 'Plan to clone not found');
    copied = await values(env, cloneFrom, source.version);
  }
  const id = `plan_${actor.newId()}`;
  await env.REPORTS_DB.batch([
    env.REPORTS_DB.prepare(
      `INSERT INTO plans (id, slug, name_en, name_ar, description_en, description_ar, audience, status, is_public, is_default, sort_order, version, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, 0, ?, 1, ?, ?, ?)`,
    ).bind(id, input.slug, input.name_en, input.name_ar, input.description_en ?? null, input.description_ar ?? null, input.audience, input.is_public ? 1 : 0, input.sort_order ?? 0, actor.id, actor.now, actor.now),
    ...Object.entries(copied).map(([key, value]) => env.REPORTS_DB.prepare('INSERT INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES (?, 1, ?, ?)').bind(id, key, JSON.stringify(value))),
    auditStatement(env, actor, cloneFrom ? 'plan.clone' : 'plan.create', 'plan', id, undefined, { ...input, cloneFrom }),
  ]);
  return getPlan(env, id);
}

export async function updatePlan(env: PlansEnv, actor: Actor, id: string, input: PlanInput): Promise<Outcome> {
  const plan = await getRow(env, id);
  if (!plan) return fail(404, 'Plan not found');
  const next = {
    name_en: input.name_en ?? plan.name_en,
    name_ar: input.name_ar ?? plan.name_ar,
    description_en: input.description_en === undefined ? plan.description_en : input.description_en,
    description_ar: input.description_ar === undefined ? plan.description_ar : input.description_ar,
    is_public: input.is_public === undefined ? plan.is_public : input.is_public ? 1 : 0,
    sort_order: input.sort_order ?? plan.sort_order,
  };
  await env.REPORTS_DB.batch([
    env.REPORTS_DB.prepare('UPDATE plans SET name_en = ?, name_ar = ?, description_en = ?, description_ar = ?, is_public = ?, sort_order = ?, updated_at = ? WHERE id = ?').bind(next.name_en, next.name_ar, next.description_en, next.description_ar, next.is_public, next.sort_order, actor.now, id),
    auditStatement(env, actor, 'plan.update', 'plan', id, plan, next),
  ]);
  if (plan.is_default) await invalidate(env, [DEFAULT_PLAN_CACHE_KEY]);
  return getPlan(env, id);
}

/** Replaces the plan's editable values. Published values are untouched until publish. */
export async function setPlanValues(env: PlansEnv, actor: Actor, id: string, input: Record<string, unknown>): Promise<Outcome> {
  const plan = await getRow(env, id);
  if (!plan) return fail(404, 'Plan not found');
  if (plan.status === 'archived') return fail(409, 'An archived plan cannot be edited');
  const problem = validateValues(input);
  if (problem) return fail(400, problem);
  const version = editableVersion(plan);
  const before = await values(env, id, version);
  await env.REPORTS_DB.batch([
    env.REPORTS_DB.prepare('DELETE FROM plan_entitlements WHERE plan_id = ? AND plan_version = ?').bind(id, version),
    ...Object.entries(input).map(([key, value]) => env.REPORTS_DB.prepare('INSERT INTO plan_entitlements (plan_id, plan_version, key, value_json) VALUES (?, ?, ?, ?)').bind(id, version, key, JSON.stringify(value))),
    auditStatement(env, actor, 'plan.values', 'plan', id, before, { version, values: input }),
  ]);
  return getPlan(env, id);
}

export async function publishPlan(env: PlansEnv, actor: Actor, id: string): Promise<Outcome> {
  const plan = await getRow(env, id);
  if (!plan) return fail(404, 'Plan not found');
  if (plan.status === 'archived') return fail(409, 'An archived plan cannot be published');
  const version = editableVersion(plan);
  const pending = await values(env, id, version);
  if (Object.keys(pending).length === 0) return fail(409, 'There are no changes to publish');
  const problem = validateValues(pending);
  if (problem) return fail(400, problem);
  await env.REPORTS_DB.batch([
    env.REPORTS_DB.prepare("UPDATE plans SET status = 'active', version = ?, updated_at = ? WHERE id = ?").bind(version, actor.now, id),
    auditStatement(env, actor, 'plan.publish', 'plan', id, { status: plan.status, version: plan.version }, { status: 'active', version }),
  ]);
  if (plan.is_default) await invalidate(env, [DEFAULT_PLAN_CACHE_KEY]);
  return getPlan(env, id);
}

export async function archivePlan(env: PlansEnv, actor: Actor, id: string): Promise<Outcome> {
  const plan = await getRow(env, id);
  if (!plan) return fail(404, 'Plan not found');
  if (plan.is_default) return fail(409, 'The default plan cannot be archived');
  await env.REPORTS_DB.batch([
    env.REPORTS_DB.prepare("UPDATE plans SET status = 'archived', updated_at = ? WHERE id = ?").bind(actor.now, id),
    auditStatement(env, actor, 'plan.archive', 'plan', id, { status: plan.status }, { status: 'archived' }),
  ]);
  return getPlan(env, id);
}

const LIVE = "status IN ('trialing', 'active', 'past_due')";

export async function getSubjectState(env: PlansEnv, subject: SubjectRef): Promise<Outcome> {
  const [subscription, overrides, usage] = await Promise.all([
    env.REPORTS_DB.prepare(`SELECT s.*, p.slug, p.name_en, p.name_ar FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.subject_type = ? AND s.subject_id = ? AND s.${LIVE}`).bind(subject.type, subject.id).first(),
    env.REPORTS_DB.prepare('SELECT * FROM entitlement_overrides WHERE subject_type = ? AND subject_id = ? ORDER BY key').bind(subject.type, subject.id).all(),
    env.REPORTS_DB.prepare('SELECT key, period, value FROM usage_counters WHERE subject_type = ? AND subject_id = ? ORDER BY key, period DESC').bind(subject.type, subject.id).all(),
  ]);
  return { ok: true, result: { subject, subscription: subscription ?? null, overrides: overrides.results.map((o: any) => ({ ...o, value: JSON.parse(o.value_json) })), usage: usage.results } };
}

export interface AssignInput {
  planId: string;
  status: 'active' | 'trialing';
  expiresAt?: string | null;
  reason: string;
}

export async function assignPlan(env: PlansEnv, actor: Actor, subject: SubjectRef, input: AssignInput): Promise<Outcome> {
  const reason = input.reason.trim();
  if (!reason) return fail(400, 'A reason is required');
  if (input.status === 'trialing' && !input.expiresAt) return fail(400, 'A trial needs an end date');
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) return fail(400, 'Invalid end date');
  const plan = await getRow(env, input.planId);
  if (!plan) return fail(404, 'Plan not found');
  if (plan.status !== 'active') return fail(409, 'Only an active plan can be assigned');
  const id = actor.newId();
  await env.REPORTS_DB.batch([
    env.REPORTS_DB.prepare(`UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE subject_type = ? AND subject_id = ? AND ${LIVE}`).bind(actor.now, subject.type, subject.id),
    env.REPORTS_DB.prepare(
      `INSERT INTO subscriptions (id, subject_type, subject_id, plan_id, plan_version, status, current_period_start, current_period_end, provider, assigned_by, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
    ).bind(id, subject.type, subject.id, plan.id, plan.version, input.status, actor.now, input.expiresAt ?? null, actor.id, reason, actor.now, actor.now),
    auditStatement(env, actor, 'assignment.set', subject.type, subject.id, undefined, { planId: plan.id, version: plan.version, status: input.status, expiresAt: input.expiresAt ?? null }, reason),
  ]);
  await invalidate(env, [subjectCacheKey(subject.type, subject.id)]);
  return getSubjectState(env, subject);
}

export async function cancelAssignment(env: PlansEnv, actor: Actor, subject: SubjectRef, rawReason: string): Promise<Outcome> {
  const reason = rawReason.trim();
  if (!reason) return fail(400, 'A reason is required');
  await env.REPORTS_DB.batch([
    env.REPORTS_DB.prepare(`UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE subject_type = ? AND subject_id = ? AND ${LIVE}`).bind(actor.now, subject.type, subject.id),
    auditStatement(env, actor, 'assignment.cancel', subject.type, subject.id, undefined, undefined, reason),
  ]);
  await invalidate(env, [subjectCacheKey(subject.type, subject.id)]);
  return getSubjectState(env, subject);
}

export interface OverrideInput {
  key: string;
  value: unknown;
  expiresAt?: string | null;
  reason: string;
}

export async function setOverride(env: PlansEnv, actor: Actor, subject: SubjectRef, input: OverrideInput): Promise<Outcome> {
  const reason = input.reason.trim();
  if (!reason) return fail(400, 'A reason is required');
  const problem = validateEntitlementValue(input.key, input.value);
  if (problem) return fail(400, problem);
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) return fail(400, 'Invalid expiry date');
  await env.REPORTS_DB.batch([
    env.REPORTS_DB.prepare(
      `INSERT INTO entitlement_overrides (id, subject_type, subject_id, key, value_json, expires_at, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (subject_type, subject_id, key) DO UPDATE SET value_json = excluded.value_json, expires_at = excluded.expires_at, reason = excluded.reason, created_by = excluded.created_by, created_at = excluded.created_at`,
    ).bind(actor.newId(), subject.type, subject.id, input.key, JSON.stringify(input.value), input.expiresAt ?? null, reason, actor.id, actor.now),
    auditStatement(env, actor, 'override.set', subject.type, subject.id, undefined, { key: input.key, value: input.value, expiresAt: input.expiresAt ?? null }, reason),
  ]);
  await invalidate(env, [subjectCacheKey(subject.type, subject.id)]);
  return getSubjectState(env, subject);
}

export async function removeOverride(env: PlansEnv, actor: Actor, subject: SubjectRef, key: string, rawReason: string): Promise<Outcome> {
  const reason = rawReason.trim();
  if (!reason) return fail(400, 'A reason is required');
  await env.REPORTS_DB.batch([
    env.REPORTS_DB.prepare('DELETE FROM entitlement_overrides WHERE subject_type = ? AND subject_id = ? AND key = ?').bind(subject.type, subject.id, key),
    auditStatement(env, actor, 'override.remove', subject.type, subject.id, { key }, undefined, reason),
  ]);
  await invalidate(env, [subjectCacheKey(subject.type, subject.id)]);
  return getSubjectState(env, subject);
}

/** Moves subscribers on older versions to the published one. Dry run unless `apply` is true. */
export async function migrateSubscribers(env: PlansEnv, actor: Actor, id: string, apply: boolean, rawReason: string): Promise<Outcome> {
  const plan = await getRow(env, id);
  if (!plan) return fail(404, 'Plan not found');
  const affected = Number((await env.REPORTS_DB.prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE plan_id = ? AND plan_version < ? AND ${LIVE}`).bind(id, plan.version).first())?.n ?? 0);
  if (!apply) return { ok: true, result: { affected, applied: false, toVersion: plan.version } };
  const reason = rawReason.trim();
  if (!reason) return fail(400, 'A reason is required');
  await env.REPORTS_DB.batch([
    env.REPORTS_DB.prepare(`UPDATE subscriptions SET plan_version = ?, updated_at = ? WHERE plan_id = ? AND plan_version < ? AND ${LIVE}`).bind(plan.version, actor.now, id, plan.version),
    auditStatement(env, actor, 'plan.migrate', 'plan', id, undefined, { toVersion: plan.version, affected }, reason),
  ]);
  return { ok: true, result: { affected, applied: true, toVersion: plan.version } };
}

export async function listAudit(env: PlansEnv, limit: number): Promise<Outcome> {
  const { results } = await env.REPORTS_DB.prepare('SELECT * FROM plan_audit_log ORDER BY created_at DESC, id DESC LIMIT ?').bind(Math.min(Math.max(limit, 1), 200)).all();
  return { ok: true, result: { entries: results } };
}
