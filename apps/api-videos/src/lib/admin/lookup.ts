/**
 * Batch lookup for the admin reports queue (POST /internal/admin/lookup):
 * titles, channels and owners of many reported items, and the names and ban
 * state of many users, in one call. Reads the admin index in D1
 * (content_ownership, admin_comments, videos_bans); only playlists, which the
 * index does not hold, are read from R2 (one get each, bounded by the caller's
 * page size). Posts are stored under their channel and cannot be found by id
 * alone, so they come back `found: false`.
 */
import {
	ADMIN_LOOKUP_MAX_ITEMS,
	ADMIN_LOOKUP_MAX_USERS,
	OWNERSHIP_TABLE,
	type AdminLookupItem,
	type AdminLookupRequest,
	type AdminLookupResult,
	type AdminLookupUser,
	type ReportableEntityType,
	type SearchDb,
} from '@al-ummah/shared-types';
import { readMany, type AdminEnv } from './directory';

type Row = Record<string, any>;

/** Longest text excerpt kept for a comment. */
const EXCERPT = 200;

const excerpt = (text: unknown): string | null => {
	const flat = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
	if (!flat) return null;
	return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT - 1)}…` : flat;
};

const notFound = (type: ReportableEntityType, id: string): AdminLookupItem => ({
	type,
	id,
	found: false,
	title: null,
	parentId: null,
	channelId: null,
	channelName: null,
	ownerId: null,
	isHidden: null,
	isDeleted: null,
});

async function ownershipRows(db: SearchDb, kind: 'video' | 'channel' | 'profile', ids: string[]): Promise<Map<string, Row>> {
	const out = new Map<string, Row>();
	if (ids.length === 0) return out;
	const { results } = await db
		.prepare(
			`SELECT o.id, o.owner_id, o.channel_id, o.admin_title, o.handle, o.is_hidden, o.is_deleted
			 FROM json_each(?) j JOIN ${OWNERSHIP_TABLE} o ON o.kind = ? AND o.id = j.value`,
		)
		.bind(JSON.stringify(ids), kind)
		.all<Row>();
	for (const row of results ?? []) out.set(row.id, row);
	return out;
}

/** Normalises and caps the request (the caller is admin-api; this keeps a bad call cheap). */
export function cleanLookup(input: Partial<AdminLookupRequest> | null | undefined): AdminLookupRequest {
	const items: AdminLookupRequest['items'] = [];
	const seen = new Set<string>();
	for (const item of Array.isArray(input?.items) ? input!.items : []) {
		if (!item || typeof item.id !== 'string' || !item.id || typeof item.type !== 'string') continue;
		const key = `${item.type}:${item.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({ type: item.type, id: item.id.slice(0, 200) });
		if (items.length >= ADMIN_LOOKUP_MAX_ITEMS) break;
	}
	const users = [...new Set((Array.isArray(input?.users) ? input!.users : []).filter((u): u is string => typeof u === 'string' && !!u))].slice(0, ADMIN_LOOKUP_MAX_USERS);
	return { items, users };
}

