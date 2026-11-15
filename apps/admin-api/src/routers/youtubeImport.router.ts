/**
 * /api/youtube-import/* — Move from YouTube settings (wiki AUN-YT-IMPORT).
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts); every route also
 * needs the `media:manage` permission. The settings live in api-videos
 * (global_settings youtube-import/settings.json, /internal/youtube-import/*);
 * the Google client secret is write only: set here, sealed and kept by api-videos (or, without one,
 * the Secrets Store entry google-oauth-client-secret[-qa|-stage]), never sent back or shown (the view
 * says only whether one is present, where from, and who last replaced it).
 *
 *   GET /settings        { success, result: YoutubeImportSettingsView }
 *   PUT /settings        { enabled?, clientId? } → same (audited, key youtube-import:settings, old and new value)
 *   PUT /client-secret   { value } → same (audited, key youtube-import:client-secret: present/missing
 *                        and the source before and after, never the value)
 *
 * A change writes its audit row (site_settings_log) before calling api-videos
 * and removes it again if the call fails, so no change goes unaudited.
 */
import { Hono, type Context } from 'hono';
import { isGoogleClientId, isGoogleClientSecret, type YoutubeImportSettingsView } from '@al-ummah/shared-types';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { callVideosInternal, ProcessingApiError, type ProcessingClientEnv } from '../lib/processing/videosProcessing';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & ProcessingClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const YOUTUBE_IMPORT_SETTINGS_AUDIT_KEY = 'youtube-import:settings';
export const YOUTUBE_IMPORT_SECRET_AUDIT_KEY = 'youtube-import:client-secret';

const app = new Hono<Env>();

const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';

app.use('*', async (c, next) => {
  if (!hasPermission(normalizeRoles(c.get('auth')?.roles), 'media:manage')) {
    logger.warn('[YouTubeImport] Permission denied', { userId: actorOf(c), path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The media:manage permission is required' }, 403);
  }
  return next();
});

app.onError((error, c) => {
  if (error instanceof ProcessingApiError) return c.json({ success: false, code: 'videos_error', error: error.message }, error.status as 400);
  logger.error('[YouTubeImport] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

/** Validates a settings change: `enabled` a boolean, `clientId` a Google OAuth Web client id (or '' to clear). */
export function parseYoutubeImportSettings(body: unknown): { ok: true; value: { enabled?: boolean; clientId?: string } } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A JSON object is required' };
  const b = body as Record<string, unknown>;
  const value: { enabled?: boolean; clientId?: string } = {};
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false' };
    value.enabled = b.enabled;
  }
  if (b.clientId !== undefined) {
    if (typeof b.clientId !== 'string' || !isGoogleClientId(b.clientId.trim())) return { ok: false, error: 'clientId must be a Google OAuth Web client id (…apps.googleusercontent.com)' };
    value.clientId = b.clientId.trim();
  }
  if (!Object.keys(value).length) return { ok: false, error: 'Nothing to change' };
  return { ok: true, value };
}

app.get('/settings', async (c) => {
  const result = await callVideosInternal<YoutubeImportSettingsView>(c.env, '/internal/youtube-import/settings');
  return c.json({ success: true, result });
});

/**
 * Writes the audit row, makes the change in api-videos, and removes the row again when the change
 * fails, so no change goes unaudited and no failed one is logged as made.
 */
async function audited<T>(c: C, key: string, before: unknown, after: unknown, change: () => Promise<T>): Promise<T> {
  const db = c.env.REPORTS_DB;
  const auditId = crypto.randomUUID();
  await db
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(auditId, key, JSON.stringify(before), JSON.stringify(after), actorOf(c), new Date().toISOString())
    .run();
  try {
    return await change();
  } catch (error) {
    await db
      .prepare('DELETE FROM site_settings_log WHERE id = ?')
      .bind(auditId)
      .run()
      .catch((dropError) => logger.error('[YouTubeImport] Could not drop the audit row of a failed change', { key, error: String(dropError) }));
    throw error;
  }
}

app.put('/settings', async (c) => {
  const parsed = parseYoutubeImportSettings(await c.req.json().catch(() => null));
  if ('error' in parsed) return c.json({ success: false, code: 'bad_request', error: parsed.error }, 400);
  const current = await callVideosInternal<YoutubeImportSettingsView>(c.env, '/internal/youtube-import/settings');
  const before = { enabled: current.enabled, clientId: current.clientId };
  const result = await audited(c, YOUTUBE_IMPORT_SETTINGS_AUDIT_KEY, before, { ...before, ...parsed.value }, () =>
    callVideosInternal<YoutubeImportSettingsView>(c.env, '/internal/youtube-import/settings', { method: 'PUT', json: { ...parsed.value, actorId: actorOf(c) } }),
  );
  logger.info('[YouTubeImport] Settings changed', { actorId: actorOf(c), ...parsed.value });
  return c.json({ success: true, result });
});

/** What the audit log records about the secret: never the value, only whether one is there and from where. */
export const secretAuditState = (view: Pick<YoutubeImportSettingsView, 'secretPresent' | 'secretSource'>) => ({
  secret: view.secretPresent ? 'present' : 'missing',
  source: view.secretSource ?? null,
});

app.put('/client-secret', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
  // Checked here too so a bad value never reaches the audit log's row or api-videos
  if (!body || !isGoogleClientSecret(body.value)) {
    return c.json({ success: false, code: 'invalid_secret', error: 'Enter the client secret from Google Cloud (16 to 256 characters, no spaces)' }, 400);
  }
  const current = await callVideosInternal<YoutubeImportSettingsView>(c.env, '/internal/youtube-import/settings');
  const result = await audited(c, YOUTUBE_IMPORT_SECRET_AUDIT_KEY, secretAuditState(current), { secret: 'replaced', source: 'admin' }, () =>
    callVideosInternal<YoutubeImportSettingsView>(c.env, '/internal/youtube-import/client-secret', { method: 'PUT', json: { value: body.value, actorId: actorOf(c) } }),
  );
  logger.info('[YouTubeImport] Client secret replaced', { actorId: actorOf(c), before: secretAuditState(current).secret });
  return c.json({ success: true, result });
});

export default app;
