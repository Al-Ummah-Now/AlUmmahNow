/**
 * Creator tiers: who may upload and create channels, and within which limits
 * (packages/shared-types/src/creator-tiers.ts, migrations/search/0009).
 *
 * - No tier ("None", the default): no uploads, no channel creation.
 * - A tier: its upload limits and channel limit; `unlimited` has none.
 * - The videos "Super Admin" role: always Unlimited, no row needed.
 * - An upload to a channel runs under the channel OWNER's tier and counts
 *   against the owner's limits, so a channel's managers and editors work
 *   under one creator tier.
 *
 * Assignments are read from D1 on every call (no cache), so assigning or
 * removing a tier applies to the next request, without signing in again.
 * Tier definitions fall back to the shipped defaults when their row is
 * missing; an assignment that cannot be read is an error (the caller fails
 * closed with 503), never a silent grant or a silent refusal.
 */
import {
	CREATOR_TIER_BOUNDS,
	CREATOR_TIER_SOURCES,
	DEFAULT_CREATOR_TIER,
	DEFAULT_UNLIMITED_TIER,
	type CreatorTier,
	type CreatorTierAssignment,
	type CreatorTierSource,
	isSuperAdmin as isSuperAdminRole,
} from '@al-ummah/shared-types';

import { logger } from './logger';

const SHIPPED_TIERS: CreatorTier[] = [
	{ ...DEFAULT_CREATOR_TIER, updatedAt: null, updatedBy: null },
	{ ...DEFAULT_UNLIMITED_TIER, updatedAt: null, updatedBy: null },
];

/** The videos "Super Admin" role (the shared role check, packages/shared-types roles.ts). */
export const isSuperAdmin = (roles: readonly string[] | undefined | null) => isSuperAdminRole(roles);

export class CreatorTierError extends Error {
	constructor(readonly status: number, readonly code: string, message = code) {
		super(message);
	}
}

interface TierRow {
	id: string;
	name: string;
	unlimited: number;
	per_hour: number;
	per_day: number;
	max_concurrent: number;
	max_channels: number | null;
	updated_at: string | null;
	updated_by: string | null;
}

function toTier(row: TierRow): CreatorTier {
	return {
		id: row.id,
		name: row.name,
		unlimited: Number(row.unlimited) === 1,
		perHour: Number(row.per_hour),
		perDay: Number(row.per_day),
		maxConcurrent: Number(row.max_concurrent),
		maxChannels: row.max_channels === null || row.max_channels === undefined ? null : Number(row.max_channels),
		updatedAt: row.updated_at ?? null,
		updatedBy: row.updated_by ?? null,
	};
}

/**
 * Every tier definition. A shipped tier whose row is missing (or D1 errors)
 * uses its default, so the limits never disappear.
 */
export async function readTiers(db: D1Database): Promise<CreatorTier[]> {
	let rows: TierRow[] = [];
	try {
		rows = (await db.prepare('SELECT * FROM creator_tiers ORDER BY unlimited, name').all<TierRow>()).results ?? [];
	} catch {
		rows = [];
	}
	const tiers = rows.map(toTier);
	for (const shipped of SHIPPED_TIERS) if (!tiers.some((t) => t.id === shipped.id)) tiers.push(shipped);
	return tiers;
}

export async function readTier(db: D1Database, id: string): Promise<CreatorTier | null> {
	return (await readTiers(db)).find((t) => t.id === id) ?? null;
}

interface AssignmentRow {
	user_id: string;
	tier_id: string;
	source: string;
	assigned_by: string;
	assigned_at: string;
}

const toAssignment = (row: AssignmentRow): CreatorTierAssignment => ({
	userId: row.user_id,
	tierId: row.tier_id,
	source: (CREATOR_TIER_SOURCES as readonly string[]).includes(row.source) ? (row.source as CreatorTierSource) : 'admin',
	assignedBy: row.assigned_by,
	assignedAt: row.assigned_at,
});

/** The user's assignment, or null. Throws when D1 cannot answer. */
export async function readAssignment(db: D1Database, userId: string): Promise<CreatorTierAssignment | null> {
	const row = await db.prepare('SELECT * FROM creator_tier_assignments WHERE user_id = ?').bind(userId).first<AssignmentRow>();
	return row ? toAssignment(row) : null;
}

