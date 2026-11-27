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
 *                    upload, so the app encodes exactly what the server checks; with `?channelId=`
 *                    also `takesRenditions`: whether R2 transcodes that channel's uploads (renditions
 *                    are used only then)
 *   GET  /quran-index the Quran matcher's index of the fresh Content Sync copy → { index: { v, version,
 *                    syncedAt, words, locs }, expiresAt } (TA-13): the app turns Quran spans of a local
 *                    transcript into verse keys with it before saving or uploading anything, and drops it
 *                    at `expiresAt`; 503 quran_index_unavailable while there is no fresh copy
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
 *   GET  /batches?channelId=      the latest 50 batches (of a channel), with item counts per state and the
 *                                 channel's name (videos admin Imports view, TA-8)
 *   GET  /batches/:id             { batch, items } (every item; what the app reads)
 *   GET  /batches/:id?page=N[&state=]  the videos admin's batch page (TA-8): { batch (with channelName), items
 *                                 (ADMIN_IMPORT_PAGE_SIZE per page, oldest first), total, page, pageSize, counts,
 *                                 statuses } — statuses: per item with a video, what api-videos says became of
 *                                 it (POST /internal/admin/import/status: the video, the attach job with attempts
 *                                 n/max and next retry, each caption language); null when api-videos could not
 *                                 be read (logged; the page says so)
 *   POST /batches/:id/items       { sha256, fileName, fileSize, mimeType, fingerprint, title, … the
 *                                 initiate's metadata } → 201 { item, upload } — the normal upload
 *                                 (api-videos /internal/admin/import/initiate: owned by the channel's
 *                                 owner, uploaded by the admin, no tier quotas or limits); the TUS
 *                                 session is the admin's, used with their Admin Tools token. The same
 *                                 file again resumes its unfinished video; a file already uploaded
 *                                 answers 409 already_imported with its item. Audited per video.
 *   GET  /items/by-video/:videoId the file a video was imported from, and where it is in its batch's pages:
 *                                 { item, page } (the Errors page links here through the Imports view)
 *   POST /items/:id/uploaded      the app sent the whole file → { item }
 *   POST /items/:id/sidecars      { captions?, chapters?, thumbnail?, playlistId?, publishAt? } (TA-6) → 202
 *                                 { item, jobId } — attached by api-videos' queued job 'import.attach'
 *                                 (retried, on the Jobs page; a failure goes to the Errors page with Retry).
 *                                 Audited per video.
 *   POST /items/:id/transcript    { language, segments, engine, replace? } (TA-7) → 202 { status, segments }:
 *                                 a transcript made on the admin's computer, Quran spans as references only
 *                                 ({ startMs, endMs, quran: { range, status?, alternatives? } }, no words:
 *                                 QF terms 2026-11-21). The on-device claim job drafts it. Audited per video.
 *   POST /items/:id/translations  { sourceLanguage, languages[], replace? } (TA-7) → { results[] }: a caption
 *                                 job per language from the source draft, no caption minutes. Audited per video.
 *                                 With no draft in sourceLanguage the source is its published track (the
 *                                 sidecar captions, TA-20); each result says `source: 'draft' | 'published'`.
 *   POST /items/:id/failed        { error } the app gave up on the file → { item }
 *
 * Renditions encoded on the admin's computer (TA-12), the D11 contract of desktop Studio for a video the
 * admin does not own. Staged before the file's upload completes; the first transcode verifies them and
 * encodes itself when they do not match (api-videos lib/media/prebuilt.ts):
 *
 *   POST   /items/:id/renditions                                { rungs, files: [{ path, bytes }], encoder? } → 201
 *                                                               { stagingId, status, …, maxFileBytes }. Audited per video.
 *   PUT    /items/:id/renditions/:stagingId/files/:rung/:file   raw body, exactly the declared size (≤ 32 MiB) → 204
 *   POST   /items/:id/renditions/:stagingId/complete            → { status: 'ready' } or 409 files_missing { missing[] }
 *   DELETE /items/:id/renditions/:stagingId                     drop them; the server encodes. Audited per video.
 *   GET    /items/:id/delivery                                  { takesRenditions, staging, r2: { status, progress?,
 *                                                               error?, prebuilt?: { used, reason?, rung? } } }
 *
 * Error reports (TA-11). The app has no browser proxy holding the internal key, so it reports here with
 * its own token; the events land on the Errors page under the app `tools`:
 *
 *   POST /errors                  { events: [{ kind, ref?, message, name?, stack?, route?, method?, status?,
 *                                 release?, locale?, occurredAt?, count?, extra? }] } (at most 20, 64 KB) →
 *                                 202 { accepted, rateLimited }. The account is the token's, never the body's;
 *                                 no Retry actions, no "test" in production; the same per-client minute limit as
 *                                 browser reports. Queued like every report (ERRORS_QUEUE, retried, then its DLQ).
 */
import { Hono, type Context } from 'hono';
import {
  ADMIN_IMPORT_PAGE_SIZE,
  ENCODE_LADDER,
  IMPORT_ITEM_STATES,
  ERROR_LIMITS,
  ERROR_REF_PATTERN,
  PREBUILT_LIMITS,
  type AdminImportItemStatus,
  USER_ID as ERROR_USER_ID,
  contentPermissionsFor,
  hasContentPermission,
  newErrorRef,
  parseErrorRef,
  scrubEvent,
  type ErrorEventInput,
  baseName,
} from '@al-ummah/shared-types';
import { enqueueIngest } from '../endpoints/errors/ErrorsIngest';
import { allowClientEvents } from '../lib/errors-store';
import { apiError } from '../lib/api-error';
import { DIAGNOSTIC_MAX_BYTES, DiagnosticRefConflictError, readBoundedText, storeErrorDiagnostic } from '../lib/error-diagnostics';
import { hashIp } from '../lib/contact';
import { hasPermission, normalizeRoles, permissionsFor } from '../lib/roles';
import { callVideos, fetchVideosRaw, VideosError, type VideosCall, type VideosClientEnv } from '../lib/content/videosClient';
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
  // Details stay next to the code (files_missing lists the files the app still has to send)
  if (error instanceof VideosError) return c.json({ success: false, code: error.code, error: error.message, ...(error.details ?? {}) }, error.status as 400);
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

app.get('/encoding', async (c) => {
  const channelId = c.req.query('channelId');
  // With a channel: whether the server transcodes its uploads to R2, the only time renditions are used
  const channel = channelId
    ? await videos<{ takesRenditions: boolean }>(c, `/import/channels/${encodeURIComponent(channelId.slice(0, 200))}/delivery`)
    : undefined;
  return c.json({ success: true, result: { ladder: ENCODE_LADDER, prebuiltLimits: PREBUILT_LIMITS, ...(channel ? { takesRenditions: channel.takesRenditions } : {}) } });
});

// The Quran matcher's index (TA-13), passed through as api-videos sends it (about a megabyte: not parsed here).
// The app keeps it in memory until `expiresAt` (the copy's 7 days, QF terms) and holds no QF credentials.
app.get('/quran-index', async (c) => {
  const res = await fetchVideosRaw(c.env, '/import/quran-index', { actorId: actorOf(c) });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
});

const USER_ID = /^usr_[0-9a-f]{32}$/;
const text = (v: unknown, max: number): string | null | undefined =>
  v === undefined || v === null ? undefined : typeof v === 'string' ? v.trim().slice(0, max) || undefined : null;

function parseLocalizedPair(
  raw: unknown,
  field: string,
  max: number,
  required: boolean,
): { ok: true; value?: { en: string; ar: string } } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: `${field} must be an object with en and ar` };
  const obj = raw as Record<string, unknown>;
  const enRaw = obj.en;
  const arRaw = obj.ar;
  if (enRaw !== undefined && enRaw !== null && typeof enRaw !== 'string') return { ok: false, error: `${field}.en must be text` };
  if (arRaw !== undefined && arRaw !== null && typeof arRaw !== 'string') return { ok: false, error: `${field}.ar must be text` };
  const en = typeof enRaw === 'string' ? enRaw.trim() : '';
  const ar = typeof arRaw === 'string' ? arRaw.trim() : '';
  if (!en && !ar) return required ? { ok: false, error: `${field} requires both en and ar` } : { ok: true };
  if (!en || !ar) return { ok: false, error: `${field} requires both en and ar` };
  if (en.length > max || ar.length > max) return { ok: false, error: `${field} values must be at most ${max} characters` };
  return { ok: true, value: { en, ar } };
}

