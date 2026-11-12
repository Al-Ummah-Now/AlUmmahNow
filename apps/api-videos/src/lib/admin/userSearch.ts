/**
 * User search for admin pickers (channel ownership transfer).
 *
 * Reuses the admin users list (listUsers: email, display name, user handle,
 * exact usr_ id) and adds what a picker needs on top: a leading "@" is
 * ignored, a channel @handle finds the channel's owner, exact matches rank
 * first, the excluded users (the current owner) are left out, and each user
 * carries their owned-channel count and their role on the channel in question.
 */
import {
	ADMIN_USER_SEARCH_MAX_RESULTS,
	ADMIN_USER_SEARCH_MIN_LENGTH,
	OWNERSHIP_TABLE,
	type AdminUserRow,
	type AdminUserSearchItem,
	type AdminUserSearchQuery,
} from '@al-ummah/shared-types';
import { likeTerm, userRows, type AdminEnv } from './directory';

type Row = Record<string, unknown>;

/** Profiles not soft-deleted by an admin (those are in Recently deleted), as in the users list. */
const LIVE_PROFILE = `p.kind = 'profile' AND p.is_deleted = 0
	AND NOT EXISTS (SELECT 1 FROM admin_deletions d WHERE d.kind = 'user' AND d.target_id = p.id AND d.purged_at IS NULL)`;

/*
 * Exact matches: one small query per field. INDEXED BY pins the expression indexes (search
 * migration 0021): SQLite's planner differs between versions (CI's Node, D1, local) and without it
 * one of them searched only on `kind`, i.e. read every profile; with it SQLite errors instead of
 * silently scanning.
 */
/** ?1 id, ?2 limit */
export const PROFILE_BY_ID_SQL = `SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = 'profile' AND id = ?1 LIMIT ?2`;
/** ?1 the term lower-cased, ?2 limit */
export const PROFILE_BY_EMAIL_SQL = `SELECT id FROM ${OWNERSHIP_TABLE} INDEXED BY idx_content_ownership_email_lower WHERE kind = 'profile' AND lower(email) = ?1 LIMIT ?2`;
/** ?1 the term lower-cased, ?2 limit */
export const PROFILE_BY_HANDLE_SQL = `SELECT id FROM ${OWNERSHIP_TABLE} INDEXED BY idx_content_ownership_handle_lower WHERE kind = 'profile' AND lower(handle) = ?1 LIMIT ?2`;
/** ?1 JSON array of ids: the ones that are live profiles (primary-key lookups) */
export const LIVE_PROFILE_IDS_SQL = `SELECT p.id AS id FROM ${OWNERSHIP_TABLE} p WHERE p.kind = 'profile' AND p.id IN (SELECT value FROM json_each(?1)) AND ${LIVE_PROFILE}`;

/** ?1 the LIKE term, ?2 limit. Stops at the limit: no COUNT, no ORDER BY (the caller ranks). */
export const PROFILE_CONTAINS_SQL = `SELECT p.id AS id FROM ${OWNERSHIP_TABLE} p WHERE ${LIVE_PROFILE}
	AND (lower(p.admin_title) LIKE ?1 ESCAPE '\\' OR lower(p.handle) LIKE ?1 ESCAPE '\\' OR lower(p.email) LIKE ?1 ESCAPE '\\') LIMIT ?2`;

/** ?1 the term lower-cased, ?2 limit. A range on the lower(handle) index, not a LIKE scan. */
export const CHANNEL_HANDLE_PREFIX_SQL = `SELECT DISTINCT owner_id FROM ${OWNERSHIP_TABLE} INDEXED BY idx_content_ownership_handle_lower
	WHERE kind = 'channel' AND is_deleted = 0 AND owner_id IS NOT NULL AND lower(handle) >= ?1 AND lower(handle) < ?1 || char(1114111) LIMIT ?2`;


/** The search term: trimmed, without a leading "@" (handles are stored without it). */
export function searchTerm(q: string | undefined): string {
	return (q ?? '').trim().replace(/^@+/, '').trim();
}

/** 0 = exact id/email/handle, 1 = starts with the term, 2 = contains it. */
function rank(user: AdminUserRow, term: string, ownsHandle: boolean): number {
	const t = term.toLowerCase();
	const fields = [user.email, user.userName, user.displayName].map((f) => (f ?? '').toLowerCase());
	if (user.id === term || fields.includes(t) || ownsHandle) return 0;
	if (fields.some((f) => f.startsWith(t) || f.split(/\s+/).some((w) => w.startsWith(t)))) return 1;
	return 2;
}

