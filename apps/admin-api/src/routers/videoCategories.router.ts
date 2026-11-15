/**
 * /api/video-categories — admin-managed video categories (owner 2026-11-15: "can you add categories in admin?").
 *
 *   GET    /                 every category (retired included) with its video count; canManage
 *   POST   /                 { labelEn, labelAr, hint?, value? } add one (value = slug, suggested from labelEn)
 *   PATCH  /:value           { labelEn?, labelAr?, hint?, retired? } rename (en + ar), change the AI hint, retire or restore
 *   PUT    /order            { values: string[] } the display order
 *   GET    /history          the latest changes (audit log, newest first)
 *
 * The list lives in the search D1 (`video_categories`, api-videos migration 0050). A value never changes once
 * created, so videos keep it; a retired category leaves pickers, Explore, search filters and AI suggestions, and
 * videos that have it keep it and its label. Reads are open to every admin role; changes need videos:categories
 * (admins and super admins). Every change is audited first (site_settings_log, key content:category:<value>) and
 * the row is dropped again when the change fails. After a change this isolate's list is reloaded and api-videos
 * is told to drop its cached copy (other isolates and colos follow within a minute). A rename queues
 * MessageType.CategoryRelabel so search finds videos by the new name (processor, retry + DLQ).
 */
import { Hono, type Context } from 'hono';
import {
  CATEGORY_LIMITS,
  MessageType,
  invalidateVideoCategories,
  loadVideoCategories,
  rowToEntry,
  slugFromLabel,
  validateCategoryFields,
  type CategoryRelabelPayload,
  type SearchDb,
  type VideoCategoryRow,
} from '@al-ummah/shared-types';
import { hasPermission } from '../lib/roles';
import { logger } from '../lib/logger';
import { auditKey, dropAudit, writeAudit } from '../lib/content/audit';
import { resolveNames } from '../lib/queue/names';
import type { ProcessingClientEnv } from '../lib/processing/videosProcessing';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & ProcessingClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string, readonly fields?: Record<string, string>) {
    super(message ?? code);
  }
}

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const POSITION_STEP = 10;

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ success: false, code: error.code, error: error.message, ...(error.fields ? { fields: error.fields } : {}) }, error.status as 400);
  }
  logger.error('[VideoCategories] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

function db(c: C): SearchDb {
  const bound = c.env.SEARCH_DB as unknown as SearchDb | undefined;
  if (!bound) throw new HttpError(503, 'not_configured', 'SEARCH_DB not bound');
  return bound;
}

function needManage(c: C) {
  if (!hasPermission(c.get('auth')?.roles, 'videos:categories')) {
    logger.warn('[VideoCategories] Permission denied', { userId: actorOf(c), path: c.req.path });
    throw new HttpError(403, 'forbidden', 'The videos:categories permission is required');
  }
}

async function readRows(d: SearchDb): Promise<VideoCategoryRow[]> {
  const { results } = await d
    .prepare('SELECT value, label_en, label_ar, hint, position, retired, created_at, updated_at FROM video_categories ORDER BY position, value')
    .all<VideoCategoryRow>();
  return results ?? [];
}

async function readRow(d: SearchDb, value: string): Promise<VideoCategoryRow | null> {
  return d
    .prepare('SELECT value, label_en, label_ar, hint, position, retired, created_at, updated_at FROM video_categories WHERE value = ?')
    .bind(value)
    .first<VideoCategoryRow>();
}

const view = (row: VideoCategoryRow, counts: Map<string, number>) => ({
  ...rowToEntry(row),
  hint: row.hint ?? '',
  videoCount: counts.get(row.value) ?? 0,
  updatedAt: row.updated_at ?? null,
});

/** Videos per category: an index-only pass over idx_search_videos_category (the same count Explore makes). */
async function videoCounts(d: SearchDb): Promise<Map<string, number>> {
  try {
    const { results } = await d
      .prepare('SELECT category, COUNT(*) AS n FROM search_videos WHERE category IS NOT NULL GROUP BY category')
      .all<{ category: string; n: number }>();
    return new Map((results ?? []).map((r) => [r.category, Number(r.n)]));
  } catch (error) {
    logger.warn('[VideoCategories] Video counts unavailable', { error: error instanceof Error ? error.message : String(error) });
    return new Map();
  }
}

/** This isolate reloads now; api-videos drops its cached copy (best effort: it expires within a minute anyway). */
async function publish(c: C): Promise<void> {
  invalidateVideoCategories();
  await loadVideoCategories(db(c), { force: true });
  try {
    const binding = c.env.INTERNAL_API_KEY;
    const key = typeof binding === 'string' ? binding : await binding?.get();
    if (!key) return;
    const init: RequestInit = { method: 'POST', headers: { 'X-API-Key': key, 'X-Admin-Actor': actorOf(c) } };
    const path = '/internal/categories/invalidate';
    const res = c.env.VIDEOS
      ? await c.env.VIDEOS.fetch(`https://videos.internal${path}`, init)
      : c.env.VIDEOS_API_URL
        ? await fetch(`${c.env.VIDEOS_API_URL.replace(/\/$/, '')}${path}`, init)
        : null;
    if (res && !res.ok) logger.warn('[VideoCategories] api-videos did not drop its cached list', { status: res.status });
  } catch (error) {
    logger.warn('[VideoCategories] api-videos did not drop its cached list', { error: error instanceof Error ? error.message : String(error) });
  }
}

const fieldErrors = (errors: Record<string, string | undefined>) => {
  const fields = Object.fromEntries(Object.entries(errors).filter(([, v]) => !!v)) as Record<string, string>;
  return Object.keys(fields).length ? fields : null;
};

const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v);

