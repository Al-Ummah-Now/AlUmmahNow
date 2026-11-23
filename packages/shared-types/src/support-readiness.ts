/**
 * `creatorSupport` turn-on precondition, readable from any Worker with the search D1 (api-videos,
 * and admin-api's Features page write path, AUN-FEATURES FEAT-4; wiki AUN-MEMBERS §9.7).
 *
 * Reads only `support_config` and `support_finance_members` (search migration 0076), both keyed
 * lookups. Fails closed: no SEARCH_DB, or a read that throws, is "not ready".
 */
import type { SearchDb } from './search/store';
import { parseSupportPolicy, SUPPORT_TURN_ON_REASONS, supportReadiness, type PayoutRailId, type SupportCollectorId, type SupportReadiness, type SupportTurnOnBlocker } from './support';

/**
 * Adapters that exist in code today. The test ones only where SUPPORT_TEST_PROVIDERS is "1"
 * outside production. PayGood (MEM-10), Wise and PayPal Payouts (MEM-11) join this list when their
 * adapters land; until then no live vendor can be used anywhere.
 */
export const BUILT_SUPPORT_COLLECTORS: readonly SupportCollectorId[] = Object.freeze(['test']);
export const BUILT_PAYOUT_RAILS: readonly PayoutRailId[] = Object.freeze(['test']);

export interface SupportEnv {
  SEARCH_DB?: SearchDb;
  ENVIRONMENT?: string;
  SUPPORT_TEST_PROVIDERS?: string;
}

const testAllowed = (env: SupportEnv) => env.SUPPORT_TEST_PROVIDERS === '1' && env.ENVIRONMENT !== 'production';

export function supportCollectorAvailable(env: SupportEnv, id: SupportCollectorId): boolean {
  return BUILT_SUPPORT_COLLECTORS.includes(id) && (id !== 'test' || testAllowed(env));
}

export function payoutRailAvailable(env: SupportEnv, id: PayoutRailId): boolean {
  return BUILT_PAYOUT_RAILS.includes(id) && (id !== 'test' || testAllowed(env));
}

const ALL_BLOCKERS: SupportTurnOnBlocker[] = ['organization_not_formed', 'no_finance_approver', 'decisions_open', 'no_collector', 'no_fees', 'no_rail'];

/** Collectors whose adapter returns a live fee quote (O43: the live quote wins; no setting needed). */
export const LIVE_FEE_COLLECTORS: readonly SupportCollectorId[] = Object.freeze(['test']);

/**
 * Whether the admin entered the collector's fee for every currency, for any method (method IS NULL):
 * a card-only rate leaves the other methods unpriced. Unreadable reads as not known.
 */
export async function collectorFeesKnown(db: SearchDb, collector: string, currencies: readonly string[], now = new Date()): Promise<boolean> {
  try {
    for (const currency of currencies) {
      const fee = await db.prepare("SELECT 1 AS x FROM support_fee_schedules WHERE kind = 'collector' AND provider = ? AND currency = ? AND method IS NULL AND effective_from <= ? LIMIT 1").bind(collector, currency, now.toISOString()).first<{ x: number }>();
      if (!fee) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function supportCanTurnOn(env: SupportEnv): Promise<SupportReadiness> {
  const db = env.SEARCH_DB;
  if (!db) return { ready: false, blockers: [...ALL_BLOCKERS], openDecisions: [] };
  let row: { policy: string; collector: SupportCollectorId; organisation_formed: number } | null;
  let members: { n: number } | null;
  try {
    row = await db.prepare("SELECT policy, collector, organisation_formed FROM support_config WHERE id = 'default'").first<{ policy: string; collector: SupportCollectorId; organisation_formed: number }>();
    // Approvers: approved by a second person, holding support:payouts, never tech staff (admin-api financeAllows)
    members = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM support_finance_members m WHERE m.removed_at IS NULL AND m.approved_by IS NOT NULL
         AND EXISTS (SELECT 1 FROM json_each(m.roles) WHERE value = 'support:payouts')
         AND NOT EXISTS (SELECT 1 FROM support_tech_staff t WHERE t.user_id = m.user_id)`,
      )
      .first<{ n: number }>();
  } catch {
    // Unreadable: not ready (fails closed)
    return { ready: false, blockers: [...ALL_BLOCKERS], openDecisions: [] };
  }
  let raw: unknown = {};
  try {
    raw = row?.policy ? JSON.parse(row.policy) : {};
  } catch {
    raw = {};
  }
  const policy = parseSupportPolicy(raw).policy;
  const collector = row?.collector ?? 'test';
  const feesKnown = LIVE_FEE_COLLECTORS.includes(collector) || !policy.amounts ? true : await collectorFeesKnown(db, collector, Object.keys(policy.amounts));
  return supportReadiness({
    feesKnown,
    organizationFormed: row?.organisation_formed === 1,
    financeApprovers: Number(members?.n ?? 0),
    policy,
    collectorAvailable: supportCollectorAvailable(env, collector),
    railAvailable: policy.primaryRail !== null && payoutRailAvailable(env, policy.primaryRail),
  });
}

/** FEAT-4's precondition shape. */
export async function supportCanTurnOnHook(env: SupportEnv): Promise<{ ok: true } | { ok: false; reasonKey: SupportTurnOnBlocker; reason: { en: string; ar: string } }> {
  const r = await supportCanTurnOn(env);
  if (r.ready) return { ok: true };
  const reasonKey = r.blockers[0];
  return { ok: false, reasonKey, reason: SUPPORT_TURN_ON_REASONS[reasonKey] };
}
