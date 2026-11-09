/**
 * Ownership index for videos and channels.
 *
 * The search tables only hold public content. Owner- and channel-scoped
 * listings ("my channels", a channel's videos and totals, channel-filtered
 * video search) need every object, including private, scheduled, processing,
 * hidden and soft-deleted ones, so they get their own table:
 * apps/api-videos/migrations/search/0002_content_ownership.sql.
 *
 * Projection is pure and shared so api-videos (inline on R2 writes) and the
 * processor (SearchIndexSync / moderation messages) write identical rows.
 * Readers trust the table only once a full pass of the bucket has completed
 * (`ownershipCompleteKey`); any failed write clears that marker so readers fall
 * back to scanning R2 until the next pass repairs the table.
 */

import type { SearchDb, SearchStatement } from './store';
import type { SearchEntityType } from './documents';

export type OwnershipKind = 'video' | 'channel';

export const OWNERSHIP_KINDS: ReadonlyArray<OwnershipKind> = ['video', 'channel'];

export const OWNERSHIP_TABLE = 'content_ownership';

/** search_meta key set when a full ownership pass of a bucket has completed. */
export function ownershipCompleteKey(kind: OwnershipKind): string {
  return `ownership:complete:${kind}`;
}

/**
 * search_meta key holding the last time a write could not be applied. A pass
 * that started before then may have read the stale row, so it must not mark
 * the kind complete.
 */
export function ownershipInvalidatedKey(kind: OwnershipKind): string {
  return `ownership:invalidated:${kind}`;
}

export type StudioVideoStatus = 'published' | 'scheduled' | 'drafts' | 'processing' | 'failed';

export const STUDIO_VIDEO_STATUSES: readonly StudioVideoStatus[] = ['published', 'scheduled', 'drafts', 'processing', 'failed'];

/** The one status a video has in Studio. The first match wins. */
export function studioVideoStatus(video: {
  uploadStatus?: unknown;
  processingStatus?: unknown;
  scheduledPublishStatus?: unknown;
  isDraft?: unknown;
}): StudioVideoStatus {
  const { uploadStatus, processingStatus, scheduledPublishStatus, isDraft } = video;
  if (uploadStatus === 'failed' || processingStatus === 'failed' || scheduledPublishStatus === 'failed') return 'failed';
  if (uploadStatus === 'initiated' || uploadStatus === 'uploading' || uploadStatus === 'processing') return 'processing';
  if (processingStatus === 'pending' || processingStatus === 'processing' || processingStatus === 'transcoding') return 'processing';
  if (scheduledPublishStatus === 'scheduled' || scheduledPublishStatus === 'publishing') return 'scheduled';
  return isDraft === true ? 'drafts' : 'published';
}

export interface OwnershipRow {
  kind: OwnershipKind;
  id: string;
  ownerId: string | null;
  channelId: string | null;
  isPublic: boolean;
  isHidden: boolean;
  isDeleted: boolean;
  isLive: boolean;
  duration: number | null;
  scheduleStatus: string | null;
  uploadStatus: string | null;
  studioStatus: StudioVideoStatus | null;
  title: string | null;
  category: string | null;
  language: string | null;
  views: number;
  createdAt: number | null;
  updatedAt: number | null;
}

export type OwnershipSyncResult = 'upserted' | 'removed' | 'skipped';

const INTERNAL_VIDEO_PREFIXES = ['index:', 'metadata:', 'livestream:'];

