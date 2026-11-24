/**
 * Whether a reminder fan-out (wiki E17 §5.5) may still send: the switch is on and the stream is what it
 * was when the message was queued. Checked on every page, so a stream made private or moved stops the
 * rest. Anything unreadable throws, so the queue tries again.
 */
import { LIVE_METADATA_TABLE, featureGate, type NotificationFanoutPayload } from '@al-ummah/shared-types';
import type { D1Database } from '../types';

interface Row {
  kind: string;
  status: string;
  visibility: string;
  made_for_kids: number;
  scheduled_start_at: number | null;
}

export async function reminderMaySend(env: { SEARCH_DB?: unknown }, payload: Pick<NotificationFanoutPayload, 'kind' | 'entityId' | 'startsAt'>): Promise<boolean> {
  const db = env.SEARCH_DB as D1Database | undefined;
  if (!db || !(await featureGate(env as never, 'liveReminders')).on) return false;
  const row = await db.prepare(`SELECT kind, status, visibility, made_for_kids, scheduled_start_at FROM ${LIVE_METADATA_TABLE} WHERE stream_id = ?`).bind(payload.entityId).first<Row>();
  if (!row || row.visibility !== 'public' || row.made_for_kids !== 0) return false;
  // A premiere is shown only while premieres are on
  if (row.kind === 'premiere' && !(await featureGate(env as never, 'livePremieres')).on) return false;
  if (payload.kind === 'live_soon') return row.status === 'scheduled' && row.scheduled_start_at === payload.startsAt;
  return row.status === 'live';
}
