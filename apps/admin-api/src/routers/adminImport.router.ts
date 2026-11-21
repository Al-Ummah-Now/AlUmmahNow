/**
 * /api/admin/import/* — Admin Tools, the desktop admin import app (wiki TOOLS-ADMIN, TA-3/TA-4/TA-12).
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts); Admin Tools' tokens are accepted by
 * admin-api's audience list (shared-types token-audience.ts `adminTools`). Every route here also needs
 * `imports:manage`; making a channel needs the `channels:manage` content permission too.
 *
 *   GET  /me         who is signed in and what the app may show: { userId, email, roles,
 *                    permissions, contentPermissions }
 *   GET  /encoding   the server's HLS ladder and encode settings (shared-types ENCODE_LADDER, the same
 *                    values as the media container's ladder.mjs) and the limits of a pre-encoded
 *                    upload, so the app encodes exactly what the server checks
 *   POST /channels   { name, handle?, description?, ownerId? } → 201 { channel } — a channel owned by
 *                    `ownerId` (a videos user; needs users:manage, as an invite does) or, without
 *                    one, by the acting admin; the same
 *                    validation as an admin making a channel for an invite (409 duplicate name or
 *                    taken handle) and no tier or max-channels check. Audited (content:import:<id>).
 *
 * Bulk import (TA-5). A batch is one import run into a channel; an item is one file, unique per
 * channel by its full SHA-256, so the same file is never uploaded twice:
 *
 *   POST /batches                 { channelId, name? } → 201 { batch }
 *   GET  /batches?channelId=      the latest 50 batches (of a channel), with item counts per state
 *   GET  /batches/:id             { batch, items }
 *   POST /batches/:id/items       { sha256, fileName, fileSize, mimeType, fingerprint, title, … the
 *                                 initiate's metadata } → 201 { item, upload } — the normal upload
 *                                 (api-videos /internal/admin/import/initiate: owned by the channel's
 *                                 owner, uploaded by the admin, no tier quotas or limits); the TUS
 *                                 session is the admin's, used with their Admin Tools token. The same
 *                                 file again resumes its unfinished video; a file already uploaded
 *                                 answers 409 already_imported with its item. Audited per video.
 *   POST /items/:id/uploaded      the app sent the whole file → { item }
 *   POST /items/:id/failed        { error } the app gave up on the file → { item }
 */
import { Hono, type Context } from 'hono';
import { ENCODE_LADDER, PREBUILT_LIMITS, contentPermissionsFor, hasContentPermission } from '@al-ummah/shared-types';
import { hasPermission, normalizeRoles, permissionsFor } from '../lib/roles';
import { callVideos, VideosError, type VideosCall, type VideosClientEnv } from '../lib/content/videosClient';
import { dropAudit, setAuditSubject, writeAudit } from '../lib/content/audit';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & VideosClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();

const auth = (c: C) => c.get('auth');
const actorOf = (c: C) => auth(c)?.userId ?? 'unknown';
const videos = <T>(c: C, path: string, call: VideosCall = {}) => callVideos<T>(c.env, path, { actorId: actorOf(c), ...call });
const fail = (c: C, status: 400 | 403 | 404, code: string, error: string) => c.json({ success: false, code, error }, status);

app.use('*', async (c, next) => {
  if (!hasPermission(normalizeRoles(auth(c)?.roles), 'imports:manage')) {
    logger.warn('[AdminImport] Permission denied', { userId: actorOf(c), path: c.req.path });
    return fail(c, 403, 'forbidden', 'The imports:manage permission is required');
  }
  return next();
});

