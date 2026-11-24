/**
 * Automatic Kids allowlist revocation when an approved (or trashed `pre_delete_status = 'approved'`)
 * video's metadata, thumbnail, media, audio tracks, captions/subtitles, or chapters change
 * (wiki E20 `S-N`). Every edit path awaits this helper synchronously BEFORE mutating the video
 * object so D1 revocation fails closed and edited content can never remain approved in Kids Mode.
 */
import type { SearchDb } from '@al-ummah/shared-types';
import type { AppBindings } from '../../base';
import { logger } from '../logger';

export const KIDS_SNAPSHOT_KV_KEY = 'kids:catalog:snapshot:v1';

export type KidsSnapshotEnv = Partial<Pick<AppBindings, 'APP_CONFIG'>> & { ENVIRONMENT?: string };
export type KidsRevokeEnv = KidsSnapshotEnv & { SEARCH_DB?: unknown };

export function kidsCacheEnvironment(env: unknown): string {
  const raw = (env as { ENVIRONMENT?: string } | undefined)?.ENVIRONMENT?.trim();
  return raw && raw.length > 0 ? raw : 'production';
}

export function kidsSnapshotCacheUrl(env: unknown): string {
  return `https://kids-cache.internal/browse-snapshot-v1?env=${encodeURIComponent(kidsCacheEnvironment(env))}`;
}

export interface KidsEditableVideoFields {
  title?: unknown;
  description?: unknown;
  titleLocalized?: unknown;
  descriptionLocalized?: unknown;
  thumbnailUrl?: unknown;
  thumbnailType?: unknown;
  bunnyVideoId?: unknown;
  r2?: { rev?: unknown } | null;
  chapters?: unknown;
  subtitles?: unknown;
}

export async function invalidateKidsBrowseSnapshot(env: KidsSnapshotEnv): Promise<void> {
  const results = await Promise.allSettled([
    env.APP_CONFIG?.delete(KIDS_SNAPSHOT_KV_KEY),
    (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default?.delete(
      new Request(kidsSnapshotCacheUrl(env), { method: 'GET' }),
    ),
  ]);
  for (const res of results) {
    if (res.status === 'rejected') {
      logger.error('[KidsCatalog] Snapshot invalidation failed', {
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
      throw res.reason;
    }
  }
}

export function hasKidsSensitiveVideoChange(
  previous: KidsEditableVideoFields,
  next: KidsEditableVideoFields,
): boolean {
  return (
    previous.title !== next.title ||
    previous.description !== next.description ||
    JSON.stringify(previous.titleLocalized ?? null) !== JSON.stringify(next.titleLocalized ?? null) ||
    JSON.stringify(previous.descriptionLocalized ?? null) !== JSON.stringify(next.descriptionLocalized ?? null) ||
    previous.thumbnailUrl !== next.thumbnailUrl ||
    previous.thumbnailType !== next.thumbnailType ||
    previous.bunnyVideoId !== next.bunnyVideoId ||
    (previous.r2?.rev ?? null) !== (next.r2?.rev ?? null)
  );
}

/**
 * Revokes an approved Kids video (`status = 'approved' -> 'revoked'`) or clears
 * `pre_delete_status = 'revoked'` if edited while soft-deleted in trash (`status = 'deleted'`),
 * writes an immutable `'metadata_changed'` audit entry, and clears the snapshot cache.
 * Fails closed: any D1 or cache invalidation error throws instead of leaving edited content approved.
 */
export async function revokeKidsVideoOnEdit(
  env: KidsRevokeEnv,
  params: {
    videoId: string;
    actorId: string;
    reason: string;
    previous?: KidsEditableVideoFields | null;
    next?: KidsEditableVideoFields | null;
    force?: boolean;
  },
): Promise<{ revoked: boolean; catalogId?: string }> {
  const db = env.SEARCH_DB as SearchDb | undefined;
  if (!db) return { revoked: false };

  if (!params.force && params.previous && params.next && !hasKidsSensitiveVideoChange(params.previous, params.next)) {
    return { revoked: false };
  }

  const now = new Date().toISOString();
  const revoked = await db
    .prepare(
      `UPDATE kids_catalog_items
       SET status = CASE WHEN status = 'approved' THEN 'revoked' ELSE status END,
           pre_delete_status = CASE WHEN status = 'deleted' AND pre_delete_status = 'approved' THEN 'revoked' ELSE pre_delete_status END,
           updated_at = ?
       WHERE target_type = 'video' AND target_id = ?
         AND (status = 'approved' OR (status = 'deleted' AND pre_delete_status = 'approved'))
       RETURNING id, status`,
    )
    .bind(now, params.videoId)
    .first<{ id: string; status: string }>();

  if (!revoked?.id) return { revoked: false };

  await db
    .prepare(
      `INSERT INTO kids_catalog_audit (id, entity_type, entity_id, action, actor_id, details_json, created_at)
       VALUES (?, 'catalog_item', ?, 'metadata_changed', ?, ?, ?)`,
    )
    .bind(
      `kaud_${crypto.randomUUID()}`,
      revoked.id,
      params.actorId,
      JSON.stringify({ videoId: params.videoId, reason: params.reason, targetStatus: revoked.status }),
      now,
    )
    .run();

  await invalidateKidsBrowseSnapshot(env);
  logger.info('[KidsCatalog] Revoked approved video after edit', {
    videoId: params.videoId,
    catalogId: revoked.id,
    reason: params.reason,
    actorId: params.actorId,
    targetStatus: revoked.status,
  });
  return { revoked: true, catalogId: revoked.id };
}