export async function readAssignments(db: D1Database, userIds: string[]): Promise<Map<string, CreatorTierAssignment>> {
	if (!userIds.length) return new Map();
	const { results } = await db
		.prepare('SELECT * FROM creator_tier_assignments WHERE user_id IN (SELECT value FROM json_each(?))')
		.bind(JSON.stringify(userIds))
		.all<AssignmentRow>();
	return new Map((results ?? []).map((r) => [r.user_id, toAssignment(r)]));
}

/** Whose tier and limits apply to a request, and why. */
export interface ResolvedCreator {
	/** The user whose tier applies and whose counters move (the channel owner for a channel upload) */
	subjectId: string;
	tier: CreatorTier | null;
	via: 'tier' | 'super_admin' | 'none';
}

/** Who stored a super admin's automatic Unlimited assignment */
export const SUPER_ADMIN_ASSIGNER = 'system:super-admin';

/**
 * Super admins hold a stored Unlimited assignment too (owner, 2026-11-10), so
 * their access shows in the admin. It is a record of the role, not a grant:
 * resolveCreator honours it only while the token carries Super Admin and
 * deletes it once the role is gone, so a revoked super admin keeps nothing.
 * Written once, on first sight; never overwrites a tier an admin set. A failed
 * write is logged, never blocks the request.
 */
async function storeSuperAdminTier(db: D1Database, userId: string): Promise<void> {
	try {
		await db
			.prepare(
				`INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES (?, 'unlimited', 'admin', ?, ?)
				 ON CONFLICT (user_id) DO NOTHING`,
			)
			.bind(userId, SUPER_ADMIN_ASSIGNER, new Date().toISOString())
			.run();
	} catch (error) {
		logger.warn('[Creator] Could not store the super admin Unlimited tier', { userId, error: error instanceof Error ? error.message : String(error) });
	}
}

