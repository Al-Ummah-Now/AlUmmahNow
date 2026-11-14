/**
 * Caption minutes (AUN-CAPTIONS §6; shared-types caption-minutes.ts): the
 * allowance, the admin's grants, and the reserve → commit / release of a job's
 * minutes. SEARCH_DB (migration 0032).
 *
 * Who pays: the tier holder that resolveCreator names (the channel owner, or a
 * super admin themselves). A job is charged its estimate when it starts (it needs a
 * balance above 0 and may take it negative: the overdraft, paid down by the next
 * month's allowance and by grants) and settled to what it used when it ends. Every
 * step is one batch guarded by the figures it was planned from and writes one
 * ledger row whose id is the step (`<jobId>:start|settle|cancel|refund`), so a
 * retry never charges twice (migrations 0032, 0035).
 */
import {
	CAPTION_GRANT_BOUNDS,
	CAPTION_GRANT_SCOPES,
	captionPeriod,
	captionUsageFrom,
	type CaptionGrantScope,
	type CaptionLedgerEntry,
	type CaptionMinuteGrant,
	type CaptionMinutesUsage,
} from '@al-ummah/shared-types';
import { readAssignment, readTier, resolveCreator } from '../creatorTiers';
import { logger } from '../logger';

export class CaptionMinutesError extends Error {
	constructor(readonly status: number, readonly code: string, message = code) {
		super(message);
	}
}

export interface MinutesSubject {
	subjectId: string;
	unlimited: boolean;
	via: CaptionMinutesUsage['via'];
	tierMinutes: number;
}

/** The tier holder who pays for `userId`'s caption work on a channel owned by `channelOwnerId`. */
export async function captionSubject(db: D1Database, who: { userId: string; roles?: readonly string[] | null; channelOwnerId?: string | null }): Promise<MinutesSubject> {
	const resolved = await resolveCreator(db, who);
	return {
		subjectId: resolved.subjectId,
		unlimited: resolved.via === 'super_admin' || !!resolved.tier?.unlimited,
		via: resolved.via,
		tierMinutes: resolved.tier && !resolved.tier.unlimited ? resolved.tier.captionMinutesMonth : 0,
	};
}

/** The admin's view: a user's own tier (no roles in the admin context; a super admin holds the stored Unlimited row). */
export async function subjectOfUser(db: D1Database, userId: string): Promise<MinutesSubject> {
	const assignment = await readAssignment(db, userId);
	const tier = assignment ? await readTier(db, assignment.tierId) : null;
	return {
		subjectId: userId,
		unlimited: !!tier?.unlimited,
		via: assignment?.assignedBy === 'system:super-admin' ? 'super_admin' : tier ? 'tier' : 'none',
		tierMinutes: tier && !tier.unlimited ? tier.captionMinutesMonth : 0,
	};
}

interface GrantRow {
	id: string;
	user_id: string;
	minutes: number;
	scope: string;
	period: string | null;
	used: number;
	reason: string;
	created_by: string;
	created_at: string;
	revoked_at: string | null;
	revoked_by: string | null;
	revoke_reason: string | null;
}

const toGrant = (r: GrantRow): CaptionMinuteGrant => ({
	id: r.id,
	userId: r.user_id,
	minutes: Number(r.minutes),
	scope: r.scope === 'until_used' ? 'until_used' : 'month',
	period: r.period ?? null,
	used: Number(r.used ?? 0),
	reason: r.reason,
	createdBy: r.created_by,
	createdAt: r.created_at,
	revokedAt: r.revoked_at ?? null,
	revokedBy: r.revoked_by ?? null,
	revokeReason: r.revoke_reason ?? null,
});

export async function listGrants(db: D1Database, userId: string): Promise<CaptionMinuteGrant[]> {
	const rows = (await db.prepare('SELECT * FROM caption_minute_grants WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').bind(userId).all<GrantRow>()).results ?? [];
	return rows.map(toGrant);
}

/** Active "until used" grants with minutes left, oldest first (the order they are spent in). */
async function openPacks(db: D1Database, userId: string): Promise<Array<{ id: string; left: number }>> {
	const rows =
		(
			await db
				.prepare("SELECT id, minutes, used FROM caption_minute_grants WHERE user_id = ? AND scope = 'until_used' AND revoked_at IS NULL AND used < minutes ORDER BY created_at, id")
				.bind(userId)
				.all<{ id: string; minutes: number; used: number }>()
		).results ?? [];
	return rows.map((r) => ({ id: r.id, left: Number(r.minutes) - Number(r.used) }));
}

