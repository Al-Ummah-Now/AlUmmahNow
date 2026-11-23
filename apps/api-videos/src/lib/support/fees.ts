/**
 * Fee schedules (wiki AUN-MEMBERS O43, owner 2026-11-23): the collector's and the payout rail's fees
 * are admin settings with an effective date, never constants in the code. A vendor's live quote wins;
 * the newest setting already in force is the fallback; with neither, nobody can pay (collector) and no
 * payout is planned for that payee (rail).
 *
 * Rows in search D1 support_fee_schedules (migration 0116) are append-only: a change is a new row.
 * Written by admin-api for people on the organization's finance list (support:providers), audited.
 */
import { feeScheduleProblems, type CollectorFeeSchedule, type FeeScheduleEntry, type FeeScheduleKind, type SearchDb, type SupportCurrency } from '@al-ummah/shared-types';

interface Row {
	id: string;
	kind: FeeScheduleKind;
	provider: string;
	currency: SupportCurrency;
	method: string | null;
	basis_points: number;
	fixed_minor: number;
	effective_from: string;
	preset_id: string | null;
	created_by: string;
	created_at: string;
}

const toEntry = (r: Row): FeeScheduleEntry => ({ id: r.id, kind: r.kind, provider: r.provider, currency: r.currency, method: r.method, basisPoints: Number(r.basis_points), fixedMinor: Number(r.fixed_minor), effectiveFrom: r.effective_from, presetId: r.preset_id, createdBy: r.created_by, createdAt: r.created_at });

/** The setting in force for this provider, currency and method (a method-specific row wins over "any method"). */
export async function feeSetting(db: SearchDb, kind: FeeScheduleKind, provider: string, currency: SupportCurrency, method: string | null, now: Date): Promise<CollectorFeeSchedule | null> {
	const r = await db
		.prepare(
			`SELECT basis_points, fixed_minor FROM support_fee_schedules WHERE kind = ? AND provider = ? AND currency = ? AND effective_from <= ? AND (method IS NULL OR method = ?)
			 ORDER BY CASE WHEN method IS NULL THEN 1 ELSE 0 END, effective_from DESC, created_at DESC LIMIT 1`,
		)
		.bind(kind, provider, currency, now.toISOString(), method ?? '')
		.first<{ basis_points: number; fixed_minor: number }>();
	return r ? { basisPoints: Number(r.basis_points), fixed: { amount: Number(r.fixed_minor), currency } } : null;
}

export async function listFeeSchedules(db: SearchDb): Promise<FeeScheduleEntry[]> {
	const rows = await db.prepare('SELECT id, kind, provider, currency, method, basis_points, fixed_minor, effective_from, preset_id, created_by, created_at FROM support_fee_schedules ORDER BY kind, provider, currency, effective_from DESC LIMIT 500').all<Row>();
	return (rows.results ?? []).map(toEntry);
}

export class FeeScheduleError extends Error {
	constructor(readonly fields: string[]) {
		super(`Invalid fee schedule: ${fields.join(', ')}`);
		this.name = 'FeeScheduleError';
	}
}

/** A new fee setting; the one in force before it (same kind, provider, currency, method) is returned for the audit log. */
export async function addFeeSchedule(
	db: SearchDb,
	input: { kind?: unknown; provider?: unknown; currency?: unknown; method?: unknown; basisPoints?: unknown; fixedMinor?: unknown; effectiveFrom?: unknown; presetId?: unknown },
	actorId: string,
	now = new Date(),
): Promise<{ entry: FeeScheduleEntry; previous: CollectorFeeSchedule | null }> {
	const problems = feeScheduleProblems(input);
	if (problems.length) throw new FeeScheduleError(problems);
	const kind = input.kind as FeeScheduleKind;
	const currency = input.currency as SupportCurrency;
	const method = (input.method as string | null | undefined) ?? null;
	const effectiveFrom = new Date(Date.parse(input.effectiveFrom as string)).toISOString();
	const previous = await feeSetting(db, kind, input.provider as string, currency, method, new Date(effectiveFrom));
	const id = `sfs_${crypto.randomUUID().replace(/-/g, '')}`;
	const presetId = typeof input.presetId === 'string' ? input.presetId.slice(0, 60) : null;
	await db
		.prepare('INSERT INTO support_fee_schedules (id, kind, provider, currency, method, basis_points, fixed_minor, effective_from, preset_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(id, kind, input.provider, currency, method, input.basisPoints, input.fixedMinor, effectiveFrom, presetId, actorId, now.toISOString())
		.run();
	const row = await db.prepare('SELECT id, kind, provider, currency, method, basis_points, fixed_minor, effective_from, preset_id, created_by, created_at FROM support_fee_schedules WHERE id = ?').bind(id).first<Row>();
	return { entry: toEntry(row!), previous };
}
