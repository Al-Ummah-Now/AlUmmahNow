/**
 * Live chat (wiki E17 §5.2): reading, posting and moderating, over SEARCH_DB.live_chat_messages and the
 * stream's live_stream_metadata row. Every query uses an index of migration 0092; a page is at most
 * MAX_PAGE rows. Switch, ban, human check and rate limits run before this, in the middleware.
 */
import {
	LIVE_CHAT_COOLDOWN_MS,
	LIVE_CHAT_DUPLICATE_WINDOW_MS,
	LIVE_CHAT_MODERATOR_COOLDOWN_MS,
	LIVE_CHAT_PRESHOW_MS,
	LIVE_METADATA_TABLE,
	can,
	isLiveChatSlowMode,
	liveChatGateOf,
	liveChatOpenToAnyone,
	liveChatReadable,
	tierAllowsLiveCapability,
	type LiveChatGate,
	type LiveChatMessage,
	type LiveChatSettings,
	type LiveStreamVisibility,
} from '@al-ummah/shared-types';
import { roleOnChannel, type ChannelAccessEnv } from '../channelAccess';
import { cachedBan } from '../admin/bans';
import { isBlocked } from '../channelComments/blocks';
import { channelOwnerTier } from '../creatorTiers';
import { edgeCacheUrl } from '../edge-cache';
import { logger } from '../logger';

export const MAX_PAGE = 100;
export const REPLAY_PAGE = 200;
export const REPLAY_WINDOW_MS = 60_000;
export const SNAPSHOT_TTL_SECONDS = 2;

/**
 * Cache key of a stream's latest page. On the API's own origin (edge-cache.ts: the environments share a
 * zone), so a write that closes the stream finds it without the request that made it.
 */
export function chatCacheUrl(env: { VIDEOS_API_URL?: string }, streamId: string, requestUrl?: string): string | null {
	const base = env.VIDEOS_API_URL || requestUrl;
	return base ? edgeCacheUrl(base, `live-chat/${encodeURIComponent(streamId)}/latest`) : null;
}

export interface ChatStream {
	id: string;
	channelId: string | null;
	ownerId: string | null;
	gate: LiveChatGate;
	settings: LiveChatSettings;
	scheduledStartAt: number | null;
	startedAt: number | null;
}

interface StreamRow {
	stream_id: string;
	channel_id: string | null;
	owner_id: string | null;
	visibility: LiveStreamVisibility;
	status: string;
	made_for_kids: number;
	recording_withheld: number;
	allow_chat: number;
	chat_replay: number;
	slow_mode_seconds: number;
	subscribers_only: number;
	scheduled_start_at: number | null;
	started_at: number | null;
}

interface MessageRow {
	id: string;
	stream_id: string;
	user_id: string;
	author_name: string;
	author_handle: string | null;
	author_avatar: string | null;
	author_role: 'owner' | 'moderator' | null;
	text: string;
	offset_ms: number;
	status: string;
	is_pinned: number;
	created_at: number;
}

const COLUMNS = 'id, stream_id, user_id, author_name, author_handle, author_avatar, author_role, text, offset_ms, status, is_pinned, created_at';

const toMessage = (r: MessageRow): LiveChatMessage => ({
	id: r.id,
	streamId: r.stream_id,
	userId: r.user_id,
	authorName: r.author_name,
	authorHandle: r.author_handle,
	authorAvatar: r.author_avatar,
	authorRole: r.author_role,
	text: r.text,
	offsetMs: r.offset_ms,
	isPinned: r.is_pinned === 1,
	createdAt: new Date(r.created_at).toISOString(),
});

/** The stream's chat facts; null when it is not indexed (nothing is shown then: fail closed). */
export async function readChatStream(db: D1Database, streamId: string): Promise<ChatStream | null> {
	const row = await db
		.prepare(`SELECT stream_id, channel_id, owner_id, visibility, status, made_for_kids, recording_withheld, allow_chat, chat_replay, slow_mode_seconds, subscribers_only, scheduled_start_at, started_at FROM ${LIVE_METADATA_TABLE} WHERE stream_id = ?`)
		.bind(streamId)
		.first<StreamRow>();
	if (!row) return null;
	return {
		id: row.stream_id,
		channelId: row.channel_id,
		ownerId: row.owner_id,
		gate: liveChatGateOf(row),
		settings: {
			allowChat: row.allow_chat === 1,
			chatReplay: row.chat_replay === 1,
			slowModeSeconds: isLiveChatSlowMode(row.slow_mode_seconds) ? row.slow_mode_seconds : 0,
			subscribersOnly: row.subscribers_only === 1,
		},
		scheduledStartAt: row.scheduled_start_at,
		startedAt: row.started_at,
	};
}

