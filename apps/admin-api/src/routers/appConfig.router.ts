/**
 * /api/app-config — remote config and feature flags for the native apps (issue #413, Epic 9.5),
 * edited from the videos admin. settings:manage (admins and super admins) for every route.
 *
 *   GET  /:key            the stored document (flags | config | versions), null when unset
 *   PUT  /:key            { value, expected? } replace it; api-videos validates it (400 with its
 *                         problems, nothing written). `expected` is the document the editor
 *                         started from: when the stored one has changed since, 409 (no overwrite)
 *   GET  /:key/history    the latest changes (audit log, newest first), each with who made it by name
 *   POST /evaluate        { context, documents? } dry run: what an app build would get
 *   GET  /releases        the app release index (wiki AUN-APP-UPDATES §4.2)
 *   POST /releases/refresh  run the release index now (429 while one runs)
 *   PUT  /releases/available  { app, platform, source: testflight|amazon, version|null } (super admins; audited)
 *
 * The `versions` document (minimum versions, notes overrides, forced-screen message) and the
 * Available marks need app_versions:manage (super admins, issue #1434); admins see them read-only.
 *
 * The documents live in api-videos' APP_CONFIG KV (/internal/app-config/*, INTERNAL_API_KEY, which
 * stays on the servers). Every change is audited (site_settings_log, key app-config:<key>, old and
 * new document) before api-videos is called, and the row is dropped again if that call fails.
 */
import { Hono, type Context } from 'hono';
import { APP_CONFIG_DOCUMENT_KEYS, sameAppConfigDocument, type AppConfigDocumentKey } from '@al-ummah/shared-types';
import { hasPermission } from '../lib/roles';
import { callVideosInternal, ProcessingApiError, type ProcessingClientEnv } from '../lib/processing/videosProcessing';
import { lookupMany } from '../lib/moderation/reportMeta';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';
import { auditOriginJson } from '../lib/request-origin';
import { apiError } from '../lib/api-error';

