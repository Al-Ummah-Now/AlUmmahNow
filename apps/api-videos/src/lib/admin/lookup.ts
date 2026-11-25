/**
 * Batch lookup for the admin reports queue (POST /internal/admin/lookup):
 * titles, channels and owners of many reported items, and the names and ban
 * state of many users, in one call. Reads the admin index in D1
 * (content_ownership, channel_comments, admin_comments, live_chat_messages, videos_bans); only
 * playlists, posts and post comments, which the index does not hold, are read from R2 (a few gets
 * each, bounded by the caller's page size). A post's channel comes from its search row or its
 * location record, a post comment's post from the channel comments index.
 */
import {
	ADMIN_LOOKUP_MAX_ITEMS,
	ADMIN_LOOKUP_MAX_USERS,
	LIVE_METADATA_TABLE,
	OWNERSHIP_TABLE,
	type AdminLookupItem,
	type AdminLookupRequest,
	type AdminLookupResult,
	type AdminLookupUser,
	type ReportableEntityType,
	type SearchDb,
} from '@al-ummah/shared-types';
import { resolveHandle, resolveHandleHistory } from '../channelHandles';
import { locatePostComment } from '../channelComments/moderation';
import { readPostLocation } from '../community-posts';
import { reportableChatMessage } from '../live/reportable';
import { readMany, type AdminEnv } from './directory';

type Row = Record<string, any>;

/** Longest text excerpt kept for a comment. */
const EXCERPT = 200;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** On one line; null when empty. A chat message is short enough to judge whole. */
const flat = (text: unknown): string | null => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '') || null;

