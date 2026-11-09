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

import { NOT_TOMBSTONED, type SearchDb, type SearchStatement } from './store';
import type { SearchEntityType } from './documents';
import { isShort, type VideoFormatInput } from '../video-format';
import { channelMembersOf } from '../channel-roles';
import { hasOpenFormatIssue } from '../video-format-ops';

export type OwnershipKind = 'video' | 'channel' | 'profile';

/**
 * Kinds the public endpoints read. Profiles are indexed for the admin's user
 * list only (apps/api-videos/migrations/search/0005_admin_content.sql).
 */
export const OWNERSHIP_KINDS: ReadonlyArray<OwnershipKind> = ['video', 'channel'];
export const ALL_OWNERSHIP_KINDS: ReadonlyArray<OwnershipKind> = ['video', 'channel', 'profile'];

/**
 * Version of the admin columns (title, handle, email, verified, suspended,
 * subscribers). Rows written before 0005 have admin_cols = 0 until the next
 * ownership pass rewrites them; admin lists rebuild while any remain.
 */
export const OWNERSHIP_ADMIN_COLS_VERSION = 1;

export const OWNERSHIP_TABLE = 'content_ownership';

/**
 * search_meta key set when a full ownership pass of a bucket has completed.
 * v2: markers written before passes counted skipped objects (2026-11-10: a
 * pass dropped 345 videos and a channel yet marked the kinds complete) are
 * not trusted; readers rebuild once and the fixed pass writes the v2 marker.
 */
export function ownershipCompleteKey(kind: OwnershipKind): string {
  return `ownership:complete:v2:${kind}`;
}

/** The pre-v2 completeness marker (deleted by the next finished pass). */
export function legacyOwnershipCompleteKey(kind: OwnershipKind): string {
  return `ownership:complete:${kind}`;
}

/** search_meta key of the kind's index drift flag (see OwnershipDrift). */
export function ownershipDriftKey(kind: OwnershipKind): string {
  return `ownership:drift:${kind}`;
}

/** Most ids of skipped objects a drift flag names (the rest are counted). */
export const OWNERSHIP_DRIFT_SAMPLE = 20;

/**
 * Set by a finished ownership pass whose index does not hold every object it
 * listed in R2 (`indexed < stored`), or that skipped or failed to read some
 * of them; cleared by the next pass that indexes all of them. The admin
 * Errors page shows it with a Rebuild that queues the
 * 'search.rebuild-ownership' admin job.
 */
