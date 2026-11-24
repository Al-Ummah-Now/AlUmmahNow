/**
 * /api/kids/* — Videos Admin Ummah Kids curation, review queue, and policy readiness
 * (wiki E20 §5.2; stories E20-2, E20-3).
 *
 * Every route is explicitly listed under `FEATURE_ROUTE_EXEMPTIONS` so staff curation
 * and policy readiness setup stay reachable while `ummahKids` is OFF (B1); all routes
 * still enforce `authMiddleware`, `adminMiddleware`, and `passkeyMiddleware`. Zero child
 * personal data is accepted or stored here.
 */
import { Hono, type Context } from 'hono';
import {
  KIDS_DECISION_IDS,
  cleanKidsTopics,
  cleanTrashReason,
  isKidsAgeBand,
  isKidsCatalogStatus,
  isKidsTargetType,
  isSuperAdmin,
  kidsCanTurnOn,
  normalizeSearchText,
  parseKidsTopicsJson,
  purgeAfter,
  type KidsAgeBand,
  type KidsCatalogStatus,
  type KidsReviewStatus,
  type KidsTargetType,
  type SearchDb,
} from '@al-ummah/shared-types';
import type { AdminBindings, AuthContext } from '../base/types';
import { apiError } from '../lib/api-error';
import { dropAudit, setAuditPrevious, writeAudit, type AuditAction } from '../lib/content/audit';
import { logger } from '../lib/logger';
import { hasAdminRole, hasModeratorRole } from '../lib/roles';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const MAX_STAFF_CHANNELS = 25;

class HttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

interface CatalogRow {
  id: string;
  target_type: KidsTargetType;
  target_id: string;
  age_band: KidsAgeBand;
  status: KidsCatalogStatus;
  pre_delete_status: 'approved' | 'revoked' | null;
  topics_json: string;
  position: number;
  approved_by: string;
  approved_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
  purge_after: string | null;
  updated_at: string;
}

interface ReviewRow {
  id: string;
  target_type: KidsTargetType;
  target_id: string;
  channel_id: string;
  requested_by: string;
  suggested_age_band: KidsAgeBand;
  notes: string | null;
  status: KidsReviewStatus;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const ok = (c: C, result: unknown, status: 200 | 201 = 200) => c.json({ success: true, result }, status);

async function bodyOf(c: C): Promise<Record<string, unknown>> {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function dbOf(c: C): SearchDb {
  const bound = c.env.SEARCH_DB as unknown as SearchDb | undefined;
  if (!bound) throw new HttpError(503, 'service_unavailable', 'SEARCH_DB not bound');
  return bound;
}

function needModerator(c: C): void {
  if (!hasModeratorRole(c.get('auth')?.roles)) throw new HttpError(403, 'forbidden', 'Moderator or admin role required');
}

function needAdmin(c: C): void {
  if (!hasAdminRole(c.get('auth')?.roles)) throw new HttpError(403, 'forbidden', 'Admin role required');
}

function needSuperAdmin(c: C): void {
  if (!isSuperAdmin(c.get('auth')?.roles)) throw new HttpError(403, 'forbidden', 'Super admin role required');
}

function cleanStaffChannelIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || id.length > 128 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_STAFF_CHANNELS) break;
  }
  return out;
}

function parseStaffChannelIdsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return cleanStaffChannelIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function getStaffChannelIds(db: SearchDb): Promise<string[]> {
  const row = await db
    .prepare("SELECT staff_channel_ids_json FROM kids_policy_settings WHERE key = 'default'")
    .first<{ staff_channel_ids_json: string | null }>();
  return parseStaffChannelIdsJson(row?.staff_channel_ids_json);
}

/**
 * Ensures catalog approvals/edits reference an existing, visible video or a visible
 * playlist owned by an approved staff editorial channel. Channel-wide approvals are
 * refused until channel admission semantics are built and shipped.
 */
async function verifyCatalogTarget(db: SearchDb, targetType: KidsTargetType, targetId: string): Promise<void> {
  if (targetType === 'channel') {
    throw new HttpError(400, 'invalid_request', 'Channel-wide approvals are not supported; approve individual videos or staff playlists');
  }
  if (targetType === 'video') {
    const row = await db
      .prepare('SELECT id, visible FROM search_videos WHERE id = ?')
      .bind(targetId)
      .first<{ id: string; visible: number }>();
    if (!row) throw new HttpError(404, 'video_not_found', 'Video not found');
    if (Number(row.visible) !== 1) throw new HttpError(400, 'kids_video_hidden', 'Video must be visible before Kids approval');
    return;
  }
  const playlist = await db
    .prepare('SELECT id, channel_id, visible FROM search_playlists WHERE id = ?')
    .bind(targetId)
    .first<{ id: string; channel_id: string | null; visible: number }>();
  if (!playlist) throw new HttpError(404, 'playlist_not_found', 'Playlist not found');
  if (Number(playlist.visible) !== 1) throw new HttpError(400, 'kids_video_hidden', 'Playlist must be visible before Kids approval');
  const staffChannels = await getStaffChannelIds(db);
  if (!playlist.channel_id || !staffChannels.includes(playlist.channel_id)) {
    throw new HttpError(403, 'kids_staff_playlist_required', 'Curated playlists must belong to a staff-owned editorial channel');
  }
}

