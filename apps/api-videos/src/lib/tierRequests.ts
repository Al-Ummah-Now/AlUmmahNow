/**
 * Tier requests (wiki AUN-TIER-REQUESTS; packages/shared-types tier-requests.ts,
 * migrations/search/0063).
 *
 * A signed-in user asks for a requestable tier on /upgrade (name + about). One
 * open request per user (a partial unique index, so parallel submits cannot
 * both land) and at most TIER_REQUESTS_PER_30_DAYS a month. The videos admin
 * decides through admin-api, which checks creators:manage and writes the audit
 * row; approving assigns the tier in the same D1 batch that marks the request
 * approved, so a request is never approved without its tier (or the reverse).
 * The decision is delivered by admin-api's queued tier-request job, which
 * calls notify (in-app, deduplicated) and records the email outcome here.
 */
import {
	DEFAULT_TIER_ID,
	TIER_REQUEST_ERRORS,
	TIER_REQUEST_HISTORY_PAGE,
	type TierRequestHistoryPage,
	TIER_REQUEST_LIMITS,
	TIER_REQUEST_STATUSES,
	TIER_REQUESTS_PER_30_DAYS,
	toPublicTier,
	type AdminTierRequestFilter,
	type AdminTierRequestRow,
	type AdminTierRequestsPage,
	type CreatorTier,
	type NotificationCreatePayload,
	type TierRequest,
	type TierRequestInput,
	type TierRequestStatus,
	type UpgradeMode,
	type UpgradeOverview,
} from '@al-ummah/shared-types';
import { readAssignments, readTier, readTiers, resolveCreator, SUPER_ADMIN_ASSIGNER } from './creatorTiers';
import { readMany } from './admin/directory';

export class TierRequestError extends Error {
	constructor(readonly status: number, readonly code: string, message = code) {
		super(message);
	}
}

interface RequestRow {
	id: string;
	user_id: string;
	tier_id: string;
	tier_name: string;
	from_tier_id: string;
	name: string;
	about: string;
	status: string;
	decline_reason: string | null;
	created_at: string;
	decided_at: string | null;
	decided_by: string | null;
	notified_at?: string | null;
	email_status?: string | null;
	email_error?: string | null;
}

const toRequest = (row: RequestRow): TierRequest => ({
	id: row.id,
	userId: row.user_id,
	tierId: row.tier_id,
	tierName: row.tier_name,
	fromTierId: row.from_tier_id,
	name: row.name,
	about: row.about,
	status: (TIER_REQUEST_STATUSES as readonly string[]).includes(row.status) ? (row.status as TierRequestStatus) : 'pending',
	declineReason: row.decline_reason,
	createdAt: row.created_at,
	decidedAt: row.decided_at,
	decidedBy: row.decided_by,
});

/** A request as its author sees it: never which staff member decided it. */
export const ownRequest = (request: TierRequest): TierRequest => ({ ...request, decidedBy: null });

