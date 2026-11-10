// The admin theme builder's API (docs/themes/README.md). Mounted at /api/themes behind the admin
// API's auth: moderators may read, only admins (the same role that sets the site theme) may change.
// Binary bodies (zip, asset files) are plain Hono routes rather than OpenAPI schemas.
import { Hono, type Context } from 'hono';
import { BUILT_IN_THEMES, DEFAULT_THEME, validatePackage, type ThemePackage } from '@al-ummah/theme-packages';
import { parseSiteThemeValue, SITE_THEME_SETTING_KEY } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import type { AuthContext } from '../middleware/auth';
import { hasAdminRole } from '../lib/roles';
import { logger } from '../lib/logger';
import { ThemeError, ThemeStore } from '../lib/themePackages';

type Env = { Bindings: AdminBindings };
const app = new Hono<Env>();

const MAX_UPLOAD = 16 * 1024 * 1024;
const store = (c: Context<Env>) => new ThemeStore(c.env.REPORTS_DB, c.env.theme_packages);
const actor = (c: Context<Env>) => (c.get('auth' as never) as AuthContext | undefined)?.userId ?? 'unknown';
const now = () => new Date().toISOString();

function requireAdmin(c: Context<Env>): Response | null {
  const auth = c.get('auth' as never) as AuthContext | undefined;
  if (!auth) return c.json({ success: false, error: 'Authentication required' }, 401);
  if (!hasAdminRole(auth.roles ?? [])) {
    logger.warn('[Themes] Non-admin attempted a theme change', { userId: auth.userId });
    return c.json({ success: false, error: 'Admin role required' }, 403);
  }
  return null;
}

function fail(c: Context<Env>, e: unknown): Response {
  if (e instanceof ThemeError) return c.json({ success: false, error: e.message, issues: e.issues }, e.status);
  logger.error('[Themes] Unexpected error', e);
  return c.json({ success: false, error: 'Theme storage failed' }, 500);
}

async function activeRef(c: Context<Env>) {
  const row = await c.env.REPORTS_DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(SITE_THEME_SETTING_KEY).first<{ value: string }>();
  return row ? parseSiteThemeValue(row.value) : { id: DEFAULT_THEME, version: null };
}

async function bodyBytes(c: Context<Env>): Promise<Uint8Array | Response> {
  const length = Number(c.req.header('content-length') ?? 0);
  if (length > MAX_UPLOAD) return c.json({ success: false, error: 'The upload is larger than 16 MB' }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD) return c.json({ success: false, error: 'The upload is larger than 16 MB' }, 413);
  return bytes;
}

/** Built-in and custom themes, each marked active or not. */
app.get('/', async (c) => {
  try {
    const active = await activeRef(c);
    const custom = await store(c).list();
    return c.json({
      success: true,
      result: {
        active,
        themes: [
          ...BUILT_IN_THEMES.map((t) => ({ id: t.id, name: t.name, builtIn: true, kind: t.kind, latestVersion: t.version, versions: [{ version: t.version }], active: active.id === t.id, draftUpdatedAt: null, basedOn: null })),
          ...custom.map((t) => ({
            id: t.id, name: { en: t.name_en, ar: t.name_ar }, builtIn: false, kind: 'custom', basedOn: t.based_on,
            latestVersion: t.latest_version, draftUpdatedAt: t.draft_updated_at, draftUpdatedBy: t.draft_updated_by,
            versions: t.versions.map((v) => ({ version: v.version, publishedAt: v.published_at, publishedBy: v.published_by, size: v.size_bytes })),
            active: active.id === t.id, activeVersion: active.id === t.id ? active.version : null,
          })),
        ],
      },
    });
  } catch (e) { return fail(c, e); }
});

/** Creates a custom theme from a whole package sent as JSON ({ theme }); assets follow as uploads. */
app.post('/', async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  try {
    const body = (await c.req.json().catch(() => null)) as { theme?: ThemePackage } | null;
    if (!body?.theme) return c.json({ success: false, error: 'Send { theme }' }, 400);
    const validation = await store(c).create({ theme: body.theme, assets: {} }, actor(c), now());
    return c.json({ success: true, result: { id: body.theme.id, validation } }, 201);
  } catch (e) { return fail(c, e); }
});

/** Creates a custom theme from a .zip package (folder + theme.json + assets). ?id= renames it. */
app.post('/import', async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  try {
    const bytes = await bodyBytes(c); if (bytes instanceof Response) return bytes;
    const rename = c.req.query('id') || undefined;
    const result = await store(c).importZip(bytes, rename, actor(c), now());
    return c.json({ success: true, result }, 201);
  } catch (e) { return fail(c, e); }
});

