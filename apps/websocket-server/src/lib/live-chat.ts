/**
 * Who may join a live stream's chat channel, `live:<streamId>` (wiki E17 §5.3): the same rule the
 * chat's HTTP reads use, from indexed reads. Anything unreadable refuses.
 *
 * TODO(E20, AlUmmahNow#1801): once Auth issues `kids:viewer` tokens, authenticateToken (../auth.ts) refuses
 * them on connect (wiki E20 §4.2) and live-chat.test.ts checks it. No Kids session exists on main today.
 */
import { LIVE_METADATA_TABLE, can, liveChatGateOf, liveChatOpenToAnyone, liveChatReadable, type ChannelRole } from '@al-ummah/shared-types';
import { logger } from './logger';

interface Row {
  owner_id: string | null;
  channel_id: string | null;
  visibility: string;
  status: string;
  made_for_kids: number;
  recording_withheld: number;
  allow_chat: number;
  chat_replay: number;
}

export async function mayJoinLiveChat(env: { SEARCH_DB?: D1Database }, channel: string, userId: string | undefined): Promise<boolean> {
  const streamId = channel.slice('live:'.length);
  if (!streamId || !env.SEARCH_DB) return false;
  try {
    const row = await env.SEARCH_DB.prepare(`SELECT owner_id, channel_id, visibility, status, made_for_kids, recording_withheld, allow_chat, chat_replay FROM ${LIVE_METADATA_TABLE} WHERE stream_id = ?`).bind(streamId).first<Row>();
    if (!row) return false;
    const gate = liveChatGateOf(row);
    if (liveChatOpenToAnyone(gate)) return true;
    // Not public: the stream's team only, and only while it has chat at all
    if (!userId || !liveChatReadable(gate)) return false;
    // Banned on videos: like a visitor
    if (await env.SEARCH_DB.prepare('SELECT 1 AS x FROM videos_bans WHERE user_id = ?').bind(userId).first()) return false;
    if (row.owner_id === userId) return true;
    if (!row.channel_id) return false;
    const access = await env.SEARCH_DB.prepare('SELECT role FROM channel_access WHERE channel_id = ? AND user_id = ?').bind(row.channel_id, userId).first<{ role: ChannelRole }>();
    const role = access?.role ?? null;
    return can(role, 'live.manage') || can(role, 'live.moderate') || can(role, 'comment.moderate');
  } catch (error) {
    logger.warn('[LiveChat] Stream not read; subscription refused', { streamId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
