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
import { likeTerm, listUsers, userRows, type AdminEnv } from './directory';

type Row = Record<string, unknown>;

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

	// Users by email, name, user handle or id, and owners of channels whose @handle starts with the term
	const [page, handleOwners] = await Promise.all([
		listUsers(env, { q: term, pageSize: limit + exclude.size + 10 }),
		db
			.prepare(
				`SELECT DISTINCT owner_id FROM ${OWNERSHIP_TABLE}
				 WHERE kind = 'channel' AND is_deleted = 0 AND owner_id IS NOT NULL AND lower(handle) LIKE ? ESCAPE '\\' LIMIT ?`,
			)
			.bind(`${likeTerm(term).slice(1)}`, limit)
			.all<{ owner_id: string }>(),
	]);
	const exactHandleOwners = new Set<string>();
	const ownerIds = (handleOwners.results ?? []).map((r) => r.owner_id);
	if (ownerIds.length) {
		const { results } = await db
			.prepare(`SELECT DISTINCT owner_id FROM ${OWNERSHIP_TABLE} WHERE kind = 'channel' AND is_deleted = 0 AND lower(handle) = ?`)
			.bind(term.toLowerCase())
			.all<{ owner_id: string }>();
		for (const r of results ?? []) exactHandleOwners.add(r.owner_id);
	}

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