/**
 * Validates a new channel: a name of 1–100 characters (and when localized, both
 * en and ar); handle, description and ownerId optional.
 * Channels are creator/user content (wiki guides/localized-fields.md), so legacy
 * callers omitting `nameLocalized` remain accepted, while any localized map must
 * provide both `en` and `ar` and agree with `name`/`description`.
 */
export function parseNewChannel(body: unknown):
  | {
      ok: true;
      value: {
        name: string;
        nameLocalized?: { en: string; ar: string };
        handle?: string;
        description?: string;
        descriptionLocalized?: { en: string; ar: string };
        ownerId?: string;
      };
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A JSON object is required' };
  const b = body as Record<string, unknown>;
  const nameLoc = parseLocalizedPair(b.nameLocalized, 'nameLocalized', 100, true);
  if (nameLoc.ok === false) return nameLoc;
  if (b.name !== undefined && b.name !== null && typeof b.name !== 'string') return { ok: false, error: 'name must be text' };
  const rawName = typeof b.name === 'string' ? b.name.trim() : '';
  if (rawName && nameLoc.value && rawName !== nameLoc.value.en) {
    return { ok: false, error: 'name must match nameLocalized.en' };
  }
  const name = nameLoc.value?.en ?? rawName;
  if (!name || name.length > 100) return { ok: false, error: 'name is required (at most 100 characters)' };
  const handle = text(b.handle, 1000);
  const descLoc = parseLocalizedPair(b.descriptionLocalized, 'descriptionLocalized', 5000, false);
  if (descLoc.ok === false) return descLoc;
  if (b.description !== undefined && b.description !== null && typeof b.description !== 'string') return { ok: false, error: 'description must be text' };
  const rawDescription = typeof b.description === 'string' && b.description.trim() ? b.description.trim() : undefined;
  if (rawDescription && rawDescription.length > 5000) return { ok: false, error: 'description must be at most 5000 characters' };
  if (rawDescription && descLoc.value && rawDescription !== descLoc.value.en) {
    return { ok: false, error: 'description must match descriptionLocalized.en' };
  }
  if (handle === null) return { ok: false, error: 'handle must be text' };
  if (handle && handle.length > 60) return { ok: false, error: 'handle must be at most 60 characters' };
  const description = descLoc.value?.en ?? rawDescription;
  if (b.ownerId !== undefined && b.ownerId !== null && (typeof b.ownerId !== 'string' || !USER_ID.test(b.ownerId))) {
    return { ok: false, error: 'ownerId must be a videos user id (usr_ followed by 32 hex digits)' };
  }
  return {
    ok: true,
    value: {
      name,
      ...(nameLoc.value ? { nameLocalized: nameLoc.value } : {}),
      ...(handle ? { handle } : {}),
      ...(description ? { description } : {}),
      ...(descLoc.value ? { descriptionLocalized: descLoc.value } : {}),
      ...(b.ownerId ? { ownerId: b.ownerId as string } : {}),
    },
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
  attach_job_id?: string | null;
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
  fileName: baseName(r.file_name),
  fileSize: r.file_size,
  videoId: r.video_id,
  state: r.state,
  error: r.error,
  attachJobId: r.attach_job_id ?? null,
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
  const fileName = typeof b.fileName === 'string' ? baseName(b.fileName.trim()).slice(0, 500) : '';
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

/** Channel names for the Imports view; a channel that cannot be read (deleted, api-videos down) has none. */
async function channelNames(c: C, ids: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids)];
  const read = await Promise.allSettled(unique.map((id) => videos<{ name?: string }>(c, `/channels/${encodeURIComponent(id)}`)));
  return new Map(unique.map((id, i) => {
    const r = read[i];
    return [id, r.status === 'fulfilled' && typeof r.value?.name === 'string' ? r.value.name : null];
  }));
}

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
  const names = await channelNames(c, rows.map((r) => r.channel_id));
  return c.json({ success: true, result: { batches: rows.map((r) => ({ ...batchView(r, counts.get(r.id) ?? {}), channelName: names.get(r.channel_id) ?? null })) } });
});

