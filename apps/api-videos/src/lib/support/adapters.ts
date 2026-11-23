/**
 * Which collector and payout rail this environment may use (wiki AUN-MEMBERS §9.2, §13).
 *
 * - The test collector and test rail exist only where SUPPORT_TEST_PROVIDERS is "1" and the
 *   environment isn't production (local stack, CI, QA). They never move money.
 * - PayGood collecting (MEM-10) and the Wise / PayPal Payouts rails (MEM-11) are separate stories;
 *   until their adapters land, asking for them answers `null` and every caller refuses with
 *   `support_unavailable`. No live call can happen from this code.
 * - Which real rail is primary or fallback is owner decision MEM-D17 (`SupportPolicy`), read by
 *   `railForPayee`, never assumed.
 */
import { payoutRailAvailable, supportCollectorAvailable, type PayoutRailId, type SupportCollectorId, type SupportPolicy } from '@al-ummah/shared-types';
import type { SupportCollector } from './collector';
import type { PayoutRail } from './rail';
import { testCollector } from './test-collector';
import { testRail } from './test-rail';

export interface SupportAdapterEnv {
	ENVIRONMENT?: string;
	SUPPORT_TEST_PROVIDERS?: string;
}

export const isProduction = (env: SupportAdapterEnv) => env.ENVIRONMENT === 'production';

/** The test adapters are allowed here. */
export const testAdaptersAllowed = (env: SupportAdapterEnv) => env.SUPPORT_TEST_PROVIDERS === '1' && !isProduction(env);

export function collectorFor(env: SupportAdapterEnv, id: SupportCollectorId): SupportCollector | null {
	if (!supportCollectorAvailable(env, id)) return null;
	return id === 'test' ? testCollector : null;
}

export function railFor(env: SupportAdapterEnv, id: PayoutRailId): PayoutRail | null {
	if (!payoutRailAvailable(env, id)) return null;
	return id === 'test' ? testRail : null;
}

/**
 * The rail a payee in `country` is paid through: the primary rail when it covers the country,
 * else the fallback (MEM-D17). `null` while the decision is open, when neither rail is built here,
 * or when neither covers the country (then the country is "no rail", §7.6).
 */
export function railForPayee(env: SupportAdapterEnv, policy: Pick<SupportPolicy, 'primaryRail' | 'fallbackRail'>, country: string | null): PayoutRail | null {
	const candidates = [policy.primaryRail, policy.fallbackRail === 'none' ? null : policy.fallbackRail];
	for (const id of candidates) {
		if (!id) continue;
		const rail = railFor(env, id);
		if (!rail) continue;
		if (rail.countries === null || (country !== null && rail.countries.includes(country))) return rail;
	}
	return null;
}