const toCatalogView = (row: CatalogRow) => ({
  id: row.id,
  targetType: row.target_type,
  targetId: row.target_id,
  ageBand: row.age_band,
  status: row.status,
  topics: parseKidsTopicsJson(row.topics_json),
  position: Number(row.position) || 0,
  approvedBy: row.approved_by,
  approvedAt: row.approved_at,
  deletedAt: row.deleted_at,
  deletedBy: row.deleted_by,
  deleteReason: row.delete_reason,
  purgeAfter: row.purge_after,
  updatedAt: row.updated_at,
});

const toReviewView = (row: ReviewRow) => ({
  id: row.id,
  targetType: row.target_type,
  targetId: row.target_id,
  channelId: row.channel_id,
  requestedBy: row.requested_by,
  suggestedAgeBand: row.suggested_age_band,
  notes: row.notes,
  status: row.status,
  decisionReason: row.decision_reason,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  createdAt: row.created_at,
});

async function writeKidsAudit(
  db: SearchDb,
  entry: { entityType: string; entityId: string; action: string; actorId: string; details?: Record<string, unknown>; now: string },
): Promise<void> {
  await db
    .prepare('INSERT INTO kids_catalog_audit (id, entity_type, entity_id, action, actor_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      crypto.randomUUID(),
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.actorId,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.now,
    )
    .run();
}

async function audited<T>(
  c: C,
  entry: Omit<AuditAction, 'actorId'>,
  run: () => Promise<T>,
  previousFrom?: (result: T) => Record<string, unknown> | null | undefined,
): Promise<T> {
  const reports = c.env.REPORTS_DB;
  const auditId = await writeAudit(reports, { ...entry, actorId: actorOf(c) });
  try {
    const result = await run();
    const previous = previousFrom?.(result);
    if (previous) {
      await setAuditPrevious(reports, auditId, previous).catch((err) =>
        logger.warn('[KidsAdmin] Could not record previous audit state', { auditId, error: String(err) }),
      );
    }
    return result;
  } catch (error) {
    await dropAudit(reports, auditId).catch((err) =>
      logger.error('[KidsAdmin] Could not drop failed audit row', { auditId, error: String(err) }),
    );
    throw error;
  }
}

const clampLimit = (raw: string | undefined, fallback = 30, max = 50): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
};

function encodeCursor(value: unknown): string {
  return btoa(JSON.stringify(value));
}

function decodeCursor<T>(raw: string | undefined, validate: (v: unknown) => v is T): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(raw));
    if (validate(parsed)) return parsed;
  } catch {
    // Throw uniform 400 below
  }
  throw new HttpError(400, 'invalid_request', 'Invalid cursor');
}

const isCatalogCursor = (v: unknown): v is { pos: number; upd: string; id: string } =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as { pos?: unknown }).pos === 'number' &&
  Number.isInteger((v as { pos: number }).pos) &&
  typeof (v as { upd?: unknown }).upd === 'string' &&
  typeof (v as { id?: unknown }).id === 'string';

const isReviewCursor = (v: unknown): v is { ts: string; id: string } =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as { ts?: unknown }).ts === 'string' &&
  typeof (v as { id?: unknown }).id === 'string';

const isStaffPlaylistCursor = (v: unknown): v is { chIdx: number; ts: string; id: string } =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as { chIdx?: unknown }).chIdx === 'number' &&
  Number.isInteger((v as { chIdx: number }).chIdx) &&
  (v as { chIdx: number }).chIdx >= 0 &&
  typeof (v as { ts?: unknown }).ts === 'string' &&
  typeof (v as { id?: unknown }).id === 'string';

/**
 * Hourly cleanup of soft-deleted Kids catalog rows whose 30-day retention window has elapsed.
 * Safe to run concurrently/repeatedly (`status = 'deleted' AND purge_after <= ?`).
 */
