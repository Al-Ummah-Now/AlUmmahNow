/**
 * The theme builder API through the real routers, on the real migrations (node:sqlite standing in
 * for D1) and an in-memory R2: who may change themes, drafts, uploads, publish, export/import,
 * setting a package as the site theme, and deleting.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { duplicatePackage, packageToZip, zipToPackage, type ThemePackage } from '@al-ummah/theme-packages';
import themesRouter, { publicThemes } from '../src/routers/themes.router';
import siteSettingsRouter from '../src/routers/siteSettings.router';
import { publicSiteTheme } from '../src/lib/siteSettings';
import { loadPackageDir } from '../../../packages/theme-packages/scripts/load.ts';

/** D1's API over node:sqlite, with the admin API's migrations applied. */
function d1() {
  const sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => (sqlite.prepare(sql).get(...(args as never[])) as T) ?? null,
    all: async <T>() => ({ results: sqlite.prepare(sql).all(...(args as never[])) as T[] }),
    run: async () => { sqlite.prepare(sql).run(...(args as never[])); return { success: true }; },
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { run(): Promise<unknown> }[]) => {
      sqlite.exec('BEGIN');
      try { for (const s of list) await s.run(); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
      return [];
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}

/** R2's API for binary objects. */
class BinaryR2 {
  objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  async put(key: string, value: Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }) {
    this.objects.set(key, { bytes: typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value), contentType: opts?.httpMetadata?.contentType });
    return { key };
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      body: new Blob([o.bytes as BlobPart]).stream(),
      httpMetadata: { contentType: o.contentType },
      httpEtag: '"e"',
      arrayBuffer: async () => o.bytes.slice().buffer,
      json: async () => JSON.parse(new TextDecoder().decode(o.bytes)),
      text: async () => new TextDecoder().decode(o.bytes),
    };
  }
  async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k); }
  async list({ prefix }: { prefix: string }) {
    return { objects: [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.byteLength })), truncated: false };
  }
}