/** Removes an automatic super admin row (the role was revoked); admin-set tiers are untouched. */
async function dropSuperAdminTier(db: D1Database, userId: string): Promise<void> {
	try {
		await db.prepare('DELETE FROM creator_tier_assignments WHERE user_id = ? AND assigned_by = ?').bind(userId, SUPER_ADMIN_ASSIGNER).run();
		logger.info('[Creator] Removed the automatic Unlimited tier of a former super admin', { userId });
	} catch (error) {
		logger.warn('[Creator] Could not remove a former super admin Unlimited tier', { userId, error: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * The tier that applies to `userId` acting (optionally) on a channel owned by
 * `channelOwnerId`. Throws when D1 cannot answer (fail closed).
 */
export async function resolveCreator(
	db: D1Database,
	who: { userId: string; roles?: readonly string[] | null; channelOwnerId?: string | null },
): Promise<ResolvedCreator> {
	const unlimited = { ...DEFAULT_UNLIMITED_TIER, updatedAt: null, updatedBy: null };
	const ownChannel = !who.channelOwnerId || who.channelOwnerId === who.userId;
	if (ownChannel && isSuperAdmin(who.roles)) {
		await storeSuperAdminTier(db, who.userId);
		return { subjectId: who.userId, tier: unlimited, via: 'super_admin' };
	}
	const subjectId = ownChannel ? who.userId : (who.channelOwnerId as string);
	let assignment = await readAssignment(db, subjectId);
	// An automatic super admin row is only as good as the role: it never grants
	// on someone else's channel, and once the role is gone it is removed
	if (assignment?.assignedBy === SUPER_ADMIN_ASSIGNER) {
		if (subjectId === who.userId && !isSuperAdmin(who.roles)) await dropSuperAdminTier(db, subjectId);
		assignment = null;
	}
	if (!assignment) {
		// A super admin working on someone else's channel still has their own Unlimited
		if (isSuperAdmin(who.roles)) return { subjectId: who.userId, tier: unlimited, via: 'super_admin' };
		return { subjectId, tier: null, via: 'none' };
	}
	const tier = await readTier(db, assignment.tierId);
	if (!tier && isSuperAdmin(who.roles)) return { subjectId: who.userId, tier: unlimited, via: 'super_admin' };
	return { subjectId, tier, via: tier ? 'tier' : 'none' };
}

/** Assign (tierId) or remove (null) a user's tier. Returns the previous assignment. */
export async function assignTier(
	db: D1Database,
	userId: string,
	tierId: string | null,
	actorId: string,
	source: CreatorTierSource = 'admin',
	now = new Date().toISOString(),
): Promise<{ previous: CreatorTierAssignment | null; assignment: CreatorTierAssignment | null }> {
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) {
		throw new CreatorTierError(400, 'invalid_user');
	}
	const previous = await readAssignment(db, userId);
	if (tierId === null) {
		await db.prepare('DELETE FROM creator_tier_assignments WHERE user_id = ?').bind(userId).run();
		return { previous, assignment: null };
	}
	if (!(await readTier(db, tierId))) throw new CreatorTierError(404, 'tier_not_found');
	const assignment: CreatorTierAssignment = { userId, tierId, source, assignedBy: actorId, assignedAt: now };
	await db
		.prepare(
			`INSERT INTO creator_tier_assignments (user_id, tier_id, source, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (user_id) DO UPDATE SET tier_id = excluded.tier_id, source = excluded.source,
			   assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at`,
		)
		.bind(userId, tierId, source, actorId, now)
		.run();
	return { previous, assignment };
}

export interface TierInput {
	name?: unknown;
	unlimited?: unknown;
	perHour?: unknown;
	perDay?: unknown;
	maxConcurrent?: unknown;
	maxChannels?: unknown;
}

function intIn(value: unknown, field: keyof typeof CREATOR_TIER_BOUNDS): number {
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	const { min, max } = CREATOR_TIER_BOUNDS[field];
	if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
		throw new CreatorTierError(400, 'invalid_tier', `${field} must be a whole number from ${min} to ${max}`);
	}
	return n;
}

/** Validates a full tier definition (the shipped `unlimited` tier stays unlimited). */
export function validateTier(id: string, input: TierInput, current?: CreatorTier | null): Omit<CreatorTier, 'updatedAt' | 'updatedBy'> {
	const name = typeof input.name === 'string' ? input.name.trim() : current?.name ?? '';
	if (!name || name.length > 60) throw new CreatorTierError(400, 'invalid_tier', 'name must be 1 to 60 characters');
	const unlimited = id === DEFAULT_UNLIMITED_TIER.id ? true : input.unlimited === undefined ? current?.unlimited ?? false : input.unlimited === true;
	if (unlimited) return { id, name, unlimited, perHour: 0, perDay: 0, maxConcurrent: 0, maxChannels: null };
	const pick = (field: 'perHour' | 'perDay' | 'maxConcurrent') => intIn(input[field] ?? current?.[field], field);
	const perHour = pick('perHour');
	const perDay = pick('perDay');
	if (perDay < perHour) throw new CreatorTierError(400, 'invalid_tier', 'perDay must be at least perHour');
	const rawChannels = input.maxChannels === undefined ? current?.maxChannels ?? null : input.maxChannels;
	const maxChannels = rawChannels === null || rawChannels === '' ? null : intIn(rawChannels, 'maxChannels');
	return { id, name, unlimited, perHour, perDay, maxConcurrent: pick('maxConcurrent'), maxChannels };
}

/** Creates (new id) or replaces a tier definition. */
export async function saveTier(
	db: D1Database,
	id: string,
	input: TierInput,
	actorId: string,
	opts: { create?: boolean } = {},
	now = new Date().toISOString(),
): Promise<{ previous: CreatorTier | null; tier: CreatorTier }> {
	if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) throw new CreatorTierError(400, 'invalid_tier', 'id must be 2 to 40 lowercase letters, digits or dashes');
	const previous = await readTier(db, id);
	if (opts.create && previous) throw new CreatorTierError(409, 'tier_exists');
	if (!opts.create && !previous) throw new CreatorTierError(404, 'tier_not_found');
	const tier = { ...validateTier(id, input, previous), updatedAt: now, updatedBy: actorId };
	await db
		.prepare(
			`INSERT INTO creator_tiers (id, name, unlimited, per_hour, per_day, max_concurrent, max_channels, updated_at, updated_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET name = excluded.name, unlimited = excluded.unlimited, per_hour = excluded.per_hour,
			   per_day = excluded.per_day, max_concurrent = excluded.max_concurrent, max_channels = excluded.max_channels,
			   updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
		)
		.bind(id, tier.name, tier.unlimited ? 1 : 0, tier.perHour, tier.perDay, tier.maxConcurrent, tier.maxChannels, now, actorId)
		.run();
	return { previous, tier };
}

/** Deletes a tier nobody holds (shipped tiers stay). */
export async function deleteTier(db: D1Database, id: string): Promise<{ previous: CreatorTier }> {
	if (id === DEFAULT_CREATOR_TIER.id || id === DEFAULT_UNLIMITED_TIER.id) throw new CreatorTierError(409, 'tier_shipped', 'The Creator and Unlimited tiers cannot be deleted');
	const previous = await readTier(db, id);
	if (!previous) throw new CreatorTierError(404, 'tier_not_found');
	const held = await db.prepare('SELECT COUNT(*) AS n FROM creator_tier_assignments WHERE tier_id = ?').bind(id).first<{ n: number }>();
	if (Number(held?.n) > 0) throw new CreatorTierError(409, 'tier_in_use', `${held?.n} users hold this tier; assign them another tier first`);
	await db.prepare('DELETE FROM creator_tiers WHERE id = ?').bind(id).run();
	return { previous };
}

/**
 * Channel creation within a tier's limit, safe against parallel requests and
 * against the ownership index (content_ownership, written from the queue)
 * lagging behind: a create first reserves a slot in upload_rate_leases with
 * one conditional INSERT (D1 runs it alone, so N parallel creates take at most
 * the free slots). A reservation counts until its channel is in the index;
 * the create's answer turns it into the channel's id, a failed create drops it.
 */
const CHANNEL_RESERVATION = 'channel_create';
/** A failed or never-indexed create stops counting after this */
const RESERVATION_TTL_SECONDS = 24 * 60 * 60;

/** Channels the user owns plus creates in flight or not indexed yet. */
export async function countChannelSlots(db: D1Database, userId: string, nowMs = Date.now()): Promise<number> {
	const row = await db
		.prepare(
			`SELECT
			   (SELECT COUNT(*) FROM content_ownership WHERE kind = 'channel' AND owner_id = ?1 AND is_deleted = 0)
			 + (SELECT COUNT(*) FROM upload_rate_leases WHERE user_id = ?1 AND operation = ?2 AND expires_at > ?3
			      AND lease_id NOT IN (SELECT id FROM content_ownership WHERE kind = 'channel')) AS n`,
		)
		.bind(userId, CHANNEL_RESERVATION, Math.floor(nowMs / 1000))
		.first<{ n: number }>();
	return Number(row?.n) || 0;
}

/** Reserves a channel slot when fewer than `max` are taken. Returns the reservation id, or null when full. */
export async function reserveChannelSlot(db: D1Database, userId: string, max: number, nowMs = Date.now()): Promise<string | null> {
	const id = `pending:${crypto.randomUUID()}`;
	const now = Math.floor(nowMs / 1000);
	const result = await db
		.prepare(
			`INSERT INTO upload_rate_leases (user_id, operation, lease_id, expires_at)
			 SELECT ?1, ?2, ?3, ?4
			 WHERE (SELECT COUNT(*) FROM content_ownership WHERE kind = 'channel' AND owner_id = ?1 AND is_deleted = 0)
			     + (SELECT COUNT(*) FROM upload_rate_leases WHERE user_id = ?1 AND operation = ?2 AND expires_at > ?5
			          AND lease_id NOT IN (SELECT id FROM content_ownership WHERE kind = 'channel')) < ?6`,
		)
		.bind(userId, CHANNEL_RESERVATION, id, now + RESERVATION_TTL_SECONDS, now, max)
		.run();
	return (result.meta?.changes ?? 0) > 0 ? id : null;
}

/** The create finished: the reservation becomes the channel's id (it stops counting once indexed), or is dropped. */
export async function settleChannelSlot(db: D1Database, userId: string, reservation: string, channelId: string | null): Promise<void> {
	const stmt = channelId
		? db.prepare('UPDATE upload_rate_leases SET lease_id = ? WHERE user_id = ? AND operation = ? AND lease_id = ?').bind(channelId, userId, CHANNEL_RESERVATION, reservation)
		: db.prepare('DELETE FROM upload_rate_leases WHERE user_id = ? AND operation = ? AND lease_id = ?').bind(userId, CHANNEL_RESERVATION, reservation);
	await stmt.run();
}

/** Records an upload-limit refusal (the admin's notice to raise a limit). Never throws. */
export async function recordLimitHit(db: D1Database, userId: string, period: string, tierId: string | null, nowMs = Date.now()): Promise<void> {
	try {
		await db
			.prepare('INSERT INTO upload_limit_hits (id, user_id, period, tier_id, hit_at) VALUES (?, ?, ?, ?, ?)')
			.bind(crypto.randomUUID(), userId, period, tierId, Math.floor(nowMs / 1000))
			.run();
	} catch {
		// The refusal itself is already logged as a warning by the caller
	}
}

export async function pruneLimitHits(db: D1Database, nowMs = Date.now()): Promise<void> {
	await db.prepare('DELETE FROM upload_limit_hits WHERE hit_at < ?').bind(Math.floor(nowMs / 1000) - 30 * 86400).run();
}