type Raw = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function time(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** The ownership table only covers videos and channels. */
export function ownershipKindFor(type: SearchEntityType | string): OwnershipKind | null {
  return type === 'video' || type === 'channel' ? type : null;
}

/**
 * Project a stored object into an ownership row. Flags follow the endpoint
 * filters exactly (JS truthiness where the endpoints use it; videos are
 * private only when `isPublic === false`). Returns null for internal records
 * and for JSON stored under the key that is not this entity.
 */
export function projectOwnership(kind: OwnershipKind, id: string, raw: unknown): OwnershipRow | null {
  if (!id || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Raw;
  if (obj.id !== undefined && obj.id !== id) return null;
  if (kind === 'video' && INTERNAL_VIDEO_PREFIXES.some(prefix => id.startsWith(prefix))) return null;
  const common = {
    kind,
    id,
    ownerId: text(obj.userId),
    isHidden: Boolean(obj.isHidden),
    isDeleted: Boolean(obj.isDeleted),
    views: Math.max(0, Math.floor(finite(obj.views) ?? 0)),
    createdAt: time(obj.dateCreated),
    updatedAt: time(obj.dateModified),
  };
  if (kind === 'channel') {
    return {
      ...common,
      channelId: id,
      isPublic: !obj.isPrivate,
      isLive: false,
      duration: null,
      scheduleStatus: null,
      uploadStatus: null,
      studioStatus: null,
      title: null,
      category: null,
      language: null,
    };
  }
  return {
    ...common,
    channelId: text(obj.channelId),
    isPublic: obj.isPublic !== false,
    isLive: Boolean(obj.isLive),
    duration: finite(obj.duration),
    scheduleStatus: text(obj.scheduledPublishStatus),
    uploadStatus: text(obj.uploadStatus),
    studioStatus: studioVideoStatus(obj),
    title: text(obj.title),
    category: text(obj.category),
    language: text(obj.language),
  };
}

function int(value: boolean): number {
  return value ? 1 : 0;
}

export function ownershipUpsertStatement(db: SearchDb, row: OwnershipRow, now: number): SearchStatement {
  return db.prepare(
    `INSERT INTO ${OWNERSHIP_TABLE} (kind, id, owner_id, channel_id, is_public, is_hidden, is_deleted, is_live, duration, schedule_status, upload_status, studio_status, title, category, language, views, created_at, updated_at, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, id) DO UPDATE SET
       owner_id = excluded.owner_id, channel_id = excluded.channel_id, is_public = excluded.is_public,
       is_hidden = excluded.is_hidden, is_deleted = excluded.is_deleted, is_live = excluded.is_live,
       duration = excluded.duration, schedule_status = excluded.schedule_status, upload_status = excluded.upload_status, studio_status = excluded.studio_status, title = excluded.title,
       category = excluded.category, language = excluded.language,
       views = excluded.views, created_at = excluded.created_at, updated_at = excluded.updated_at,
       indexed_at = excluded.indexed_at`,
  ).bind(
    row.kind, row.id, row.ownerId, row.channelId, int(row.isPublic), int(row.isHidden), int(row.isDeleted),
    int(row.isLive), row.duration, row.scheduleStatus, row.uploadStatus, row.studioStatus, row.title, row.category, row.language, row.views, row.createdAt, row.updatedAt, now,
  );
}

export function ownershipDeleteStatement(db: SearchDb, kind: OwnershipKind, id: string): SearchStatement {
  return db.prepare(`DELETE FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND id = ?`).bind(kind, id);
}

/**
 * Bring one ownership row in line with the stored object (null = deleted).
 * Objects that are not this entity (see projectOwnership) are left alone.
 */
export async function syncOwnership(
  db: SearchDb,
  kind: OwnershipKind,
  id: string,
  object: unknown,
  now = Date.now(),
): Promise<OwnershipSyncResult> {
  if (object == null) {
    await ownershipDeleteStatement(db, kind, id).run();
    return 'removed';
  }
  const row = projectOwnership(kind, id, object);
  if (!row) return 'skipped';
  await ownershipUpsertStatement(db, row, now).run();
  return 'upserted';
}

/**
 * Mark the index incomplete so readers fall back to scanning R2 and the next
 * ownership pass (cron or self-heal) rebuilds it.
 */
export async function invalidateOwnership(db: SearchDb, kind: OwnershipKind, now = Date.now()): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM search_meta WHERE key = ?').bind(ownershipCompleteKey(kind)),
    db.prepare(
      `INSERT INTO search_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(ownershipInvalidatedKey(kind), String(now), now),
  ]);
}

export type SafeOwnershipResult =
  | { ok: true; result: OwnershipSyncResult }
  | { ok: false; error: string; invalidated: boolean };

/**
 * syncOwnership that never throws: on failure the index is invalidated (when
 * D1 still accepts that write) so a missed update cannot serve stale lists.
 */
export async function syncOwnershipSafely(
  db: SearchDb,
  kind: OwnershipKind,
  id: string,
  object: unknown,
  now = Date.now(),
): Promise<SafeOwnershipResult> {
  try {
    return { ok: true, result: await syncOwnership(db, kind, id, object, now) };
  } catch (error) {
    let invalidated = false;
    try {
      await invalidateOwnership(db, kind, now);
      invalidated = true;
    } catch {
      invalidated = false;
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), invalidated };
  }
}

/**
 * Apply a moderation outcome made outside api-videos (admin-api writes the
 * flags to R2 directly, then notifies the processor).
 */
export async function applyOwnershipModeration(
  db: SearchDb,
  kind: OwnershipKind,
  id: string,
  flags: { hidden?: boolean; deleted?: boolean },
  now = Date.now(),
): Promise<void> {
  const sets: string[] = [];
  if (flags.hidden) sets.push('is_hidden = 1');
  if (flags.deleted) sets.push('is_deleted = 1');
  if (!sets.length) return;
  await db.prepare(`UPDATE ${OWNERSHIP_TABLE} SET ${sets.join(', ')}, indexed_at = ? WHERE kind = ? AND id = ?`)
    .bind(now, kind, id).run();
}