export interface CaptionHold {
	holdId: string;
	userId: string;
	period: string;
	/** The estimate charged at the start */
	minutes: number;
	/** Of that, from the month's allowance (of `period`) and from each grant; the rest went on the overdraft */
	monthMinutes: number;
	packs: Array<{ grantId: string; minutes: number }>;
	state: 'reserved' | 'committed' | 'released';
	/** What the job cost in the end (null while it runs) */
	charged: number | null;
}

interface HoldRow {
	hold_id: string;
	user_id: string;
	period: string;
	minutes: number;
	month_minutes: number;
	packs_json: string;
	state: CaptionHold['state'];
	charged: number | null;
}

const toHold = (r: HoldRow): CaptionHold => ({
	holdId: r.hold_id,
	userId: r.user_id,
	period: r.period,
	minutes: Number(r.minutes),
	monthMinutes: Number(r.month_minutes),
	packs: (JSON.parse(r.packs_json || '[]') as CaptionHold['packs']).filter((p) => p && typeof p.grantId === 'string' && p.minutes > 0),
	state: r.state,
	charged: r.charged === null || r.charged === undefined ? null : Number(r.charged),
});

export async function readHold(db: D1Database, holdId: string): Promise<CaptionHold | null> {
	const row = await db.prepare('SELECT * FROM caption_minute_holds WHERE hold_id = ?').bind(holdId).first<HoldRow>();
	return row ? toHold(row) : null;
}

// --- The balance ----------------------------------------------------------------
//
// balance = max(0, month limit − month used) + minutes left on "until used" grants − overdraft.
// A change is planned from one observation of these figures and applied in one D1 batch
// (a transaction): its first statement checks that every observed figure is still what it
// was (a compare-and-swap) and makes the step's mark (the hold, or its new state); every
// later statement runs only if the one before it changed a row (`changes() > 0`), the last
// writing the ledger row. A step that loses a race to another change applies nothing and is
// planned again from fresh figures; a step already made applies nothing either.

interface Observed {
	userId: string;
	period: string;
	/** null: unlimited */
	limit: number | null;
	used: number;
	granted: number;
	packsLeft: number;
	packs: Array<{ id: string; left: number }>;
	overdraft: number;
}

/** What a step changes: + charges, − gives back. */
interface Plan {
	months: Array<{ period: string; minutes: number }>;
	packs: Array<{ grantId: string; minutes: number }>;
	overdraft: number;
}

const balanceOf = (o: Pick<Observed, 'limit' | 'used' | 'packsLeft' | 'overdraft'>): number | null =>
	o.limit === null ? null : Math.max(0, o.limit - o.used) + o.packsLeft - o.overdraft;

async function observe(db: D1Database, subject: MinutesSubject, period: string, at: string): Promise<Observed> {
	const userId = subject.subjectId;
	await db.batch([
		db.prepare('INSERT OR IGNORE INTO caption_minute_usage (user_id, period, minutes, updated_at) VALUES (?, ?, 0, ?)').bind(userId, period, at),
		db.prepare('INSERT OR IGNORE INTO caption_minute_overdraft (user_id, minutes, updated_at) VALUES (?, 0, ?)').bind(userId, at),
	]);
	const [granted, used, overdraft, packs] = await Promise.all([
		db
			.prepare("SELECT COALESCE(SUM(minutes), 0) AS n FROM caption_minute_grants WHERE user_id = ? AND scope = 'month' AND period = ? AND revoked_at IS NULL")
			.bind(userId, period)
			.first<{ n: number }>(),
		db.prepare('SELECT minutes FROM caption_minute_usage WHERE user_id = ? AND period = ?').bind(userId, period).first<{ minutes: number }>(),
		db.prepare('SELECT minutes FROM caption_minute_overdraft WHERE user_id = ?').bind(userId).first<{ minutes: number }>(),
		openPacks(db, userId),
	]);
	const monthGranted = Number(granted?.n ?? 0);
	return {
		userId,
		period,
		limit: subject.unlimited ? null : subject.tierMinutes + monthGranted,
		used: Number(used?.minutes ?? 0),
		granted: monthGranted,
		packsLeft: packs.reduce((n, p) => n + p.left, 0),
		packs,
		overdraft: Number(overdraft?.minutes ?? 0),
	};
}