app.get('/batches/:id', async (c) => {
  const batch = await readBatch(c, c.req.param('id'));
  if (!batch) return fail(c, 404, 'batch_not_found', 'No such import batch');
  if (c.req.query('page') !== undefined) return batchPage(c, batch);
  const items = (await c.env.REPORTS_DB.prepare('SELECT * FROM import_items WHERE batch_id = ? ORDER BY created_at').bind(batch.id).all<ImportItemRow>()).results ?? [];
  return c.json({ success: true, result: { batch: batchView(batch), items: items.map(itemView) } });
});

/** The videos admin's batch page (TA-8): one page of files and what became of each on the server. */
async function batchPage(c: C, batch: ImportBatchRow) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(c.req.query('page') ?? '1', 10) || 1));
  const stateParam = c.req.query('state');
  const state = (IMPORT_ITEM_STATES as readonly string[]).includes(stateParam ?? '') ? stateParam : undefined;
  const db = c.env.REPORTS_DB;
  const [tallies, rows, names] = await Promise.all([
    db.prepare('SELECT state, COUNT(*) AS n FROM import_items WHERE batch_id = ? GROUP BY state').bind(batch.id).all<{ state: string; n: number }>(),
    (state
      ? db.prepare('SELECT * FROM import_items WHERE batch_id = ? AND state = ? ORDER BY created_at, rowid LIMIT ? OFFSET ?').bind(batch.id, state, ADMIN_IMPORT_PAGE_SIZE, (page - 1) * ADMIN_IMPORT_PAGE_SIZE)
      : db.prepare('SELECT * FROM import_items WHERE batch_id = ? ORDER BY created_at, rowid LIMIT ? OFFSET ?').bind(batch.id, ADMIN_IMPORT_PAGE_SIZE, (page - 1) * ADMIN_IMPORT_PAGE_SIZE)
    ).all<ImportItemRow>(),
    channelNames(c, [batch.channel_id]),
  ]);
  const counts: Record<string, number> = {};
  for (const t of tallies.results ?? []) counts[t.state] = Number(t.n);
  const total = state ? (counts[state] ?? 0) : Object.values(counts).reduce((a, b) => a + b, 0);
  const items = rows.results ?? [];
  const withVideo = items.filter((i) => i.video_id);
  let statuses: Record<string, AdminImportItemStatus> | null = {};
  if (withVideo.length) {
    try {
      const out = await videos<{ items: AdminImportItemStatus[] }>(c, '/import/status', {
        method: 'POST',
        json: { items: withVideo.map((i) => ({ videoId: i.video_id, attachJobId: i.attach_job_id ?? null })) },
      });
      statuses = Object.fromEntries(withVideo.map((i, n) => [i.id, out.items[n]]).filter(([, s]) => !!s));
    } catch (error) {
      logger.warn('[AdminImport] Could not read the batch page statuses', { batchId: batch.id, page, error: error instanceof Error ? error.message : String(error) });
      statuses = null;
    }
  }
  return c.json({
    success: true,
    result: {
      batch: { ...batchView(batch), channelName: names.get(batch.channel_id) ?? null },
      items: items.map(itemView),
      total,
      page,
      pageSize: ADMIN_IMPORT_PAGE_SIZE,
      counts,
      ...(state ? { state } : {}),
      statuses,
    },
  });
}

/** The file's video asked to be uploaded again (its bytes did not arrive as sent): the same file may come again. */
async function needsReupload(c: C, videoId: string | null): Promise<boolean> {
  if (!videoId) return false;
  const { items } = await videos<{ items: AdminImportItemStatus[] }>(c, '/import/status', { method: 'POST', json: { items: [{ videoId, attachJobId: null }] } });
  return items[0]?.video?.needsReupload === true;
}

type Initiated = { videoId: string; tusSessionId: string; tusUploadId?: string; chunkSize: number; resumable: boolean; expiresAt?: string; reused?: boolean };

