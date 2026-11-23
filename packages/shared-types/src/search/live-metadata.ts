/**
 * SEARCH_DB.live_stream_metadata (wiki E17 §4.1): the projection of a live stream's R2 record that
 * the chat, the events calendar (wiki E22) and the premiere and reminder crons read.
 * Schema: apps/api-videos/migrations/search/0092_live_in_apps.sql
 *
 * Written beside the stream's content_ownership row (kind 'stream') with the same guards: never
 * from an older copy than the one stored, never after a delete at or past that copy. Every field
 * has a fallback, so no stored record can fail the batch that also writes its ownership row.
 * reminder_count, heads_up_for and purge_pending belong to D1 and are not touched here.
 */
import { isLiveChatSlowMode, isLiveEventType, isLiveStreamKind, isLiveStreamStatus, type LiveEventType, type LiveStreamKind, type LiveStreamStatus, type LiveStreamVisibility } from '../live-apps';
import { liveRecordingWithheld } from '../video-review';
import { ownershipTombstone } from './ownership';
import { NOT_TOMBSTONED, type SearchDb, type SearchStatement } from './store';

export const LIVE_METADATA_TABLE = 'live_stream_metadata';

export interface LiveMetadataRow {
  streamId: string;
  channelId: string | null;
  ownerId: string | null;
  kind: LiveStreamKind;
  premiereVideoId: string | null;
  eventType: LiveEventType | null;
  status: LiveStreamStatus;
  visibility: LiveStreamVisibility;
  madeForKids: boolean;
  recordingWithheld: boolean;
  allowChat: boolean;
  chatReplay: boolean;
  slowModeSeconds: number;
  subscribersOnly: boolean;
  durationSeconds: number | null;
  scheduledStartAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

type Raw = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

function time(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** The row of a stored stream, or null for JSON that is not this stream. */
export function projectLiveMetadata(id: string, raw: unknown): LiveMetadataRow | null {
  if (!id || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Raw;
  if (s.id !== undefined && s.id !== id) return null;
  const kind = isLiveStreamKind(s.kind) ? s.kind : 'live';
  const duration = typeof s.durationSeconds === 'number' && s.durationSeconds > 0 ? Math.floor(s.durationSeconds) : null;
  return {
    streamId: id,
    channelId: text(s.channelId),
    ownerId: text(s.userId),
    kind,
    premiereVideoId: kind === 'premiere' ? text(s.premiereVideoId) : null,
    eventType: isLiveEventType(s.eventType) ? s.eventType : null,
    status: isLiveStreamStatus(s.status) ? s.status : 'scheduled',
    // The flags the endpoints test, in the order of the stronger one
    visibility: s.isDeleted ? 'deleted' : s.isHidden ? 'hidden' : s.isPrivate ? 'private' : 'public',
    madeForKids: s.madeForKids === true,
    recordingWithheld: liveRecordingWithheld(s),
    allowChat: s.allowChat !== false,
    chatReplay: s.chatReplay !== false,
    slowModeSeconds: isLiveChatSlowMode(s.slowModeSeconds) ? s.slowModeSeconds : 0,
    subscribersOnly: s.subscribersOnly === true,
    durationSeconds: duration,
    scheduledStartAt: time(s.scheduledStartTime),
    startedAt: time(s.actualStartTime),
    endedAt: time(s.actualEndTime),
    createdAt: time(s.dateCreated) ?? 0,
    updatedAt: time(s.dateModified) ?? time(s.dateCreated) ?? 0,
  };
}

const COLUMNS = [
  'channel_id', 'owner_id', 'kind', 'premiere_video_id', 'event_type', 'status', 'visibility', 'made_for_kids', 'recording_withheld', 'allow_chat', 'chat_replay',
  'slow_mode_seconds', 'subscribers_only', 'duration_seconds', 'scheduled_start_at', 'started_at', 'ended_at', 'created_at', 'updated_at',
] as const;

/** Upsert, applied only when `version` (R2's upload time) is not older than the row's nor than the stream's last delete. */
export function liveMetadataUpsertStatement(db: SearchDb, row: LiveMetadataRow, version: number): SearchStatement {
  const n = (value: boolean) => (value ? 1 : 0);
  return db
    .prepare(
      `INSERT INTO ${LIVE_METADATA_TABLE} (stream_id, ${COLUMNS.join(', ')}, source_version)
       SELECT ?, ${COLUMNS.map(() => '?').join(', ')}, ?
       WHERE ${NOT_TOMBSTONED}
       ON CONFLICT(stream_id) DO UPDATE SET ${COLUMNS.map((c) => `${c} = excluded.${c}`).join(', ')}, source_version = excluded.source_version, purge_pending = 0
       WHERE excluded.source_version >= ${LIVE_METADATA_TABLE}.source_version
         AND (excluded.source_version > ${LIVE_METADATA_TABLE}.source_version OR ${LIVE_METADATA_TABLE}.purge_pending = 1
           OR ${COLUMNS.map((c) => `${LIVE_METADATA_TABLE}.${c} IS NOT excluded.${c}`).join(' OR ')})`,
    )
    .bind(
      row.streamId, row.channelId, row.ownerId, row.kind, row.premiereVideoId, row.eventType, row.status, row.visibility, n(row.madeForKids), n(row.recordingWithheld), n(row.allowChat), n(row.chatReplay),
      row.slowModeSeconds, n(row.subscribersOnly), row.durationSeconds, row.scheduledStartAt, row.startedAt, row.endedAt, row.createdAt, row.updatedAt, version,
      ownershipTombstone('stream'), row.streamId, version,
    );
}

/**
 * The stream's record is gone: nobody may see it any more, and the 'live.purge-streams' job removes its
 * chat and reminders, then the row. The row stays until then so the job can always find the work.
 * An older delete than the copy indexed still wins: deletes are final (its tombstone is as new as the row).
 */
export function liveMetadataDeleteStatement(db: SearchDb, streamId: string): SearchStatement {
  return db.prepare(`UPDATE ${LIVE_METADATA_TABLE} SET visibility = 'deleted', purge_pending = 1 WHERE stream_id = ?`).bind(streamId);
}

/** Statements that bring the row in line with a stored record (null = deleted). Run after the ownership write. */
export function liveMetadataStatements(db: SearchDb, streamId: string, raw: unknown, version: number): SearchStatement[] {
  if (raw == null) return [liveMetadataDeleteStatement(db, streamId)];
  const row = projectLiveMetadata(streamId, raw);
  return row ? [liveMetadataUpsertStatement(db, row, version)] : [];
}

export async function syncLiveMetadata(db: SearchDb, streamId: string, raw: unknown, version: number): Promise<void> {
  for (const statement of liveMetadataStatements(db, streamId, raw, version)) await statement.run();
}
