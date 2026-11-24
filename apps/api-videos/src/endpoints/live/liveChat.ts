/**
 * Live chat (wiki E17 §5.2), behind the `liveChat` switch (feature-routes.ts):
 *
 *   GET   /api/live-streams/:id/chat                      latest, after a message, before one, or replay
 *   POST  /api/live-streams/:id/chat                      post
 *   POST  /api/live-streams/:id/chat/:messageId/moderate  remove, restore, pin, unpin, block the author
 *   PATCH /api/live-streams/:id/chat/settings             chat on/off, replay, slow mode, subscribers only
 */
import { z } from 'zod';
import { DEFAULT_LIVE_CHAT_AI_HOLD, LIVE_CHAT_ACTIONS, LIVE_CHAT_AI_HOLDS, LIVE_CHAT_SLOW_MODES, checkLiveChatText, isLiveChatAiHold, liveChatChannel, liveChatOpenToAnyone, type LiveChatAction, type LiveChatEvent, type LiveChatSettings } from '@al-ummah/shared-types';
import { AppContext, AuthenticatedRoute, OptionalAuthRoute } from '../../base';
import { Str } from '../../lib/chanfana-params';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { apiError } from '../../lib/api-error';
import { addBlock, isBlocked } from '../../lib/channelComments/blocks';
import { resolveCommentAuthors } from '../../lib/commentAuthors';
import { deleteEdgeCache, readEdgeCache, writeEdgeCache } from '../../lib/edge-cache';
import { featureOff } from '../../lib/features/off';
import { hasSuspensionHolds } from '../../lib/admin/frozen';
import { MAX_PAGE, REPLAY_WINDOW_MS, SNAPSHOT_TTL_SECONDS, chatCacheUrl, chatRole, heldForReview, isSubscriber, latestPage, mayRead, mayReview, olderPage, ownerTierHasChat, pinMessage, postMessage, postingOpen, readChatStream, readMessage, readSnapshot, removeAllBy, removeMessage, replayPage, restoreMessage, withOwnHeld, type ChatStream, type Snapshot } from '../../lib/live/chat';
import { streamKey, type LiveStreamRecord } from '../../lib/live/streams';
import { logger } from '../../lib/logger';
import { scanInBackground } from '../../lib/moderation-scan';
import { NonVideoRepository } from '../../lib/r2Repo';
import { broadcastInBackground } from '../../lib/websocket-notify';
import { allowLiveChatAddress } from '../../middleware/bot-protection';
import { PollAfterMs } from './pollAfter';

const Params = z.object({ id: Str({ description: 'Live stream id' }) });
const Ok = (schema: z.ZodTypeAny, description: string) => ({ description, content: { 'application/json': { schema: z.object({ success: z.boolean(), result: schema }) } } });
const Err = (description: string) => ({ description, content: { 'application/json': { schema: z.object({ success: z.boolean(), code: z.string().optional(), error: z.string() }) } } });
const Message = z.object({
	id: z.string(),
	streamId: z.string(),
	userId: z.string(),
	authorName: z.string(),
	authorHandle: z.string().nullable(),
	authorAvatar: z.string().nullable(),
	authorRole: z.enum(['owner', 'moderator']).nullable(),
	text: z.string(),
	offsetMs: z.number().int(),
	isPinned: z.boolean(),
	createdAt: z.string(),
});

const dbOf = (c: AppContext) => (c.env as { SEARCH_DB?: D1Database }).SEARCH_DB;
const waitUntilOf = (c: AppContext) => {
	try {
		const ctx = c.executionCtx;
		return (p: Promise<unknown>) => ctx.waitUntil(p);
	} catch {
		return null;
	}
};
const cacheUrl = (c: AppContext, streamId: string) => chatCacheUrl(c.env as never, streamId, c.req.url)!;
const notFound = (c: AppContext) => apiError(c, 404, 'not_found');
const unavailable = (c: AppContext) => apiError(c, 503, 'service_unavailable', { retryAfter: 5 }, { 'Retry-After': '5' });

export function sendChatEvent(c: AppContext, streamId: string, event: LiveChatEvent, data: Record<string, unknown>): void {
	deleteEdgeCache(cacheUrl(c, streamId), waitUntilOf(c));
	broadcastInBackground(c as never, liveChatChannel(streamId), event, { streamId, ...data });
}

/** The latest page as anyone may see it: shared for 2 seconds while the stream's chat is open to anyone, else read for this caller. */
async function snapshotFor(c: AppContext, db: D1Database, streamId: string, userId: string | undefined): Promise<Snapshot | null> {
	const url = cacheUrl(c, streamId);
	const cached = await readEdgeCache<Snapshot>(url);
	if (cached?.stream && liveChatOpenToAnyone(cached.stream.gate)) return cached;
	const stream = await readChatStream(db, streamId);
	if (!stream || !(await mayRead(c.env as never, stream, userId))) return null;
	const snapshot = await readSnapshot(db, stream);
	if (liveChatOpenToAnyone(stream.gate)) writeEdgeCache(url, snapshot, SNAPSHOT_TTL_SECONDS, waitUntilOf(c));
	return snapshot;
}