export async function purgeExpiredKidsCatalogItems(
  db: SearchDb | undefined,
  now = new Date(),
  limit = 50,
): Promise<{ purged: number; failed: number }> {
  if (!db) return { purged: 0, failed: 0 };
  const cutoffIso = now.toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, target_type, target_id
       FROM kids_catalog_items
       WHERE status = 'deleted' AND purge_after IS NOT NULL AND purge_after <= ?
       ORDER BY purge_after ASC, id ASC
       LIMIT ?`,
    )
    .bind(cutoffIso, limit)
    .all<{ id: string; target_type: KidsTargetType; target_id: string }>();

  let purged = 0;
  let failed = 0;
  for (const row of results ?? []) {
    try {
      const batchResults = await db.batch([
        db
          .prepare("DELETE FROM kids_catalog_items WHERE id = ? AND status = 'deleted' AND purge_after IS NOT NULL AND purge_after <= ? RETURNING id")
          .bind(row.id, cutoffIso),
        db
          .prepare(
            `INSERT INTO kids_catalog_audit (id, entity_type, entity_id, action, actor_id, details_json, created_at)
             SELECT ?, 'catalog_item', ?, 'purge', 'system:cleanup', ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM kids_catalog_items WHERE id = ?)`,
          )
          .bind(
            crypto.randomUUID(),
            row.id,
            JSON.stringify({ targetType: row.target_type, targetId: row.target_id }),
            cutoffIso,
            row.id,
          ),
      ]);
      const deletedRow = (batchResults[0] as { results?: Array<{ id: string }> } | undefined)?.results?.[0];
      if (deletedRow?.id) purged += 1;
    } catch (error) {
      failed += 1;
      logger.error('[KidsAdmin] Failed to purge expired catalog row', { id: row.id, error: String(error) });
    }
  }
  return { purged, failed };
}

const app = new Hono<Env>();

app.onError((error, c) => {
  if (error instanceof HttpError) return apiError(c, error.status, error.code, { error: error.message });
  logger.error('[KidsAdmin] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return apiError(c, 500, 'internal_error');
});

// ---------------------------------------------------------------------------
// Catalog allowlist
// ---------------------------------------------------------------------------

app.get('/catalog', async (c) => {
  needModerator(c);
  const db = dbOf(c);
  const statusParam = c.req.query('status');
  const ageBand = c.req.query('ageBand');
  const targetType = c.req.query('targetType');
  const targetId = c.req.query('targetId')?.trim();
  const limit = clampLimit(c.req.query('limit'));
  const cursor = decodeCursor(c.req.query('cursor'), isCatalogCursor);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (statusParam) {
    if (!isKidsCatalogStatus(statusParam)) throw new HttpError(400, 'invalid_request', 'Invalid status');
    where.push('status = ?');
    binds.push(statusParam);
  } else {
    where.push("status IN ('approved', 'revoked')");
  }
  if (ageBand) {
    if (!isKidsAgeBand(ageBand)) throw new HttpError(400, 'invalid_request', 'Invalid ageBand');
    where.push('age_band = ?');
    binds.push(ageBand);
  }
  if (targetType) {
    if (!isKidsTargetType(targetType)) throw new HttpError(400, 'invalid_request', 'Invalid targetType');
    where.push('target_type = ?');
    binds.push(targetType);
  }
  if (targetId) {
    where.push('target_id = ?');
    binds.push(targetId);
  }
  if (cursor) {
    where.push('(position > ? OR (position = ? AND updated_at < ?) OR (position = ? AND updated_at = ? AND id > ?))');
    binds.push(cursor.pos, cursor.pos, cursor.upd, cursor.pos, cursor.upd, cursor.id);
  }

  const sql = `SELECT * FROM kids_catalog_items WHERE ${where.join(' AND ')} ORDER BY position ASC, updated_at DESC, id ASC LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...binds, limit + 1).all<CatalogRow>();
  const rows = results ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  const revokedIds = page.filter((r) => r.status === 'revoked').map((r) => r.id);
  const revokeMeta = new Map<string, { revokedByEdit: boolean; revocationReason: string | null; revokedAt: string | null }>();
  if (revokedIds.length > 0) {
    await Promise.all(
      revokedIds.map(async (revId) => {
        const auditRow = await db
          .prepare(
            `SELECT action, details_json, created_at
             FROM kids_catalog_audit
             WHERE entity_type = 'catalog_item' AND entity_id = ?
             ORDER BY created_at DESC
             LIMIT 1`,
          )
          .bind(revId)
          .first<{ action: string; details_json: string | null; created_at: string }>();
        if (!auditRow) return;
        let reason: string | null = null;
        if (auditRow.details_json) {
          try {
            const parsed = JSON.parse(auditRow.details_json) as { reason?: unknown };
            if (typeof parsed?.reason === 'string') reason = parsed.reason;
          } catch {
            reason = null;
          }
        }
        revokeMeta.set(revId, {
          revokedByEdit: auditRow.action === 'metadata_changed',
          revocationReason: reason,
          revokedAt: auditRow.created_at,
        });
      }),
    );
  }

  return ok(c, {
    items: page.map((row) => ({
      ...toCatalogView(row),
      ...(revokeMeta.get(row.id) ?? {}),
    })),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ pos: Number(last.position) || 0, upd: last.updated_at, id: last.id }) : null,
    canDelete: hasAdminRole(c.get('auth')?.roles),
  });
});