app.post('/batches/:id/items', async (c) => {
  const batch = await readBatch(c, c.req.param('id'));
  if (!batch) return fail(c, 404, 'batch_not_found', 'No such import batch');
  const parsed = parseNewItem(await c.req.json().catch(() => null));
  if (parsed.ok === false) return fail(c, 400, 'invalid_request', parsed.error);
  const { sha256, fileName, fileSize, upload } = parsed.value;
  const db = c.env.REPORTS_DB;
  const existing = await db.prepare('SELECT * FROM import_items WHERE channel_id = ? AND sha256 = ?').bind(batch.channel_id, sha256).first<ImportItemRow>();
  if (existing?.state === 'uploaded' && !(await needsReupload(c, existing.video_id))) {
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
    initiated = await videos<Initiated>(c, '/import/initiate', { method: 'POST', json: { ...upload, channelId: batch.channel_id, sha256, ...(item.video_id ? { videoId: item.video_id } : {}) } });
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[AdminImport] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    const reason = error instanceof Error ? error.message.slice(0, 1000) : 'The upload could not be started';
    await db.prepare("UPDATE import_items SET state = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(reason, now(), item.id).run();
    throw error;
  }
  await setAuditSubject(db, auditId, 'import', initiated.videoId).catch((e) => logger.warn('[AdminImport] Could not point the audit row at the video', { auditId, error: String(e) }));
  // Another video than before: the attach job was the earlier one's
  const attachJobId = initiated.videoId === item.video_id ? item.attach_job_id ?? null : null;
  await db.prepare("UPDATE import_items SET video_id = ?, attach_job_id = ?, state = 'initiated', error = NULL, updated_at = ? WHERE id = ?").bind(initiated.videoId, attachJobId, now(), item.id).run();
  logger.info('[AdminImport] Upload opened', { itemId: item.id, videoId: initiated.videoId, reused: !!initiated.reused, actorId: actorOf(c) });
  return c.json({ success: true, result: { item: itemView({ ...item, video_id: initiated.videoId, attach_job_id: attachJobId }), upload: initiated } }, existing ? 200 : 201);
});

async function setItemState(c: C, state: 'uploaded' | 'failed', error: string | null) {
  const item = await readItem(c, c.req.param('id') as string);
  if (!item) return fail(c, 404, 'item_not_found', 'No such import item');
  if (state === 'failed' && item.state === 'uploaded') return c.json({ success: false, code: 'already_uploaded', error: 'This file was already uploaded' }, 409);
  await c.env.REPORTS_DB.prepare('UPDATE import_items SET state = ?, error = ?, updated_at = ? WHERE id = ?').bind(state, error, now(), item.id).run();
  return c.json({ success: true, result: { item: itemView({ ...item, state, error }) } });
}

app.get('/items/by-video/:videoId', async (c) => {
  const videoId = c.req.param('videoId');
  if (!CHANNEL_ID.test(videoId)) return fail(c, 400, 'invalid_request', 'videoId is not valid');
  const item = await c.env.REPORTS_DB.prepare('SELECT *, rowid AS _row FROM import_items WHERE video_id = ? ORDER BY created_at DESC LIMIT 1').bind(videoId).first<ImportItemRow & { _row: number }>();
  if (!item) return fail(c, 404, 'item_not_found', 'No imported file has this video');
  // Its place among the batch's files, oldest first (the batch page's order)
  const before = await c.env.REPORTS_DB.prepare('SELECT COUNT(*) AS n FROM import_items WHERE batch_id = ? AND (created_at < ? OR (created_at = ? AND rowid < ?))')
    .bind(item.batch_id, item.created_at, item.created_at, item._row)
    .first<{ n: number }>();
  const { _row: _ignored, ...row } = item;
  return c.json({ success: true, result: { item: itemView(row), page: Math.floor(Number(before?.n ?? 0) / ADMIN_IMPORT_PAGE_SIZE) + 1 } });
});

app.post('/items/:id/uploaded', (c) => setItemState(c, 'uploaded', null));

app.post('/items/:id/sidecars', async (c) => {
  const item = await readItem(c, c.req.param('id'));
  if (!item) return fail(c, 404, 'item_not_found', 'No such import item');
  if (!item.video_id) return c.json({ success: false, code: 'no_video', error: 'This file has no video yet: open its upload first' }, 409);
  const sidecars = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!sidecars || typeof sidecars !== 'object' || Array.isArray(sidecars)) return fail(c, 400, 'invalid_request', 'A JSON object is required');
  const db = c.env.REPORTS_DB;
  // What arrived, never the file contents (captions and images stay out of the audit log)
  const summary = {
    itemId: item.id,
    captions: Array.isArray(sidecars.captions) ? (sidecars.captions as Array<{ language?: unknown }>).map((t) => String(t?.language ?? '')) : [],
    chapters: typeof sidecars.chapters === 'string',
    thumbnail: !!sidecars.thumbnail,
    ...(typeof sidecars.playlistId === 'string' ? { playlistId: sidecars.playlistId } : {}),
    ...(typeof sidecars.publishAt === 'string' ? { publishAt: sidecars.publishAt } : {}),
  };
  const auditId = await writeAudit(db, { kind: 'import', id: item.video_id, action: 'sidecars:attach', actorId: actorOf(c), details: summary });
  let queued: { jobId: string; status: string };
  try {
    queued = await videos<{ jobId: string; status: string }>(c, `/import/videos/${encodeURIComponent(item.video_id)}/sidecars`, { method: 'POST', json: sidecars });
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[AdminImport] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
  await db.prepare('UPDATE import_items SET attach_job_id = ?, updated_at = ? WHERE id = ?').bind(queued.jobId, now(), item.id).run();
  return c.json({ success: true, result: { item: itemView({ ...item, attach_job_id: queued.jobId }), jobId: queued.jobId } }, 202);
});
/** An audited call to api-videos for an item's video; the audit row goes again if the call fails. */
async function forItemVideo<T>(c: C, action: string, call: (videoId: string, body: Record<string, unknown>) => Promise<T>) {
  const item = await readItem(c, c.req.param('id') ?? '');
  if (!item) return { response: fail(c, 404, 'item_not_found', 'No such import item') };
  if (!item.video_id) return { response: c.json({ success: false, code: 'no_video', error: 'This file has no video yet: open its upload first' }, 409) };
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { response: fail(c, 400, 'invalid_request', 'A JSON object is required') };
  const db = c.env.REPORTS_DB;
  const auditId = await writeAudit(db, { kind: 'import', id: item.video_id, action, actorId: actorOf(c), details: { itemId: item.id, ...summarise(body) } });
  try {
    return { result: await call(item.video_id, body) };
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[AdminImport] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
}
// What a caption request asked for, never the transcript itself
const summarise = (b: Record<string, unknown>) => ({
  ...(typeof b.language === 'string' ? { language: b.language } : {}),
  ...(Array.isArray(b.segments) ? { segments: b.segments.length } : {}),
  ...(typeof b.sourceLanguage === 'string' ? { sourceLanguage: b.sourceLanguage } : {}),
  ...(Array.isArray(b.languages) ? { languages: b.languages.filter((l) => typeof l === 'string').slice(0, 10) } : {}),
  ...(b.replace === true ? { replace: true } : {}),
  ...(Array.isArray(b.rungs) ? { rungs: b.rungs.filter((r) => typeof r === 'string').slice(0, 8) } : {}),
  ...(Array.isArray(b.files) ? { files: b.files.length } : {}),
  ...(typeof b.encoder === 'string' ? { encoder: b.encoder.slice(0, 120) } : {}),
});

app.post('/items/:id/transcript', async (c) => {
  const out = await forItemVideo(c, 'captions:transcript', (videoId, body) => {
    const language = typeof body.language === 'string' ? body.language : '';
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) throw new VideosError(400, 'unsupported_language', 'language is required');
    const { language: _language, ...rest } = body;
    return videos<{ status: string; segments: number }>(c, `/import/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(language)}/transcript`, { method: 'POST', json: rest });
  });
  if ('response' in out) return out.response;
  return c.json({ success: true, result: out.result }, 202);
});
app.post('/items/:id/translations', async (c) => {
  const out = await forItemVideo(c, 'captions:translate', (videoId, body) =>
    videos<{ results: unknown[] }>(c, `/import/videos/${encodeURIComponent(videoId)}/translations`, { method: 'POST', json: body }),
  );
  if ('response' in out) return out.response;
  return c.json({ success: true, result: out.result });
});
// Renditions encoded on the admin's computer (TA-12): staged before the file's upload completes, then
// verified by the first transcode, which encodes itself when they do not match (api-videos prebuilt.ts)
const STAGING_ID = /^[a-f0-9]{16}$/;
const RUNG = /^\d{3,4}p$/;
const FILE = /^[A-Za-z0-9_.-]{1,64}$/;
/** The item's video for a renditions call, or the answer when there is none. */
async function renditionsVideo(c: C) {
  const item = await readItem(c, c.req.param('id') ?? '');
  if (!item) return { response: fail(c, 404, 'item_not_found', 'No such import item') };
  if (!item.video_id) return { response: c.json({ success: false, code: 'no_video', error: 'This file has no video yet: open its upload first' }, 409) };
  const stagingId = c.req.param('stagingId');
  if (stagingId !== undefined && !STAGING_ID.test(stagingId)) return { response: fail(c, 404, 'staging_not_found', 'No such staged upload') };
  return { item, path: `/import/videos/${encodeURIComponent(item.video_id)}${stagingId ? `/renditions/${stagingId}` : ''}` };
}
app.post('/items/:id/renditions', async (c) => {
  const out = await forItemVideo(c, 'renditions:stage', (videoId, body) => videos<Record<string, unknown>>(c, `/import/videos/${encodeURIComponent(videoId)}/renditions`, { method: 'POST', json: body }));
  if ('response' in out) return out.response;
  return c.json({ success: true, result: out.result }, 201);
});
app.put('/items/:id/renditions/:stagingId/files/:rung/:file', async (c) => {
  const found = await renditionsVideo(c);
  if ('response' in found) return found.response;
  const rung = c.req.param('rung');
  const file = c.req.param('file');
  if (!RUNG.test(rung) || !FILE.test(file) || file.startsWith('.')) return fail(c, 400, 'file_not_declared', 'Not a rendition file');
  // The declared length is required: api-videos reads no more than the file's declared size either way
  const length = c.req.header('content-length') ?? '';
  if (!/^\d{1,10}$/.test(length)) return c.json({ success: false, code: 'length_required', error: 'Content-Length is required' }, 411);
  if (Number(length) > PREBUILT_LIMITS.maxFileBytes) return c.json({ success: false, code: 'file_too_large', error: `At most ${PREBUILT_LIMITS.maxFileBytes} bytes per file` }, 413);
  // Streamed through: a segment is up to 32 MiB and the app sends several at once
  await videos<undefined>(c, `${found.path}/files/${rung}/${file}`, { method: 'PUT', raw: { body: c.req.raw.body, contentType: c.req.header('content-type'), contentLength: length } });
  return c.body(null, 204);
});
app.post('/items/:id/renditions/:stagingId/complete', async (c) => {
  const found = await renditionsVideo(c);
  if ('response' in found) return found.response;
  return c.json({ success: true, result: await videos<Record<string, unknown>>(c, `${found.path}/complete`, { method: 'POST' }) });
});
app.delete('/items/:id/renditions/:stagingId', async (c) => {
  const found = await renditionsVideo(c);
  if ('response' in found) return found.response;
  const db = c.env.REPORTS_DB;
  const auditId = await writeAudit(db, { kind: 'import', id: found.item.video_id!, action: 'renditions:cancel', actorId: actorOf(c), details: { itemId: found.item.id, stagingId: c.req.param('stagingId') } });
  try {
    await videos(c, found.path, { method: 'DELETE' });
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[AdminImport] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
  return c.json({ success: true, result: {} });
});
// Whether the server takes renditions for this file's video, and what its transcode did with them
app.get('/items/:id/delivery', async (c) => {
  const found = await renditionsVideo(c);
  if ('response' in found) return found.response;
  return c.json({ success: true, result: await videos<Record<string, unknown>>(c, `${found.path}/delivery`) });
});
app.post('/items/:id/failed', async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const error = typeof b.error === 'string' && b.error.trim() ? b.error.trim().slice(0, 1000) : 'The app could not upload this file';
  return setItemState(c, 'failed', error);
});

// ---------------------------------------------------------------------------
// Error reports from the app (TA-11)
// ---------------------------------------------------------------------------

/** What the app may report: its own failures, never a Worker's kinds or a needs-action item. */
export const TOOLS_ERROR_KINDS = ['unhandled', 'rejection', 'fetch', 'upload', 'caught'] as const;
/** An app event may fold at most this many repeats into one report (as browser reports, ErrorsIngest.ts) */
const TOOLS_MAX_COUNT = 50;

/**
 * The app's events as the Errors page stores them: app `tools`, the signed-in account from the token,
 * a reference when the app sent none, no needs-action item, at most 50 repeats, no origin or "shown" claim,
 * and "test" only outside production.
 */
export function toolsErrorEvents(raw: unknown[], vouched: { userId: string; environment: string }): ErrorEventInput[] {
  const out: ErrorEventInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const given = r as Record<string, unknown>;
    if (!(TOOLS_ERROR_KINDS as readonly unknown[]).includes(given.kind)) continue;
    const ref = typeof given.ref === 'string' && ERROR_REF_PATTERN.test(given.ref) ? given.ref : newErrorRef();
    const { action: _action, userId: _userId, environment: _environment, workerVersion: _worker, ...rest } = given;
    const event = scrubEvent({ ...rest, app: 'tools', ref });
    if (!event) continue;
    // Like a browser report: the repeat count is capped, and where it came from is never the app's claim
    const { test, shown: _shown, count, context, ...kept } = event;
    const { origin: _origin, ...ownContext } = context ?? {};
    out.push({
      ...kept,
      count: Math.max(1, Math.min(TOOLS_MAX_COUNT, Math.floor(count ?? 1))),
      ...(Object.keys(ownContext).length ? { context: ownContext } : {}),
      ...(ERROR_USER_ID.test(vouched.userId) ? { userId: vouched.userId } : {}),
      ...(test && vouched.environment !== 'production' ? { test: true } : {}),
    });
  }
  return out;
}