app.onError((error, c) => {
  if (error instanceof VideosError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
  logger.error('[AdminImport] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

app.get('/me', (c) => {
  const a = auth(c);
  return c.json({
    success: true,
    result: {
      userId: actorOf(c),
      email: a?.email ?? null,
      roles: normalizeRoles(a?.roles ?? []),
      permissions: permissionsFor(a?.roles),
      contentPermissions: contentPermissionsFor(a?.roles),
    },
  });
});

app.get('/encoding', (c) => c.json({ success: true, result: { ladder: ENCODE_LADDER, prebuiltLimits: PREBUILT_LIMITS } }));

const USER_ID = /^usr_[0-9a-f]{32}$/;
const text = (v: unknown, max: number): string | null | undefined =>
  v === undefined || v === null ? undefined : typeof v === 'string' ? v.trim().slice(0, max) || undefined : null;

/** Validates a new channel: a name of 1–100 characters; handle, description and ownerId optional. */
export function parseNewChannel(body: unknown):
  | { ok: true; value: { name: string; handle?: string; description?: string; ownerId?: string } }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A JSON object is required' };
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 100) return { ok: false, error: 'name is required (at most 100 characters)' };
  const handle = text(b.handle, 64);
  const description = text(b.description, 5000);
  if (handle === null) return { ok: false, error: 'handle must be text' };
  if (description === null) return { ok: false, error: 'description must be text' };
  if (b.ownerId !== undefined && b.ownerId !== null && (typeof b.ownerId !== 'string' || !USER_ID.test(b.ownerId))) {
    return { ok: false, error: 'ownerId must be a videos user id (usr_ followed by 32 hex digits)' };
  }
  return {
    ok: true,
    value: { name, ...(handle ? { handle } : {}), ...(description ? { description } : {}), ...(b.ownerId ? { ownerId: b.ownerId as string } : {}) },
  };
}

app.post('/channels', async (c) => {
  if (!hasContentPermission(auth(c)?.roles, 'channels:manage')) return fail(c, 403, 'forbidden', 'The channels:manage permission is required');
  const parsed = parseNewChannel(await c.req.json().catch(() => null));
  if (parsed.ok === false) return fail(c, 400, 'invalid_request', parsed.error);
  const { ownerId: chosen, ...input } = parsed.value;
  const ownerId = chosen ?? actorOf(c);
  // A channel for someone else is what an invite does: the same users:manage it needs (invites.router.ts)
  if (ownerId !== actorOf(c) && !hasContentPermission(auth(c)?.roles, 'users:manage')) {
    return fail(c, 403, 'forbidden', 'The users:manage permission is required to make a channel for another user');
  }
  const db = c.env.REPORTS_DB;
  // The channel id exists only once api-videos made it: the row is written first (so nothing goes
  // unaudited), pointed at the channel afterwards, and dropped if api-videos refuses.
  const auditId = await writeAudit(db, { kind: 'import', id: 'pending', action: 'channel:create', actorId: actorOf(c), details: { ownerId, name: input.name, ...(input.handle ? { handle: input.handle } : {}) } });
  try {
    const create = () => videos<{ channel: { id: string; name: string; handle?: string } }>(c, `/users/${ownerId}/channels`, { method: 'POST', json: input });
    let result: { channel: { id: string; name: string; handle?: string } };
    try {
      result = await create();
    } catch (error) {
      // An admin making a channel for themselves may have no videos profile yet: make it, then retry.
      if (!(error instanceof VideosError && error.code === 'user_not_found' && !chosen)) throw error;
      const email = auth(c)?.email;
      if (!email) throw error;
      await videos(c, '/users/provision', { method: 'POST', json: { userId: ownerId, email } });
      result = await create();
    }
    await setAuditSubject(db, auditId, 'import', result.channel.id).catch((e) =>
      logger.warn('[AdminImport] Could not point the audit row at the channel', { auditId, error: String(e) }),
    );
    logger.info('[AdminImport] Channel created', { channelId: result.channel.id, ownerId, actorId: actorOf(c) });
    return c.json({ success: true, result: { channel: result.channel } }, 201);
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[AdminImport] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Batches and items (TA-5)
// ---------------------------------------------------------------------------

export interface ImportBatchRow { id: string; channel_id: string; name: string | null; created_by: string; created_at: string; updated_at: string }
export interface ImportItemRow {
  id: string;
  batch_id: string;
  channel_id: string;
  sha256: string;
  file_name: string;
  file_size: number;
  video_id: string | null;
  state: 'initiated' | 'uploaded' | 'failed';
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const batchView = (r: ImportBatchRow, counts?: Record<string, number>) => ({
  id: r.id,
  channelId: r.channel_id,
  name: r.name,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(counts ? { counts } : {}),
});
const itemView = (r: ImportItemRow) => ({
  id: r.id,
  batchId: r.batch_id,
  channelId: r.channel_id,
  sha256: r.sha256,
  fileName: r.file_name,
  fileSize: r.file_size,
  videoId: r.video_id,
  state: r.state,
  error: r.error,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SHA256 = /^[0-9a-f]{64}$/;
const CHANNEL_ID = /^[A-Za-z0-9_-]{1,200}$/;
/** The initiate's metadata the app may send for a file (api-videos InitiateBodySchema, without youtubeImport). */
const UPLOAD_FIELDS = ['title', 'description', 'fileSize', 'mimeType', 'isPublic', 'visibility', 'isDraft', 'tags', 'titleLocalized', 'descriptionLocalized', 'category', 'format', 'thumbnail', 'fingerprint'] as const;

/** Validates a new item: the file (sha256, name, size, mime type) and its title; api-videos checks the rest. */
export function parseNewItem(body: unknown):
  | { ok: true; value: { sha256: string; fileName: string; fileSize: number; upload: Record<string, unknown> } }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A JSON object is required' };
  const b = body as Record<string, unknown>;
  const sha256 = typeof b.sha256 === 'string' ? b.sha256.toLowerCase() : '';
  if (!SHA256.test(sha256)) return { ok: false, error: 'sha256 must be the file\'s SHA-256 (64 hex digits)' };
  const fileName = typeof b.fileName === 'string' ? b.fileName.trim().slice(0, 500) : '';
  if (!fileName) return { ok: false, error: 'fileName is required' };
  if (typeof b.fileSize !== 'number' || !Number.isSafeInteger(b.fileSize) || b.fileSize <= 0) return { ok: false, error: 'fileSize must be a positive whole number of bytes' };
  if (typeof b.mimeType !== 'string' || !b.mimeType.startsWith('video/')) return { ok: false, error: 'mimeType must be a video type' };
  if (typeof b.title !== 'string' || !b.title.trim()) return { ok: false, error: 'title is required' };
  const upload: Record<string, unknown> = {};
  for (const key of UPLOAD_FIELDS) if (b[key] !== undefined) upload[key] = b[key];
  return { ok: true, value: { sha256, fileName, fileSize: b.fileSize, upload } };
}

const now = () => new Date().toISOString();
const readBatch = (c: C, id: string) => c.env.REPORTS_DB.prepare('SELECT * FROM import_batches WHERE id = ?').bind(id).first<ImportBatchRow>();
const readItem = (c: C, id: string) => c.env.REPORTS_DB.prepare('SELECT * FROM import_items WHERE id = ?').bind(id).first<ImportItemRow>();

app.post('/batches', async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (typeof b.channelId !== 'string' || !CHANNEL_ID.test(b.channelId)) return fail(c, 400, 'invalid_request', 'channelId is required');
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 200) : null;
  // The channel must exist (and api-videos answers 404 otherwise)
  await videos(c, `/channels/${encodeURIComponent(b.channelId)}`);
  const row: ImportBatchRow = { id: crypto.randomUUID(), channel_id: b.channelId, name, created_by: actorOf(c), created_at: now(), updated_at: now() };
  await c.env.REPORTS_DB.prepare('INSERT INTO import_batches (id, channel_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.channel_id, row.name, row.created_by, row.created_at, row.updated_at)
    .run();
  await writeAudit(c.env.REPORTS_DB, { kind: 'import', id: `batch:${row.id}`, action: 'batch:create', actorId: actorOf(c), details: { channelId: row.channel_id, ...(name ? { name } : {}) } });
  return c.json({ success: true, result: { batch: batchView(row) } }, 201);
});

app.get('/batches', async (c) => {
  const channelId = c.req.query('channelId');
  const rows = (
    channelId
      ? await c.env.REPORTS_DB.prepare('SELECT * FROM import_batches WHERE channel_id = ? ORDER BY created_at DESC LIMIT 50').bind(channelId).all<ImportBatchRow>()
      : await c.env.REPORTS_DB.prepare('SELECT * FROM import_batches ORDER BY created_at DESC LIMIT 50').all<ImportBatchRow>()
  ).results ?? [];
  const counts = new Map<string, Record<string, number>>();
  if (rows.length) {
    const marks = rows.map(() => '?').join(',');
    const tallies = (
      await c.env.REPORTS_DB.prepare(`SELECT batch_id, state, COUNT(*) AS n FROM import_items WHERE batch_id IN (${marks}) GROUP BY batch_id, state`)
        .bind(...rows.map((r) => r.id))
        .all<{ batch_id: string; state: string; n: number }>()
    ).results ?? [];
    for (const t of tallies) counts.set(t.batch_id, { ...(counts.get(t.batch_id) ?? {}), [t.state]: Number(t.n) });
  }
  return c.json({ success: true, result: { batches: rows.map((r) => batchView(r, counts.get(r.id) ?? {})) } });
});

app.get('/batches/:id', async (c) => {
  const batch = await readBatch(c, c.req.param('id'));
  if (!batch) return fail(c, 404, 'batch_not_found', 'No such import batch');
  const items = (await c.env.REPORTS_DB.prepare('SELECT * FROM import_items WHERE batch_id = ? ORDER BY created_at').bind(batch.id).all<ImportItemRow>()).results ?? [];
  return c.json({ success: true, result: { batch: batchView(batch), items: items.map(itemView) } });
});

type Initiated = { videoId: string; tusSessionId: string; tusUploadId?: string; chunkSize: number; resumable: boolean; expiresAt?: string; reused?: boolean };

app.post('/batches/:id/items', async (c) => {
  const batch = await readBatch(c, c.req.param('id'));
  if (!batch) return fail(c, 404, 'batch_not_found', 'No such import batch');
  const parsed = parseNewItem(await c.req.json().catch(() => null));
  if (parsed.ok === false) return fail(c, 400, 'invalid_request', parsed.error);
  const { sha256, fileName, fileSize, upload } = parsed.value;
  const db = c.env.REPORTS_DB;
  const existing = await db.prepare('SELECT * FROM import_items WHERE channel_id = ? AND sha256 = ?').bind(batch.channel_id, sha256).first<ImportItemRow>();
  if (existing?.state === 'uploaded') {
    return c.json({ success: false, code: 'already_imported', error: 'This file is already in this channel', item: itemView(existing) }, 409);
  }
  const t = now();
  const item: ImportItemRow = existing
    ? { ...existing, state: 'initiated', error: null, updated_at: t }
    : { id: crypto.randomUUID(), batch_id: batch.id, channel_id: batch.channel_id, sha256, file_name: fileName, file_size: fileSize, video_id: null, state: 'initiated', error: null, created_by: actorOf(c), created_at: t, updated_at: t };
  if (!existing) {
    // The unique (channel_id, sha256) index: a parallel request for the same file loses here
    const inserted = await db
      .prepare('INSERT OR IGNORE INTO import_items (id, batch_id, channel_id, sha256, file_name, file_size, state, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(item.id, item.batch_id, item.channel_id, sha256, fileName, fileSize, 'initiated', item.created_by, t, t)
      .run();
    if (!(inserted as { meta?: { changes?: number } }).meta?.changes) {
      c.header('Retry-After', '3');
      return c.json({ success: false, code: 'busy', error: 'This file is being started by another request; retry' }, 503);
    }
  }
  // Audited before api-videos makes anything: the row names the item, then the video once it exists,
  // and is dropped if api-videos refuses (the item then says why)
  const auditId = await writeAudit(db, {
    kind: 'import',
    id: `item:${item.id}`,
    action: existing ? 'upload:resume' : 'upload:initiate',
    actorId: actorOf(c),
    details: { channelId: batch.channel_id, batchId: batch.id, itemId: item.id, fileName, fileSize, sha256 },
  });
  let initiated: Initiated;
  try {
    // The same file again resumes its video (api-videos' file claim on the fingerprint)
    initiated = await videos<Initiated>(c, '/import/initiate', { method: 'POST', json: { ...upload, channelId: batch.channel_id } });
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[AdminImport] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    const reason = error instanceof Error ? error.message.slice(0, 1000) : 'The upload could not be started';
    await db.prepare("UPDATE import_items SET state = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(reason, now(), item.id).run();
    throw error;
  }
  await setAuditSubject(db, auditId, 'import', initiated.videoId).catch((e) => logger.warn('[AdminImport] Could not point the audit row at the video', { auditId, error: String(e) }));
  await db.prepare("UPDATE import_items SET video_id = ?, state = 'initiated', error = NULL, updated_at = ? WHERE id = ?").bind(initiated.videoId, now(), item.id).run();
  logger.info('[AdminImport] Upload opened', { itemId: item.id, videoId: initiated.videoId, reused: !!initiated.reused, actorId: actorOf(c) });
  return c.json({ success: true, result: { item: itemView({ ...item, video_id: initiated.videoId }), upload: initiated } }, existing ? 200 : 201);
});

async function setItemState(c: C, state: 'uploaded' | 'failed', error: string | null) {
  const item = await readItem(c, c.req.param('id') as string);
  if (!item) return fail(c, 404, 'item_not_found', 'No such import item');
  if (state === 'failed' && item.state === 'uploaded') return c.json({ success: false, code: 'already_uploaded', error: 'This file was already uploaded' }, 409);
  await c.env.REPORTS_DB.prepare('UPDATE import_items SET state = ?, error = ?, updated_at = ? WHERE id = ?').bind(state, error, now(), item.id).run();
  return c.json({ success: true, result: { item: itemView({ ...item, state, error }) } });
}

app.post('/items/:id/uploaded', (c) => setItemState(c, 'uploaded', null));
app.post('/items/:id/failed', async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const error = typeof b.error === 'string' && b.error.trim() ? b.error.trim().slice(0, 1000) : 'The app could not upload this file';
  return setItemState(c, 'failed', error);
});

export default app;
