/**
 * Site-wide creator-support settings (search D1 `support_config`, one row 'default'; wiki
 * AUN-MEMBERS §9.6 Settings, §15).
 *
 * The owner-decision policy is stored as JSON and parsed with `parseSupportPolicy`: a missing or
 * invalid value reads as null (undecided), never as a default. Writes carry the version the admin
 * saw (two admins at once: the second write is refused, not merged) and return the old and new
 * values for the audit log.
 */
import { isSupportCurrency, parseSupportPolicy, type CollectorFeeSchedule, type PolicyProblem, type SearchDb, type SupportCollectorId, type SupportCurrency, type SupportMode, type SupportPolicy } from '@al-ummah/shared-types';

export interface SupportConfig {
	policy: SupportPolicy;
	collector: SupportCollectorId;
	mode: SupportMode;
	collectorFees: Partial<Record<SupportCurrency, CollectorFeeSchedule>>;
	organizationFormed: boolean;
	organizationName: string | null;
	emergencyStop: boolean;
	holdAllPayouts: boolean;
	version: number;
	updatedAt: string | null;
	updatedBy: string | null;
}

interface ConfigRow {
	policy: string;
	collector: SupportCollectorId;
	mode: SupportMode;
	collector_fees: string;
	organisation_formed: number;
	organisation_name: string | null;
	emergency_stop: number;
	hold_all_payouts: number;
	version: number;
	updated_at: string | null;
	updated_by: string | null;
}

const ID = 'default';

function json(text: string | null | undefined): unknown {
	try {
		return text ? JSON.parse(text) : {};
	} catch {
		return {};
	}
}

/** Collector fee schedules per currency; anything malformed is dropped (that currency has no quote). */
export function parseCollectorFees(input: unknown): Partial<Record<SupportCurrency, CollectorFeeSchedule>> {
	const out: Partial<Record<SupportCurrency, CollectorFeeSchedule>> = {};
	if (!input || typeof input !== 'object') return out;
	for (const [currency, v] of Object.entries(input as Record<string, unknown>)) {
		const f = v as { basisPoints?: unknown; fixed?: unknown };
		if (!isSupportCurrency(currency) || !Number.isSafeInteger(f?.basisPoints) || !Number.isSafeInteger(f?.fixed)) continue;
		const bp = f.basisPoints as number;
		const fixed = f.fixed as number;
		if (bp < 0 || bp > 2_000 || fixed < 0 || fixed > 10_000) continue;
		out[currency] = { basisPoints: bp, fixed: { amount: fixed, currency } };
	}
	return out;
}

export async function readSupportConfig(db: SearchDb): Promise<SupportConfig> {
	const row = await db.prepare('SELECT policy, collector, mode, collector_fees, organisation_formed, organisation_name, emergency_stop, hold_all_payouts, version, updated_at, updated_by FROM support_config WHERE id = ?').bind(ID).first<ConfigRow>();
	return {
		policy: parseSupportPolicy(json(row?.policy)).policy,
		collector: row?.collector ?? 'test',
		mode: row?.mode ?? 'test',
		collectorFees: parseCollectorFees(json(row?.collector_fees)),
		organizationFormed: row?.organisation_formed === 1,
		organizationName: row?.organisation_name ?? null,
		emergencyStop: row?.emergency_stop === 1,
		holdAllPayouts: row?.hold_all_payouts === 1,
		version: row?.version ?? 0,
		updatedAt: row?.updated_at ?? null,
		updatedBy: row?.updated_by ?? null,
	};
}

export class SupportConfigError extends Error {
	constructor(
		readonly code: 'invalid' | 'stale',
		readonly problems: PolicyProblem[] = [],
	) {
		super(code === 'stale' ? 'Someone else changed the support settings' : 'Invalid support settings');
		this.name = 'SupportConfigError';
	}
}

/**
 * Records owner decisions (a partial policy; `null` re-opens a decision). Refuses invalid values and
 * a stale version. Returns the policy before and after, for the audit log.
 */
export async function writeSupportPolicy(db: SearchDb, patch: Partial<Record<keyof SupportPolicy, unknown>>, actor: string, expectedVersion: number, now = new Date()): Promise<{ before: SupportPolicy; after: SupportPolicy; version: number }> {
	const current = await readSupportConfig(db);
	if (current.version !== expectedVersion) throw new SupportConfigError('stale');
	const merged: Record<string, unknown> = { ...current.policy, ...patch };
	const { policy, problems } = parseSupportPolicy(merged);
	if (problems.length) throw new SupportConfigError('invalid', problems);
	const version = current.version + 1;
	const res = (await db
		.prepare(
			`INSERT INTO support_config (id, policy, version, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET policy = excluded.policy, version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by
			 WHERE support_config.version = ?`,
		)
		.bind(ID, JSON.stringify(policy), version, now.toISOString(), actor, expectedVersion)
		.run()) as { meta?: { changes?: number } };
	if (!res.meta?.changes) throw new SupportConfigError('stale');
	return { before: current.policy, after: policy, version };
}