app.post('/errors', async (c) => {
  const text = await c.req.text();
  if (text.length > ERROR_LIMITS.maxBodyBytes) return c.json({ success: false, code: 'too_large', error: 'At most 64 KB of reports at once' }, 413);
  let body: { events?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return fail(c, 400, 'invalid_request', 'A JSON object is required');
  }
  const raw = Array.isArray(body?.events) ? body.events : [];
  if (raw.length > ERROR_LIMITS.maxEventsPerBatch) return c.json({ success: false, code: 'too_many_events', error: `At most ${ERROR_LIMITS.maxEventsPerBatch} reports at once` }, 413);
  let events = toolsErrorEvents(raw, { userId: actorOf(c), environment: c.env.ENVIRONMENT || 'development' });
  if (!events.length) return fail(c, 400, 'invalid_request', 'No valid reports');
  const key = typeof c.env.INTERNAL_API_KEY === 'string' ? c.env.INTERNAL_API_KEY : ((await c.env.INTERNAL_API_KEY?.get().catch(() => '')) ?? '');
  // The browser reports' per-client minute limit, counted per account (a keyed hash: no id in the rate table)
  const rateKey = (await hashIp(`tools:${actorOf(c)}`, key)).slice(0, 24);
  const allowed = await allowClientEvents(c.env.REPORTS_DB, rateKey, events.length, new Date());
  const rateLimited = events.length - allowed;
  events = events.slice(0, allowed);
  if (!events.length) return c.json({ success: false, code: 'rate_limited', error: 'Too many reports; try again in a minute' }, 429, { 'Retry-After': '60' });
  try {
    await enqueueIngest(c.env, { v: 1, events, resolved: [], trustedRetry: false, userAgent: c.req.header('User-Agent')?.slice(0, 512), receivedAt: new Date().toISOString() });
  } catch (error) {
    logger.error('[AdminImport] Could not queue the app\'s error reports', { events: events.length, error: error instanceof Error ? error.message : String(error) });
    return c.json({ success: false, code: 'ingest_failed', error: 'Reports could not be queued; try again' }, 503, { 'Retry-After': '30' });
  }
  return c.json({ success: true, result: { accepted: events.length, rateLimited } }, 202);
});

