/**
 * Holding live chat messages for their moderators (wiki E17-D4), as far as the stream's creator chose (`ai_hold`).
 * Inside Epic 28's rules: only categories an admin enforces, never religious authenticity, and reversible (a held
 * message is approved or removed by a person, and purged after 30 days). The owner's and moderators' messages are
 * never held, nor is one a person has already decided on.
 */
import { LIVE_METADATA_TABLE, liveChatChannel, type D1Database, type ModerationCategory, type ModerationCategoryPolicy } from '@al-ummah/shared-types';
import { broadcast } from '../lib/websocket-notify';

/** 'strict' also holds what comes this close to a category's threshold. */
export const STRICT_MARGIN = 0.15;
/** Judged by scholars, never by a score. */
const NEVER = new Set<string>(['religious_authenticity']);

/** What these scores would hold: `basic` (the AI flags it), `strict` (it comes close), or nothing. */
export function holdLevel(scores: Record<string, number>, policies: Partial<Record<ModerationCategory, ModerationCategoryPolicy>>): 'basic' | 'strict' | null {
  let level: 'strict' | null = null;
  for (const [category, score] of Object.entries(scores)) {
    const policy = policies[category as ModerationCategory];
    if (!policy || !policy.enabled || policy.mode !== 'enforce' || policy.action === 'none' || NEVER.has(category)) continue;
    if (score >= policy.threshold) return 'basic';
    if (score > 0 && score >= policy.threshold - STRICT_MARGIN) level = 'strict';
  }
  return level;
}

export interface LiveChatHoldEnv {
  SEARCH_DB?: unknown;
  WEBSOCKET_URL?: string;
  INTERNAL_API_KEY?: unknown;
}

/** Holds the message when its stream's setting reaches that far, and takes it off everyone's screen. False when nothing changed. */
export async function holdLiveChatMessage(env: LiveChatHoldEnv, messageId: string, streamId: string, level: 'basic' | 'strict', now = Date.now()): Promise<boolean> {
  const db = env.SEARCH_DB as D1Database | undefined;
  if (!db) return false;
  const r = await db
    .prepare(
      `UPDATE live_chat_messages SET status = 'held', held_by = 'moderation', is_pinned = 0, updated_at = ?
       WHERE id = ? AND stream_id = ? AND status = 'published' AND author_role IS NULL
         AND EXISTS (SELECT 1 FROM ${LIVE_METADATA_TABLE} m WHERE m.stream_id = ? AND m.ai_hold IN (${level === 'basic' ? "'basic', 'strict'" : "'strict'"}))`
    )
    .bind(now, messageId, streamId, streamId)
    .run();
  if (!((r.meta as { changes?: number } | undefined)?.changes ?? 0)) return false;
  await broadcast(env as never, liveChatChannel(streamId), 'live_chat_removed', { streamId, messageId });
  return true;
}