app.get('/staff-playlists', async (c) => {
  needModerator(c);
  const db = dbOf(c);
  const q = c.req.query('q')?.trim() ?? '';
  const limit = clampLimit(c.req.query('limit'), 20, 40);
  const cursor = decodeCursor(c.req.query('cursor'), isStaffPlaylistCursor);
  const staffChannels = await getStaffChannelIds(db);
  if (staffChannels.length === 0) {
    return ok(c, { items: [], staffChannelIds: [], nextCursor: null });
  }

  const needle = normalizeSearchText(q);
  const matched: Array<{ kind: 'playlist'; id: string; label: string; secondary: string | null; imageUrl: null }> = [];
  let nextCursor: string | null = null;
  let chIdx = cursor ? Math.min(cursor.chIdx, staffChannels.length) : 0;
  let lastTs = cursor?.ts ?? '';
  let lastId = cursor?.id ?? '';
  let scannedTotal = 0;
  const MAX_SCAN = needle ? 2500 : 600;
  const BATCH_SIZE = needle ? 200 : 100;

  while (chIdx < staffChannels.length && matched.length <= limit && scannedTotal < MAX_SCAN) {
    const channelId = staffChannels[chIdx]!;
    const hasKey = lastTs !== '';
    const sql = hasKey
      ? `SELECT id, channel_id, created_at, payload
         FROM search_playlists INDEXED BY idx_search_playlists_channel_created
         WHERE channel_id = ? AND visible = 1 AND (created_at < ? OR (created_at = ? AND id > ?))
         ORDER BY created_at DESC, id ASC
         LIMIT ?`
      : `SELECT id, channel_id, created_at, payload
         FROM search_playlists INDEXED BY idx_search_playlists_channel_created
         WHERE channel_id = ? AND visible = 1
         ORDER BY created_at DESC, id ASC
         LIMIT ?`;
    const binds = hasKey ? [channelId, lastTs, lastTs, lastId, BATCH_SIZE] : [channelId, BATCH_SIZE];
    const { results } = await db.prepare(sql).bind(...binds).all<{ id: string; channel_id: string | null; created_at: string; payload: string }>();
    const rows = results ?? [];
    scannedTotal += rows.length;

    if (rows.length === 0) {
      chIdx += 1;
      lastTs = '';
      lastId = '';
      continue;
    }

    for (const row of rows) {
      let payload: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(row.payload);
        if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
      } catch {
        payload = null;
      }
      const title = typeof payload?.title === 'string' && payload.title ? payload.title : row.id;
      const channelName = typeof payload?.channelName === 'string' && payload.channelName ? payload.channelName : row.channel_id;
      lastTs = row.created_at ?? '';
      lastId = row.id;
      if (needle) {
        const candidates = [title, row.id, channelName ?? ''];
        if (payload?.titleLocalized && typeof payload.titleLocalized === 'object') {
          for (const v of Object.values(payload.titleLocalized as Record<string, unknown>)) {
            if (typeof v === 'string') candidates.push(v);
          }
        }
        if (!candidates.some((part) => normalizeSearchText(part).includes(needle))) continue;
      }
      if (matched.length < limit) {
        matched.push({
          kind: 'playlist',
          id: row.id,
          label: title,
          secondary: channelName ?? null,
          imageUrl: null,
        });
        nextCursor = encodeCursor({ chIdx, ts: row.created_at ?? '', id: row.id });
      } else {
        return ok(c, {
          items: matched,
          staffChannelIds: staffChannels,
          nextCursor,
        });
      }
    }

    if (rows.length < BATCH_SIZE) {
      chIdx += 1;
      lastTs = '';
      lastId = '';
    }
  }

  return ok(c, {
    items: matched,
    staffChannelIds: staffChannels,
    nextCursor: chIdx < staffChannels.length ? encodeCursor({ chIdx, ts: lastTs, id: lastId }) : null,
  });
});

app.post('/catalog', async (c) => {
  needModerator(c);
  const db = dbOf(c);
  const body = await bodyOf(c);
  if (body.targetType !== 'video' && body.targetType !== 'playlist') {
    throw new HttpError(400, 'invalid_request', 'targetType must be video or playlist');
  }
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId || targetId.length > 128) throw new HttpError(400, 'invalid_request', 'targetId is required');
  const ageBand = body.ageBand === undefined ? 'all' : body.ageBand;
  if (!isKidsAgeBand(ageBand)) throw new HttpError(400, 'invalid_request', 'Invalid ageBand');
  const topics = cleanKidsTopics(body.topics);
  const position = Number.isInteger(body.position) ? Number(body.position) : 0;

  await verifyCatalogTarget(db, body.targetType, targetId);

  const existing = await db
    .prepare('SELECT * FROM kids_catalog_items WHERE target_type = ? AND target_id = ?')
    .bind(body.targetType, targetId)
    .first<CatalogRow>();
  if (existing?.status === 'deleted') {
    throw new HttpError(409, 'kids_catalog_deleted', 'Deleted catalog item must be restored by an admin before re-approval');
  }

  const resolvedTopics =
    body.topics !== undefined ? topics : existing ? parseKidsTopicsJson(existing.topics_json) : topics;
  const resolvedPosition =
    body.position !== undefined ? position : existing ? Number(existing.position) || 0 : position;

  const now = new Date().toISOString();
  const actor = actorOf(c);
  const id = existing?.id ?? `kids_${crypto.randomUUID()}`;
  const out = await audited(
    c,
    { kind: 'kids-catalog', id, action: existing ? 'kids.catalog.reapprove' : 'kids.catalog.approve', details: { targetType: body.targetType, targetId, ageBand, topics: resolvedTopics, position: resolvedPosition } },
    async () => {
      if (existing) {
        const updated = await db
          .prepare(
            `UPDATE kids_catalog_items
             SET age_band = ?, status = 'approved', pre_delete_status = NULL, topics_json = ?, position = ?,
                 approved_by = ?, approved_at = ?, updated_at = ?
             WHERE id = ? AND status != 'deleted'
             RETURNING id`,
          )
          .bind(ageBand, JSON.stringify(resolvedTopics), resolvedPosition, actor, now, now, id)
          .first<{ id: string }>();
        if (!updated) throw new HttpError(409, 'kids_catalog_deleted', 'Deleted catalog item must be restored by an admin before re-approval');
      } else {
        try {
          await db
            .prepare(
              `INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at)
               VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)`,
            )
            .bind(id, body.targetType, targetId, ageBand, JSON.stringify(resolvedTopics), resolvedPosition, actor, now, now)
            .run();
        } catch (err) {
          if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
            throw new HttpError(409, 'conflict', 'Catalog item already exists');
          }
          throw err;
        }
      }
      await writeKidsAudit(db, { entityType: 'catalog_item', entityId: id, action: existing ? 'reapprove' : 'approve', actorId: actor, details: { ageBand, topics: resolvedTopics, position: resolvedPosition }, now });
      return (await db.prepare('SELECT * FROM kids_catalog_items WHERE id = ?').bind(id).first<CatalogRow>())!;
    },
    () => (existing ? { status: existing.status, ageBand: existing.age_band } : null),
  );

  return ok(c, { item: toCatalogView(out) }, existing ? 200 : 201);
});

