/**
 * Short vs video admin actions (endpoints/videoFormat/VideoFormatAdmin.ts).
 * The rule lives in packages/shared-types (video-format.ts, video-format-ops.ts).
 */
import { applyFormatChoice, classifyVideoFormat, type VideoFormatIssue } from '@al-ummah/shared-types';
import { updateJson, type CasBucket } from './r2Cas';

export type FormatChoice = 'short' | 'video' | 'auto';

export interface SetFormatResult {
  id: string;
  changed: boolean;
  error?: string;
}

/** Search/ownership refresh for a video admin-api wrote (processor SearchIndexSync). */
export type IndexRefresh = (id: string, object: Record<string, unknown>, version: number) => Promise<void>;

/**
 * Store an admin's Short / video / auto choice on each video (conditional
 * write; a concurrent owner edit is kept) and queue the index refresh.
 */
export async function setVideoFormats(
  bucket: CasBucket,
  refresh: IndexRefresh,
  ids: string[],
  format: FormatChoice,
  actorId: string,
  now = new Date().toISOString(),
): Promise<SetFormatResult[]> {
  const results: SetFormatResult[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const written = await updateJson<Record<string, unknown>>(bucket, id, (current) => {
        if (!current) return undefined;
        const next = { ...current };
        if (!applyFormatChoice(next as never, format, { by: 'admin', userId: actorId, at: now })) return undefined;
        next.dateModified = now;
        return next;
      });
      if (!written) {
        results.push({ id, changed: false, error: 'Video not found' });
        continue;
      }
      if (written.written) await refresh(id, written.value, written.version ?? Date.now());
      results.push({ id, changed: written.written });
    } catch (error) {
      results.push({ id, changed: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

interface StoredVideo {
  title?: string;
  channelId?: string;
  userId?: string;
  thumbnailUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  uploadStatus?: string;
  isLive?: boolean;
  format?: 'short' | 'video';
  formatIssue?: VideoFormatIssue;
  dateCreated?: string;
}

interface FlaggedDb {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> };
    first<T>(): Promise<T | null>;
  };
}

/** Videos the rule cannot classify and no one chose for (ownership index needs_format), newest first. */
export async function listFlaggedVideos(
  db: FlaggedDb,
  bucket: { get(key: string): Promise<{ text(): Promise<string> } | null> },
  limit: number,
  offset: number,
) {
  const where = "kind = 'video' AND needs_format = 1 AND is_deleted = 0";
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM content_ownership WHERE ${where}`).first<{ n: number }>())?.n ?? 0;
  const { results } = await db
    .prepare(`SELECT id FROM content_ownership WHERE ${where} ORDER BY COALESCE(created_at, 0) DESC, id LIMIT ? OFFSET ?`)
    .bind(limit, offset)
    .all<{ id: string }>();
  const items = [];
  for (const { id } of results ?? []) {
    const object = await bucket.get(id);
    if (!object) continue;
    const video = JSON.parse(await object.text()) as StoredVideo;
    items.push({
      id,
      title: video.title,
      channelId: video.channelId,
      userId: video.userId,
      thumbnailUrl: video.thumbnailUrl,
      duration: video.duration ?? null,
      width: video.width ?? null,
      height: video.height ?? null,
      uploadStatus: video.uploadStatus,
      format: video.format ?? null,
      formatIssue: video.formatIssue ?? null,
      dateCreated: video.dateCreated,
      detected: classifyVideoFormat(video),
    });
  }
  return { items, total: Number(total) };
}
