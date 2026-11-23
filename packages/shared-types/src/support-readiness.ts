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

const ALL_BLOCKERS: SupportTurnOnBlocker[] = ['organisation_not_formed', 'no_finance_approver', 'decisions_open', 'no_collector', 'no_rail'];

export async function supportCanTurnOn(env: SupportEnv): Promise<SupportReadiness> {
  const db = env.SEARCH_DB;
  if (!db) return { ready: false, blockers: [...ALL_BLOCKERS], openDecisions: [] };
  const row = await db.prepare("SELECT policy, collector, organisation_formed FROM support_config WHERE id = 'default'").first<{ policy: string; collector: SupportCollectorId; organisation_formed: number }>();
  const members = await db.prepare('SELECT COUNT(*) AS n FROM support_finance_members WHERE removed_at IS NULL AND approved_by IS NOT NULL').first<{ n: number }>();
  let raw: unknown = {};
  try {
    raw = row?.policy ? JSON.parse(row.policy) : {};
  } catch {
    raw = {};
  }
  const policy = parseSupportPolicy(raw).policy;
  return supportReadiness({
    organisationFormed: row?.organisation_formed === 1,
    financeApprovers: Number(members?.n ?? 0),
    policy,
    collectorAvailable: supportCollectorAvailable(env, row?.collector ?? 'test'),
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
