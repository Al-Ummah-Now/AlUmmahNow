/**
 * The Upgrade page's mode (shared-types UPGRADE_MODES; owner rule 2026-11-15):
 * decided ONLY by whether any payment provider is enabled and by the admin's
 * "Allow tier requests" (creator_tier_settings 'tier_requests_enabled',
 * migration 0063). No per-tier, env or feature-flag switch.
 */
import { upgradeModeOf, type UpgradeMode } from '@al-ummah/shared-types';
import { enabledProviders } from './billing/config';
import type { BillingEnv } from './billing/config';

const REQUESTS_KEY = 'tier_requests_enabled';

/** The admin's "Allow tier requests" (on by default; on when the table or row is missing). */
export async function readRequestsAllowed(db: D1Database): Promise<{ allowed: boolean; updatedAt: string | null; updatedBy: string | null }> {
	try {
		const row = await db.prepare('SELECT value, updated_at, updated_by FROM creator_tier_settings WHERE key = ?').bind(REQUESTS_KEY).first<{ value: string; updated_at: string | null; updated_by: string | null }>();
		return { allowed: row ? row.value === '1' : true, updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ?? null };
	} catch (error) {
		if (/no such table/i.test(error instanceof Error ? error.message : String(error))) return { allowed: true, updatedAt: null, updatedBy: null };
		throw error;
	}
}

/** Turns "Allow tier requests" on or off; returns the previous value (audit, Undo). */
export async function setRequestsAllowed(db: D1Database, allowed: boolean, actorId: string, now = new Date().toISOString()): Promise<{ previous: boolean; allowed: boolean }> {
	const { allowed: previous } = await readRequestsAllowed(db);
	await db
		.prepare(
			`INSERT INTO creator_tier_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
		)
		.bind(REQUESTS_KEY, allowed ? '1' : '0', actorId, now)
		.run();
	return { previous, allowed };
}

/** The mode, from the two inputs only. */
export async function upgradeMode(env: BillingEnv): Promise<{ mode: UpgradeMode; providerEnabled: boolean; requestsAllowed: boolean }> {
	const [providers, requests] = await Promise.all([enabledProviders(env), readRequestsAllowed(env.SEARCH_DB as D1Database)]);
	const providerEnabled = providers.length > 0;
	return { mode: upgradeModeOf({ providerEnabled, requestsAllowed: requests.allowed }), providerEnabled, requestsAllowed: requests.allowed };
}