function setup() {
  const { db, sqlite } = d1();
  const bucket = new BinaryR2();
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles');
    if (roles !== undefined) c.set('auth' as never, { userId: c.req.header('x-test-user') ?? 'admin-1', roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  app.route('/public/themes', publicThemes as never);
  fromHono(app).route('/api/site-settings', siteSettingsRouter);
  app.route('/api/themes', themesRouter as never);
  const env = { REPORTS_DB: db, theme_packages: bucket };
  const call = (path: string, init: RequestInit & { roles?: string } = {}) => {
    const { roles = 'Admin', headers, ...rest } = init;
    return app.request(path, { ...rest, headers: { 'x-test-roles': roles, ...(headers as Record<string, string>) } }, env);
  };
  return { call, db, sqlite, bucket };
}

const fawanees = () => loadPackageDir(fileURLToPath(new URL('../../../packages/theme-packages/themes/fawanees', import.meta.url)));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#f4ae3a"/></svg>';

async function importCopy(call: ReturnType<typeof setup>['call'], id = 'eid-lights') {
  const src = fawanees();
  const theme = duplicatePackage(src.theme, id, { en: 'Eid lights', ar: 'أنوار العيد' }, 'admin-1');
  return call('/api/themes/import', { method: 'POST', body: packageToZip({ theme, assets: src.assets }), headers: { 'content-type': 'application/zip' } });
}

describe('theme builder API', () => {
  it('only admins change themes; moderators may read', async () => {
    const { call } = setup();
    assert.equal((await importCopy(call)).status, 201);
    const asModerator = await call('/api/themes/import', { method: 'POST', body: new Uint8Array([1]), roles: 'Moderator' });
    assert.equal(asModerator.status, 403);
    assert.equal((await call('/api/themes/eid-lights/publish', { method: 'POST', roles: 'Moderator' })).status, 403);
    assert.equal((await call('/api/themes/eid-lights', { method: 'DELETE', roles: 'Moderator' })).status, 403);
    const list = (await (await call('/api/themes', { roles: 'Moderator' })).json()) as { result: { themes: { id: string; builtIn: boolean; active: boolean }[] } };
    assert.deepEqual(list.result.themes.map((t) => [t.id, t.builtIn, t.active]), [['lantern', true, false], ['zujaj', true, false], ['nahas', true, false], ['fawanees', true, true], ['eid-lights', false, false]]);
  });

  it('refuses a built-in id, a taken id and a broken zip', async () => {
    const { call } = setup();
    const src = fawanees();
    const asBuiltIn = await call('/api/themes/import', { method: 'POST', body: packageToZip(src) });
    assert.equal(asBuiltIn.status, 409);
    assert.equal((await importCopy(call)).status, 201);
    assert.equal((await importCopy(call)).status, 409);
    assert.equal((await call('/api/themes/import', { method: 'POST', body: new Uint8Array([1, 2, 3]) })).status, 400);
  });

  it('edit a token and an image, publish, serve, set as site theme, restore, delete', async () => {
    const { call, db, bucket, sqlite } = setup();
    await importCopy(call);
    const detail = (await (await call('/api/themes/eid-lights')).json()) as { result: { theme: ThemePackage; validation: { ok: boolean } } };
    assert.equal(detail.result.validation.ok, true);
    const theme = detail.result.theme;
    theme.tokens.color.dark.surfaceRaised = '#123456';
    theme.components.page.style!.background = '{asset:assets/test-sky.svg} center/cover no-repeat,{color.background}';

    // The image is not uploaded yet: the draft saves, and says what is wrong
    const saved = (await (await call('/api/themes/eid-lights/draft', { method: 'PUT', body: JSON.stringify(theme), headers: { 'content-type': 'application/json' } })).json()) as { result: { validation: { ok: boolean; errors: { message: string }[] } } };
    assert.equal(saved.result.validation.ok, false);
    assert.ok(saved.result.validation.errors.some((e) => e.message.includes('assets/test-sky.svg')));
    assert.equal((await call('/api/themes/eid-lights/publish', { method: 'POST' })).status, 422);

    // Unsafe uploads are refused; a clean SVG is stored
    assert.equal((await call('/api/themes/eid-lights/draft/assets/test-sky.svg', { method: 'PUT', body: '<svg><script>alert(1)</script></svg>' })).status, 422);
    assert.equal((await call('/api/themes/eid-lights/draft/assets/evil.exe', { method: 'PUT', body: SVG })).status, 400);
    assert.equal((await call('/api/themes/eid-lights/draft/assets/test-sky.svg', { method: 'PUT', body: SVG })).status, 200);

    const published = (await (await call('/api/themes/eid-lights/publish', { method: 'POST' })).json()) as { result: { version: string } };
    assert.equal(published.result.version, '1.0.0');
    const css = await call('/public/themes/eid-lights/1.0.0/theme.css', { roles: '' });
    assert.equal(css.status, 200);
    assert.match(css.headers.get('cache-control')!, /immutable/);
    const text = await css.text();
    assert.ok(text.includes("html[data-theme='eid-lights'].dark {"));
    assert.ok(text.includes('--fanous-color-surface-raised: #123456;'));
    assert.ok(text.includes('--m-page:url("/api/theme-packages/eid-lights/1.0.0/assets/test-sky.svg") center/cover no-repeat,var(--fanous-color-background)'));
    const asset = await call('/public/themes/eid-lights/1.0.0/assets/test-sky.svg', { roles: '' });
    assert.equal(asset.headers.get('content-type'), 'image/svg+xml');
    assert.equal(await asset.text(), SVG);

    // A second publish is the next version; the first stays
    assert.equal(((await (await call('/api/themes/eid-lights/publish', { method: 'POST' })).json()) as { result: { version: string } }).result.version, '1.1.0');
    assert.ok(bucket.objects.has('themes/eid-lights/1.0.0/theme.css'));

    // Set as the site theme, with its audit row
    assert.equal((await call('/api/site-settings/theme', { method: 'PUT', body: JSON.stringify({ theme: 'eid-lights' }), headers: { 'content-type': 'application/json' } })).status, 400);
    assert.equal((await call('/api/site-settings/theme', { method: 'PUT', body: JSON.stringify({ theme: 'eid-lights', version: '9.9.9' }), headers: { 'content-type': 'application/json' } })).status, 404);
    const set = await call('/api/site-settings/theme', { method: 'PUT', body: JSON.stringify({ theme: 'eid-lights', version: '1.0.0' }), headers: { 'content-type': 'application/json' } });
    assert.equal(set.status, 200);
    assert.deepEqual(await publicSiteTheme(db, 'https://admin.test'), { theme: 'eid-lights', package: { id: 'eid-lights', version: '1.0.0', css: 'https://admin.test/public/themes/eid-lights/1.0.0/theme.css' } });
    const audit = sqlite.prepare("SELECT key, old_value, new_value FROM site_settings_log WHERE key = 'site.theme'").all();
    assert.deepEqual(audit.map((r) => ({ ...r })), [{ key: 'site.theme', old_value: null, new_value: 'eid-lights@1.0.0' }]);

    // The active theme cannot be deleted
    assert.equal((await call('/api/themes/eid-lights', { method: 'DELETE' })).status, 409);
    await call('/api/site-settings/theme', { method: 'PUT', body: JSON.stringify({ theme: 'fawanees' }), headers: { 'content-type': 'application/json' } });
    const files = [...bucket.objects.keys()].filter((k) => k.startsWith('themes/eid-lights/')).length;
    assert.equal((await call('/api/themes/eid-lights', { method: 'DELETE', body: JSON.stringify({ reason: 'Eid is over' }), headers: { 'content-type': 'application/json' } })).status, 200);

    // Soft delete: hidden from the list, the editor, the public files and the site theme picker; files and rows stay
    const listed = (await (await call('/api/themes')).json()) as { result: { themes: { id: string }[] } };
    assert.equal(listed.result.themes.some((t) => t.id === 'eid-lights'), false);
    assert.equal((await call('/api/themes/eid-lights')).status, 404);
    assert.equal((await call('/api/themes/eid-lights/export')).status, 404);
    assert.equal((await call('/public/themes/eid-lights/1.0.0/theme.css', { roles: '' })).status, 404);
    assert.equal((await call('/api/site-settings/theme', { method: 'PUT', body: JSON.stringify({ theme: 'eid-lights', version: '1.0.0' }), headers: { 'content-type': 'application/json' } })).status, 404);
    assert.equal((await call('/api/themes/eid-lights', { method: 'DELETE' })).status, 404);
    assert.equal((await importCopy(call)).status, 409, 'its id stays taken while it can be restored');
    assert.equal([...bucket.objects.keys()].filter((k) => k.startsWith('themes/eid-lights/')).length, files);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM theme_package_versions').get()!.n, 2);
    const row = sqlite.prepare("SELECT deleted_by, delete_reason FROM theme_packages WHERE id = 'eid-lights'").get();
    assert.deepEqual({ ...row }, { deleted_by: 'admin-1', delete_reason: 'Eid is over' });
    const log = sqlite.prepare("SELECT new_value FROM site_settings_log WHERE key = 'theme.package' ORDER BY rowid").all().map((r) => r.new_value);
    assert.deepEqual(log, ['create eid-lights from fawanees@1.1.0', 'publish eid-lights@1.0.0', 'publish eid-lights@1.1.0', 'delete eid-lights']);
    const trash = sqlite.prepare("SELECT new_value FROM site_settings_log WHERE key = 'trash:theme:eid-lights'").all().map((r) => r.new_value);
    assert.deepEqual(trash, [JSON.stringify({ action: 'delete', reason: 'Eid is over' })]);
  });

  it('built-in themes cannot be deleted; a missing published version falls back to the default', async () => {
    const { call, db, sqlite } = setup();
    assert.equal((await call('/api/themes/fawanees', { method: 'DELETE' })).status, 403);
    sqlite.prepare("INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ('site.theme', 'gone@1.0.0', 'a', 'now')").run();
    assert.deepEqual(await publicSiteTheme(db, 'https://admin.test'), { theme: 'fawanees' });
  });

  it('exports a version as a zip that imports back', async () => {
    const { call } = setup();
    await importCopy(call);
    await call('/api/themes/eid-lights/publish', { method: 'POST' });
    const res = await call('/api/themes/eid-lights/export?version=1.0.0');
    assert.equal(res.headers.get('content-type'), 'application/zip');
    const pkg = await zipToPackage(new Uint8Array(await res.arrayBuffer()));
    assert.equal(pkg.theme.id, 'eid-lights');
    assert.equal(pkg.theme.version, '1.0.0');
    assert.deepEqual(Object.keys(pkg.assets).sort(), Object.keys(fawanees().assets).sort());
    const again = await call('/api/themes/import?id=eid-copy', { method: 'POST', body: new Uint8Array(await (await call('/api/themes/eid-lights/export')).arrayBuffer()) });
    assert.equal(again.status, 201);
  });
});