app.patch('/catalog/:id', async (c) => {
  needModerator(c);
  const db = dbOf(c);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT * FROM kids_catalog_items WHERE id = ?').bind(id).first<CatalogRow>();
  if (!existing || existing.status === 'deleted') throw new HttpError(404, 'kids_catalog_not_found');

  const body = await bodyOf(c);
  const sets: string[] = [];
  const binds: unknown[] = [];

  const ageBand = body.ageBand !== undefined ? body.ageBand : existing.age_band;
  if (body.ageBand !== undefined) {
    if (!isKidsAgeBand(ageBand)) throw new HttpError(400, 'invalid_request', 'Invalid ageBand');
    sets.push('age_band = ?');
    binds.push(ageBand);
  }

  const status = body.status !== undefined ? body.status : existing.status;
  if (body.status !== undefined) {
    if (status !== 'approved' && status !== 'revoked') throw new HttpError(400, 'invalid_request', 'status must be approved or revoked');
    if (existing.target_type === 'channel' && status === 'approved') {
      throw new HttpError(400, 'invalid_request', 'Channel-wide approvals are not supported; approve individual videos or staff playlists');
    }
    sets.push('status = ?');
    binds.push(status);
  }
  if (status === 'approved' && (existing.status !== 'approved' || existing.target_type === 'playlist')) {
    await verifyCatalogTarget(db, existing.target_type, existing.target_id);
  }

  const topics = body.topics !== undefined ? cleanKidsTopics(body.topics) : parseKidsTopicsJson(existing.topics_json);
  if (body.topics !== undefined) {
    sets.push('topics_json = ?');
    binds.push(JSON.stringify(topics));
  }

  const position = body.position !== undefined ? Number(body.position) : Number(existing.position);
  if (body.position !== undefined) {
    if (!Number.isInteger(body.position)) throw new HttpError(400, 'invalid_request', 'Invalid position');
    sets.push('position = ?');
    binds.push(position);
  }

  const now = new Date().toISOString();
  const actor = actorOf(c);
  const reapproved = existing.status === 'revoked' && status === 'approved';
  if (reapproved) {
    sets.push('approved_by = ?', 'approved_at = ?');
    binds.push(actor, now);
  }
  sets.push('updated_at = ?');
  binds.push(now);

  const updated = await audited(
    c,
    { kind: 'kids-catalog', id, action: 'kids.catalog.update', details: { ageBand, status, topics, position }, previous: { ageBand: existing.age_band, status: existing.status, position: existing.position } },
    async () => {
      const row = await db
        .prepare(`UPDATE kids_catalog_items SET ${sets.join(', ')} WHERE id = ? AND status != 'deleted' RETURNING *`)
        .bind(...binds, id)
        .first<CatalogRow>();
      if (!row) throw new HttpError(404, 'kids_catalog_not_found');
      await writeKidsAudit(db, { entityType: 'catalog_item', entityId: id, action: 'update', actorId: actor, details: { ageBand, status, position }, now });
      return row;
    },
  );
  return ok(c, { item: toCatalogView(updated) });
});

app.delete('/catalog/:id', async (c) => {
  needAdmin(c);
  const db = dbOf(c);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT * FROM kids_catalog_items WHERE id = ?').bind(id).first<CatalogRow>();
  if (!existing || existing.status === 'deleted') throw new HttpError(404, 'kids_catalog_not_found');

  const body = await bodyOf(c);
  const reason = cleanTrashReason(body.reason);
  const now = new Date().toISOString();
  const purge = purgeAfter(now);
  const actor = actorOf(c);

  const updated = await audited(
    c,
    { kind: 'kids-catalog', id, action: 'kids.catalog.soft_delete', details: { reason, purgeAfter: purge }, previous: { status: existing.status } },
    async () => {
      const marked = await db
        .prepare(
          `UPDATE kids_catalog_items
           SET pre_delete_status = status, status = 'deleted', deleted_at = ?, deleted_by = ?, delete_reason = ?, purge_after = ?, updated_at = ?
           WHERE id = ? AND status != 'deleted'
           RETURNING *`,
        )
        .bind(now, actor, reason, purge, now, id)
        .first<CatalogRow>();
      if (!marked) throw new HttpError(404, 'kids_catalog_not_found');
      await writeKidsAudit(db, { entityType: 'catalog_item', entityId: id, action: 'soft_delete', actorId: actor, details: { reason, purgeAfter: purge }, now });
      return marked;
    },
  );
  return ok(c, { item: toCatalogView(updated) });
});