app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const s = store(c);
    const row = await s.get(id);
    if (!row) return c.json({ success: false, error: `No custom theme ${id}` }, 404);
    const theme = await s.draftTheme(id);
    const assets = await s.draftAssets(id);
    const files = await s.load(id, 'draft');
    const validation = files ? validatePackage(files.theme, { assets: files.assets }) : null;
    const active = await activeRef(c);
    return c.json({ success: true, result: { id, theme, assets, validation, versions: row.versions, latestVersion: row.latest_version, active: active.id === id, activeVersion: active.id === id ? active.version : null } });
  } catch (e) { return fail(c, e); }
});

app.put('/:id/draft', async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  try {
    const theme = (await c.req.json().catch(() => null)) as ThemePackage | null;
    if (!theme || typeof theme !== 'object') return c.json({ success: false, error: 'Send theme.json' }, 400);
    const validation = await store(c).saveDraft(c.req.param('id'), theme, actor(c), now());
    return c.json({ success: true, result: { validation } });
  } catch (e) { return fail(c, e); }
});

app.get('/:id/draft/assets/*', async (c) => {
  try {
    const id = c.req.param('id');
    const path = c.req.path.slice(c.req.path.indexOf('/draft/') + '/draft/'.length);
    const obj = await store(c).getObject(id, 'draft', decodeURIComponent(path));
    if (!obj) return c.json({ success: false, error: 'Not found' }, 404);
    return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } });
  } catch (e) { return fail(c, e); }
});

app.put('/:id/draft/assets/*', async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  try {
    const id = c.req.param('id');
    const path = decodeURIComponent(c.req.path.slice(c.req.path.indexOf('/draft/') + '/draft/'.length));
    const bytes = await bodyBytes(c); if (bytes instanceof Response) return bytes;
    await store(c).putAsset(id, path, bytes, actor(c), now());
    return c.json({ success: true, result: { path, size: bytes.byteLength } });
  } catch (e) { return fail(c, e); }
});

app.delete('/:id/draft/assets/*', async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  try {
    const id = c.req.param('id');
    const path = decodeURIComponent(c.req.path.slice(c.req.path.indexOf('/draft/') + '/draft/'.length));
    await store(c).deleteAsset(id, path);
    return c.json({ success: true });
  } catch (e) { return fail(c, e); }
});

app.post('/:id/publish', async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  try {
    const result = await store(c).publish(c.req.param('id'), actor(c), now());
    logger.info('[Themes] Published', { id: c.req.param('id'), version: result.version, actor: actor(c) });
    return c.json({ success: true, result });
  } catch (e) { return fail(c, e); }
});

/** The package as a .zip: ?version=draft (default) or a published version. */
app.get('/:id/export', async (c) => {
  try {
    const id = c.req.param('id');
    const version = c.req.query('version') || 'draft';
    if (version !== 'draft' && !/^\d+\.\d+\.\d+$/.test(version)) return c.json({ success: false, error: 'version must be draft or x.y.z' }, 400);
    const zip = await store(c).exportZip(id, version);
    if (!zip) return c.json({ success: false, error: `No ${version} of ${id}` }, 404);
    const name = `${id}${version === 'draft' ? '-draft' : `-${version}`}.zip`;
    return new Response(zip, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' } });
  } catch (e) { return fail(c, e); }
});

app.delete('/:id', async (c) => {
  const denied = requireAdmin(c); if (denied) return denied;
  try {
    await store(c).remove(c.req.param('id'), actor(c), now());
    logger.info('[Themes] Deleted', { id: c.req.param('id'), actor: actor(c) });
    return c.json({ success: true });
  } catch (e) { return fail(c, e); }
});

export default app;

/** Public, immutable files of published versions: theme.css, theme.json and assets. */
export const publicThemes = new Hono<Env>();
const IMMUTABLE = 'public, max-age=31536000, immutable';
publicThemes.get('/:id/:version/*', async (c) => {
  const { id, version } = c.req.param();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version)) return c.text('Not found', 404);
  const rest = decodeURIComponent(c.req.path.slice(`/public/themes/${id}/${version}/`.length));
  if (!(rest === 'theme.css' || rest === 'theme.json' || /^assets\/(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9._/-]*$/.test(rest))) return c.text('Not found', 404);
  const obj = await new ThemeStore(c.env.REPORTS_DB, c.env.theme_packages).getObject(id, version, rest);
  if (!obj) return c.text('Not found', 404, { 'Cache-Control': 'public, max-age=30' });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': IMMUTABLE,
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      ...(rest.endsWith('.svg') ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
      ETag: obj.httpEtag,
    },
  });
});