export class LiveChatList extends OptionalAuthRoute {
	schema = {
		tags: ['Live Streams'],
		summary: 'Live chat messages',
		description:
			'Published messages, oldest first. Without a cursor: the latest. `afterId`: those after that message (`resync: true` when it is gone; start over from this page). `before`: those before that message. `fromMs` (and `toMs`, at most 60 s later), on an ended stream: the replay beside the recording, by the time since the start; `truncated` when one window held more than fits. Poll only while the realtime channel `live:<id>` is not connected, every 10 s.',
		request: {
			params: Params,
			query: z.object({
				afterId: z.string().max(64).optional(),
				before: z.string().max(64).optional(),
				fromMs: z.coerce.number().int().min(0).optional(),
				toMs: z.coerce.number().int().min(0).optional(),
				limit: z.coerce.number().int().min(1).max(MAX_PAGE).optional(),
			}),
		},
		responses: {
			'200': Ok(z.object({ messages: z.array(Message), pinned: Message.nullable(), resync: z.boolean(), hasMore: z.boolean(), truncated: z.boolean().optional(), pollAfterMs: PollAfterMs }), 'Messages'),
			'404': Err('No such stream, or its chat is off'),
		},
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const db = dbOf(c);
		if (!db) return unavailable(c);
		const userId = this.getUserId(c);
		// Never kept by a browser: signing in or out changes what it may hold
		const answer = (result: unknown) => c.json({ success: true, result }, 200, { 'Cache-Control': 'private, no-store' });
		if (query.fromMs !== undefined || query.before) {
			const stream = await readChatStream(db, params.id);
			if (!stream || !(await mayRead(c.env as never, stream, userId))) return notFound(c);
			if (query.before) return answer(await olderPage(db, stream.id, query.before, query.limit ?? 50));
			if (stream.gate.status !== 'ended') return notFound(c);
			const replay = await replayPage(db, stream.id, query.fromMs!, query.toMs ?? query.fromMs! + REPLAY_WINDOW_MS);
			return answer({ messages: replay.messages, pinned: null, resync: false, hasMore: false, truncated: replay.truncated });
		}
		const snapshot = await snapshotFor(c, db, params.id, userId);
		if (!snapshot) return notFound(c);
		const page = await latestPage(db, snapshot, query.afterId ?? null, query.limit ?? 50);
		return answer(query.afterId && !page.resync ? page : await withOwnHeld(db, snapshot.stream, userId, page));
	}
}

export class LiveChatHeld extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ['Live Streams'],
		summary: 'Live chat messages held for review',
		description: '🔒 Newest first, at most 100: what the AI scan held (E17-D4). For the stream’s owner, live.manage, live.moderate or comment.moderate. `restore` shows one, `remove` removes it.',
		request: { params: Params },
		responses: { '200': Ok(z.object({ messages: z.array(Message) }), 'Held messages'), '403': Err('Not a moderator'), '404': Err('Not found') },
	});

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const db = dbOf(c);
		if (!db) return unavailable(c);
		const userId = this.getUserId(c);
		const stream = await readChatStream(db, params.id);
		if (!stream) return notFound(c);
		// The ban middleware lets reads through, so it is asked here
		if (!(await mayReview(c.env as never, stream, userId))) return (await mayRead(c.env as never, stream, userId)) ? apiError(c, 403, 'forbidden') : notFound(c);
		return c.json({ success: true, result: { messages: await heldForReview(db, stream.id) } }, 200, { 'Cache-Control': 'private, no-store' });
	}
}