/** Collapses runs of whitespace inside a line; keeps the about text's line breaks (at most two in a row). */
function clean(value: unknown, multiline: boolean): string {
	if (typeof value !== 'string') return '';
	// eslint-disable-next-line no-control-regex
	const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
	if (!multiline) return text.replace(/\s+/g, ' ').trim();
	return text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.replace(/[ \t]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Validates and trims a request body (TIER_REQUEST_LIMITS, in characters). */
export function validateRequestInput(input: Partial<TierRequestInput> | null | undefined): { tierId: string; name: string; about: string } {
	const tierId = typeof input?.tierId === 'string' ? input.tierId.trim() : '';
	const name = clean(input?.name, false);
	const about = clean(input?.about, true);
	const len = (s: string) => [...s].length;
	if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(tierId)) throw new TierRequestError(400, TIER_REQUEST_ERRORS.invalid, 'tierId is required');
	if (len(name) < TIER_REQUEST_LIMITS.name.min || len(name) > TIER_REQUEST_LIMITS.name.max) {
		throw new TierRequestError(400, TIER_REQUEST_ERRORS.invalid, `name must be ${TIER_REQUEST_LIMITS.name.min} to ${TIER_REQUEST_LIMITS.name.max} characters`);
	}
	if (len(about) < TIER_REQUEST_LIMITS.about.min || len(about) > TIER_REQUEST_LIMITS.about.max) {
		throw new TierRequestError(400, TIER_REQUEST_ERRORS.invalid, `about must be ${TIER_REQUEST_LIMITS.about.min} to ${TIER_REQUEST_LIMITS.about.max} characters`);
	}
	return { tierId, name, about };
}

/** The user's latest request (any status), or null. */
export async function latestRequest(db: D1Database, userId: string): Promise<TierRequest | null> {
	// Ids are random: in a same-millisecond tie the pending request is the newer one (one is filed only after the last was decided)
	const row = await db
		.prepare(`SELECT * FROM tier_requests WHERE user_id = ? ORDER BY created_at DESC, status = 'pending' DESC, id DESC LIMIT 1`)
		.bind(userId)
		.first<RequestRow>();
	return row ? toRequest(row) : null;
}

/**
 * The user's own requests, newest first ("Your requests" on /upgrade and in
 * Settings › Tier): keyset on (created_at, id) over idx_tier_requests_user.
 */
export async function listMyRequests(db: D1Database, userId: string, opts: { cursor?: string | null; limit?: number } = {}): Promise<TierRequestHistoryPage> {
	const limit = Math.min(Math.max(Math.trunc(opts.limit ?? TIER_REQUEST_HISTORY_PAGE), 1), 50);
	const after = decodeCursor(opts.cursor ?? undefined);
	const rows =
		(
			await db
				.prepare(
					`SELECT * FROM tier_requests WHERE user_id = ?1 ${after ? 'AND (created_at < ?2 OR (created_at = ?2 AND id < ?3))' : ''}
					 ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`,
				)
				.bind(...(after ? [userId, after.createdAt, after.id] : [userId]))
				.all<RequestRow>()
		).results ?? [];
	const page = rows.slice(0, limit);
	return { items: page.map((r) => ownRequest(toRequest(r))), next: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}

/** The in-app "we received your request" notice (always on). */
export function receivedNotificationPayload(request: Pick<TierRequest, 'id' | 'userId' | 'tierName'>, tier: CreatorTier | null, now = Date.now()): NotificationCreatePayload {
	const nameEn = tier?.name ?? request.tierName;
	const nameAr = tier?.nameAr || nameEn;
	return {
		notificationId: crypto.randomUUID(),
		recipientUserId: request.userId,
		notificationKey: 'tierRequestReceived',
		params: { tier: nameEn, tier_en: nameEn, tier_ar: nameAr },
		actionUrl: '/upgrade',
		entityId: request.id,
		dedupeKey: `tier-request-received:${request.id}`,
		createdAt: now,
	};
}

export async function readRequestRow(db: D1Database, id: string): Promise<RequestRow | null> {
	return db.prepare('SELECT * FROM tier_requests WHERE id = ?').bind(id).first<RequestRow>();
}

const isUniqueViolation = (error: unknown) => /UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error));

/**
 * Files a request. Refuses a tier that is not requestable (or gone), the tier
 * the user already holds, a second open request and more than
 * TIER_REQUESTS_PER_30_DAYS in 30 days.
 */