/** The figures a plan was made from are still the figures (SQL condition and its values). */
function unchanged(o: Observed): { sql: string; values: unknown[] } {
	return {
		sql: `(SELECT minutes FROM caption_minute_usage WHERE user_id = ? AND period = ?) = ?
			AND (SELECT minutes FROM caption_minute_overdraft WHERE user_id = ?) = ?
			AND (SELECT COALESCE(SUM(minutes), 0) FROM caption_minute_grants WHERE user_id = ? AND scope = 'month' AND period = ? AND revoked_at IS NULL) = ?
			AND (SELECT COALESCE(SUM(minutes - used), 0) FROM caption_minute_grants WHERE user_id = ? AND scope = 'until_used' AND revoked_at IS NULL AND used < minutes) = ?`,
		values: [o.userId, o.period, o.used, o.userId, o.overdraft, o.userId, o.period, o.granted, o.userId, o.packsLeft],
	};
}

/** Charging `minutes`: the month's allowance, then "until used" grants (oldest first), then the overdraft. */
function planCharge(o: Observed, minutes: number): Plan {
	if (o.limit === null) return { months: [{ period: o.period, minutes }], packs: [], overdraft: 0 };
	const fromMonth = Math.max(0, Math.min(minutes, o.limit - o.used));
	let rest = minutes - fromMonth;
	const packs: Plan['packs'] = [];
	for (const p of o.packs) {
		if (rest === 0) break;
		const take = Math.min(p.left, rest);
		packs.push({ grantId: p.id, minutes: take });
		rest -= take;
	}
	return { months: fromMonth > 0 ? [{ period: o.period, minutes: fromMonth }] : [], packs, overdraft: rest };
}

/**
 * Giving back `minutes` of `hold`: the overdraft first (it is owed), then the hold's grants
 * (newest taken first), then its month; what is left (an overdraft since paid from this month's
 * allowance) comes off this month.
 */
function planGiveBack(o: Observed, hold: CaptionHold, minutes: number): Plan {
	const fromOverdraft = Math.min(o.overdraft, minutes);
	let rest = minutes - fromOverdraft;
	const packs: Plan['packs'] = [];
	for (const p of [...hold.packs].reverse()) {
		if (rest === 0) break;
		const back = Math.min(p.minutes, rest);
		packs.push({ grantId: p.grantId, minutes: -back });
		rest -= back;
	}
	const months: Plan['months'] = [];
	const toHoldMonth = Math.min(hold.monthMinutes, rest);
	if (toHoldMonth > 0) months.push({ period: hold.period, minutes: -toHoldMonth });
	rest -= toHoldMonth;
	if (rest > 0) {
		const same = months.find((m) => m.period === o.period);
		if (same) same.minutes -= rest;
		else months.push({ period: o.period, minutes: -rest });
	}
	return { months, packs, overdraft: -fromOverdraft };
}

/** The balance once `plan` is applied to `o`. */
function balanceAfter(o: Observed, plan: Plan): number | null {
	if (o.limit === null) return null;
	const used = o.used + plan.months.filter((m) => m.period === o.period).reduce((n, m) => n + m.minutes, 0);
	const packsLeft = o.packsLeft - plan.packs.reduce((n, p) => n + p.minutes, 0);
	return balanceOf({ limit: o.limit, used: Math.max(0, used), packsLeft, overdraft: Math.max(0, o.overdraft + plan.overdraft) });
}

const AFTER = 'changes() > 0';

/** The statements that apply `plan` after the batch's first statement, then the ledger row. */
function planStatements(db: D1Database, userId: string, plan: Plan, ledger: { id: string; holdId: string | null; kind: string; minutes: number; balanceAfter: number | null; period: string }, at: string): D1PreparedStatement[] {
	return [
		...plan.months
			.filter((m) => m.minutes !== 0)
			.map((m) =>
				db
					.prepare(`UPDATE caption_minute_usage SET minutes = MAX(0, minutes + ?), updated_at = ? WHERE user_id = ? AND period = ? AND ${AFTER}`)
					.bind(m.minutes, at, userId, m.period),
			),
		...plan.packs
			.filter((p) => p.minutes !== 0)
			.map((p) => db.prepare(`UPDATE caption_minute_grants SET used = MIN(minutes, MAX(0, used + ?)) WHERE id = ? AND user_id = ? AND ${AFTER}`).bind(p.minutes, p.grantId, userId)),
		...(plan.overdraft !== 0
			? [db.prepare(`UPDATE caption_minute_overdraft SET minutes = MAX(0, minutes + ?), updated_at = ? WHERE user_id = ? AND ${AFTER}`).bind(plan.overdraft, at, userId)]
			: []),
		db
			.prepare(
				`INSERT INTO caption_minute_ledger (id, user_id, hold_id, kind, minutes, balance_after, period, created_at)
				 SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${AFTER}`,
			)
			.bind(ledger.id, userId, ledger.holdId, ledger.kind, ledger.minutes, ledger.balanceAfter, ledger.period, at),
	];
}