export interface OwnershipDrift {
  kind: OwnershipKind;
  /** Objects of this kind the pass listed in R2 */
  stored: number;
  /** Index rows of this kind after the pass */
  indexed: number;
  /** Listed objects the pass could not index (no row, unreadable as this entity, or blocked by a delete) */
  skipped: number;
  /** Listed objects the pass could not read */
  failed: number;
  /** Up to OWNERSHIP_DRIFT_SAMPLE ids of skipped or failed objects */
  sampleIds: string[];
  /** When the pass finished (ISO) */
  at: string;
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

/** What a Retry on a failed video should do. Null when the video hasn't failed. */
export function studioFailureKind(video: { uploadStatus?: unknown; processingStatus?: unknown; scheduledPublishStatus?: unknown }): 'upload' | 'publish' | null {
  if (video.uploadStatus === 'failed' || video.processingStatus === 'failed') return 'upload';
  return video.scheduledPublishStatus === 'failed' ? 'publish' : null;
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
  /** Short (videos only; see video-format.ts). */
  isShort: boolean;
  /** Unclassifiable Short/video with no choice made: an admin must set it (video-format-ops.ts). */
  needsFormat: boolean;
  duration: number | null;
  scheduleStatus: string | null;
  uploadStatus: string | null;
  /** Studio Videos tab columns (migrations/search/0017_content_studio_columns.sql); videos only. */
  studioStatus: StudioVideoStatus | null;
  category: string | null;
  language: string | null;
  views: number;
  createdAt: number | null;
  updatedAt: number | null;
  /** Admin columns: video title, channel name or profile display name. */
  title?: string | null;
  /** Channel @handle or profile userName. */
  handle?: string | null;
  /** Channel contact/owner email or profile email. */
  email?: string | null;
  isVerified?: boolean;
  /** Channel suspended by an admin. */
  isSuspended?: boolean;
  subscribers?: number;
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

/** The ownership table covers videos and channels (profiles are synced separately). */
export function ownershipKindFor(type: SearchEntityType | string): OwnershipKind | null {
  return type === 'video' || type === 'channel' ? type : null;
}

function count(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return Math.max(0, Math.floor(finite(value) ?? 0));
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
  if (kind === 'profile') {
    const name = text(obj.displayName) ?? ([text(obj.firstName), text(obj.lastName)].filter(Boolean).join(' ') || null);
    return {
      ...common,
      ownerId: id,
      channelId: null,
      isPublic: true,
      isLive: false,
      isShort: false,
      needsFormat: false,
      duration: null,
      scheduleStatus: null,
      uploadStatus: null,
      studioStatus: null,
      category: null,
      language: null,
      title: name,
      handle: text(obj.userName),
      email: text(obj.email),
      isVerified: false,
      isSuspended: false,
      subscribers: 0,
    };
  }
  if (kind === 'channel') {
    return {
      ...common,
      channelId: id,
      isPublic: !obj.isPrivate,
      isLive: false,
      isShort: false,
      needsFormat: false,
      duration: null,
      scheduleStatus: null,
      uploadStatus: null,
      studioStatus: null,
      category: null,
      language: null,
      title: text(obj.name),
      handle: text(obj.handle),
      email: text(obj.email),
      isVerified: Boolean(obj.isVerified),
      isSuspended: Boolean(obj.isSuspended),
      subscribers: count(obj.subscriberCount ?? obj.subscribers),
    };
  }
  return {
    ...common,
    channelId: text(obj.channelId),
    isPublic: obj.isPublic !== false,
    isLive: Boolean(obj.isLive),
    isShort: isShort(obj as VideoFormatInput),
    needsFormat: hasOpenFormatIssue(obj as never),
    duration: finite(obj.duration),
    scheduleStatus: text(obj.scheduledPublishStatus),
    uploadStatus: text(obj.uploadStatus),
    studioStatus: studioVideoStatus(obj),
    category: text(obj.category),
    language: text(obj.language),
    title: text(obj.title),
    handle: null,
    email: null,
    isVerified: false,
    isSuspended: false,
    subscribers: 0,
  };
}

function int(value: boolean): number {
  return value ? 1 : 0;
}

/** Tombstone namespace of the ownership index (the search index uses the bare entity type). */
export function ownershipTombstone(kind: OwnershipKind): string {
  return `own:${kind}`;
}

/**
 * Upsert one row, applied only if `version` is not older than the row's and
 * than the item's last delete (SCALABILITY-AUDIT PR-8; see store.ts).
 */
export function ownershipUpsertStatement(db: SearchDb, row: OwnershipRow, now: number, version = now): SearchStatement {
  return db.prepare(
    `INSERT INTO ${OWNERSHIP_TABLE} (kind, id, owner_id, channel_id, is_public, is_hidden, is_deleted, is_live, duration, schedule_status, upload_status, views, created_at, updated_at, indexed_at, source_version,
       admin_title, handle, email, is_verified, is_suspended, subscribers, admin_cols, is_short, needs_format,
       studio_status, category, language)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE ${NOT_TOMBSTONED}
     ON CONFLICT(kind, id) DO UPDATE SET
       owner_id = excluded.owner_id, channel_id = excluded.channel_id, is_public = excluded.is_public,
       is_hidden = excluded.is_hidden, is_deleted = excluded.is_deleted, is_live = excluded.is_live,
       duration = excluded.duration, schedule_status = excluded.schedule_status, upload_status = excluded.upload_status,
       views = excluded.views, created_at = excluded.created_at, updated_at = excluded.updated_at,
       indexed_at = excluded.indexed_at, source_version = excluded.source_version,
       admin_title = excluded.admin_title, handle = excluded.handle, email = excluded.email, is_verified = excluded.is_verified,
       is_suspended = excluded.is_suspended, subscribers = excluded.subscribers, admin_cols = excluded.admin_cols, is_short = excluded.is_short, needs_format = excluded.needs_format,
       studio_status = excluded.studio_status, category = excluded.category, language = excluded.language
     WHERE excluded.source_version >= ${OWNERSHIP_TABLE}.source_version`,
  ).bind(
    row.kind, row.id, row.ownerId, row.channelId, int(row.isPublic), int(row.isHidden), int(row.isDeleted),
    int(row.isLive), row.duration, row.scheduleStatus, row.uploadStatus, row.views, row.createdAt, row.updatedAt, now, version,
    row.title ?? null, row.handle ?? null, row.email ?? null, int(row.isVerified === true), int(row.isSuspended === true),
    row.subscribers ?? 0, OWNERSHIP_ADMIN_COLS_VERSION, int(row.isShort), int(row.needsFormat),
    row.studioStatus, row.category, row.language,
    ownershipTombstone(row.kind), row.id, version,
  );
}

/** Delete one row (a delete is final). Pair with tombstoneStatement so older snapshots stay out. */
export function ownershipDeleteStatement(db: SearchDb, kind: OwnershipKind, id: string, _version?: number): SearchStatement {
  return db.prepare(`DELETE FROM ${OWNERSHIP_TABLE} WHERE kind = ? AND id = ?`).bind(kind, id);
}

/** Index of per-channel roles (migrations/search/0008_channel_access.sql). */
export const CHANNEL_ACCESS_TABLE = 'channel_access';

/**
 * Statements that bring a channel's access rows in line with its record
 * (`members`; null = the channel is gone). Run them after the channel's
 * ownership upsert in the same batch: they share its version guard, so an
 * older copy of the channel arriving late changes nothing.
 */
export function channelAccessStatements(db: SearchDb, channelId: string, raw: unknown, version: number): SearchStatement[] {
  if (raw == null) {
    return [db.prepare(`DELETE FROM ${CHANNEL_ACCESS_TABLE} WHERE channel_id = ?`).bind(channelId)];
  }
  const members = channelMembersOf(raw as { userId?: string | null; members?: unknown });
  const statements: SearchStatement[] = [
    // Rows from this or an older copy that the new copy no longer lists
    db.prepare(`DELETE FROM ${CHANNEL_ACCESS_TABLE} WHERE channel_id = ? AND source_version <= ?`).bind(channelId, version),
  ];
  for (const member of members) {
    statements.push(db.prepare(
      `INSERT INTO ${CHANNEL_ACCESS_TABLE} (channel_id, user_id, role, source_version)
       SELECT ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM ${OWNERSHIP_TABLE} WHERE kind = 'channel' AND id = ? AND source_version > ?)
         AND ${NOT_TOMBSTONED}
       ON CONFLICT(channel_id, user_id) DO UPDATE SET role = excluded.role, source_version = excluded.source_version
       WHERE excluded.source_version >= ${CHANNEL_ACCESS_TABLE}.source_version`,
    ).bind(channelId, member.userId, member.role, version, channelId, version, ownershipTombstone('channel'), channelId, version));
  }
  return statements;
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
  version = now,
): Promise<OwnershipSyncResult> {
  if (object == null) {
    // Tombstone at the newer of the delete time and the row's version, then delete
    await db.batch([
      db.prepare(
        `INSERT INTO search_tombstones (entity, id, version)
         VALUES (?4, ?2, max(?3, COALESCE((SELECT source_version FROM ${OWNERSHIP_TABLE} WHERE kind = ?1 AND id = ?2), 0)))
         ON CONFLICT(entity, id) DO UPDATE SET version = max(version, excluded.version)`,
      ).bind(kind, id, version, ownershipTombstone(kind)),
      ownershipDeleteStatement(db, kind, id),
      ...(kind === 'channel' ? channelAccessStatements(db, id, null, version) : []),
    ]);
    return 'removed';
  }
  const row = projectOwnership(kind, id, object);
  if (!row) return 'skipped';
  if (kind === 'channel') {
    // The channel's role rows move with it, in one batch
    await db.batch([ownershipUpsertStatement(db, row, now, version), ...channelAccessStatements(db, id, object, version)]);
    return 'upserted';
  }
  await ownershipUpsertStatement(db, row, now, version).run();
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
  version = now,
): Promise<SafeOwnershipResult> {
  try {
    return { ok: true, result: await syncOwnership(db, kind, id, object, now, version) };
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