app.get('/', async (c) => {
  const d = db(c);
  const [rows, counts] = await Promise.all([readRows(d), videoCounts(d)]);
  return c.json({
    success: true,
    result: {
      categories: rows.map((row) => view(row, counts)),
      limits: CATEGORY_LIMITS,
      canManage: hasPermission(c.get('auth')?.roles, 'videos:categories'),
    },
  });
});

app.get('/history', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
  const prefix = auditKey('category', '');
  const { results } = await c.env.REPORTS_DB
    .prepare('SELECT id, key, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key >= ? AND key < ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .bind(prefix, `${prefix.slice(0, -1)};`, limit)
    .all<{ id: string; key: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }>();
  const rows = results ?? [];
  // Names, not ids (one batch over the search index; falls back to the id)
  const names = await resolveNames(c.env.SEARCH_DB as never, { profiles: rows.map((r) => r.actor_id) });
  const entries = rows.map((r) => ({
    id: r.id,
    value: r.key.slice(prefix.length),
    previous: r.old_value ? JSON.parse(r.old_value) : null,
    change: JSON.parse(r.new_value),
    actorId: r.actor_id,
    actorName: names.profiles.get(r.actor_id) ?? null,
    createdAt: r.created_at,
  }));
  return c.json({ success: true, result: { entries } });
});