app.post('/catalog/:id/restore', async (c) => {
  needAdmin(c);
  const db = dbOf(c);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT * FROM kids_catalog_items WHERE id = ?').bind(id).first<CatalogRow>();
  if (!existing || existing.status !== 'deleted') throw new HttpError(404, 'kids_catalog_not_found');

  let restoreStatus: 'approved' | 'revoked' = 'revoked';
  if (existing.pre_delete_status === 'approved') {
    try {
      await verifyCatalogTarget(db, existing.target_type, existing.target_id);
      restoreStatus = 'approved';
    } catch {
      restoreStatus = 'revoked';
    }
  }

  const now = new Date().toISOString();
  const actor = actorOf(c);
  const restored = await audited(
    c,
    { kind: 'kids-catalog', id, action: 'kids.catalog.restore', details: { status: restoreStatus }, previous: { status: 'deleted', deletedAt: existing.deleted_at } },
    async () => {
      const row = await db
        .prepare(
          `UPDATE kids_catalog_items
           SET status = ?, pre_delete_status = NULL, deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, purge_after = NULL, updated_at = ?
           WHERE id = ? AND status = 'deleted'
           RETURNING *`,
        )
        .bind(restoreStatus, now, id)
        .first<CatalogRow>();
      if (!row) throw new HttpError(404, 'kids_catalog_not_found');
      await writeKidsAudit(db, { entityType: 'catalog_item', entityId: id, action: 'restore', actorId: actor, details: { status: restoreStatus }, now });
      return row;
    },
  );
  return ok(c, { item: toCatalogView(restored) });
});

// ---------------------------------------------------------------------------
// Creator review requests queue
// ---------------------------------------------------------------------------