app.post('/diagnostics', async (c) => {
  if (!c.env.DIAGNOSTICS) {
    return apiError(c, 503, 'service_unavailable', { error: 'Diagnostic storage is not configured' });
  }
  const text = await readBoundedText(c.req.raw, DIAGNOSTIC_MAX_BYTES);
  if (text === null) {
    return apiError(c, 413, 'payload_too_large', { error: 'Diagnostic log exceeds the 512 KB limit' });
  }
  let body: { ref?: unknown; release?: unknown; entryCount?: unknown; content?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return apiError(c, 400, 'invalid_request', { error: 'A JSON object is required' });
  }
  if (!body || typeof body !== 'object' || typeof body.content !== 'string' || !body.content.trim()) {
    return apiError(c, 400, 'invalid_request', { error: 'Diagnostic content is required' });
  }
  if (body.ref !== undefined && body.ref !== null && (typeof body.ref !== 'string' || !parseErrorRef(body.ref))) {
    return apiError(c, 400, 'invalid_request', { error: 'Invalid error reference' });
  }
  const key = typeof c.env.INTERNAL_API_KEY === 'string' ? c.env.INTERNAL_API_KEY : ((await c.env.INTERNAL_API_KEY?.get().catch(() => '')) ?? '');
  const rateKey = (await hashIp(`tools-diag:${actorOf(c)}`, key)).slice(0, 24);
  const allowed = await allowClientEvents(c.env.REPORTS_DB, rateKey, 1, new Date());
  if (allowed < 1) return apiError(c, 429, 'rate_limited', { error: 'Too many diagnostic uploads; try again in a minute' }, { 'Retry-After': '60' });
  try {
    const stored = await storeErrorDiagnostic(c.env.REPORTS_DB, c.env.DIAGNOSTICS, {
      ref: typeof body.ref === 'string' ? body.ref : null,
      app: 'tools',
      environment: c.env.ENVIRONMENT || 'development',
      release: typeof body.release === 'string' ? body.release : null,
      userId: actorOf(c),
      entryCount: typeof body.entryCount === 'number' ? body.entryCount : undefined,
      content: body.content,
    });
    return c.json({ success: true, result: { ref: stored.ref, sizeBytes: stored.sizeBytes, storedBytes: stored.storedBytes, entryCount: stored.entryCount } }, 201);
  } catch (error) {
    if (error instanceof DiagnosticRefConflictError) {
      return apiError(c, 409, 'conflict', { error: 'That error reference already belongs to another diagnostic upload' });
    }
    logger.error('[AdminImport] Could not store diagnostic log', { error: error instanceof Error ? error.message : String(error) });
    return apiError(c, 503, 'service_unavailable', { error: 'Diagnostic log could not be stored; try again' }, { 'Retry-After': '30' });
  }
});

