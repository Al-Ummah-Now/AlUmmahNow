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
import { themeIdBase } from '../src/lib/themePackages';
import siteSettingsRouter from '../src/routers/siteSettings.router';
import { publicSiteTheme, publicSiteThemeRoute } from '../src/lib/siteSettings';
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
    assert.deepEqual(log, [`create eid-lights from fawanees@${fawanees().theme.version}`, 'publish eid-lights@1.0.0', 'publish eid-lights@1.1.0', 'delete eid-lights']);
    const trash = sqlite.prepare("SELECT new_value FROM site_settings_log WHERE key = 'trash:theme:eid-lights'").all().map((r) => r.new_value);
    assert.deepEqual(trash, [JSON.stringify({ action: 'delete', reason: 'Eid is over' })]);
  });

  it('built-in themes cannot be deleted; a missing published version falls back to the default', async () => {
    const { call, db, sqlite } = setup();
    assert.equal((await call('/api/themes/fawanees', { method: 'DELETE' })).status, 403);
    sqlite.prepare("INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ('site.theme', 'gone@1.0.0', 'a', 'now')").run();
    assert.deepEqual(await publicSiteTheme(db, 'https://admin.test'), { theme: 'fawanees' });
  });

  it('a site theme that cannot be read is 503, never the default; no published version is still the default', async () => {
    const { db, sqlite } = setup();
    let failing = /nothing/;
    const flaky = { prepare: (sql: string) => {
      if (!failing.test(sql)) return db.prepare(sql);
      const down: any = { bind: () => down, first: async () => { throw new Error('Network connection lost.'); } };
      return down;
    } };
    const app = new Hono().get('/public/site-theme', (c) => publicSiteThemeRoute(c as never));
    const read = async () => {
      const res = await app.request('https://admin.test/public/site-theme', {}, { REPORTS_DB: flaky });
      return { status: res.status, cache: res.headers.get('cache-control'), body: (await res.json()) as any };
    };
    assert.deepEqual(await read(), { status: 200, cache: 'public, max-age=30', body: { theme: 'fawanees' } });
    sqlite.prepare("INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ('site.theme', 'gone@1.0.0', 'a', 'now')").run();
    assert.deepEqual((await read()).body, { theme: 'fawanees' });
    for (const part of [/FROM site_settings/, /theme_package_versions/]) {
      failing = part;
      const res = await read();
      assert.deepEqual([res.status, res.cache, res.body.code, res.body.theme], [503, 'no-store', 'service_unavailable', undefined]);
    }
  });

  it('rejects unsafe archive assets before creating a draft', async () => {
    const { call, bucket } = setup();
    const { theme } = fawanees();
    theme.id = 'custom-test';
    const assets = { 'assets/test.svg': new TextEncoder().encode('<svg><style>path {fill: red}</style></svg>') };
    const res = await call('/api/themes/import', { method: 'POST', body: packageToZip({ theme, assets }) });
    assert.equal(res.status, 422);
    assert.equal(bucket.objects.size, 0);
  });

  it('rejects invalid archive metadata before making a new id', async () => {
    const { call, bucket } = setup();
    const { theme, assets } = fawanees();
    Object.assign(theme.name, { en: 42 });
    const res = await call('/api/themes/import?newId=1', { method: 'POST', body: packageToZip({ theme, assets }) });
    assert.equal(res.status, 422);
    assert.equal(bucket.objects.size, 0);
  });

  it('requires a known theme.json schema on archive import', async () => {
    const { call, bucket } = setup();
    const { theme, assets } = fawanees();
    theme.id = 'custom-test';
    Object.assign(theme, { legacyField: 'unknown' });
    const res = await call('/api/themes/import', { method: 'POST', body: packageToZip({ theme, assets }) });
    assert.equal(res.status, 422);
    assert.equal(bucket.objects.size, 0);
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

describe('Duplicate makes the theme id from the name (#1479)', () => {
  /** A copy of Fawanees named `en` / `ar`, imported with ?newId=1 (the dialog sends no id). */
  async function duplicateNamed(call: ReturnType<typeof setup>['call'], en: string, ar = 'نسخة') {
    const src = fawanees();
    // The source's id stands in, as the admin page sends it
    const theme = duplicatePackage(src.theme, 'fawanees', { en, ar }, 'admin-1');
    const res = await call('/api/themes/import?newId=1', { method: 'POST', body: packageToZip({ theme, assets: src.assets }), headers: { 'content-type': 'application/zip' } });
    return { res, body: (await res.json()) as { result?: { id: string }; error?: string } };
  }

  it('slugs the English name; Arabic-only and unusable names get a random id', () => {
    assert.equal(themeIdBase('Eid Lights'), 'eid-lights');
    assert.equal(themeIdBase('  Café — Night!! '), 'cafe-night');
    assert.equal(themeIdBase('2026 Ramadan'), 'ramadan', 'starts with a letter');
    assert.equal(themeIdBase('أنوار العيد'), null);
    assert.equal(themeIdBase('أنوار Eid'), 'eid', 'mixed: the Latin words');
    assert.equal(themeIdBase('A'), null, 'too short');
    assert.ok((themeIdBase('x'.repeat(80)) ?? '').length <= 40);
  });

  it('creates the copy under the made id; the stored theme.json carries it', async () => {
    const { call, bucket } = setup();
    const { res, body } = await duplicateNamed(call, 'Eid Lights');
    assert.equal(res.status, 201);
    assert.equal(body.result?.id, 'eid-lights');
    const stored = JSON.parse(new TextDecoder().decode(bucket.objects.get('themes/eid-lights/draft/theme.json')!.bytes)) as ThemePackage;
    assert.equal(stored.id, 'eid-lights');
    assert.equal(stored.basedOn?.startsWith('fawanees@'), true);
  });

  it('an Arabic-only name gets a random theme-… id', async () => {
    const { call } = setup();
    const { res, body } = await duplicateNamed(call, 'أنوار العيد', 'أنوار العيد');
    assert.equal(res.status, 201);
    assert.match(body.result!.id, /^theme-[0-9a-f]{8}$/);
  });

  it('never reuses an id: taken, in Recently deleted, purged, or built in', async () => {
    const { call, sqlite } = setup();
    assert.equal((await duplicateNamed(call, 'Eid Lights')).body.result?.id, 'eid-lights');
    assert.equal((await duplicateNamed(call, 'Eid Lights')).body.result?.id, 'eid-lights-2');
    // Soft-deleted: still taken
    assert.equal((await call('/api/themes/eid-lights-2', { method: 'DELETE', body: JSON.stringify({ reason: 'test' }), headers: { 'content-type': 'application/json' } })).status < 300, true);
    assert.equal((await duplicateNamed(call, 'Eid Lights')).body.result?.id, 'eid-lights-3');
    // Purged (row gone, its create log kept): still never reused
    sqlite.exec("DELETE FROM theme_packages WHERE id = 'eid-lights-3'");
    assert.equal((await duplicateNamed(call, 'Eid Lights')).body.result?.id, 'eid-lights-4');
    // A built-in theme's id is never made
    assert.equal((await duplicateNamed(call, 'Fawanees')).body.result?.id, 'fawanees-2');
  });

  it('the id is immutable: a draft cannot change it', async () => {
    const { call } = setup();
    const { body } = await duplicateNamed(call, 'Eid Lights');
    const draft = (await (await call(`/api/themes/${body.result!.id}`)).json()) as { result: { theme: ThemePackage } };
    const renamed = await call(`/api/themes/${body.result!.id}/draft`, { method: 'PUT', body: JSON.stringify({ ...draft.result.theme, id: 'other-id' }), headers: { 'content-type': 'application/json' } });
    assert.equal(renamed.status, 400);
  });

  it('needs both names', async () => {
    const { call } = setup();
    const { res } = await duplicateNamed(call, '   ');
    assert.equal(res.status, 422);
  });
});

describe('theme art (the sign-in banner\'s, imagery.headerGraphic)', () => {
  const ENV_ROLES = { roles: '' };
  async function publishCopy(call: ReturnType<typeof setup>['call']) {
    await importCopy(call);
    const res = await call('/api/themes/eid-lights/publish', { method: 'POST' });
    assert.equal(res.status, 200);
  }
  /** A version as published before the art part existed: theme.css with no art, no art files */
  function makeLegacy(bucket: BinaryR2) {
    const at = 'themes/eid-lights/1.0.0/';
    const css = new TextDecoder().decode(bucket.objects.get(`${at}theme.css`)!.bytes);
    const legacy = css.slice(0, css.indexOf("html[data-theme='eid-lights'].dark {\n  --fanous-header-graphic"));
    assert.ok(legacy.length > 1000 && !legacy.includes('--fanous-header-graphic:'));
    bucket.objects.set(`${at}theme.css`, { bytes: new TextEncoder().encode(legacy), contentType: 'text/css; charset=utf-8' });
    for (const mode of ['light', 'dark']) bucket.objects.delete(`${at}art/${mode}.svg`);
    return legacy;
  }

  it('publishing writes the art per mode as files the CSS links, with the theme\'s colours written in', async () => {
    const { call, bucket } = setup();
    await publishCopy(call);
    const css = await (await call('/public/themes/eid-lights/1.0.0/theme.css', ENV_ROLES)).text();
    assert.ok(css.includes("html[data-theme='eid-lights'].dark {\n  --fanous-header-graphic: url(\"/api/theme-packages/eid-lights/1.0.0/art/dark.svg\");"));
    assert.ok(css.includes("html[data-theme='eid-lights']:not(.dark) {\n  --fanous-header-graphic: url(\"/api/theme-packages/eid-lights/1.0.0/art/light.svg\");"));
    assert.ok(!css.includes('data:image/svg+xml'), 'a large drawing never swells the stylesheet');
    for (const mode of ['light', 'dark']) {
      const art = await call(`/public/themes/eid-lights/1.0.0/art/${mode}.svg`, ENV_ROLES);
      assert.equal(art.status, 200);
      assert.equal(art.headers.get('content-type'), 'image/svg+xml');
      assert.match(art.headers.get('content-security-policy')!, /default-src 'none'/);
      const svg = await art.text();
      assert.match(svg, /^<svg[\s>]/);
      assert.doesNotMatch(svg, /var\(--fanous/);
    }
    assert.equal((await call('/public/themes/eid-lights/1.0.0/art/other.svg', ENV_ROLES)).status, 404);
    // Not part of the package: an export carries the source files only
    const zip = await zipToPackage(new Uint8Array(await (await call('/api/themes/eid-lights/export?version=1.0.0')).arrayBuffer()));
    assert.ok(!Object.keys(zip.assets).some((p) => p.startsWith('art/')));
    assert.ok(bucket.objects.has('themes/eid-lights/1.0.0/art/dark.svg'));
  });

  it('a version published before the art existed gets it on its first read, once (idempotent)', async () => {
    const { call, bucket, sqlite } = setup();
    await publishCopy(call);
    const legacy = makeLegacy(bucket);

    const first = await call('/public/themes/eid-lights/1.0.0/theme.css', ENV_ROLES);
    assert.equal(first.status, 200);
    assert.match(first.headers.get('cache-control')!, /immutable/);
    const css = await first.text();
    assert.ok(css.startsWith(legacy.trimEnd()), 'the stored CSS is kept as it was, the art added after it');
    assert.ok(css.includes('--fanous-header-graphic: url("/api/theme-packages/eid-lights/1.0.0/art/dark.svg");'));
    assert.equal(new TextDecoder().decode(bucket.objects.get('themes/eid-lights/1.0.0/theme.css')!.bytes), css, 'written back');
    assert.ok(bucket.objects.has('themes/eid-lights/1.0.0/art/light.svg') && bucket.objects.has('themes/eid-lights/1.0.0/art/dark.svg'));

    // Later reads change nothing
    const writes = new Map([...bucket.objects].map(([k, o]) => [k, o.bytes]));
    const again = await (await call('/public/themes/eid-lights/1.0.0/theme.css', ENV_ROLES)).text();
    assert.equal(again, css);
    for (const [k, o] of bucket.objects) assert.equal(o.bytes, writes.get(k), k);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM error_actions WHERE item_key LIKE 'theme-art:%'").get()!.n, 0);
  });

  it('a version published with the art but before the shared header part gets the header part on its first read, once', async () => {
    const { call, bucket } = setup();
    await publishCopy(call);
    const at = 'themes/eid-lights/1.0.0/';
    const published = new TextDecoder().decode(bucket.objects.get(`${at}theme.css`)!.bytes);
    const nav = published.indexOf("html[data-theme='eid-lights']{--aun-header-band:");
    assert.ok(nav > 0, 'publishing writes the header part');
    const withArtOnly = published.slice(0, nav);
    assert.ok(withArtOnly.includes('--fanous-header-graphic:') && !withArtOnly.includes('--aun-header-band:'));
    bucket.objects.set(`${at}theme.css`, { bytes: new TextEncoder().encode(withArtOnly), contentType: 'text/css; charset=utf-8' });
    const art = bucket.objects.get(`${at}art/dark.svg`)!.bytes;

    const css = await (await call('/public/themes/eid-lights/1.0.0/theme.css', ENV_ROLES)).text();
    assert.ok(css.startsWith(withArtOnly.trimEnd()), 'the stored CSS is kept as it was, the header part added after it');
    assert.equal(css.split('--fanous-header-graphic: url(').length, withArtOnly.split('--fanous-header-graphic: url(').length, 'the art is not added twice');
    assert.ok(css.includes("html[data-theme='eid-lights']{--aun-header-band:") && css.includes('--aun-header-edge:'));
    assert.doesNotMatch(css.slice(withArtOnly.length), /var\(--m-/, 'the header part stands alone: no videos materials');
    assert.equal(bucket.objects.get(`${at}art/dark.svg`)!.bytes, art, 'the art files are not rewritten');
    assert.equal(new TextDecoder().decode(bucket.objects.get(`${at}theme.css`)!.bytes), css, 'written back');
    assert.equal(await (await call('/public/themes/eid-lights/1.0.0/theme.css', ENV_ROLES)).text(), css);
  });

  it('when the art cannot be built: served without it on a short cache, the admin flagged, Retry builds it', async () => {
    const { call, bucket, db, sqlite } = setup();
    await publishCopy(call);
    const legacy = makeLegacy(bucket);
    const json = bucket.objects.get('themes/eid-lights/1.0.0/theme.json')!;
    bucket.objects.set('themes/eid-lights/1.0.0/theme.json', { bytes: new TextEncoder().encode('{ not json'), contentType: 'application/json' });

    const res = await call('/public/themes/eid-lights/1.0.0/theme.css', ENV_ROLES);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), legacy);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
    const item = () => sqlite.prepare("SELECT status, source, title, item_url, retry_json FROM error_actions WHERE item_key = 'theme-art:eid-lights@1.0.0'").get() as Record<string, string> | undefined;
    // The flag is reported after the response (waitUntil); give it a turn
    for (let i = 0; i < 20 && !item(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual({ ...item()!, retry_json: JSON.parse(item()!.retry_json) }, { status: 'open', source: 'admin-job', title: 'Theme art not built', item_url: '/site-theme/themes/eid-lights', retry_json: { kind: 'builtin', handler: 'theme-art', args: { id: 'eid-lights', version: '1.0.0' } } });

    // Still broken: Retry says so; fixed: Retry builds it and the item is resolved
    const { BUILTIN_RETRIES } = await import('../src/lib/errors-actions');
    const env = { REPORTS_DB: db, theme_packages: bucket } as never;
    assert.deepEqual((await BUILTIN_RETRIES['theme-art'](env, { id: 'eid-lights', version: '1.0.0' }, 'a1')).status, 'open');
    bucket.objects.set('themes/eid-lights/1.0.0/theme.json', json);
    assert.deepEqual(await BUILTIN_RETRIES['theme-art'](env, { id: 'eid-lights', version: '1.0.0' }, 'a2'), { ok: true, status: 'resolved', result: 'Art built' });
    assert.ok(new TextDecoder().decode(bucket.objects.get('themes/eid-lights/1.0.0/theme.css')!.bytes).includes('--fanous-header-graphic: url('));
    assert.deepEqual(await BUILTIN_RETRIES['theme-art'](env, { id: 'eid-lights', version: '1.0.0' }, 'a3'), { ok: true, status: 'resolved', result: 'The art was already built' });
    assert.equal((await BUILTIN_RETRIES['theme-art'](env, { id: 'eid-lights', version: '9.9.9' }, 'a4')).status, 'dismissed');
    assert.equal((await BUILTIN_RETRIES['theme-art'](env, { id: '../x', version: '1.0.0' }, 'a5')).ok, false);
  });
});