export interface ChatRole {
	isOwner: boolean;
	/** May moderate this stream's chat: the owner, live.moderate, live.manage or comment.moderate on its channel */
	moderates: boolean;
	/** May change the chat settings: the owner, live.manage or live.moderate */
	manages: boolean;
}

const NO_ROLE: ChatRole = { isOwner: false, moderates: false, manages: false };

export async function chatRole(env: ChannelAccessEnv, stream: ChatStream, userId: string | null | undefined): Promise<ChatRole> {
	if (!userId) return NO_ROLE;
	if (stream.ownerId && stream.ownerId === userId) return { isOwner: true, moderates: true, manages: true };
	if (!stream.channelId) return NO_ROLE;
	try {
		const role = await roleOnChannel(env, stream.channelId, userId);
		const manages = can(role, 'live.manage') || can(role, 'live.moderate');
		return { isOwner: role === 'owner', manages, moderates: manages || can(role, 'comment.moderate') };
	} catch (error) {
		logger.warn('[LiveChat] Channel role not read; treated as a viewer', { streamId: stream.id, error: error instanceof Error ? error.message : String(error) });
		return NO_ROLE;
	}
}

/** Whether this person may read the chat: anyone on a public stream, its team on any other (a banned member reads like a visitor). */
export async function mayRead(env: ChannelAccessEnv & { SEARCH_DB?: unknown }, stream: ChatStream, userId: string | null | undefined): Promise<boolean> {
	if (liveChatOpenToAnyone(stream.gate)) return true;
	if (!userId || !liveChatReadable(stream.gate) || !(await chatRole(env, stream, userId)).moderates) return false;
	try {
		return !(await cachedBan(env.SEARCH_DB as never, userId));
	} catch (error) {
		logger.warn('[LiveChat] Ban not read; a chat that is not public is refused', { streamId: stream.id, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface Snapshot {
	stream: ChatStream;
	messages: LiveChatMessage[];
	pinned: LiveChatMessage | null;
}

/** The latest page and the stream's facts, as everyone may see them (what the 2-second cache holds). */
export async function readSnapshot(db: D1Database, stream: ChatStream): Promise<Snapshot> {
	const [latest, pinned] = await Promise.all([
		db.prepare(`SELECT ${COLUMNS} FROM live_chat_messages WHERE stream_id = ? AND status = 'published' ORDER BY created_at DESC, id DESC LIMIT ?`).bind(stream.id, MAX_PAGE).all<MessageRow>(),
		db.prepare(`SELECT ${COLUMNS} FROM live_chat_messages WHERE stream_id = ? AND is_pinned = 1 LIMIT 5`).bind(stream.id).all<MessageRow>(),
	]);
	const pin = (pinned.results ?? []).find((r) => r.status === 'published');
	return { stream, messages: (latest.results ?? []).map(toMessage).reverse(), pinned: pin ? toMessage(pin) : null };
}

export interface ChatPage {
	messages: LiveChatMessage[];
	pinned: LiveChatMessage | null;
	/** The message asked about is gone: this is the latest page, start over from it */
	resync: boolean;
	/** More messages after this page (afterId), or before it (latest, before) */
	hasMore: boolean;
}

/** The latest `limit` messages, or those after `afterId`. */
export async function latestPage(db: D1Database, snapshot: Snapshot, afterId: string | null, limit: number): Promise<ChatPage> {
	const latest = (resync: boolean): ChatPage => ({ messages: snapshot.messages.slice(-limit), pinned: snapshot.pinned, resync, hasMore: snapshot.messages.length > limit || snapshot.messages.length === MAX_PAGE });
	if (!afterId) return latest(false);
	const at = snapshot.messages.findIndex((m) => m.id === afterId);
	if (at >= 0) {
		const rest = snapshot.messages.slice(at + 1);
		return { messages: rest.slice(0, limit), pinned: snapshot.pinned, resync: false, hasMore: rest.length > limit };
	}
	const anchor = await db.prepare("SELECT created_at FROM live_chat_messages WHERE id = ? AND stream_id = ? AND status != 'removed'").bind(afterId, snapshot.stream.id).first<{ created_at: number }>();
	if (!anchor) return latest(true);
	const { results } = await db
		.prepare(`SELECT ${COLUMNS} FROM live_chat_messages WHERE stream_id = ? AND status = 'published' AND (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT ?`)
		.bind(snapshot.stream.id, anchor.created_at, afterId, limit + 1)
		.all<MessageRow>();
	const rows = results ?? [];
	return { messages: rows.slice(0, limit).map(toMessage), pinned: snapshot.pinned, resync: false, hasMore: rows.length > limit };
}

/** The `limit` messages before `beforeId`, oldest first. */
export async function olderPage(db: D1Database, streamId: string, beforeId: string, limit: number): Promise<ChatPage> {
	const anchor = await db.prepare("SELECT created_at FROM live_chat_messages WHERE id = ? AND stream_id = ? AND status != 'removed'").bind(beforeId, streamId).first<{ created_at: number }>();
	if (!anchor) return { messages: [], pinned: null, resync: true, hasMore: false };
	const { results } = await db
		.prepare(`SELECT ${COLUMNS} FROM live_chat_messages WHERE stream_id = ? AND status = 'published' AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`)
		.bind(streamId, anchor.created_at, beforeId, limit + 1)
		.all<MessageRow>();
	const rows = results ?? [];
	return { messages: rows.slice(0, limit).map(toMessage).reverse(), pinned: null, resync: false, hasMore: rows.length > limit };
}

/** Replay beside the recording: messages whose offset is in [fromMs, toMs). */
export async function replayPage(db: D1Database, streamId: string, fromMs: number, toMs: number): Promise<{ messages: LiveChatMessage[]; truncated: boolean }> {
	const end = Math.min(toMs, fromMs + REPLAY_WINDOW_MS);
	const { results } = await db
		.prepare(`SELECT ${COLUMNS} FROM live_chat_messages WHERE stream_id = ? AND status = 'published' AND offset_ms >= ? AND offset_ms < ? ORDER BY offset_ms, id LIMIT ?`)
		.bind(streamId, fromMs, end, REPLAY_PAGE + 1)
		.all<MessageRow>();
	const rows = results ?? [];
	return { messages: rows.slice(0, REPLAY_PAGE).map(toMessage), truncated: rows.length > REPLAY_PAGE };
}

/**
 * A blocked author still sees their own messages among everyone else's, so the block stays silent. For the
 * latest page only: what they post afterwards they already have from the answer to their post.
 */
export async function withOwnHeld(db: D1Database, stream: ChatStream, userId: string | null | undefined, page: ChatPage): Promise<ChatPage> {
	if (!userId || !stream.channelId || !(await isBlocked(db as never, stream.channelId, userId))) return page;
	// The page's own span; everything when it is the whole chat
	const since = page.hasMore && page.messages.length ? Date.parse(page.messages[0].createdAt) : 0;
	const { results } = await db
		.prepare(`SELECT ${COLUMNS} FROM live_chat_messages WHERE stream_id = ? AND user_id = ? AND created_at >= ? AND status = 'held' AND held_by = 'channel_block' ORDER BY created_at DESC LIMIT 20`)
		.bind(stream.id, userId, since)
		.all<MessageRow>();
	if (!results?.length) return page;
	const merged = [...page.messages, ...results.map(toMessage)].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
	return { ...page, messages: merged };
}

/** What the AI scan holds for the moderators (E17-D4), newest first; a blocked person's messages are not among them. */
export async function heldForReview(db: D1Database, streamId: string): Promise<LiveChatMessage[]> {
	const { results } = await db
		.prepare(`SELECT ${COLUMNS} FROM live_chat_messages WHERE stream_id = ? AND status = 'held' AND held_by = 'moderation' ORDER BY created_at DESC, id DESC LIMIT ?`)
		.bind(streamId, MAX_PAGE)
		.all<MessageRow>();
	return (results ?? []).map(toMessage);
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/** Chat is open for posting: on air, or in the half hour before a scheduled start. */
export function postingOpen(stream: ChatStream, now: number): boolean {
	if (!liveChatReadable(stream.gate) || !stream.settings.allowChat) return false;
	if (stream.gate.status === 'live') return true;
	return stream.gate.status === 'scheduled' && stream.scheduledStartAt !== null && stream.scheduledStartAt - now <= LIVE_CHAT_PRESHOW_MS;
}

const TIER_MEMO_MS = 60_000;
const tierMemo = new Map<string, { at: number; allowed: boolean }>();
/** Tests: forget the tiers remembered in this isolate. */
export const forgetChatTiers = () => tierMemo.clear();

/** The channel owner's tier includes chat (remembered a minute per isolate). Fails closed. */
export async function ownerTierHasChat(db: D1Database, stream: ChatStream, now = Date.now()): Promise<boolean> {
	if (!stream.ownerId) return false;
	const known = tierMemo.get(stream.ownerId);
	if (known && now - known.at < TIER_MEMO_MS) return known.allowed;
	try {
		const allowed = tierAllowsLiveCapability(await channelOwnerTier(db, stream.ownerId), 'liveChat');
		if (tierMemo.size > 500) tierMemo.clear();
		tierMemo.set(stream.ownerId, { at: now, allowed });
		return allowed;
	} catch (error) {
		logger.warn('[LiveChat] Owner tier not read; chat closed for now', { streamId: stream.id, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/** Subscribed to the channel, as a person or as any of their channels. Fails closed. */
export async function isSubscriber(ndb: D1Database | undefined, channelId: string | null, userId: string): Promise<boolean> {
	if (!ndb || !channelId) return false;
	return !!(await ndb.prepare('SELECT 1 AS x FROM channel_subscriptions WHERE channel_id = ? AND user_id = ? LIMIT 1').bind(channelId, userId).first());
}

export interface NewMessage {
	userId: string;
	authorChannelId: string | null;
	authorName: string;
	authorHandle: string | null;
	authorAvatar: string | null;
	authorRole: 'owner' | 'moderator' | null;
	text: string;
	/** Blocked on the channel: stored for the author alone */
	held: boolean;
}

export type PostResult = { ok: true; message: LiveChatMessage } | { ok: false; code: 'live_chat_slow_mode' | 'live_chat_duplicate'; retryAfter: number };

/**
 * Stores one message. The pace and the duplicate check are conditions of the one INSERT, so two
 * parallel posts cannot both pass them.
 */
export async function postMessage(db: D1Database, stream: ChatStream, input: NewMessage, now = Date.now()): Promise<PostResult> {
	const cooldown = input.authorRole ? LIVE_CHAT_MODERATOR_COOLDOWN_MS : Math.max(LIVE_CHAT_COOLDOWN_MS, stream.settings.slowModeSeconds * 1000);
	const row: MessageRow = {
		// Time-ordered, so messages of one millisecond keep a stable order
		id: `lcm_${now.toString(36).padStart(9, '0')}${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
		stream_id: stream.id,
		user_id: input.userId,
		author_name: input.authorName,
		author_handle: input.authorHandle,
		author_avatar: input.authorAvatar,
		author_role: input.authorRole,
		text: input.text,
		offset_ms: stream.startedAt !== null ? Math.max(0, now - stream.startedAt) : 0,
		status: input.held ? 'held' : 'published',
		is_pinned: 0,
		created_at: now,
	};
	const result = await db
		.prepare(
			`INSERT INTO live_chat_messages (id, stream_id, user_id, author_channel_id, author_name, author_handle, author_avatar, author_role, text, offset_ms, status, held_by, created_at, updated_at)
			 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13
			 WHERE NOT EXISTS (SELECT 1 FROM live_chat_messages WHERE stream_id = ?2 AND user_id = ?3 AND created_at > ?14)
			   AND NOT EXISTS (SELECT 1 FROM live_chat_messages WHERE stream_id = ?2 AND user_id = ?3 AND created_at > ?15 AND text = ?9)`,
		)
		.bind(row.id, row.stream_id, row.user_id, input.authorChannelId, row.author_name, row.author_handle, row.author_avatar, row.author_role, row.text, row.offset_ms, row.status, input.held ? 'channel_block' : null, now, now - cooldown, now - LIVE_CHAT_DUPLICATE_WINDOW_MS)
		.run();
	if (Number(result.meta?.changes) > 0) return { ok: true, message: toMessage(row) };
	const last = await db.prepare('SELECT created_at FROM live_chat_messages WHERE stream_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1').bind(stream.id, input.userId).first<{ created_at: number }>();
	const wait = last ? last.created_at + cooldown - now : 0;
	if (wait > 0) return { ok: false, code: 'live_chat_slow_mode', retryAfter: Math.max(1, Math.ceil(wait / 1000)) };
	return { ok: false, code: 'live_chat_duplicate', retryAfter: Math.ceil(LIVE_CHAT_DUPLICATE_WINDOW_MS / 1000) };
}

// ---------------------------------------------------------------------------
// Moderating
// ---------------------------------------------------------------------------

export interface StoredMessage {
	id: string;
	streamId: string;
	userId: string;
	status: 'published' | 'held' | 'removed';
	message: LiveChatMessage;
}

/** A message by its id; of this stream only, when one is given. */
export async function readMessage(db: D1Database, streamId: string | null, messageId: string): Promise<StoredMessage | null> {
	const found = await db.prepare(`SELECT ${COLUMNS} FROM live_chat_messages WHERE id = ?`).bind(messageId).first<MessageRow>();
	const row = found && (streamId === null || found.stream_id === streamId) ? found : null;
	return row ? { id: row.id, streamId: row.stream_id, userId: row.user_id, status: row.status as StoredMessage['status'], message: toMessage(row) } : null;
}

/** Removes a published or held message; false when it was already removed. */
export async function removeMessage(db: D1Database, messageId: string, by: 'author' | 'moderator' | 'admin', now = Date.now()): Promise<boolean> {
	const r = await db.prepare("UPDATE live_chat_messages SET status = 'removed', removed_by = ?, held_by = NULL, is_pinned = 0, updated_at = ? WHERE id = ? AND status != 'removed'").bind(by, now, messageId).run();
	return Number(r.meta?.changes) > 0;
}

/** Brings back what a moderator or an admin removed, or a held message; never what its author removed. */
export async function restoreMessage(db: D1Database, messageId: string, now = Date.now()): Promise<boolean> {
	const r = await db
		.prepare("UPDATE live_chat_messages SET status = 'published', removed_by = NULL, held_by = NULL, updated_at = ? WHERE id = ? AND status != 'published' AND (removed_by IS NULL OR removed_by != 'author') AND (held_by IS NULL OR held_by != 'channel_block')")
		.bind(now, messageId)
		.run();
	return Number(r.meta?.changes) > 0;
}

/** Pins one published message (or none): there is at most one per stream. */
export async function pinMessage(db: D1Database, streamId: string, messageId: string | null, now = Date.now()): Promise<boolean> {
	if (!messageId) {
		await db.prepare('UPDATE live_chat_messages SET is_pinned = 0, updated_at = ? WHERE stream_id = ? AND is_pinned = 1').bind(now, streamId).run();
		return true;
	}
	// The old pin goes only when the new one can take its place (one transaction)
	const statements = [
		db
			.prepare("UPDATE live_chat_messages SET is_pinned = 0, updated_at = ? WHERE stream_id = ? AND is_pinned = 1 AND id != ? AND EXISTS (SELECT 1 FROM live_chat_messages WHERE id = ? AND stream_id = ? AND status = 'published')")
			.bind(now, streamId, messageId, messageId, streamId),
	];
	statements.push(db.prepare("UPDATE live_chat_messages SET is_pinned = 1, updated_at = ? WHERE id = ? AND stream_id = ? AND status = 'published'").bind(now, messageId, streamId));
	const results = await db.batch(statements);
	return Number(results.at(-1)?.meta?.changes) > 0;
}

/** Removes everything a person published on the stream, in bounded batches. */
export async function removeAllBy(db: D1Database, streamId: string, userId: string, now = Date.now()): Promise<number> {
	let total = 0;
	for (let i = 0; i < 20; i++) {
		const r = await db
			.prepare(
				"UPDATE live_chat_messages SET status = 'removed', removed_by = 'moderator', is_pinned = 0, updated_at = ? WHERE id IN (SELECT id FROM live_chat_messages WHERE stream_id = ? AND user_id = ? AND status = 'published' LIMIT 500)",
			)
			.bind(now, streamId, userId)
			.run();
		const n = Number(r.meta?.changes) || 0;
		total += n;
		if (n < 500) break;
	}
	return total;
}

/** Removed and held messages are kept this long, then gone (decision E17-D1). */
export const REMOVED_CHAT_DAYS = 30;

/** Daily: messages removed or held for 30 days, in bounded batches; the rest is the next day's. */
export async function purgeRemovedChat(db: D1Database, now = Date.now()): Promise<number> {
	let total = 0;
	for (let i = 0; i < 20; i++) {
		const r = await db
			.prepare("DELETE FROM live_chat_messages WHERE id IN (SELECT id FROM live_chat_messages WHERE status IN ('held', 'removed') AND updated_at < ? LIMIT 500)")
			.bind(now - REMOVED_CHAT_DAYS * 86_400_000)
			.run();
		const n = Number(r.meta?.changes) || 0;
		total += n;
		if (n < 500) break;
	}
	return total;
}