// ---------------------------------------------------------------------------
// Social import sources (TA-9): super admins only (import_sources:manage). api-videos keeps the
// sources and runs the sync job (/internal/admin/import/sources, lib/importSources/*); every change
// is audited here under content:import-source:<id>, the owner's recorded permission included.
// ---------------------------------------------------------------------------

const sources = new Hono<Env>();
sources.use('*', async (c, next) => {
  if (!hasPermission(normalizeRoles(auth(c)?.roles), 'import_sources:manage')) {
    logger.warn('[AdminImport] Import sources refused', { userId: actorOf(c), path: c.req.path });
    return fail(c, 403, 'forbidden', 'The import_sources:manage permission is required');
  }
  return next();
});
const SOURCE_ID = /^isrc_[0-9a-f]{32}$/;
const sourcePath = (c: C) => {
  const id = c.req.param('id') ?? '';
  return SOURCE_ID.test(id) ? `/import/sources/${id}` : null;
};
/** Writes the audit row first; drops it when api-videos refuses (nothing changed). */
async function auditedSource<T>(c: C, subject: string, action: string, details: Record<string, unknown>, call: () => Promise<T>): Promise<T> {
  const db = c.env.REPORTS_DB;
  const auditId = await writeAudit(db, { kind: 'import-source', id: subject, action, actorId: actorOf(c), details });
  try {
    return await call();
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[AdminImport] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
}

sources.get('/', async (c) => {
  const channelId = c.req.query('channelId');
  return c.json({ success: true, result: await videos(c, `/import/sources${channelId ? `?channelId=${encodeURIComponent(channelId.slice(0, 200))}` : ''}`) });
});
sources.get('/channels/:channelId/connections', async (c) =>
  c.json({ success: true, result: await videos(c, `/import/sources/channels/${encodeURIComponent(c.req.param('channelId').slice(0, 200))}/connections`) }),
);
sources.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(c, 400, 'invalid_request', 'A JSON object is required');
  const permission = body.permission as { by?: unknown; note?: unknown } | undefined;
  // The id exists once api-videos made the source: the row is written first, then pointed at it
  const db = c.env.REPORTS_DB;
  const auditId = await writeAudit(db, {
    kind: 'import-source',
    id: 'pending',
    action: 'source:create',
    actorId: actorOf(c),
    details: {
      channelId: String(body.channelId ?? '').slice(0, 200),
      network: String(body.network ?? '').slice(0, 20),
      address: String(body.address ?? '').slice(0, 500),
      schedule: String(body.schedule ?? 'manual').slice(0, 20),
      ...(permission ? { permissionBy: String(permission.by ?? '').slice(0, 200), permissionNote: String(permission.note ?? '').slice(0, 1000) } : {}),
    },
  });
  try {
    const result = await videos<{ source: { id: string; auth: string } }>(c, '/import/sources', { method: 'POST', json: body });
    await setAuditSubject(db, auditId, 'import-source', result.source.id).catch((e) => logger.warn('[AdminImport] Could not point the audit row at the source', { auditId, error: String(e) }));
    return c.json({ success: true, result }, 201);
  } catch (error) {
    await dropAudit(db, auditId).catch((e) => logger.error('[AdminImport] Could not drop the audit row of a failed action', { auditId, error: String(e) }));
    throw error;
  }
});
sources.get('/:id', async (c) => {
  const path = sourcePath(c);
  if (!path) return fail(c, 404, 'source_not_found', 'No such source');
  return c.json({ success: true, result: await videos(c, path) });
});
sources.get('/:id/items', async (c) => {
  const path = sourcePath(c);
  if (!path) return fail(c, 404, 'source_not_found', 'No such source');
  const q = new URLSearchParams();
  const state = c.req.query('state');
  const limit = c.req.query('limit');
  if (state) q.set('state', state.slice(0, 20));
  if (limit) q.set('limit', limit.slice(0, 4));
  return c.json({ success: true, result: await videos(c, `${path}/items${q.size ? `?${q}` : ''}`) });
});
sources.patch('/:id', async (c) => {
  const path = sourcePath(c);
  if (!path) return fail(c, 404, 'source_not_found', 'No such source');
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(c, 400, 'invalid_request', 'A JSON object is required');
  const details = Object.fromEntries(['label', 'schedule', 'enabled'].filter((k) => k in body).map((k) => [k, body[k]]));
  return c.json({ success: true, result: await auditedSource(c, c.req.param('id'), 'source:update', details, () => videos(c, path, { method: 'PATCH', json: body })) });
});
sources.delete('/:id', async (c) => {
  const path = sourcePath(c);
  if (!path) return fail(c, 404, 'source_not_found', 'No such source');
  return c.json({ success: true, result: await auditedSource(c, c.req.param('id'), 'source:delete', {}, () => videos(c, path, { method: 'DELETE' })) });
});
sources.post('/:id/sync', async (c) => {
  const path = sourcePath(c);
  if (!path) return fail(c, 404, 'source_not_found', 'No such source');
  const result = await auditedSource(c, c.req.param('id'), 'source:sync', {}, () => videos<{ jobId: string; status: string }>(c, `${path}/sync`, { method: 'POST' }));
  return c.json({ success: true, result }, 202);
});
// Cancel (TA-9 follow-up): stops one of the source's jobs (its sync, or its Takeout match). Idempotent:
// a job already cancelled or finished answers 200 with its state. The job log names the admin.
const JOB_ID = /^[0-9a-f-]{36}$/;
/** The admin's name for "cancelled by …": the token's name, never the email. */
const adminName = (c: C): string | null => {
  const p = (auth(c)?.payload ?? {}) as Record<string, unknown>;
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : [p.given_name, p.family_name].filter((v) => typeof v === 'string' && v.trim()).join(' ').trim();
  return name ? name.slice(0, 200) : null;
};
sources.post('/:id/cancel', async (c) => {
  const path = sourcePath(c);
  if (!path) return fail(c, 404, 'source_not_found', 'No such source');
  const body = (await c.req.json().catch(() => null)) as { jobId?: unknown } | null;
  const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
  if (!JOB_ID.test(jobId)) return fail(c, 400, 'invalid_request', 'jobId is not valid');
  const result = await auditedSource(c, c.req.param('id'), 'source:cancel', { jobId }, () =>
    videos<{ job: { status: string } }>(c, `${path}/cancel`, { method: 'POST', json: { jobId, byName: adminName(c) } }),
  );
  return c.json({ success: true, result });
});