app.post('/', async (c) => {
  needManage(c);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_request', 'A category is required');
  const labelEn = clean(body.labelEn);
  const labelAr = clean(body.labelAr);
  const hint = typeof body.hint === 'string' ? body.hint.trim() : undefined;
  const value = typeof body.value === 'string' && body.value.trim() ? body.value.trim() : typeof labelEn === 'string' ? slugFromLabel(labelEn) : '';
  const errors = fieldErrors({ ...validateCategoryFields({ value, labelEn, labelAr, hint }, true) });
  if (errors) throw new HttpError(400, 'invalid', 'Check the highlighted fields', errors);

  const d = db(c);
  const rows = await readRows(d);
  if (rows.some((r) => r.value === value)) throw new HttpError(409, 'exists', 'A category with this value already exists', { value: 'exists' });
  if (rows.length >= CATEGORY_LIMITS.max) throw new HttpError(400, 'too_many', `At most ${CATEGORY_LIMITS.max} categories`);
  const position = (rows.reduce((max, r) => Math.max(max, Number(r.position) || 0), 0)) + POSITION_STEP;
  const now = Date.now();
  const created = { value, labelEn: labelEn as string, labelAr: labelAr as string, hint: hint || null, position };

  const auditId = await writeAudit(c.env.REPORTS_DB, { kind: 'category', id: value, action: 'create', actorId: actorOf(c), details: created });
  try {
    await d
      .prepare('INSERT INTO video_categories (value, label_en, label_ar, hint, position, retired, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
      .bind(value, created.labelEn, created.labelAr, created.hint, position, now, now)
      .run();
  } catch (error) {
    await dropAudit(c.env.REPORTS_DB, auditId).catch(() => undefined);
    throw error;
  }
  await publish(c);
  logger.info('[VideoCategories] Category added', { actorId: actorOf(c), value });
  const row = await readRow(d, value);
  return c.json({ success: true, result: { category: view(row!, new Map()) } }, 201);
});

app.put('/order', async (c) => {
  needManage(c);
  const body = (await c.req.json().catch(() => null)) as { values?: unknown } | null;
  const values = Array.isArray(body?.values) ? body!.values.filter((v): v is string => typeof v === 'string') : null;
  const d = db(c);
  const rows = await readRows(d);
  const known = new Set(rows.map((r) => r.value));
  if (!values || values.length !== rows.length || new Set(values).size !== values.length || values.some((v) => !known.has(v))) {
    throw new HttpError(400, 'invalid_order', 'Send every category value once, in the new order');
  }
  const before = rows.map((r) => r.value);
  if (before.join(',') === values.join(',')) return c.json({ success: true, result: { changed: false } });
  const now = Date.now();
  const auditId = await writeAudit(c.env.REPORTS_DB, { kind: 'category', id: '*order', action: 'reorder', actorId: actorOf(c), details: { values }, previous: { values: before } });
  try {
    await d.batch(values.map((v, i) => d.prepare('UPDATE video_categories SET position = ?, updated_at = ? WHERE value = ?').bind((i + 1) * POSITION_STEP, now, v)));
  } catch (error) {
    await dropAudit(c.env.REPORTS_DB, auditId).catch(() => undefined);
    throw error;
  }
  await publish(c);
  logger.info('[VideoCategories] Categories reordered', { actorId: actorOf(c) });
  return c.json({ success: true, result: { changed: true } });
});

app.patch('/:value', async (c) => {
  needManage(c);
  const value = c.req.param('value');
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_request', 'Changes are required');
  if ('value' in body && body.value !== value) throw new HttpError(400, 'immutable_value', 'A category value never changes; rename its labels instead');
  const labelEn = body.labelEn === undefined ? undefined : clean(body.labelEn);
  const labelAr = body.labelAr === undefined ? undefined : clean(body.labelAr);
  const hint = body.hint === undefined ? undefined : typeof body.hint === 'string' ? body.hint.trim() : body.hint;
  const retired = body.retired === undefined ? undefined : body.retired;
  if (retired !== undefined && typeof retired !== 'boolean') throw new HttpError(400, 'invalid', 'retired is true or false', { retired: 'invalid' });
  const errors = fieldErrors({ ...validateCategoryFields({ labelEn, labelAr, hint }, false) });
  if (errors) throw new HttpError(400, 'invalid', 'Check the highlighted fields', errors);

  const d = db(c);
  const current = await readRow(d, value);
  if (!current) throw new HttpError(404, 'not_found', 'No such category');
  const next = {
    labelEn: (labelEn as string | undefined) ?? current.label_en,
    labelAr: (labelAr as string | undefined) ?? current.label_ar,
    hint: hint === undefined ? current.hint : (hint as string) || null,
    retired: retired === undefined ? Number(current.retired) === 1 : retired,
  };
  const previous = { labelEn: current.label_en, labelAr: current.label_ar, hint: current.hint, retired: Number(current.retired) === 1 };
  const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => previous[k as keyof typeof previous] !== v));
  if (!Object.keys(changed).length) return c.json({ success: true, result: { category: view(current, new Map()), changed: false } });
  if (next.retired && !previous.retired) {
    const active = (await readRows(d)).filter((r) => Number(r.retired) !== 1);
    if (active.length <= 1) throw new HttpError(400, 'last_active', 'At least one category must stay available');
  }
  const action = 'retired' in changed && Object.keys(changed).length === 1 ? (next.retired ? 'retire' : 'restore') : 'update';
  const renamed = 'labelEn' in changed || 'labelAr' in changed;
  const now = Date.now();
  const auditId = await writeAudit(c.env.REPORTS_DB, {
    kind: 'category',
    id: value,
    action,
    actorId: actorOf(c),
    details: changed,
    previous: Object.fromEntries(Object.keys(changed).map((k) => [k, previous[k as keyof typeof previous]])),
  });
  const write = (v: typeof next) => d
    .prepare('UPDATE video_categories SET label_en = ?, label_ar = ?, hint = ?, retired = ?, updated_at = ? WHERE value = ?')
    .bind(v.labelEn, v.labelAr, v.hint, v.retired ? 1 : 0, now, value)
    .run();
  try {
    await write(next);
  } catch (error) {
    await dropAudit(c.env.REPORTS_DB, auditId).catch(() => undefined);
    throw error;
  }
  if (renamed) {
    // Search finds the videos by their new name: one queued job pages the index (processor, retry + DLQ)
    const payload: CategoryRelabelPayload = {
      category: value,
      entity: 'video',
      from: { en: previous.labelEn, ar: previous.labelAr },
      to: { en: next.labelEn, ar: next.labelAr },
    };
    try {
      if (!c.env.queue) throw new Error('queue binding missing');
      await c.env.queue.send({ id: crypto.randomUUID(), type: MessageType.CategoryRelabel, payload, timestamp: Date.now() });
    } catch (error) {
      // Undo the rename: the labels and the index text never disagree
      await write({ ...next, labelEn: previous.labelEn, labelAr: previous.labelAr }).catch(() => undefined);
      await dropAudit(c.env.REPORTS_DB, auditId).catch(() => undefined);
      logger.error('[VideoCategories] Rename not applied: the search relabel job could not be queued', { value, error: error instanceof Error ? error.message : String(error) });
      throw new HttpError(503, 'relabel_not_queued', 'The rename could not be applied; try again');
    }
  }
  await publish(c);
  logger.info('[VideoCategories] Category changed', { actorId: actorOf(c), value, action, fields: Object.keys(changed) });
  const row = await readRow(d, value);
  return c.json({ success: true, result: { category: view(row!, new Map()), changed: true } });
});

export default app;