export async function lookup(env: AdminEnv, request: AdminLookupRequest): Promise<AdminLookupResult> {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	const db = env.SEARCH_DB;
	const idsOf = (...types: ReportableEntityType[]) => request.items.filter((i) => types.includes(i.type)).map((i) => i.id);

	const commentIds = idsOf('comment');
	const [videos, channels, comments, playlists] = await Promise.all([
		ownershipRows(db, 'video', idsOf('video', 'livestream')),
		ownershipRows(db, 'channel', idsOf('channel')),
		commentIds.length
			? db
					.prepare('SELECT c.comment_id, c.video_id, c.user_id, c.channel_id, c.text, c.is_hidden FROM json_each(?) j JOIN admin_comments c ON c.comment_id = j.value')
					.bind(JSON.stringify(commentIds))
					.all<Row>()
					.then(({ results }) => new Map((results ?? []).map((r) => [r.comment_id as string, r])))
			: Promise.resolve(new Map<string, Row>()),
		readMany(env.playlists, idsOf('playlist')),
	]);

	const items: AdminLookupItem[] = request.items.map(({ type, id }) => {
		if (type === 'video' || type === 'livestream') {
			const v = videos.get(id);
			return v
				? { type, id, found: true, title: v.admin_title ?? null, parentId: null, channelId: v.channel_id ?? null, channelName: null, ownerId: v.owner_id ?? null, isHidden: v.is_hidden === 1, isDeleted: v.is_deleted === 1 }
				: notFound(type, id);
		}
		if (type === 'channel') {
			const ch = channels.get(id);
			return ch
				? { type, id, found: true, title: ch.admin_title ?? null, parentId: null, channelId: id, channelName: ch.admin_title ?? null, ownerId: ch.owner_id ?? null, isHidden: ch.is_hidden === 1, isDeleted: ch.is_deleted === 1 }
				: notFound(type, id);
		}
		if (type === 'comment') {
			const cm = comments.get(id);
			return cm
				? { type, id, found: true, title: excerpt(cm.text), parentId: cm.video_id ?? null, channelId: cm.channel_id ?? null, channelName: null, ownerId: cm.user_id ?? null, isHidden: cm.is_hidden === 1, isDeleted: false }
				: notFound(type, id);
		}
		if (type === 'playlist') {
			const p = playlists.get(id) as Row | undefined;
			return p
				? { type, id, found: true, title: (p.title as string) || null, parentId: null, channelId: p.channelId ?? null, channelName: null, ownerId: p.userId ?? null, isHidden: p.isHidden === true, isDeleted: p.isDeleted === true }
				: notFound(type, id);
		}
		return notFound(type, id);
	});

	// Channel names for items that name a channel; a comment without one takes its video's channel
	const missingVideoChannels = items.filter((i) => i.type === 'comment' && i.found && !i.channelId && i.parentId).map((i) => i.parentId!);
	const parentVideos = await ownershipRows(db, 'video', [...new Set(missingVideoChannels)]);
	for (const item of items) {
		if (item.type === 'comment' && item.found && !item.channelId && item.parentId) item.channelId = parentVideos.get(item.parentId)?.channel_id ?? null;
	}
	const channelIds = [...new Set(items.filter((i) => i.channelId && !i.channelName).map((i) => i.channelId!))];
	const channelNames = await ownershipRows(db, 'channel', channelIds);
	for (const item of items) {
		if (item.channelId && !item.channelName) item.channelName = channelNames.get(item.channelId)?.admin_title ?? null;
	}

	const userIds = [...new Set([...request.users, ...items.map((i) => i.ownerId).filter((id): id is string => !!id)])].slice(0, ADMIN_LOOKUP_MAX_USERS + ADMIN_LOOKUP_MAX_ITEMS);
	return { items, users: await lookupUsers(env, db, userIds) };
}

/** Names from the admin index; users it does not hold yet are read from R2. Ban state from videos_bans. */
async function lookupUsers(env: AdminEnv, db: SearchDb, ids: string[]): Promise<AdminLookupUser[]> {
	if (ids.length === 0) return [];
	const [profiles, bans] = await Promise.all([
		ownershipRows(db, 'profile', ids),
		db
			.prepare('SELECT b.user_id FROM json_each(?) j JOIN videos_bans b ON b.user_id = j.value')
			.bind(JSON.stringify(ids))
			.all<{ user_id: string }>()
			.then(({ results }) => new Set((results ?? []).map((r) => r.user_id))),
	]);
	const missing = ids.filter((id) => !profiles.has(id));
	const stored = missing.length ? await readMany(env.profiles, missing) : new Map<string, Row>();
	return ids.map((id) => {
		const indexed = profiles.get(id);
		const profile = stored.get(id) as Row | undefined;
		const name = indexed?.admin_title || (profile ? (profile.displayName as string) || [profile.firstName, profile.lastName].filter(Boolean).join(' ') : '') || null;
		return {
			id,
			found: !!indexed || !!profile,
			displayName: name,
			userName: indexed?.handle ?? (profile?.userName as string | undefined) ?? null,
			isBanned: bans.has(id),
		};
	});
}