export class LiveChatPost extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ['Live Streams'],
		summary: 'Post in a live chat',
		description: '🔒 At most 500 characters; links only from the stream’s team. As the channel in the channelId header, or as yourself.',
		request: {
			params: Params,
			headers: z.object({ channelId: Str({ description: 'Post as this channel' }).optional().nullable() }),
			body: { content: { 'application/json': { schema: z.object({ text: z.string().max(4000) }) } } },
		},
		responses: {
			'201': Ok(z.object({ message: Message }), 'Posted'),
			'400': Err('live_chat_empty, live_chat_too_long, live_chat_link or live_chat_blocked_word'),
			'403': Err('live_chat_subscribers_only'),
			'404': Err('No such stream, or its chat is off or not open yet'),
			'429': Err('live_chat_slow_mode or live_chat_duplicate (with retryAfter), or rate_limited'),
		},
	});

	async handle(c: AppContext) {
		const { params, headers, body } = await this.getValidatedData<typeof this.schema>();
		const db = dbOf(c);
		if (!db) return unavailable(c);
		const userId = this.getUserId(c);
		const now = Date.now();
		const stream = await readChatStream(db, params.id);
		if (!stream || !postingOpen(stream, now) || !(await mayRead(c.env as never, stream, userId))) return notFound(c);
		if (!(await ownerTierHasChat(c.env as never, stream, now))) return featureOff(c, 'liveChat');
		const role = await chatRole(c.env as never, stream, userId);
		if (stream.settings.subscribersOnly && !role.moderates && !(await isSubscriber((c.env as { NOTIFICATIONS_DB?: D1Database }).NOTIFICATIONS_DB, stream.channelId, userId))) {
			return apiError(c, 403, 'live_chat_subscribers_only');
		}
		// One address: generous, since a whole mosque may share it; one person is limited by edgeRateLimit and the pace below
		if (!(await allowLiveChatAddress(c))) return apiError(c, 429, 'rate_limited', { retryAfter: 60 }, { 'Retry-After': '60' });
		const checked = checkLiveChatText(body.text, { mayLink: role.moderates });
		if (checked.problem) return apiError(c, 400, `live_chat_${checked.problem}`);

		const channelId = headers.channelId || null;
		const [authorOf, held] = await Promise.all([
			resolveCommentAuthors(c.env as never, [{ userId, channelId }]),
			role.moderates ? Promise.resolve(false) : isBlocked(db as never, stream.channelId, userId),
		]);
		const author = authorOf({ userId, channelId });
		const result = await postMessage(
			db,
			stream,
			{ userId, authorChannelId: channelId, authorName: author.displayName, authorHandle: author.handle ?? null, authorAvatar: author.avatarUrl ?? null, authorRole: role.isOwner ? 'owner' : role.moderates ? 'moderator' : null, text: checked.text, held },
			now,
		);
		if (result.ok === false) return apiError(c, 429, result.code, { retryAfter: result.retryAfter }, { 'Retry-After': String(result.retryAfter) });
		// A blocked author's message goes nowhere else
		if (!held) {
			sendChatEvent(c, stream.id, 'live_chat_message', { message: result.message });
			scanInBackground(c as never, { surface: 'live_chat', event: 'create', subjectId: result.message.id, parentId: stream.id, authorId: userId, channelId: stream.channelId ?? undefined, text: checked.text });
		}
		return c.json({ success: true, result: { message: result.message } }, 201);
	}
}

export class LiveChatModerate extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ['Live Streams'],
		summary: 'Moderate a live chat message',
		description: '🔒 The stream’s owner, or live.manage, live.moderate or comment.moderate on its channel. An author may `remove` their own message. `block_author` also removes what they wrote on this stream; they are not told.',
		request: {
			params: Params.extend({ messageId: Str({ description: 'Message id' }) }),
			body: { content: { 'application/json': { schema: z.object({ action: z.enum(LIVE_CHAT_ACTIONS) }) } } },
		},
		responses: { '200': Ok(z.object({ messageId: z.string(), action: z.enum(LIVE_CHAT_ACTIONS) }), 'Done'), '403': Err('Not yours to moderate'), '404': Err('Not found'), '409': Err('Already so') },
	});

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const db = dbOf(c);
		if (!db) return unavailable(c);
		const userId = this.getUserId(c);
		const action: LiveChatAction = body.action;
		const stream = await readChatStream(db, params.id);
		const stored = stream ? await readMessage(db, stream.id, params.messageId) : null;
		if (!stream || !stored) return notFound(c);
		const role = await chatRole(c.env as never, stream, userId);
		const own = stored.userId === userId;
		if (!role.moderates && !(own && action === 'remove')) {
			// Someone who may not see the stream does not learn that the message exists
			return (await mayRead(c.env as never, stream, userId)) ? apiError(c, 403, 'forbidden') : notFound(c);
		}
		let done = true;
		if (action === 'remove') {
			done = await removeMessage(db, stored.id, own ? 'author' : 'moderator');
			if (done) sendChatEvent(c, stream.id, 'live_chat_removed', { messageId: stored.id });
		} else if (action === 'restore') {
			done = await restoreMessage(db, stored.id);
			if (done) sendChatEvent(c, stream.id, 'live_chat_message', { message: { ...stored.message, isPinned: false } });
		} else if (action === 'pin') {
			done = await pinMessage(db, stream.id, stored.id);
			if (done) sendChatEvent(c, stream.id, 'live_chat_pinned', { message: { ...stored.message, isPinned: true } });
		} else if (action === 'unpin') {
			await pinMessage(db, stream.id, null);
			sendChatEvent(c, stream.id, 'live_chat_pinned', { message: null });
		} else {
			// The team is never blocked; a stream without a channel has no list to block on
			if (!stream.channelId || own || (await chatRole(c.env as never, stream, stored.userId)).moderates) return apiError(c, 409, 'live_chat_cannot_block');
			await addBlock(db as never, stream.channelId, stored.userId, userId);
			await removeAllBy(db, stream.id, stored.userId);
			sendChatEvent(c, stream.id, 'live_chat_removed', { messageId: stored.id, userId: stored.userId });
		}
		if (!done) return apiError(c, 409, 'conflict');
		logger.info('[LiveChat] Moderated', { streamId: stream.id, messageId: stored.id, action, by: userId });
		return { success: true, result: { messageId: stored.id, action } };
	}
}