export async function createTierRequest(
	db: D1Database,
	who: { userId: string; roles?: readonly string[] | null },
	input: Partial<TierRequestInput> | null | undefined,
	now = new Date(),
): Promise<TierRequest> {
	const body = validateRequestInput(input);
	const tier = await readTier(db, body.tierId);
	if (!tier || !tier.requestable) throw new TierRequestError(404, TIER_REQUEST_ERRORS.tierNotRequestable, 'This tier cannot be requested');
	const current = await resolveCreator(db, who);
	const fromTierId = current.tier?.id ?? DEFAULT_TIER_ID;
	if (fromTierId === tier.id) throw new TierRequestError(409, TIER_REQUEST_ERRORS.alreadyHeld, 'You already hold this tier');
	const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
	const counts = await db
		.prepare(
			`SELECT
			   (SELECT COUNT(*) FROM tier_requests WHERE user_id = ?1 AND status = 'pending') AS pending,
			   (SELECT COUNT(*) FROM tier_requests WHERE user_id = ?1 AND created_at >= ?2) AS recent`,
		)
		.bind(who.userId, since)
		.first<{ pending: number; recent: number }>();
	if (Number(counts?.pending) > 0) throw new TierRequestError(409, TIER_REQUEST_ERRORS.alreadyPending, 'You already have a request waiting for a decision');
	if (Number(counts?.recent) >= TIER_REQUESTS_PER_30_DAYS) {
		throw new TierRequestError(429, TIER_REQUEST_ERRORS.tooMany, `At most ${TIER_REQUESTS_PER_30_DAYS} requests in 30 days`);
	}
	const row: RequestRow = {
		id: crypto.randomUUID(),
		user_id: who.userId,
		tier_id: tier.id,
		tier_name: tier.name,
		from_tier_id: fromTierId,
		name: body.name,
		about: body.about,
		status: 'pending',
		decline_reason: null,
		created_at: now.toISOString(),
		decided_at: null,
		decided_by: null,
	};
	try {
		await db
			.prepare(
				`INSERT INTO tier_requests (id, user_id, tier_id, tier_name, from_tier_id, name, about, status, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
			)
			.bind(row.id, row.user_id, row.tier_id, row.tier_name, row.from_tier_id, row.name, row.about, row.created_at)
			.run();
	} catch (error) {
		// A parallel submit won the one-open-request index
		if (isUniqueViolation(error)) throw new TierRequestError(409, TIER_REQUEST_ERRORS.alreadyPending, 'You already have a request waiting for a decision');
		throw error;
	}
	return toRequest(row);
}

/** The user withdraws their pending request. */
export async function withdrawTierRequest(db: D1Database, userId: string, id: string, now = new Date()): Promise<TierRequest> {
	const result = await db
		.prepare(`UPDATE tier_requests SET status = 'withdrawn', decided_at = ?, decided_by = ? WHERE id = ? AND user_id = ? AND status = 'pending'`)
		.bind(now.toISOString(), userId, id, userId)
		.run();
	const row = await readRequestRow(db, id);
	if (!row || row.user_id !== userId) throw new TierRequestError(404, 'tier_request_not_found');
	if (!((result.meta?.changes ?? 0) > 0)) throw new TierRequestError(409, TIER_REQUEST_ERRORS.notPending, 'This request was already decided');
	return toRequest(row);
}

/**
 * What /upgrade shows: requestable tiers plus the viewer's own tier (always,
 * so "Your current tier" has its card even when the admin hid it), in
 * sortOrder; for a signed-in viewer their tier and latest request.
 */
export async function upgradeOverview(
	db: D1Database,
	who: { userId: string; roles?: readonly string[] | null } | null,
	turnstileSiteKey: string | null,
	/** The page's mode (lib/upgradeMode.ts): a provider enabled, or the admin's "Allow tier requests" */
	mode: UpgradeMode = 'request',
): Promise<UpgradeOverview> {
	const [tiers, current, request] = await Promise.all([
		readTiers(db),
		who ? resolveCreator(db, who) : Promise.resolve(null),
		who ? latestRequest(db, who.userId) : Promise.resolve(null),
	]);
	const currentTierId = who ? current?.tier?.id ?? DEFAULT_TIER_ID : null;
	return {
		mode,
		tiers: tiers.filter((t) => t.requestable || t.id === currentTierId).map(toPublicTier),
		currentTierId,
		currentTierSince: current?.since ?? null,
		request: request ? ownRequest(request) : null,
		// The human check is only for the request form
		turnstileSiteKey: mode === 'request' ? turnstileSiteKey : null,
	};
}

// ---------------------------------------------------------------------------
// The admin's queue (admin-api, creators:manage for decisions)
// ---------------------------------------------------------------------------

export interface TierRequestsEnv {
	SEARCH_DB: D1Database;
	profiles: R2Bucket;
}

const CURSOR_SEP = '|';
const encodeCursor = (row: { created_at: string; id: string }) => btoa(`${row.created_at}${CURSOR_SEP}${row.id}`);
function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
	if (!cursor) return null;
	try {
		const [createdAt, id] = atob(cursor).split(CURSOR_SEP);
		return createdAt && id ? { createdAt, id } : null;
	} catch {
		return null;
	}
}

/** Adds who asked and what they hold now (one profile read and one assignment query per page). */
async function enrich(env: TierRequestsEnv, rows: RequestRow[], tiers: CreatorTier[]): Promise<AdminTierRequestRow[]> {
	const ids = [...new Set(rows.map((r) => r.user_id))];
	const [profiles, assignments] = await Promise.all([readMany<Record<string, unknown>>(env.profiles, ids), readAssignments(env.SEARCH_DB, ids)]);
	const tierName = (id: string) => tiers.find((t) => t.id === id)?.name ?? id;
	const tierNameAr = (id: string) => tiers.find((t) => t.id === id)?.nameAr ?? null;
	return rows.map((row) => {
		const profile = profiles.get(row.user_id) ?? null;
		const assignment = assignments.get(row.user_id);
		// An automatic super admin row is only a record of the role (lib/creatorTiers.ts)
		const currentTierId = assignment && tiers.some((t) => t.id === assignment.tierId) ? assignment.tierId : DEFAULT_TIER_ID;
		const display = (profile?.displayName as string) || [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || null;
		return {
			...toRequest(row),
			displayName: display,
			userName: (profile?.userName as string) || null,
			avatarUrl: (profile?.avatarUrl as string) || null,
			currentTierId,
			currentTierName: assignment?.assignedBy === SUPER_ADMIN_ASSIGNER ? tierName('unlimited') : tierName(currentTierId),
			currentTierNameAr: assignment?.assignedBy === SUPER_ADMIN_ASSIGNER ? tierNameAr('unlimited') : tierNameAr(currentTierId),
			tierNameAr: tierNameAr(row.tier_id),
			emailStatus: row.email_status ?? null,
		};
	});
}

/** One page of the queue, newest first (pending: oldest first, the order to work through them). */
export async function listTierRequests(
	env: TierRequestsEnv,
	query: { filter?: AdminTierRequestFilter; cursor?: string; pageSize?: number },
): Promise<AdminTierRequestsPage> {
	const db = env.SEARCH_DB;
	const filter = query.filter ?? 'pending';
	const size = Math.min(Math.max(Math.floor(query.pageSize ?? 25), 1), 100);
	const after = decodeCursor(query.cursor);
	const oldestFirst = filter === 'pending';
	const where: string[] = [];
	const binds: unknown[] = [];
	if (filter !== 'all') {
		where.push('status = ?');
		binds.push(filter);
	}
	if (after) {
		where.push(oldestFirst ? '(created_at > ? OR (created_at = ? AND id > ?))' : '(created_at < ? OR (created_at = ? AND id < ?))');
		binds.push(after.createdAt, after.createdAt, after.id);
	}
	const order = oldestFirst ? 'created_at ASC, id ASC' : 'created_at DESC, id DESC';
	const [rows, pending, tiers] = await Promise.all([
		db
			.prepare(`SELECT * FROM tier_requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`)
			.bind(...binds, size + 1)
			.all<RequestRow>(),
		db.prepare(`SELECT COUNT(*) AS n FROM tier_requests WHERE status = 'pending'`).first<{ n: number }>(),
		readTiers(db),
	]);
	const results = rows.results ?? [];
	const page = results.slice(0, size);
	return {
		items: await enrich(env, page, tiers),
		next: results.length > size ? encodeCursor(page[page.length - 1]) : null,
		pending: Number(pending?.n) || 0,
	};
}

/** One request with the asker's details (the admin's decision dialog and the delivery job). */
export async function readTierRequestForAdmin(env: TierRequestsEnv, id: string): Promise<AdminTierRequestRow & { notifiedAt: string | null }> {
	const row = await readRequestRow(env.SEARCH_DB, id);
	if (!row) throw new TierRequestError(404, 'tier_request_not_found');
	const [item] = await enrich(env, [row], await readTiers(env.SEARCH_DB));
	return { ...item, notifiedAt: row.notified_at ?? null };
}

/**
 * Approves (assigns the tier) or declines (optional reason) a pending request.
 * One D1 batch: the request moves to its decision only if it is still pending,
 * and the assignment is written only if that move happened (checked by the
 * decision's own timestamp), so two admins deciding at once cannot both win.
 */
export async function decideTierRequest(
	db: D1Database,
	id: string,
	decision: { approve: boolean; reason?: string | null; actorId: string },
	now = new Date(),
): Promise<{ request: TierRequest }> {
	const row = await readRequestRow(db, id);
	if (!row) throw new TierRequestError(404, 'tier_request_not_found');
	if (row.status !== 'pending') throw new TierRequestError(409, TIER_REQUEST_ERRORS.notPending, 'This request was already decided');
	const reason = decision.approve ? null : clean(decision.reason ?? '', true).slice(0, TIER_REQUEST_LIMITS.declineReason.max) || null;
	const at = now.toISOString();
	const status: TierRequestStatus = decision.approve ? 'approved' : 'declined';
	const move = db
		.prepare(`UPDATE tier_requests SET status = ?, decline_reason = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'`)
		.bind(status, reason, at, decision.actorId, id);
	const statements = [move];
	if (decision.approve) {
		const tier = await readTier(db, row.tier_id);
		if (!tier) throw new TierRequestError(409, 'tier_not_found', 'This tier no longer exists; decline the request instead');
		const won = `EXISTS (SELECT 1 FROM tier_requests WHERE id = ? AND status = 'approved' AND decided_at = ? AND decided_by = ?)`;
		statements.push(
			tier.id === DEFAULT_TIER_ID
				? // Member is what no row means (assignTier)
					db.prepare(`DELETE FROM creator_tier_assignments WHERE user_id = ? AND ${won}`).bind(row.user_id, id, at, decision.actorId)
				: db
						.prepare(
							`INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at)
							 SELECT ?, ?, 'admin', ?, ? WHERE ${won}
							 ON CONFLICT (user_id) DO UPDATE SET tier_id = excluded.tier_id, source = excluded.source,
							   assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at`,
						)
						.bind(row.user_id, tier.id, decision.actorId, at, id, at, decision.actorId),
		);
	}
	const [moved] = await db.batch(statements);
	if (!((moved.meta?.changes ?? 0) > 0)) throw new TierRequestError(409, TIER_REQUEST_ERRORS.notPending, 'This request was already decided');
	return { request: toRequest({ ...row, status, decline_reason: reason, decided_at: at, decided_by: decision.actorId }) };
}

/** The in-app notice of a decision (category account: always delivered). One per decision, however often the job retries. */
export function decisionNotificationPayload(request: Pick<TierRequest, 'id' | 'userId' | 'status' | 'decidedAt' | 'tierName'>, tier: CreatorTier | null, now = Date.now()): NotificationCreatePayload {
	const nameEn = tier?.name ?? request.tierName;
	const nameAr = tier?.nameAr || nameEn;
	return {
		notificationId: crypto.randomUUID(),
		recipientUserId: request.userId,
		notificationKey: request.status === 'approved' ? 'tierRequestApproved' : 'tierRequestDeclined',
		params: { tier: nameEn, tier_en: nameEn, tier_ar: nameAr },
		actionUrl: '/upgrade',
		entityId: request.id,
		dedupeKey: `tier-request:${request.id}:${request.decidedAt ?? ''}`,
		createdAt: now,
	};
}

/** Records what the delivery job did (the admin queue shows the email outcome). */
export async function recordDelivery(db: D1Database, id: string, update: { notified?: boolean; emailStatus?: string; emailError?: string | null }, now = new Date()): Promise<void> {
	const sets: string[] = [];
	const binds: unknown[] = [];
	if (update.notified) {
		sets.push('notified_at = COALESCE(notified_at, ?)');
		binds.push(now.toISOString());
	}
	if (update.emailStatus) {
		sets.push('email_status = ?', 'email_error = ?');
		binds.push(update.emailStatus, update.emailError ?? null);
	}
	if (!sets.length) return;
	await db.prepare(`UPDATE tier_requests SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
}