const firstChanged = (results: D1Result[]) => (results[0]?.meta?.changes ?? 0) > 0;
const ATTEMPTS = 12;

/**
 * The overdraft is paid down by this month's allowance, then by "until used" grants: a new
 * month's allowance starts reduced by it, and a grant pays it first. The balance is unchanged.
 */
export async function payDownOverdraft(db: D1Database, subject: MinutesSubject, now = new Date()): Promise<void> {
	if (subject.unlimited) return;
	const at = now.toISOString();
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const o = await observe(db, subject, captionPeriod(now), at);
		if (o.overdraft === 0 || o.limit === null) return;
		const charge = planCharge({ ...o, overdraft: 0 }, o.overdraft);
		const paid = o.overdraft - charge.overdraft;
		if (paid === 0) return;
		const plan: Plan = { months: charge.months, packs: charge.packs, overdraft: -paid };
		const guard = unchanged(o);
		const results = await db.batch([
			db.prepare(`UPDATE caption_minute_overdraft SET updated_at = ? WHERE user_id = ? AND ${guard.sql}`).bind(at, o.userId, ...guard.values),
			...planStatements(db, o.userId, plan, { id: `paydown:${crypto.randomUUID()}`, holdId: null, kind: 'paydown', minutes: paid, balanceAfter: balanceAfter(o, plan), period: o.period }, at),
		]);
		if (firstChanged(results)) return;
	}
	logger.warn('[CaptionMinutes] Overdraft paydown kept racing; the next read retries', { userId: subject.subjectId });
}

export async function readUsage(db: D1Database, subject: MinutesSubject, now = new Date()): Promise<CaptionMinutesUsage> {
	await payDownOverdraft(db, subject, now);
	const period = captionPeriod(now);
	const o = await observe(db, subject, period, now.toISOString());
	const held = await db.prepare("SELECT COALESCE(SUM(minutes), 0) AS n FROM caption_minute_holds WHERE user_id = ? AND state = 'reserved'").bind(subject.subjectId).first<{ n: number }>();
	return captionUsageFrom({
		period,
		unlimited: subject.unlimited,
		via: subject.via,
		tierMinutes: subject.tierMinutes,
		monthGranted: o.granted,
		monthUsed: o.used,
		packsRemaining: o.packsLeft,
		overdraft: o.overdraft,
		held: Number(held?.n ?? 0),
	});
}

export type ReserveResult = { ok: true; hold: CaptionHold } | { ok: false; usage: CaptionMinutesUsage };

/**
 * A job starts: its estimate is charged now, so the meter and the next start see it at once.
 * It needs a balance above 0 and may take the balance below 0 (owner decision 2026-11-14:
 * a started job always runs to the end). Idempotent: a hold that exists is returned as it is.
 */
export async function reserveMinutes(db: D1Database, subject: MinutesSubject, holdId: string, minutes: number, now = new Date()): Promise<ReserveResult> {
	if (!Number.isInteger(minutes) || minutes < 1) throw new CaptionMinutesError(400, 'invalid_minutes');
	const existing = await readHold(db, holdId);
	if (existing) return { ok: true, hold: existing };
	await payDownOverdraft(db, subject, now);
	const period = captionPeriod(now);
	const at = now.toISOString();
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const o = await observe(db, subject, period, at);
		const balance = balanceOf(o);
		if (balance !== null && balance <= 0) return { ok: false, usage: await readUsage(db, subject, now) };
		const plan = planCharge(o, minutes);
		const monthMinutes = plan.months.reduce((n, m) => n + m.minutes, 0);
		const guard = unchanged(o);
		const results = await db.batch([
			db
				.prepare(
					`INSERT INTO caption_minute_holds (hold_id, user_id, period, minutes, month_minutes, packs_json, state, charged, created_at, updated_at)
					 SELECT ?, ?, ?, ?, ?, ?, 'reserved', NULL, ?, ?
					 WHERE NOT EXISTS (SELECT 1 FROM caption_minute_holds WHERE hold_id = ?) AND ${guard.sql}`,
				)
				.bind(holdId, o.userId, period, minutes, monthMinutes, JSON.stringify(plan.packs), at, at, holdId, ...guard.values),
			...planStatements(db, o.userId, plan, { id: `${holdId}:start`, holdId, kind: 'start', minutes, balanceAfter: balanceAfter(o, plan), period }, at),
		]);
		if (firstChanged(results)) return { ok: true, hold: (await readHold(db, holdId))! };
		const raced = await readHold(db, holdId);
		if (raced) return { ok: true, hold: raced };
		logger.debug('[CaptionMinutes] Start raced another change; planning again', { holdId, attempt });
	}
	throw new CaptionMinutesError(409, 'try_again');
}