export async function searchUsers(env: AdminEnv, query: AdminUserSearchQuery): Promise<{ items: AdminUserSearchItem[] }> {
	const term = searchTerm(query.q);
	if (term.length < ADMIN_USER_SEARCH_MIN_LENGTH) return { items: [] };
	const limit = Math.min(Math.max(query.limit ?? ADMIN_USER_SEARCH_MAX_RESULTS, 1), 20);
	const exclude = new Set(query.exclude ?? []);
	const db = env.SEARCH_DB;
	if (!db) throw new Error('SEARCH_DB is not bound');

	// Users by email, name, user handle or id, and owners of channels whose @handle starts with the term.
	// A keystroke must stay cheap: D1 runs one query at a time per database, and the old full-list
	// search (a COUNT and an ordered page over every profile, plus a scan of every channel handle,
	// ~200 ms of D1 time) queued into 500s under parallel load (TRANSFER-01, 2026-11-12).
	const lower = term.toLowerCase();
	const [matched, handleOwners] = await Promise.all([
		profileMatches(db, term, limit + exclude.size + 10),
		db
			.prepare(
				CHANNEL_HANDLE_PREFIX_SQL,
			)
			.bind(lower, limit)
			.all<{ owner_id: string }>(),
	]);
	const exactHandleOwners = new Set<string>();
	const ownerIds = (handleOwners.results ?? []).map((r) => r.owner_id);
	if (ownerIds.length) {
		const { results } = await db
			.prepare(`SELECT DISTINCT owner_id FROM ${OWNERSHIP_TABLE} WHERE kind = 'channel' AND is_deleted = 0 AND lower(handle) = ?`)
			.bind(lower)
			.all<{ owner_id: string }>();
		for (const r of results ?? []) exactHandleOwners.add(r.owner_id);
	}
	const page = { items: [...(await userRows(env, matched)).values()] };

	const byId = new Map<string, AdminUserRow>();
	for (const user of page.items) if (!user.profileDeleted) byId.set(user.id, user);
	const missing = ownerIds.filter((id) => !byId.has(id));
	if (missing.length) {
		for (const [id, user] of await userRows(env, missing)) if (!user.profileDeleted) byId.set(id, user);
	}

	const users = [...byId.values()]
		.filter((u) => !exclude.has(u.id))
		.map((u, i) => ({ u, i, r: rank(u, term, exactHandleOwners.has(u.id)) }))
		.sort((a, b) => a.r - b.r || a.i - b.i)
		.slice(0, limit)
		.map((x) => x.u);
	if (users.length === 0) return { items: [] };

	const ids = JSON.stringify(users.map((u) => u.id));
	const [counts, roles] = await Promise.all([
		db
			.prepare(
				`SELECT owner_id AS id, COUNT(*) AS n FROM ${OWNERSHIP_TABLE}
				 WHERE kind = 'channel' AND is_deleted = 0 AND owner_id IN (SELECT value FROM json_each(?)) GROUP BY owner_id`,
			)
			.bind(ids)
			.all<Row>(),
		query.channelId
			? db
					.prepare('SELECT user_id AS id, role FROM channel_access WHERE channel_id = ? AND user_id IN (SELECT value FROM json_each(?))')
					.bind(query.channelId, ids)
					.all<Row>()
			: Promise.resolve({ results: [] as Row[] }),
	]);
	const countOf = new Map((counts.results ?? []).map((r) => [String(r.id), Number(r.n) || 0]));
	const roleOf = new Map((roles.results ?? []).map((r) => [String(r.id), String(r.role)]));
	return {
		items: users.map((u) => ({ ...u, channelCount: countOf.get(u.id) ?? 0, channelRole: roleOf.get(u.id) ?? null })),
	};
}

/**
 * Profiles for a picker search, cheapest first: an exact id, email or user handle through the
 * (kind, id) key and the lower(email) / lower(handle) indexes (search migration 0021); only when
 * nothing matches exactly, one contains scan that stops at `max` rows (no COUNT, no ORDER BY: the
 * caller ranks). Users an admin soft-deleted are left out, as in the users list.
 */
export async function profileMatches(db: NonNullable<AdminEnv['SEARCH_DB']>, term: string, max: number): Promise<string[]> {
	const lower = term.toLowerCase();
	const found = await Promise.all([
		db.prepare(PROFILE_BY_ID_SQL).bind(term, max).all<{ id: string }>(),
		db.prepare(PROFILE_BY_EMAIL_SQL).bind(lower, max).all<{ id: string }>(),
		db.prepare(PROFILE_BY_HANDLE_SQL).bind(lower, max).all<{ id: string }>(),
	]);
	const exact = [...new Set(found.flatMap((r) => (r.results ?? []).map((x) => x.id)))];
	if (exact.length) {
		const live = await db.prepare(LIVE_PROFILE_IDS_SQL).bind(JSON.stringify(exact)).all<{ id: string }>();
		const ids = new Set((live.results ?? []).map((r) => r.id));
		// Exact hits that were soft-deleted: nothing to offer, and no scan either
		return exact.filter((id) => ids.has(id)).slice(0, max);
	}
	const { results } = await db.prepare(PROFILE_CONTAINS_SQL).bind(likeTerm(term), max).all<{ id: string }>();
	return (results ?? []).map((r) => r.id);
}