type Env = { Bindings: AdminBindings & ProcessingClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const appConfigAuditKey = (key: AppConfigDocumentKey) => `app-config:${key}`;
const INTERNAL = '/internal/app-config';

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const isKey = (key: string): key is AppConfigDocumentKey => (APP_CONFIG_DOCUMENT_KEYS as readonly string[]).includes(key);

/** Key order ignored, so a document read back from KV equals the one the editor started from. */
export const sameDocument = sameAppConfigDocument;

/**
 * api-videos' zod issues as the admin's problem shape: `problem` is where (the path, `0.key` for
 * the first rule's key, `viewer/ios.minimumVersion`), `detail` what is wrong. At most 50.
 */
export function documentProblems(issues: unknown): { problem: string; detail: string; code?: string; params?: Record<string, string> }[] {
  if (!Array.isArray(issues)) return [];
  return issues.slice(0, 50).map((issue) => {
    const i = (issue ?? {}) as { path?: unknown; message?: unknown; code?: unknown; params?: unknown };
    // A minimum-version problem says what is wrong in a code, which the admin's page words in its own language
    const coded = typeof i.code === 'string' && i.code.startsWith('minimum_');
    const params = coded && i.params && typeof i.params === 'object' ? Object.fromEntries(Object.entries(i.params).filter((e): e is [string, string] => typeof e[1] === 'string').map(([k, v]) => [k, v.slice(0, 80)])) : undefined;
    return { problem: Array.isArray(i.path) ? i.path.map(String).join('.') : '', detail: typeof i.message === 'string' ? i.message.slice(0, 300) : 'Invalid', ...(coded ? { code: i.code as string, params: params ?? {} } : {}) };
  });
}

app.onError((error, c) => {
  if (error instanceof ProcessingApiError) {
    if (error.status === 400) return c.json({ success: false, code: 'invalid_document', error: error.message, problems: documentProblems(error.problems) }, 400);
    logger.error('[AppConfig] api-videos refused the request', { path: c.req.path, status: error.status, error: error.message });
    return c.json({ success: false, code: 'videos_error', error: error.message }, (error.status >= 500 ? 502 : error.status) as 502);
  }
  logger.error('[AppConfig] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

app.use('*', async (c, next) => {
  if (!hasPermission(c.get('auth')?.roles, 'settings:manage')) {
    logger.warn('[AppConfig] Permission denied', { userId: actorOf(c), path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The settings:manage permission is required' }, 403);
  }
  return next();
});

app.post('/evaluate', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { context?: unknown; documents?: unknown } | null;
  if (!body || typeof body.context !== 'object') return c.json({ success: false, code: 'bad_request', error: 'context is required' }, 400);
  const result = await callVideosInternal(c.env, `${INTERNAL}/evaluate`, { method: 'POST', json: { context: body.context, documents: body.documents ?? {} } });
  return c.json({ success: true, result });
});

// --- App releases (wiki AUN-APP-UPDATES §4.2) -------------------------------------------------
app.get('/releases', async (c) => {
  const result = await callVideosInternal<unknown>(c.env, `${INTERNAL}/releases`);
  return c.json({ success: true, result });
});

app.post('/releases/refresh', async (c) => {
  const result = await callVideosInternal<unknown>(c.env, `${INTERNAL}/releases/refresh`, { method: 'POST', json: {} });
  logger.info('[AppConfig] Release index refreshed', { actorId: actorOf(c) });
  return c.json({ success: true, result });
});

app.put('/releases/available', async (c) => {
  if (!hasPermission(c.get('auth')?.roles, 'app_versions:manage')) {
    return apiError(c, 403, 'forbidden', { error: 'Only super admins mark store uploads available' });
  }
  const body = (await c.req.json().catch(() => null)) as { app?: unknown; platform?: unknown; source?: unknown; version?: unknown } | null;
  if (!body || typeof body.app !== 'string' || typeof body.platform !== 'string' || (body.source !== 'testflight' && body.source !== 'amazon') || !(body.version === null || typeof body.version === 'string')) {
    return apiError(c, 400, 'bad_request', { error: 'app, platform, source (testflight or amazon) and version (or null) are required' });
  }
  // The mark it replaces, for the audit row
  const index = await callVideosInternal<{ availability?: Record<string, string> } | null>(c.env, `${INTERNAL}/releases`);
  const previous = index?.availability?.[`${body.app}/${body.platform}/${body.source}`] ?? null;
  const db = c.env.REPORTS_DB;
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, 'app-config:availability', previous === null ? null : JSON.stringify({ app: body.app, platform: body.platform, source: body.source, version: previous }), JSON.stringify({ app: body.app, platform: body.platform, source: body.source, version: body.version }), actorOf(c), new Date().toISOString(), auditOriginJson())
    .run();
  try {
    const result = await callVideosInternal<unknown>(c.env, `${INTERNAL}/releases/available`, { method: 'PUT', json: { app: body.app, platform: body.platform, source: body.source, version: body.version } });
    logger.info('[AppConfig] Store upload marked', { actorId: actorOf(c), app: body.app, platform: body.platform, source: body.source, version: body.version });
    return c.json({ success: true, result });
  } catch (error) {
    await db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(id).run().catch(() => undefined);
    throw error;
  }
});

app.get('/:key/history', async (c) => {
  const key = c.req.param('key');
  if (!isKey(key)) return c.json({ success: false, code: 'not_found', error: 'Unknown document' }, 404);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10', 10) || 10, 1), 50);
  const { results } = await c.env.REPORTS_DB
    .prepare('SELECT id, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(appConfigAuditKey(key), limit)
    .all<{ id: string; actor_id: string; created_at: string }>();
  const rows = results ?? [];
  // Names, not ids (#745); without the lookup the entries still list, by id
  const names = await lookupMany(c.env, [], rows.map((r) => r.actor_id));
  const entries = rows.map((r) => {
    const user = names?.users.get(r.actor_id);
    return { id: r.id, actorId: r.actor_id, actorName: user?.displayName || (user?.userName ? `@${user.userName}` : null), createdAt: r.created_at };
  });
  return c.json({ success: true, result: { entries } });
});

app.get('/:key', async (c) => {
  const key = c.req.param('key');
  if (!isKey(key)) return c.json({ success: false, code: 'not_found', error: 'Unknown document' }, 404);
  const value = await callVideosInternal<unknown>(c.env, `${INTERNAL}/${key}`);
  return c.json({ success: true, result: { key, value: value ?? null } });
});

app.put('/:key', async (c) => {
  const key = c.req.param('key');
  if (!isKey(key)) return c.json({ success: false, code: 'not_found', error: 'Unknown document' }, 404);
  // Minimum versions can lock users out: super admins only (issue #1434, wiki AUN-APP-UPDATES §4.2)
  if (key === 'versions' && !hasPermission(c.get('auth')?.roles, 'app_versions:manage')) {
    return apiError(c, 403, 'forbidden', { error: 'Only super admins change app versions' });
  }
  const body = (await c.req.json().catch(() => null)) as { value?: unknown; expected?: unknown } | null;
  if (!body || body.value === undefined) return c.json({ success: false, code: 'bad_request', error: 'value is required' }, 400);

  const current = (await callVideosInternal<unknown>(c.env, `${INTERNAL}/${key}`)) ?? null;
  if ('expected' in body && !sameDocument(current, body.expected)) {
    return c.json({ success: false, code: 'conflict', error: 'The document changed since it was opened', result: { key, value: current } }, 409);
  }
  if (sameDocument(current, body.value)) return c.json({ success: true, changed: false, result: { key, value: current } });

  const db = c.env.REPORTS_DB;
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, appConfigAuditKey(key), current === null ? null : JSON.stringify(current), JSON.stringify(body.value), actorOf(c), new Date().toISOString(), auditOriginJson())
    .run();
  try {
    const value = await callVideosInternal<unknown>(c.env, `${INTERNAL}/${key}`, { method: 'PUT', json: body.value });
    logger.info('[AppConfig] Document replaced', { key, actorId: actorOf(c) });
    return c.json({ success: true, changed: true, result: { key, value } });
  } catch (error) {
    await db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(id).run().catch((dropError) =>
      logger.error('[AppConfig] Could not drop the audit row of a failed change', { key, error: String(dropError) }),
    );
    throw error;
  }
});

export default app;
