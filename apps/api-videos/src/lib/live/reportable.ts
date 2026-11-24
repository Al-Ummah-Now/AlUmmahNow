/**
 * A reported live chat message (wiki E17 §5.2): only a published one, by someone who may read that chat
 * now. What the report keeps is copied here, because deleting a stream deletes its messages.
 */
import { featureGate } from '@al-ummah/shared-types';
import type { ReportSubject } from '@al-ummah/shared-types';
import type { ChannelAccessEnv } from '../channelAccess';
import { mayRead, ownerTierHasChat, readChatStream, readMessage } from './chat';

export async function reportableChatMessage(env: ChannelAccessEnv & { SEARCH_DB?: D1Database }, messageId: string, userId: string): Promise<ReportSubject | 'off' | null> {
	// The switch or the database not read: refused
	if (!env.SEARCH_DB || !(await featureGate(env as never, 'liveChat').catch(() => ({ on: false as const }))).on) return 'off';
	const stored = await readMessage(env.SEARCH_DB, null, messageId);
	if (!stored || stored.status !== 'published') return null;
	const stream = await readChatStream(env.SEARCH_DB, stored.streamId);
	if (!stream || !(await mayRead(env, stream, userId)) || !(await ownerTierHasChat(env.SEARCH_DB, stream))) return null;
	return { text: stored.message.text.replace(/\s+/g, ' ').trim(), parentId: stored.streamId, channelId: stream.channelId, ownerId: stored.userId };
}