type SettleKind = 'settle' | 'cancel' | 'refund';

/**
 * Ends a hold at `charged` minutes: the difference from the estimate is charged (possibly into
 * the overdraft) or given back. Once: a hold that is no longer reserved is returned as it is.
 */
async function settleHold(db: D1Database, holdId: string, charged: number, kind: SettleKind, now: Date): Promise<CaptionHold | null> {
	const at = now.toISOString();
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const hold = await readHold(db, holdId);
		if (!hold || hold.state !== 'reserved') return hold;
		const subject = await subjectOfUser(db, hold.userId);
		const o = await observe(db, subject, captionPeriod(now), at);
		const delta = charged - hold.minutes;
		const plan = delta > 0 ? planCharge(o, delta) : delta < 0 ? planGiveBack(o, hold, -delta) : { months: [], packs: [], overdraft: 0 };
		const state = kind === 'refund' || charged === 0 ? 'released' : 'committed';
		const guard = unchanged(o);
		const results = await db.batch([
			db
				.prepare(`UPDATE caption_minute_holds SET state = ?, charged = ?, updated_at = ? WHERE hold_id = ? AND state = 'reserved' AND ${guard.sql}`)
				.bind(state, charged, at, holdId, ...guard.values),
			...planStatements(db, hold.userId, plan, { id: `${holdId}:${kind}`, holdId, kind, minutes: delta, balanceAfter: balanceAfter(o, plan), period: o.period }, at),
		]);
		if (firstChanged(results)) return readHold(db, holdId);
		logger.debug('[CaptionMinutes] Settling raced another change; planning again', { holdId, kind, attempt });
	}
	throw new CaptionMinutesError(409, 'try_again');
}

/** The job finished: it costs the minutes it used, more or fewer than the estimate. */
export async function commitMinutes(db: D1Database, holdId: string, actual: number, now = new Date()): Promise<CaptionHold | null> {
	return settleHold(db, holdId, Math.max(0, Math.ceil(actual)), 'settle', now);
}

/** Cancelled before its draft was written: it costs what it had transcribed, the rest comes back. */
export async function cancelMinutes(db: D1Database, holdId: string, used: number, now = new Date()): Promise<CaptionHold | null> {
	return settleHold(db, holdId, Math.max(0, Math.ceil(used)), 'cancel', now);
}

/** The job failed (or never ran): every minute comes back, once. */
export async function releaseMinutes(db: D1Database, holdId: string, now = new Date()): Promise<CaptionHold | null> {
	return settleHold(db, holdId, 0, 'refund', now);
}