app.get('/review-requests', async (c) => {
  needModerator(c);
  const db = dbOf(c);
  const status = c.req.query('status') ?? 'pending';
  if (status !== 'pending' && status !== 'approved' && status !== 'declined') {
    throw new HttpError(400, 'invalid_request', 'Invalid status');
  }
  const limit = clampLimit(c.req.query('limit'));
  const cursor = decodeCursor(c.req.query('cursor'), isReviewCursor);
  const asc = status === 'pending';
  const order = asc ? 'created_at ASC, id ASC' : 'created_at DESC, id DESC';
  const where: string[] = ['status = ?'];
  const binds: unknown[] = [status];
  if (cursor) {
    where.push(asc ? '(created_at > ? OR (created_at = ? AND id > ?))' : '(created_at < ? OR (created_at = ? AND id < ?))');
    binds.push(cursor.ts, cursor.ts, cursor.id);
  }
  const { results } = await db
    .prepare(`SELECT * FROM kids_review_requests WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
    .bind(...binds, limit + 1)
    .all<ReviewRow>();
  const rows = results ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return ok(c, {
    items: page.map(toReviewView),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ ts: last.created_at, id: last.id }) : null,
  });
});

app.post('/review-requests/:id/decide', async (c) => {
  needModerator(c);
  const db = dbOf(c);
  const id = c.req.param('id');
  const reqRow = await db.prepare('SELECT * FROM kids_review_requests WHERE id = ?').bind(id).first<ReviewRow>();
  if (!reqRow) throw new HttpError(404, 'not_found', 'Review request not found');
  if (reqRow.status !== 'pending') throw new HttpError(409, 'kids_review_already_decided', 'Review request already decided');

  const body = await bodyOf(c);
  const decision = body.decision;
  if (decision !== 'approved' && decision !== 'declined') throw new HttpError(400, 'invalid_request', 'decision must be approved or declined');
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
  const ageBand = body.ageBand !== undefined ? body.ageBand : reqRow.suggested_age_band;
  if (!isKidsAgeBand(ageBand)) throw new HttpError(400, 'invalid_request', 'Invalid ageBand');
  const providedTopics = body.topics === undefined ? null : cleanKidsTopics(body.topics);

  let existingItem: { id: string; status: KidsCatalogStatus; topics_json: string } | null = null;
  if (decision === 'approved') {
    if (reqRow.target_type !== 'video') {
      throw new HttpError(400, 'invalid_request', 'Only individual videos can be approved from the review queue');
    }
    await verifyCatalogTarget(db, 'video', reqRow.target_id);
    existingItem = await db
      .prepare("SELECT id, status, topics_json FROM kids_catalog_items WHERE target_type = 'video' AND target_id = ?")
      .bind(reqRow.target_id)
      .first<{ id: string; status: KidsCatalogStatus; topics_json: string }>();
    if (existingItem?.status === 'deleted') {
      throw new HttpError(409, 'kids_catalog_deleted', 'Deleted catalog item must be restored by an admin before re-approval');
    }
  }

  const now = new Date().toISOString();
  const actor = actorOf(c);

  const out = await audited(
    c,
    { kind: 'kids-review', id, action: `kids.review.${decision}`, details: { targetType: reqRow.target_type, targetId: reqRow.target_id, ageBand, reason } },
    async () => {
      const claimStmt =
        decision === 'approved'
          ? db
              .prepare(
                `UPDATE kids_review_requests
                 SET status = 'approved', decision_reason = ?, decided_by = ?, decided_at = ?
                 WHERE id = ? AND status = 'pending'
                   AND NOT EXISTS (SELECT 1 FROM kids_catalog_items WHERE target_type = 'video' AND target_id = ? AND status = 'deleted')
                 RETURNING *`,
              )
              .bind(reason, actor, now, id, reqRow.target_id)
          : db
              .prepare(
                `UPDATE kids_review_requests
                 SET status = 'declined', decision_reason = ?, decided_by = ?, decided_at = ?
                 WHERE id = ? AND status = 'pending'
                 RETURNING *`,
              )
              .bind(reason, actor, now, id);

      const statements = [claimStmt];
      if (decision === 'approved') {
        const topicsToSave = providedTopics ?? (existingItem ? parseKidsTopicsJson(existingItem.topics_json) : []);
        const itemId = existingItem?.id ?? `kids_${crypto.randomUUID()}`;
        if (existingItem) {
          statements.push(
            db
              .prepare(
                `UPDATE kids_catalog_items
                 SET age_band = ?, status = 'approved', topics_json = ?, approved_by = ?, approved_at = ?, updated_at = ?
                 WHERE id = ? AND status != 'deleted'
                   AND EXISTS (SELECT 1 FROM kids_review_requests WHERE id = ? AND status = 'approved' AND decided_by = ? AND decided_at = ?)`,
              )
              .bind(ageBand, JSON.stringify(topicsToSave), actor, now, now, itemId, id, actor, now),
          );
        } else {
          statements.push(
            db
              .prepare(
                `INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at)
                 SELECT ?, 'video', ?, ?, 'approved', ?, 0, ?, ?, ?
                 WHERE EXISTS (SELECT 1 FROM kids_review_requests WHERE id = ? AND status = 'approved' AND decided_by = ? AND decided_at = ?)`,
              )
              .bind(itemId, reqRow.target_id, ageBand, JSON.stringify(topicsToSave), actor, now, now, id, actor, now),
          );
        }
      }
      statements.push(
        db
          .prepare(
            `INSERT INTO kids_catalog_audit (id, entity_type, entity_id, action, actor_id, details_json, created_at)
             SELECT ?, 'review_request', ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM kids_review_requests WHERE id = ? AND status = ? AND decided_by = ? AND decided_at = ?)`,
          )
          .bind(
            crypto.randomUUID(),
            id,
            decision,
            actor,
            JSON.stringify({ reason, ageBand }),
            now,
            id,
            decision,
            actor,
            now,
          ),
      );

      let batchResults: unknown[];
      try {
        batchResults = await db.batch(statements);
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
          throw new HttpError(409, 'kids_review_already_decided', 'Video already decided concurrently');
        }
        throw err;
      }

      const claimed = ((batchResults[0] as { results?: ReviewRow[] } | undefined)?.results?.[0]) ?? null;
      if (!claimed) {
        if (decision === 'approved') {
          const curCat = await db
            .prepare("SELECT status FROM kids_catalog_items WHERE target_type = 'video' AND target_id = ?")
            .bind(reqRow.target_id)
            .first<{ status: KidsCatalogStatus }>();
          if (curCat?.status === 'deleted') {
            throw new HttpError(409, 'kids_catalog_deleted', 'Deleted catalog item must be restored by an admin before re-approval');
          }
        }
        throw new HttpError(409, 'kids_review_already_decided', 'Review request already decided');
      }
      return claimed;
    },
  );
  return ok(c, { request: toReviewView(out) });
});

// ---------------------------------------------------------------------------
// Policy readiness (FEATURE_PRECONDITIONS.ummahKids)
// ---------------------------------------------------------------------------

app.get('/policy', async (c) => {
  needModerator(c);
  const db = dbOf(c);
  const row = await db
    .prepare("SELECT decisions_json, staff_channel_ids_json, legal_approved, legal_approved_by, legal_approved_at, updated_at FROM kids_policy_settings WHERE key = 'default'")
    .first<{
      decisions_json: string;
      staff_channel_ids_json: string | null;
      legal_approved: number;
      legal_approved_by: string | null;
      legal_approved_at: string | null;
      updated_at: string;
    }>();
  let decisions: Record<string, string> = {};
  try {
    const parsed = row?.decisions_json ? JSON.parse(row.decisions_json) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) decisions = parsed as Record<string, string>;
  } catch {
    decisions = {};
  }
  const staffChannelIds = parseStaffChannelIdsJson(row?.staff_channel_ids_json);
  const readiness = await kidsCanTurnOn({ SEARCH_DB: db });
  return ok(c, {
    decisions,
    staffChannelIds,
    legalApproved: Number(row?.legal_approved ?? 0) === 1,
    legalApprovedBy: row?.legal_approved_by ?? null,
    legalApprovedAt: row?.legal_approved_at ?? null,
    updatedAt: row?.updated_at ?? null,
    readiness,
    canEdit: isSuperAdmin(c.get('auth')?.roles),
  });
});

app.put('/policy', async (c) => {
  needSuperAdmin(c);
  const db = dbOf(c);
  const body = await bodyOf(c);
  const expectedUpdatedAt =
    body.expectedUpdatedAt === undefined ? undefined : body.expectedUpdatedAt === null ? null : String(body.expectedUpdatedAt);

  const existing = await db
    .prepare("SELECT decisions_json, staff_channel_ids_json, legal_approved, legal_approved_by, legal_approved_at, updated_at FROM kids_policy_settings WHERE key = 'default'")
    .first<{
      decisions_json: string;
      staff_channel_ids_json: string | null;
      legal_approved: number;
      legal_approved_by: string | null;
      legal_approved_at: string | null;
      updated_at: string;
    }>();

  if (expectedUpdatedAt !== undefined && (existing?.updated_at ?? null) !== expectedUpdatedAt) {
    throw new HttpError(409, 'kids_policy_stale', 'Policy settings were updated in another tab; refresh and try again.');
  }

  let currentDecisions: Record<string, string> = {};
  try {
    const parsed = existing?.decisions_json ? JSON.parse(existing.decisions_json) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) currentDecisions = parsed as Record<string, string>;
  } catch {
    currentDecisions = {};
  }

  const nextDecisions = { ...currentDecisions };
  if (body.decisions && typeof body.decisions === 'object' && !Array.isArray(body.decisions)) {
    for (const [key, val] of Object.entries(body.decisions as Record<string, unknown>)) {
      if (key === 'KIDS-D9') {
        delete nextDecisions[key];
        continue;
      }
      if (!(KIDS_DECISION_IDS as readonly string[]).includes(key)) {
        throw new HttpError(400, 'invalid_request', `Unknown decision id ${key}`);
      }
      if (val === null || val === '') {
        delete nextDecisions[key];
      } else if (typeof val === 'string' && val.trim().length <= 120) {
        nextDecisions[key] = val.trim();
      } else {
        throw new HttpError(400, 'invalid_request', `Invalid value for ${key}`);
      }
    }
  }

  const currentStaffChannels = parseStaffChannelIdsJson(existing?.staff_channel_ids_json);
  let nextStaffChannels = currentStaffChannels;
  if (body.staffChannelIds !== undefined) {
    if (!Array.isArray(body.staffChannelIds)) throw new HttpError(400, 'invalid_request', 'staffChannelIds must be an array');
    nextStaffChannels = cleanStaffChannelIds(body.staffChannelIds);
  }

  const now = new Date().toISOString();
  const actor = actorOf(c);
  const legalApproved = body.legalApproved !== undefined ? (body.legalApproved === true ? 1 : 0) : Number(existing?.legal_approved ?? 0);
  const legalBy = legalApproved === 1 ? (Number(existing?.legal_approved ?? 0) === 1 ? existing?.legal_approved_by ?? actor : actor) : null;
  const legalAt = legalApproved === 1 ? (Number(existing?.legal_approved ?? 0) === 1 ? existing?.legal_approved_at ?? now : now) : null;

  await audited(
    c,
    {
      kind: 'kids-policy',
      id: 'default',
      action: 'kids.policy.update',
      details: { decisions: nextDecisions, staffChannelIds: nextStaffChannels, legalApproved: legalApproved === 1 },
      previous: { decisions: currentDecisions, staffChannelIds: currentStaffChannels, legalApproved: Number(existing?.legal_approved ?? 0) === 1 },
    },
    async () => {
      if (expectedUpdatedAt !== undefined && existing) {
        const updatedRow = await db
          .prepare(
            `UPDATE kids_policy_settings
             SET decisions_json = ?, staff_channel_ids_json = ?, legal_approved = ?, legal_approved_by = ?, legal_approved_at = ?, updated_at = ?
             WHERE key = 'default' AND updated_at = ?
             RETURNING updated_at`,
          )
          .bind(JSON.stringify(nextDecisions), JSON.stringify(nextStaffChannels), legalApproved, legalBy, legalAt, now, expectedUpdatedAt)
          .first<{ updated_at: string }>();
        if (!updatedRow) {
          throw new HttpError(409, 'kids_policy_stale', 'Policy settings were updated in another tab; refresh and try again.');
        }
      } else {
        await db
          .prepare(
            `INSERT INTO kids_policy_settings (key, decisions_json, staff_channel_ids_json, legal_approved, legal_approved_by, legal_approved_at, updated_at)
             VALUES ('default', ?, ?, ?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               decisions_json = excluded.decisions_json,
               staff_channel_ids_json = excluded.staff_channel_ids_json,
               legal_approved = excluded.legal_approved,
               legal_approved_by = excluded.legal_approved_by,
               legal_approved_at = excluded.legal_approved_at,
               updated_at = excluded.updated_at`,
          )
          .bind(JSON.stringify(nextDecisions), JSON.stringify(nextStaffChannels), legalApproved, legalBy, legalAt, now)
          .run();
      }
      await writeKidsAudit(db, { entityType: 'policy', entityId: 'default', action: 'update', actorId: actor, details: { legalApproved: legalApproved === 1 }, now });
    },
  );

  const readiness = await kidsCanTurnOn({ SEARCH_DB: db });
  return ok(c, {
    decisions: nextDecisions,
    staffChannelIds: nextStaffChannels,
    legalApproved: legalApproved === 1,
    legalApprovedBy: legalBy,
    legalApprovedAt: legalAt,
    updatedAt: now,
    readiness,
  });
});

export default app;
