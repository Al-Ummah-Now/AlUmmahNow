/**
 * A moderator's decision about a live stream or a chat message (wiki E17 §5.2). admin-api sends it here
 * (POST /internal/admin/live-moderation) instead of writing the record itself: written through the
 * search-sync wrapper, the stream's index rows follow it and its chat channel closes.
 */
import { liveChatChannel, type LiveChatMessage } from '@al-ummah/shared-types';
import { deleteEdgeCache } from '../edge-cache';
import { chatCacheUrl, readMessage, removeMessage, restoreMessage } from '../live/chat';
import { cancelPremiere, endPremiere, isPremiere } from '../live/premieres';
import { endOpenSession, readStream, streamEnd, streamKey, type LiveStreamRecord, type StreamsEnv } from '../live/streams';
import R2Repository from '../r2Repo';
import { broadcast } from '../websocket-notify';

export type LiveModerationAction = 'removed' | 'warning' | 'banned' | 'deleted' | 'restored';

export interface LiveModerationInput {
	entityType: 'livestream' | 'live_chat';
	entityId: string;
	action: LiveModerationAction;
	notes?: string | null;
	actorId: string;
}

/** What was done; `changed: false` when there was nothing to change. */
export async function moderateLive(env: StreamsEnv, input: LiveModerationInput, now = Date.now()): Promise<{ found: boolean; changed: boolean }> {
	return input.entityType === 'live_chat' ? moderateMessage(env, input, now) : moderateStream(env, input, now);
}

async function moderateMessage(env: StreamsEnv, input: LiveModerationInput, now: number): Promise<{ found: boolean; changed: boolean }> {
	const db = env.SEARCH_DB!;
	const stored = await readMessage(db, null, input.entityId);
	if (!stored) return { found: false, changed: false };
	// A warning goes to the person (user warnings); the message stays
	if (input.action === 'warning') return { found: true, changed: false };
	const changed = input.action === 'restored' ? await restoreMessage(db, stored.id, now) : await removeMessage(db, stored.id, 'admin', now);
	if (changed) {
		// The shared latest page (2 seconds) must not outlive the decision
		const cached = chatCacheUrl(env as never, stored.streamId);
		const dropped: Promise<unknown>[] = [];
		if (cached) deleteEdgeCache(cached, (p) => void dropped.push(p));
		await Promise.all(dropped);
		const channel = liveChatChannel(stored.streamId);
		if (input.action === 'restored') await broadcast(env as never, channel, 'live_chat_message', { streamId: stored.streamId, message: { ...stored.message, isPinned: false } satisfies LiveChatMessage });
		else await broadcast(env as never, channel, 'live_chat_removed', { streamId: stored.streamId, messageId: stored.id });
	}
	return { found: true, changed };
}

async function moderateStream(env: StreamsEnv, input: LiveModerationInput, now: number): Promise<{ found: boolean; changed: boolean }> {
	const at = new Date(now).toISOString();
	const reason = input.notes?.trim() || null;
	const saved = await new R2Repository<LiveStreamRecord>(env.videos).updateObject(streamKey(input.entityId), (fresh) => {
		// The same flags admin-api's contentModeration puts on videos, channels and playlists
		if (input.action === 'warning') Object.assign(fresh, { hasWarning: true, warningAt: at, warningReason: reason ?? 'Content flagged for policy violation' });
		else if (input.action === 'restored') Object.assign(fresh, { isHidden: false, isDeleted: false });
		else {
			Object.assign(fresh, { isHidden: true, hiddenAt: at, hiddenByUserId: input.actorId, hiddenReason: reason ?? 'Content removed by moderator' });
			if (input.action === 'deleted') Object.assign(fresh, { isDeleted: true, deletedAt: at, deletedBy: input.actorId });
		}
		fresh.dateModified = at;
	});
	if (!saved) return { found: false, changed: false };
	if (input.action === 'warning' || input.action === 'restored') return { found: true, changed: true };
	// Hidden: it ends whatever its status, with its session, and a premiere does not start. Go live and the
	// encoder settings are refused while it is hidden (endpoints/live/liveSession.ts)
	const stream = await readStream(env, input.entityId);
	if (isPremiere(stream)) {
		if (stream.status === 'scheduled') await cancelPremiere(env as never, stream.id, 'video_unavailable', now);
		else await endPremiere(env as never, stream.id, now);
	} else if (stream?.status === 'scheduled' || stream?.status === 'live') {
		await streamEnd(env, stream, 'moderation', now);
	} else if (stream) {
		await endOpenSession(env, stream, 'moderation', now);
	}
	return { found: true, changed: true };
}