/** The newest balance changes of a subject (the admin's user page). */
export async function listLedger(db: D1Database, userId: string, limit = 50): Promise<CaptionLedgerEntry[]> {
	const rows =
		(
			await db
				.prepare('SELECT * FROM caption_minute_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
				.bind(userId, limit)
				.all<{ id: string; hold_id: string | null; kind: CaptionLedgerEntry['kind']; minutes: number; balance_after: number | null; period: string; created_at: string }>()
		).results ?? [];
	return rows.map((r) => ({
		id: r.id,
		holdId: r.hold_id,
		kind: r.kind,
		minutes: Number(r.minutes),
		balanceAfter: r.balance_after === null ? null : Number(r.balance_after),
		period: r.period,
		createdAt: r.created_at,
	}));
}

// --- Admin grants -------------------------------------------------------------

export interface GrantInput {
	minutes?: unknown;
	scope?: unknown;
	reason?: unknown;
}

export async function addGrant(db: D1Database, userId: string, input: GrantInput, actorId: string, now = new Date()): Promise<CaptionMinuteGrant> {
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw new CaptionMinutesError(400, 'invalid_user');
	const minutes = typeof input.minutes === 'string' ? Number(input.minutes) : input.minutes;
	const { min, max } = CAPTION_GRANT_BOUNDS.minutes;
	if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < min || minutes > max) {
		throw new CaptionMinutesError(400, 'invalid_grant', `minutes must be a whole number from ${min} to ${max}`);
	}
	const scope = (CAPTION_GRANT_SCOPES as readonly unknown[]).includes(input.scope) ? (input.scope as CaptionGrantScope) : null;
	if (!scope) throw new CaptionMinutesError(400, 'invalid_grant', 'scope must be month or until_used');
	const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
	if (!reason || reason.length > CAPTION_GRANT_BOUNDS.reason.max) throw new CaptionMinutesError(400, 'invalid_grant', 'a reason is required (at most 500 characters)');
	const grant: CaptionMinuteGrant = {
		id: crypto.randomUUID(),
		userId,
		minutes,
		scope,
		period: scope === 'month' ? captionPeriod(now) : null,
		used: 0,
		reason,
		createdBy: actorId,
		createdAt: now.toISOString(),
		revokedAt: null,
		revokedBy: null,
		revokeReason: null,
	};
	await db
		.prepare('INSERT INTO caption_minute_grants (id, user_id, minutes, scope, period, used, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)')
		.bind(grant.id, userId, minutes, scope, grant.period, reason, actorId, grant.createdAt)
		.run();
	// A grant pays an overdraft first
	await payDownOverdraft(db, await subjectOfUser(db, userId), now);
	return grant;
}

/** Revoking stops further use; minutes already charged stay charged. */
export async function revokeGrant(db: D1Database, userId: string, grantId: string, reasonInput: unknown, actorId: string, now = new Date()): Promise<CaptionMinuteGrant> {
	const reason = typeof reasonInput === 'string' ? reasonInput.trim() : '';
	if (!reason || reason.length > CAPTION_GRANT_BOUNDS.reason.max) throw new CaptionMinutesError(400, 'invalid_grant', 'a reason is required (at most 500 characters)');
	const row = await db.prepare('SELECT * FROM caption_minute_grants WHERE id = ? AND user_id = ?').bind(grantId, userId).first<GrantRow>();
	if (!row) throw new CaptionMinutesError(404, 'grant_not_found');
	if (row.revoked_at) throw new CaptionMinutesError(409, 'grant_revoked');
	const at = now.toISOString();
	await db
		.prepare('UPDATE caption_minute_grants SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL')
		.bind(at, actorId, reason, grantId)
		.run();
	return toGrant({ ...row, revoked_at: at, revoked_by: actorId, revoke_reason: reason });
}

/**
 * Account erasure: the user's caption-minute usage, holds, grants and the jobs they paid for go
 * with the account. Jobs they asked for on someone else's minutes (a channel editor on the
 * owner's) stay with the payer, anonymised; one still running is cancelled and its minutes go
 * back to the payer (one already writing its draft finishes and is charged as usual).
 */
export async function eraseCaptionMinutes(db: D1Database, userId: string, now = new Date()): Promise<void> {
	const at = now.toISOString();
	const running =
		(
			await db
				.prepare("SELECT id FROM caption_jobs WHERE requested_by = ? AND subject_id != ? AND status NOT IN ('ready', 'failed', 'cancelled', 'postprocessing')")
				.bind(userId, userId)
				.all<{ id: string }>()
		).results ?? [];
	for (const { id } of running) {
		const changed = await db
			.prepare("UPDATE caption_jobs SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ? AND status NOT IN ('ready', 'failed', 'cancelled', 'postprocessing')")
			.bind(at, at, id)
			.run();
		if ((changed.meta?.changes ?? 0) > 0) await releaseMinutes(db, id, now);
	}
	await db.prepare("UPDATE caption_jobs SET requested_by = 'erased-user' WHERE requested_by = ? AND subject_id != ?").bind(userId, userId).run();
	for (const table of ['caption_minute_usage', 'caption_minute_holds', 'caption_minute_grants', 'caption_minute_overdraft', 'caption_minute_ledger']) {
		await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId).run();
	}
	// The jobs they paid for; a running one ends at the processor's next report (404)
	await db.prepare('DELETE FROM caption_jobs WHERE subject_id = ?').bind(userId).run();
}