const excerpt = (text: unknown): string | null => {
	const line = flat(text);
	return line && line.length > EXCERPT ? `${line.slice(0, EXCERPT - 1)}…` : line;
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

async function ownershipRows(db: SearchDb, kind: 'video' | 'stream' | 'channel' | 'profile', ids: string[]): Promise<Map<string, Row>> {
	const out = new Map<string, Row>();
	if (ids.length === 0) return out;
	const { results } = await db
		.prepare(
			`SELECT o.id, o.owner_id, o.channel_id, o.admin_title, o.handle, o.email, o.is_hidden, o.is_deleted
			 FROM json_each(?) j JOIN ${OWNERSHIP_TABLE} o ON o.kind = ? AND o.id = j.value`,
		)
		.bind(JSON.stringify(ids), kind)
		.all<Row>();
	for (const row of results ?? []) out.set(row.id, row);
	return out;
}

interface FoundComment {
	parentType: 'video' | 'post';
	parentId: string;
	channelId: string | null;
	ownerId: string | null;
	text: unknown;
	isHidden: boolean;
	isDeleted: boolean;
}

/**
 * Comments by id. channel_comments (primary key) says which video or post a comment is on, so admin_comments is
 * read by its own key; only comments of videos that are on no channel are looked for by id alone
 * (idx_admin_comments_comment).
 */
async function commentsByIds(env: AdminEnv, db: SearchDb, ids: string[]): Promise<Map<string, FoundComment>> {
	const out = new Map<string, FoundComment>();
	if (ids.length === 0) return out;
	const { results: indexed } = await db
		.prepare('SELECT c.comment_id, c.target_kind, c.target_id, c.channel_id FROM json_each(?) j JOIN channel_comments c ON c.comment_id = j.value')
		.bind(JSON.stringify(ids))
		.all<{ comment_id: string; target_kind: 'video' | 'post'; target_id: string; channel_id: string }>();
	const onVideo = (indexed ?? []).filter((r) => r.target_kind === 'video');
	const onPost = (indexed ?? []).filter((r) => r.target_kind === 'post');
	const known = new Set((indexed ?? []).map((r) => r.comment_id));
	const rest = ids.filter((id) => !known.has(id));
	const columns = 'c.comment_id, c.video_id, c.user_id, c.channel_id, c.text, c.is_hidden, c.status';
	const [byKey, byId] = await Promise.all([
		onVideo.length
			? db
					.prepare(`SELECT ${columns} FROM json_each(?) j JOIN admin_comments c ON c.video_id = json_extract(j.value, '$[0]') AND c.comment_id = json_extract(j.value, '$[1]')`)
					.bind(JSON.stringify(onVideo.map((r) => [r.target_id, r.comment_id])))
					.all<Row>()
			: { results: [] as Row[] },
		rest.length ? db.prepare(`SELECT ${columns} FROM json_each(?) j CROSS JOIN admin_comments c ON c.comment_id = j.value`).bind(JSON.stringify(rest)).all<Row>() : { results: [] as Row[] },
	]);
	for (const r of [...(byKey.results ?? []), ...(byId.results ?? [])]) {
		out.set(r.comment_id, { parentType: 'video', parentId: r.video_id, channelId: r.channel_id ?? null, ownerId: r.user_id ?? null, text: r.text, isHidden: r.is_hidden === 1 || r.status === 'held', isDeleted: false });
	}
	const bucket = env.community_posts;
	if (bucket) {
		const read = await Promise.all(onPost.map((r) => locatePostComment(bucket, r.target_id, r.comment_id).catch(() => null)));
		onPost.forEach((r, i) => {
			const comment = read[i]?.comment;
			if (!comment) return;
			out.set(r.comment_id, { parentType: 'post', parentId: r.target_id, channelId: r.channel_id, ownerId: comment.userId || null, text: comment.content, isHidden: comment.isHidden === true || comment.status === 'held', isDeleted: comment.isDeleted === true || !!comment.deletedAt });
		});
	}
	return out;
}

/** Posts by id, with their channel. */
async function postsByIds(env: AdminEnv, db: SearchDb, ids: string[]): Promise<Map<string, { channelId: string; value: Row }>> {
	const out = new Map<string, { channelId: string; value: Row }>();
	const bucket = env.community_posts;
	const safe = ids.filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
	if (!bucket || safe.length === 0) return out;
	const { results } = await db.prepare('SELECT p.id, p.channel_id FROM json_each(?) j JOIN search_posts p ON p.id = j.value').bind(JSON.stringify(safe)).all<{ id: string; channel_id: string | null }>();
	const channelOf = new Map((results ?? []).flatMap((r) => (r.channel_id ? [[r.id, r.channel_id] as const] : [])));
	await Promise.all(
		safe.map(async (id) => {
			const channelId = channelOf.get(id) ?? (await readPostLocation(bucket, id).catch(() => null));
			if (!channelId) return;
			const object = await bucket.get(`posts/${channelId}/${id}.json`);
			const value = object ? ((await object.json().catch(() => null)) as Row | null) : null;
			if (value) out.set(id, { channelId, value });
		}),
	);
	return out;
}

/** The channels behind @handles: the current handle index, else the handle's history. */
async function channelsByHandle(env: AdminEnv, handles: string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const bucket = (env as { channel_tabs?: R2Bucket }).channel_tabs;
	if (!bucket) return out;
	await Promise.all(
		handles.map(async (handle) => {
			const id = (await resolveHandle(bucket, handle).catch(() => null)) ?? (await resolveHandleHistory(bucket, handle).catch(() => null));
			if (id) out.set(handle, id);
		}),
	);
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
	// A channel reported by its @handle (the web report page, short links)
	const handles = await channelsByHandle(env, idsOf('channel').filter((id) => id.startsWith('@')));
	const chatIds = idsOf('live_chat');
	const [videos, streams, channels, comments, posts, chats, playlists] = await Promise.all([
		ownershipRows(db, 'video', idsOf('video')),
		ownershipRows(db, 'stream', idsOf('livestream')),
		ownershipRows(db, 'channel', [...idsOf('channel').filter((id) => !id.startsWith('@')), ...handles.values()]),
		commentsByIds(env, db, commentIds),
		postsByIds(env, db, idsOf('post')),
		chatIds.length
			? db
					.prepare(`SELECT m.id, m.stream_id, m.user_id, m.text, m.status, s.channel_id FROM json_each(?) j JOIN live_chat_messages m ON m.id = j.value LEFT JOIN ${LIVE_METADATA_TABLE} s ON s.stream_id = m.stream_id`)
					.bind(JSON.stringify(chatIds))
					.all<Row>()
					.then(({ results }) => new Map((results ?? []).map((r) => [r.id as string, r])))
			: Promise.resolve(new Map<string, Row>()),
		readMany(env.playlists, idsOf('playlist')),
	]);

	const items: AdminLookupItem[] = request.items.map(({ type, id }) => {
		if (type === 'video' || type === 'livestream') {
			const v = type === 'video' ? videos.get(id) : streams.get(id);
			return v
				? { type, id, found: true, title: v.admin_title ?? null, parentId: null, channelId: v.channel_id ?? null, channelName: null, ownerId: v.owner_id ?? null, isHidden: v.is_hidden === 1, isDeleted: v.is_deleted === 1 }
				: notFound(type, id);
		}
		if (type === 'channel') {
			const channelId = handles.get(id) ?? id;
			const ch = channels.get(channelId);
			return ch
				? { type, id, ...(channelId !== id ? { canonicalId: channelId } : {}), found: true, title: ch.admin_title ?? null, parentId: null, channelId, channelName: ch.admin_title ?? null, ownerId: ch.owner_id ?? null, isHidden: ch.is_hidden === 1, isDeleted: ch.is_deleted === 1 }
				: notFound(type, id);
		}
		if (type === 'comment') {
			const cm = comments.get(id);
			return cm
				? { type, id, found: true, title: excerpt(cm.text), parentId: cm.parentId, parentType: cm.parentType, channelId: cm.channelId, channelName: null, ownerId: cm.ownerId, isHidden: cm.isHidden, isDeleted: cm.isDeleted }
				: notFound(type, id);
		}
		if (type === 'post') {
			const post = posts.get(id);
			return post
				? { type, id, found: true, title: excerpt(post.value.content), parentId: null, channelId: post.channelId, channelName: null, ownerId: str(post.value.userId), isHidden: post.value.isHidden === true, isDeleted: post.value.status === 'deleted' || post.value.isDeleted === true }
				: notFound(type, id);
		}
		if (type === 'live_chat') {
			const m = chats.get(id);
			return m
				? { type, id, found: true, title: flat(m.text), parentId: m.stream_id ?? null, channelId: m.channel_id ?? null, channelName: null, ownerId: m.user_id ?? null, isHidden: m.status !== 'published', isDeleted: false }
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

	// Whether anyone may read a reported chat message now (a guest's report keeps what it said only then)
	await Promise.all(
		items
			.filter((i) => i.type === 'live_chat' && i.found)
			.map(async (i) => {
				const open = await reportableChatMessage(env as never, i.id, '').catch(() => null);
				i.openToAnyone = !!open && open !== 'off';
			}),
	);

	// Channel names for items that name a channel; a comment without one takes its video's channel
	const missingVideoChannels = items.filter((i) => i.type === 'comment' && i.parentType === 'video' && i.found && !i.channelId && i.parentId).map((i) => i.parentId!);
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
			email: indexed?.email ?? (profile?.email as string | undefined) ?? null,
			isBanned: bans.has(id),
		};
	});
}
