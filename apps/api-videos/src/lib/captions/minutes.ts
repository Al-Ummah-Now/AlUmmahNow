/**
 * Caption minutes (AUN-CAPTIONS §6; shared-types caption-minutes.ts): the
 * allowance, the admin's grants, and the reserve → commit / release of a job's
 * minutes. SEARCH_DB (migration 0032).
 *
 * Who pays: the tier holder that resolveCreator names (the channel owner, or a
 * super admin themselves). Every change is a conditional update, so a
 * reservation never takes a month past its limit or a grant past its minutes;
 * one that loses a race is undone and retried. A hold is changed only while
 * it is `reserved`, so a commit or a refund happens once.
 */
import {
	CAPTION_GRANT_BOUNDS,
	CAPTION_GRANT_SCOPES,
	captionPeriod,
	captionUsageFrom,
	type CaptionGrantScope,
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

async function monthFigures(db: D1Database, userId: string, period: string): Promise<{ granted: number; used: number }> {
	const [granted, used] = await Promise.all([
		db
			.prepare("SELECT COALESCE(SUM(minutes), 0) AS n FROM caption_minute_grants WHERE user_id = ? AND scope = 'month' AND period = ? AND revoked_at IS NULL")
			.bind(userId, period)
			.first<{ n: number }>(),
		db.prepare('SELECT minutes FROM caption_minute_usage WHERE user_id = ? AND period = ?').bind(userId, period).first<{ minutes: number }>(),
	]);
	return { granted: Number(granted?.n ?? 0), used: Number(used?.minutes ?? 0) };
}

export async function readUsage(db: D1Database, subject: MinutesSubject, now = new Date()): Promise<CaptionMinutesUsage> {
	const period = captionPeriod(now);
	const [month, packs] = await Promise.all([monthFigures(db, subject.subjectId, period), openPacks(db, subject.subjectId)]);
	return captionUsageFrom({
		period,
		unlimited: subject.unlimited,
		via: subject.via,
		tierMinutes: subject.tierMinutes,
		monthGranted: month.granted,
		monthUsed: month.used,
		packsRemaining: packs.reduce((n, p) => n + p.left, 0),
	});
}

export interface CaptionHold {
	holdId: string;
	userId: string;
	period: string;
	minutes: number;
	monthMinutes: number;
	packs: Array<{ grantId: string; minutes: number }>;
	state: 'reserved' | 'committed' | 'released';
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

export type ReserveResult = { ok: true; hold: CaptionHold } | { ok: false; usage: CaptionMinutesUsage };

/**
 * Reserves `minutes` for `holdId` (a job id): this month's allowance first,
 * then "until used" grants, oldest first. Idempotent: a hold that exists is
 * returned as it is, never charged twice.
 */
export async function reserveMinutes(db: D1Database, subject: MinutesSubject, holdId: string, minutes: number, now = new Date()): Promise<ReserveResult> {
	if (!Number.isInteger(minutes) || minutes < 1) throw new CaptionMinutesError(400, 'invalid_minutes');
	const existing = await readHold(db, holdId);
	if (existing) return { ok: true, hold: existing };
	const period = captionPeriod(now);
	const at = now.toISOString();
	const userId = subject.subjectId;
	await db.prepare('INSERT OR IGNORE INTO caption_minute_usage (user_id, period, minutes, updated_at) VALUES (?, ?, 0, ?)').bind(userId, period, at).run();

	for (let attempt = 0; attempt < 3; attempt++) {
		const month = await monthFigures(db, userId, period);
		const limit = subject.unlimited ? Number.MAX_SAFE_INTEGER : subject.tierMinutes + month.granted;
		const fromMonth = Math.max(0, Math.min(minutes, limit - month.used));
		let rest = minutes - fromMonth;
		const packs: CaptionHold['packs'] = [];
		if (rest > 0) {
			for (const p of await openPacks(db, userId)) {
				const take = Math.min(p.left, rest);
				packs.push({ grantId: p.id, minutes: take });
				rest -= take;
				if (rest === 0) break;
			}
		}
		if (rest > 0) return { ok: false, usage: await readUsage(db, subject, now) };

		// Nothing from the month: no month statement (its row may already be over a lowered limit)
		const statements = [
			...(fromMonth > 0
				? [
						db
							.prepare('UPDATE caption_minute_usage SET minutes = minutes + ?, updated_at = ? WHERE user_id = ? AND period = ? AND minutes + ? <= ?')
							.bind(fromMonth, at, userId, period, fromMonth, limit),
					]
				: []),
			...packs.map((p) =>
				db
					.prepare('UPDATE caption_minute_grants SET used = used + ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND used + ? <= minutes')
					.bind(p.minutes, p.grantId, userId, p.minutes),
			),
		];
		const changed = statements.length ? (await db.batch(statements)).map((r) => (r.meta?.changes ?? 0) > 0) : [];
		const applied = fromMonth > 0 ? changed : [true, ...changed];
		if (applied.every(Boolean)) {
			const hold: CaptionHold = { holdId, userId, period, minutes, monthMinutes: fromMonth, packs, state: 'reserved', charged: null };
			const inserted = await db
				.prepare(
					`INSERT OR IGNORE INTO caption_minute_holds (hold_id, user_id, period, minutes, month_minutes, packs_json, state, charged, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, 'reserved', NULL, ?, ?)`,
				)
				.bind(holdId, userId, period, minutes, fromMonth, JSON.stringify(packs), at, at)
				.run();
			if ((inserted.meta?.changes ?? 0) > 0) return { ok: true, hold };
			// The same job reserved meanwhile: give these minutes back and use that hold
			await giveBack(db, { userId, period, monthMinutes: fromMonth, packs }, at);
			return { ok: true, hold: (await readHold(db, holdId))! };
		}
		// Lost a race (or a grant was revoked meanwhile): undo what applied, then look again
		await giveBack(
			db,
			{ userId, period, monthMinutes: applied[0] ? fromMonth : 0, packs: packs.filter((_, i) => applied[i + 1]) },
			at,
		);
		logger.debug('[CaptionMinutes] Reservation raced; retrying', { holdId, attempt });
	}
	return { ok: false, usage: await readUsage(db, subject, now) };
}

async function giveBack(db: D1Database, part: { userId: string; period: string; monthMinutes: number; packs: CaptionHold['packs'] }, at: string): Promise<void> {
	const statements = [
		...(part.monthMinutes > 0
			? [db.prepare('UPDATE caption_minute_usage SET minutes = MAX(0, minutes - ?), updated_at = ? WHERE user_id = ? AND period = ?').bind(part.monthMinutes, at, part.userId, part.period)]
			: []),
		...part.packs.map((p) => db.prepare('UPDATE caption_minute_grants SET used = MAX(0, used - ?) WHERE id = ?').bind(p.minutes, p.grantId)),
	];
	if (statements.length) await db.batch(statements);
}

/** Each statement acts only while the hold is still reserved; the last one settles it. */
async function settle(db: D1Database, hold: CaptionHold, back: { monthMinutes: number; packs: CaptionHold['packs'] }, state: 'committed' | 'released', charged: number | null, at: string): Promise<boolean> {
	const reserved = 'EXISTS (SELECT 1 FROM caption_minute_holds WHERE hold_id = ? AND state = \'reserved\')';
	const statements = [
		...(back.monthMinutes > 0
			? [
					db
						.prepare(`UPDATE caption_minute_usage SET minutes = MAX(0, minutes - ?), updated_at = ? WHERE user_id = ? AND period = ? AND ${reserved}`)
						.bind(back.monthMinutes, at, hold.userId, hold.period, hold.holdId),
				]
			: []),
		...back.packs.map((p) => db.prepare(`UPDATE caption_minute_grants SET used = MAX(0, used - ?) WHERE id = ? AND ${reserved}`).bind(p.minutes, p.grantId, hold.holdId)),
		db.prepare("UPDATE caption_minute_holds SET state = ?, charged = ?, updated_at = ? WHERE hold_id = ? AND state = 'reserved'").bind(state, charged, at, hold.holdId),
	];
	const results = await db.batch(statements);
	return (results[results.length - 1]?.meta?.changes ?? 0) > 0;
}

/**
 * The job finished: `actual` minutes (≤ reserved) stand; the rest goes back,
 * "until used" grants first (newest taken first), then the month.
 */
export async function commitMinutes(db: D1Database, holdId: string, actual: number, now = new Date()): Promise<CaptionHold | null> {
	const hold = await readHold(db, holdId);
	if (!hold || hold.state !== 'reserved') return hold;
	const charged = Math.max(0, Math.min(hold.minutes, Math.ceil(actual)));
	let extra = hold.minutes - charged;
	const packs: CaptionHold['packs'] = [];
	for (const p of [...hold.packs].reverse()) {
		if (extra === 0) break;
		const back = Math.min(p.minutes, extra);
		packs.push({ grantId: p.grantId, minutes: back });
		extra -= back;
	}
	const monthMinutes = Math.min(hold.monthMinutes, extra);
	await settle(db, hold, { monthMinutes, packs }, 'committed', charged, now.toISOString());
	return readHold(db, holdId);
}

/** The job failed or was cancelled: every reserved minute goes back (once). */
export async function releaseMinutes(db: D1Database, holdId: string, now = new Date()): Promise<CaptionHold | null> {
	const hold = await readHold(db, holdId);
	if (!hold || hold.state !== 'reserved') return hold;
	await settle(db, hold, { monthMinutes: hold.monthMinutes, packs: hold.packs }, 'released', 0, now.toISOString());
	return readHold(db, holdId);
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

/** Account erasure: the user's caption-minute usage, holds and grants go with the account. */
export async function eraseCaptionMinutes(db: { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } } }, userId: string): Promise<void> {
	for (const table of ['caption_minute_usage', 'caption_minute_holds', 'caption_minute_grants']) {
		await db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId).run();
	}
}