export const LiveChatSettingsInput = {
	allowChat: z.boolean().optional(),
	chatReplay: z.boolean().optional(),
	slowModeSeconds: z.union(LIVE_CHAT_SLOW_MODES.map((n) => z.literal(n)) as unknown as [z.ZodLiteral<0>, z.ZodLiteral<5>]).optional().describe('0, 5, 10, 30 or 60'),
	subscribersOnly: z.boolean().optional(),
	aiHold: z.enum(LIVE_CHAT_AI_HOLDS).optional().describe('What the AI scan holds for the moderators: nothing, what it flags, or also what comes close'),
};

export class LiveChatSettingsUpdate extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ['Live Streams'],
		summary: 'Live chat settings',
		description: '🔒 The stream’s owner, or live.manage or live.moderate on its channel.',
		request: { params: Params, body: { content: { 'application/json': { schema: z.object(LiveChatSettingsInput) } } } },
		responses: { '200': Ok(z.object({ settings: z.object({ allowChat: z.boolean(), chatReplay: z.boolean(), slowModeSeconds: z.number(), subscribersOnly: z.boolean() }), aiHold: z.enum(LIVE_CHAT_AI_HOLDS) }), 'Saved'), '403': Err('Not allowed'), '404': Err('Not found') },
	});

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const db = dbOf(c);
		if (!db) return unavailable(c);
		const userId = this.getUserId(c);
		const stream = await readChatStream(db, params.id);
		if (!stream) return notFound(c);
		const role = await chatRole(c.env as never, stream, userId);
		if (!role.manages) return (await mayRead(c.env as never, stream, userId)) ? apiError(c, 403, 'forbidden') : notFound(c);
		const { data, rejected } = await new NonVideoRepository<LiveStreamRecord>(c.env.videos).updateObjectOrReject<true>(streamKey(stream.id), (fresh) => {
			// The role was judged on this channel; a held stream (suspension) is not changed
			if ((fresh.channelId ?? null) !== stream.channelId || hasSuspensionHolds(fresh as Record<string, unknown>)) return { reject: true };
			for (const key of ['allowChat', 'chatReplay', 'slowModeSeconds', 'subscribersOnly', 'aiHold'] as const) if (body[key] !== undefined) fresh[key] = body[key];
			fresh.dateModified = new Date().toISOString();
			return true;
		});
		if (!data) return notFound(c);
		if (rejected) return apiError(c, 403, 'forbidden');
		const settings: LiveChatSettings = {
			allowChat: data.allowChat !== false,
			chatReplay: data.chatReplay !== false,
			slowModeSeconds: ((data.slowModeSeconds as number) ?? 0) as LiveChatSettings['slowModeSeconds'],
			subscribersOnly: data.subscribersOnly === true,
		};
		// Turning chat off also closes the realtime channel (lib/search/sync.ts, after the record is written)
		sendChatEvent(c, stream.id, 'live_chat_settings', { settings });
		// Not in the event: what is held is the team's business
		return { success: true, result: { settings, aiHold: isLiveChatAiHold(data.aiHold) ? data.aiHold : DEFAULT_LIVE_CHAT_AI_HOLD } };
	}
}

/** The chat part of GET /api/live-streams/:id/state. */
export async function chatState(c: AppContext, stream: ChatStream | null, userId: string | undefined, switchedOn: boolean) {
	const db = dbOf(c);
	const off = { enabled: false, replay: false, slowModeSeconds: 0, subscribersOnly: false, canPost: false };
	if (!db || !stream || !switchedOn || stream.gate.madeForKids || !(await ownerTierHasChat(c.env as never, stream))) return { chat: off, canModerate: false };
	const role = await chatRole(c.env as never, stream, userId);
	const ended = stream.gate.status === 'ended';
	return {
		chat: {
			enabled: !ended && stream.gate.status !== 'cancelled' && stream.settings.allowChat,
			replay: ended && stream.settings.chatReplay,
			slowModeSeconds: stream.settings.slowModeSeconds,
			subscribersOnly: stream.settings.subscribersOnly,
			canPost: !!userId && postingOpen(stream, Date.now()),
		},
		canModerate: role.moderates,
	};
}
