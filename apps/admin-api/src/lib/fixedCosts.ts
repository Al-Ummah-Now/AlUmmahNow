/**
 * Fixed and other costs (COST-GAPS): costs outside the collected usage (Apple Developer, domains,
 * GitHub, Linear, AI subscriptions…), kept in COSTS_DB cost_fixed_items. Super admins (ops:manage)
 * add, change and remove them on the Costs page; each change is audited in site_settings_log
 * (key costs:fixed:<id>, before and after; a removal's after is { removed: true }, the log's new_value is NOT NULL). The budget, projection and alerts count them through
 * fixedCostsForMonth (packages/shared-types cost-fixed.ts).
 */
import { FIXED_COST_LIMITS, fixedCostsForMonth, type FixedCost, type FixedCostInput } from '@al-ummah/shared-types';
import { auditOriginJson } from './request-origin';
import { logger } from './logger';
import type { D1Database } from './types';

export const FIXED_AUDIT_PREFIX = 'costs:fixed:';

export interface FixedCostsEnv {
  COSTS_DB?: D1Database;
  REPORTS_DB: D1Database;
}

interface Row {
  id: string;
  name: string;
  amount_usd: number;
  period: 'monthly' | 'yearly';
  start_date: string;
  end_date: string | null;
  note: string | null;
  updated_by: string | null;
  updated_at: string;
}

const viewOf = (r: Row): FixedCost => ({
  id: r.id,
  name: r.name,
  amountUsd: r.amount_usd,
  period: r.period,
  startDate: r.start_date,
  endDate: r.end_date,
  note: r.note,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at,
});

/** Every item, newest start first. Best effort: none when the table is not migrated yet. */
export async function listFixedCosts(db: D1Database | undefined): Promise<FixedCost[]> {
  if (!db) return [];
  try {
    const rows = (await db.prepare('SELECT id, name, amount_usd, period, start_date, end_date, note, updated_by, updated_at FROM cost_fixed_items ORDER BY start_date DESC, name').all<Row>()).results ?? [];
    return rows.map(viewOf);
  } catch (error) {
    logger.warn('[FixedCosts] Not available', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    return [];
  }
}

/** The month so far and the whole month of every active item. */
export async function fixedCostsBudget(db: D1Database | undefined, now: Date): Promise<{ items: FixedCost[]; mtd: number; projected: number }> {
  const items = await listFixedCosts(db);
  return { items, ...fixedCostsForMonth(items, now) };
}

const snapshot = (c: FixedCost | FixedCostInput | null) =>
  c ? { name: c.name, amountUsd: c.amountUsd, period: c.period, startDate: c.startDate, endDate: c.endDate, note: c.note } : null;

async function audit(env: FixedCostsEnv, id: string, before: unknown, after: unknown, actorId: string, now: Date): Promise<void> {
  await env.REPORTS_DB.prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), `${FIXED_AUDIT_PREFIX}${id}`, before === null ? null : JSON.stringify(before), JSON.stringify(after ?? { removed: true }), actorId, now.toISOString(), auditOriginJson())
    .run();
}

async function byId(db: D1Database, id: string): Promise<FixedCost | null> {
  const r = await db.prepare('SELECT id, name, amount_usd, period, start_date, end_date, note, updated_by, updated_at FROM cost_fixed_items WHERE id = ?').bind(id).first<Row>();
  return r ? viewOf(r) : null;
}

export async function createFixedCost(env: FixedCostsEnv, input: FixedCostInput, actorId: string, now = new Date()): Promise<FixedCost | 'too_many'> {
  const db = env.COSTS_DB!;
  const count = await db.prepare('SELECT COUNT(*) AS n FROM cost_fixed_items').first<{ n: number }>();
  if ((count?.n ?? 0) >= FIXED_COST_LIMITS.items) return 'too_many';
  const id = crypto.randomUUID();
  const stamp = now.toISOString();
  // Audit first, like the other cost settings
  await audit(env, id, null, snapshot(input), actorId, now);
  await db
    .prepare('INSERT INTO cost_fixed_items (id, name, amount_usd, period, start_date, end_date, note, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, input.name, input.amountUsd, input.period, input.startDate, input.endDate, input.note, actorId, stamp, actorId, stamp)
    .run();
  logger.info('[FixedCosts] Added', { id, actorId, period: input.period });
  return (await byId(db, id))!;
}

export async function updateFixedCost(env: FixedCostsEnv, id: string, input: FixedCostInput, actorId: string, now = new Date()): Promise<FixedCost | null> {
  const db = env.COSTS_DB!;
  const before = await byId(db, id);
  if (!before) return null;
  await audit(env, id, snapshot(before), snapshot(input), actorId, now);
  await db
    .prepare('UPDATE cost_fixed_items SET name = ?, amount_usd = ?, period = ?, start_date = ?, end_date = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .bind(input.name, input.amountUsd, input.period, input.startDate, input.endDate, input.note, actorId, now.toISOString(), id)
    .run();
  logger.info('[FixedCosts] Changed', { id, actorId });
  return byId(db, id);
}

export async function deleteFixedCost(env: FixedCostsEnv, id: string, actorId: string, now = new Date()): Promise<boolean> {
  const db = env.COSTS_DB!;
  const before = await byId(db, id);
  if (!before) return false;
  await audit(env, id, snapshot(before), null, actorId, now);
  await db.prepare('DELETE FROM cost_fixed_items WHERE id = ?').bind(id).run();
  logger.info('[FixedCosts] Removed', { id, actorId });
  return true;
}