// YouTube Takeout files (TA-9/TA-13): the app lists the export's videos, api-videos' queued job
// 'import.takeout-match' matches them to the source's records waiting for their file, the admin picks
// the record of an ambiguous one, the app uploads each matched file (the record's resumable upload) and
// says when it sent it; the same job then posts the record's video. YouTube sources only (409 not_youtube).
const TAKEOUT_FILE_ID = /^tkf_[0-9a-f]{32}$/;
const takeoutFilePath = (c: C) => {
  const path = sourcePath(c);
  const fileId = c.req.param('fileId') ?? '';
  return path && TAKEOUT_FILE_ID.test(fileId) ? `${path}/takeout/files/${fileId}` : null;
};
sources.post('/:id/takeout/files', async (c) => {
  const path = sourcePath(c);
  if (!path) return fail(c, 404, 'source_not_found', 'No such source');
  const body = (await c.req.json().catch(() => null)) as { files?: unknown } | null;
  if (!body || !Array.isArray(body.files)) return fail(c, 400, 'invalid_request', 'files must be a list');
  const result = await auditedSource(c, c.req.param('id'), 'source:takeout-files', { files: body.files.length }, () =>
    videos<{ listed: number; added: number; jobId: string; status: string }>(c, `${path}/takeout/files`, { method: 'POST', json: { files: body.files } }),
  );
  return c.json({ success: true, result }, 202);
});
sources.get('/:id/takeout', async (c) => {
  const path = sourcePath(c);
  if (!path) return fail(c, 404, 'source_not_found', 'No such source');
  const q = new URLSearchParams();
  const state = c.req.query('state');
  const limit = c.req.query('limit');
  if (state) q.set('state', state.slice(0, 20));
  if (limit) q.set('limit', limit.slice(0, 4));
  return c.json({ success: true, result: await videos(c, `${path}/takeout${q.size ? `?${q}` : ''}`) });
});
sources.post('/:id/takeout/files/:fileId/confirm', async (c) => {
  const path = takeoutFilePath(c);
  if (!path) return fail(c, 404, 'file_not_found', 'No such Takeout file');
  const body = (await c.req.json().catch(() => null)) as { itemId?: unknown } | null;
  const itemId = typeof body?.itemId === 'string' ? body.itemId.slice(0, 200) : '';
  if (!itemId) return fail(c, 400, 'invalid_request', 'itemId is required');
  const result = await auditedSource(c, c.req.param('id'), 'source:takeout-confirm', { fileId: c.req.param('fileId'), itemId }, () =>
    videos(c, `${path}/confirm`, { method: 'POST', json: { itemId } }),
  );
  return c.json({ success: true, result });
});
sources.post('/:id/takeout/files/:fileId/upload', async (c) => {
  const path = takeoutFilePath(c);
  if (!path) return fail(c, 404, 'file_not_found', 'No such Takeout file');
  const result = await auditedSource(c, c.req.param('id'), 'source:takeout-upload', { fileId: c.req.param('fileId') }, () =>
    videos(c, `${path}/upload`, { method: 'POST' }),
  );
  return c.json({ success: true, result });
});
sources.post('/:id/takeout/files/:fileId/uploaded', async (c) => {
  const path = takeoutFilePath(c);
  if (!path) return fail(c, 404, 'file_not_found', 'No such Takeout file');
  return c.json({ success: true, result: await videos(c, `${path}/uploaded`, { method: 'POST' }) }, 202);
});
app.route('/sources', sources);

export default app;
