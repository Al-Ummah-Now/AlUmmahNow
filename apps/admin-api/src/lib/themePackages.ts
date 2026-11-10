// Theme packages made in the admin theme builder (docs/themes/README.md).
//
// R2 (binding theme_packages):
//   themes/<id>/draft/theme.json, themes/<id>/draft/assets/...      the editable draft
//   themes/<id>/<version>/theme.json, assets/..., theme.css         a published version, never changed
// D1 (REPORTS_DB): theme_packages and theme_package_versions hold the metadata the lists read.
// Every create, import, publish and delete appends a row to site_settings_log (key theme.package).
import {
  BUILT_IN_IDS,
  ID_PATTERN,
  MAX_ASSET_BYTES,
  sniff,
  svgProblem,
  compilePackage,
  nextVersion,
  packageToZip,
  validatePackage,
  zipToPackage,
  type Issue,
  type PackageFiles,
  type ThemePackage,
  type Validation,
} from '@al-ummah/theme-packages';
import { SITE_THEME_SETTING_KEY, parseSiteThemeValue } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';

type Db = AdminBindings['REPORTS_DB'];

export const THEME_LOG_KEY = 'theme.package';
export const ASSET_PATH = /^assets\/(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9._/-]*\.(svg|png|jpg|jpeg|webp|ico|woff2)$/;
const CONTENT_TYPES: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2',
};
export const contentTypeOf = (path: string) => CONTENT_TYPES[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

/** Where the videos site serves a published package's assets (it proxies them from this API). */
export const publicAssetUrl = (id: string, version: string) => (path: string) => `/api/theme-packages/${id}/${version}/${path}`;

export interface ThemeRow {
  id: string;
  name_en: string;
  name_ar: string;
  based_on: string | null;
  latest_version: string | null;
  draft_updated_by: string;
  draft_updated_at: string;
  created_by: string;
  created_at: string;
}
export interface VersionRow { theme_id: string; version: string; size_bytes: number; published_by: string; published_at: string }

export class ThemeError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413 | 422, message: string, readonly issues: Issue[] = []) {
    super(message);
  }
}

const prefix = (id: string, version: 'draft' | string) => `themes/${id}/${version}/`;
const bytesOf = (s: string) => new TextEncoder().encode(s);

export class ThemeStore {
  constructor(private readonly db: Db, private readonly bucket: R2Bucket) {}

  async list(): Promise<(ThemeRow & { versions: VersionRow[] })[]> {
    const { results: themes } = await this.db.prepare('SELECT * FROM theme_packages ORDER BY created_at, id').all<ThemeRow>();
    const { results: versions } = await this.db.prepare('SELECT * FROM theme_package_versions ORDER BY published_at DESC').all<VersionRow>();
    return themes.map((t) => ({ ...t, versions: versions.filter((v) => v.theme_id === t.id) }));
  }

  async get(id: string): Promise<(ThemeRow & { versions: VersionRow[] }) | null> {
    const row = await this.db.prepare('SELECT * FROM theme_packages WHERE id = ?').bind(id).first<ThemeRow>();
    if (!row) return null;
    const { results } = await this.db.prepare('SELECT * FROM theme_package_versions WHERE theme_id = ? ORDER BY published_at DESC').bind(id).all<VersionRow>();
    return { ...row, versions: results };
  }

  async version(id: string, version: string): Promise<VersionRow | null> {
    return this.db.prepare('SELECT * FROM theme_package_versions WHERE theme_id = ? AND version = ?').bind(id, version).first<VersionRow>();
  }

  /** Every file under a prefix, by path relative to it. */
  private async files(at: string): Promise<Record<string, Uint8Array>> {
    const out: Record<string, Uint8Array> = {};
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix: at, cursor });
      for (const obj of page.objects) {
        const body = await this.bucket.get(obj.key);
        if (body) out[obj.key.slice(at.length)] = new Uint8Array(await body.arrayBuffer());
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  private async keys(at: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix: at, cursor });
      keys.push(...page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return keys;
  }

  /** A package as stored: theme.json and its assets. */
  async load(id: string, version: 'draft' | string): Promise<PackageFiles | null> {
    const all = await this.files(prefix(id, version));
    if (!all['theme.json']) return null;
    const theme = JSON.parse(new TextDecoder().decode(all['theme.json'])) as ThemePackage;
    const assets = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('assets/')));
    return { theme, assets };
  }

  async draftTheme(id: string): Promise<ThemePackage | null> {
    const obj = await this.bucket.get(`${prefix(id, 'draft')}theme.json`);
    return obj ? ((await obj.json()) as ThemePackage) : null;
  }

  async draftAssets(id: string): Promise<{ path: string; size: number }[]> {
    const at = `${prefix(id, 'draft')}assets/`;
    const out: { path: string; size: number }[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix: at, cursor });
      out.push(...page.objects.map((o) => ({ path: o.key.slice(prefix(id, 'draft').length), size: o.size })));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async getObject(id: string, version: 'draft' | string, path: string): Promise<R2ObjectBody | null> {
    return this.bucket.get(`${prefix(id, version)}${path}`);
  }

  private log(id: string, entry: string, actor: string, now: string) {
    return this.db
      .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), THEME_LOG_KEY, id, entry, actor, now);
  }

  /** A new custom theme from a whole package (duplicate or import). Its draft is the package. */
  async create(files: PackageFiles, actor: string, now: string): Promise<Validation> {
    const { theme } = files;
    if (typeof theme?.id !== 'string' || !ID_PATTERN.test(theme.id)) throw new ThemeError(400, 'id must be 2-40 lowercase letters, digits or dashes, starting with a letter');
    if (BUILT_IN_IDS.includes(theme.id)) throw new ThemeError(409, `${theme.id} is a built-in theme; choose another id`);
    if (await this.get(theme.id)) throw new ThemeError(409, `A theme with id ${theme.id} already exists`);
    for (const path of Object.keys(files.assets)) if (!ASSET_PATH.test(path)) throw new ThemeError(400, `${path} is not an allowed asset path`);
    const draft: ThemePackage = { ...theme, kind: 'custom' };
    const validation = validatePackage(draft, { assets: files.assets });
    // A draft may be incomplete; only the schema's shape for the list (id and names) is required
    if (!draft.name?.en || !draft.name?.ar) throw new ThemeError(422, 'The package needs name.en and name.ar', validation.errors);
    const at = prefix(theme.id, 'draft');
    await Promise.all(Object.entries(files.assets).map(([path, bytes]) => this.bucket.put(`${at}${path}`, bytes, { httpMetadata: { contentType: contentTypeOf(path) } })));
    await this.bucket.put(`${at}theme.json`, bytesOf(JSON.stringify(draft, null, 2)), { httpMetadata: { contentType: 'application/json' } });
    await this.db.batch([
      this.db
        .prepare('INSERT INTO theme_packages (id, name_en, name_ar, based_on, latest_version, draft_updated_by, draft_updated_at, created_by, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)')
        .bind(theme.id, draft.name.en, draft.name.ar, draft.basedOn ?? null, actor, now, actor, now),
      this.log(theme.id, `create ${theme.id}${draft.basedOn ? ` from ${draft.basedOn}` : ''}`, actor, now),
    ]);
    return validation;
  }

  async saveDraft(id: string, theme: ThemePackage, actor: string, now: string): Promise<Validation> {
    const row = await this.get(id);
    if (!row) throw new ThemeError(404, `No custom theme ${id}`);
    if (theme?.id !== id) throw new ThemeError(400, `theme.json id must stay ${id}`);
    const draft: ThemePackage = { ...theme, kind: 'custom' };
    const assets = await this.files(`${prefix(id, 'draft')}assets/`);
    const validation = validatePackage(draft, { assets: Object.fromEntries(Object.entries(assets).map(([k, v]) => [`assets/${k}`, v])) });
    await this.bucket.put(`${prefix(id, 'draft')}theme.json`, bytesOf(JSON.stringify(draft, null, 2)), { httpMetadata: { contentType: 'application/json' } });
    await this.db
      .prepare('UPDATE theme_packages SET name_en = ?, name_ar = ?, draft_updated_by = ?, draft_updated_at = ? WHERE id = ?')
      .bind(draft.name?.en || row.name_en, draft.name?.ar || row.name_ar, actor, now, id)
      .run();
    return validation;
  }

  async putAsset(id: string, path: string, bytes: Uint8Array, actor: string, now: string): Promise<void> {
    if (!(await this.get(id))) throw new ThemeError(404, `No custom theme ${id}`);
    if (!ASSET_PATH.test(path)) throw new ThemeError(400, `${path} is not an allowed asset path (assets/…, .svg .png .jpg .webp .ico .woff2)`);
    const check = assetProblem(path, bytes);
    if (check) throw new ThemeError(check.startsWith('is ') && check.includes('MB') ? 413 : 422, `${path} ${check}`);
    await this.bucket.put(`${prefix(id, 'draft')}${path}`, bytes, { httpMetadata: { contentType: contentTypeOf(path) } });
    await this.db.prepare('UPDATE theme_packages SET draft_updated_by = ?, draft_updated_at = ? WHERE id = ?').bind(actor, now, id).run();
  }

  async deleteAsset(id: string, path: string): Promise<void> {
    if (!(await this.get(id))) throw new ThemeError(404, `No custom theme ${id}`);
    if (!ASSET_PATH.test(path)) throw new ThemeError(400, `${path} is not an allowed asset path`);
    await this.bucket.delete(`${prefix(id, 'draft')}${path}`);
  }

  /** Validates the draft with its files, then writes it as the next version with its compiled CSS. */
  async publish(id: string, actor: string, now: string): Promise<{ version: string; validation: Validation }> {
    const row = await this.get(id);
    if (!row) throw new ThemeError(404, `No custom theme ${id}`);
    const files = await this.load(id, 'draft');
    if (!files) throw new ThemeError(404, `${id} has no draft`);
    const version = nextVersion(row.versions.map((v) => v.version));
    const theme: ThemePackage = { ...files.theme, id, kind: 'custom', version };
    const validation = validatePackage(theme, { assets: files.assets });
    if (!validation.ok) throw new ThemeError(422, 'The draft has errors; fix them before publishing', validation.errors);
    const css = compilePackage(theme, { assetUrl: publicAssetUrl(id, version) }).css;
    const at = prefix(id, version);
    let size = 0;
    for (const [path, bytes] of Object.entries(files.assets)) {
      size += bytes.byteLength;
      await this.bucket.put(`${at}${path}`, bytes, { httpMetadata: { contentType: contentTypeOf(path), cacheControl: 'public, max-age=31536000, immutable' } });
    }
    await this.bucket.put(`${at}theme.json`, bytesOf(JSON.stringify(theme, null, 2)), { httpMetadata: { contentType: 'application/json' } });
    // theme.css last: a version is served only once its CSS exists
    await this.bucket.put(`${at}theme.css`, bytesOf(css), { httpMetadata: { contentType: 'text/css; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' } });
    await this.bucket.put(`${prefix(id, 'draft')}theme.json`, bytesOf(JSON.stringify(theme, null, 2)), { httpMetadata: { contentType: 'application/json' } });
    await this.db.batch([
      this.db.prepare('INSERT INTO theme_package_versions (theme_id, version, size_bytes, published_by, published_at) VALUES (?, ?, ?, ?, ?)').bind(id, version, size, actor, now),
      this.db.prepare('UPDATE theme_packages SET latest_version = ?, name_en = ?, name_ar = ? WHERE id = ?').bind(version, theme.name.en, theme.name.ar, id),
      this.log(id, `publish ${id}@${version}`, actor, now),
    ]);
    return { version, validation };
  }

  async exportZip(id: string, version: 'draft' | string): Promise<Uint8Array | null> {
    const files = await this.load(id, version);
    return files ? packageToZip(files) : null;
  }

  async importZip(zip: Uint8Array, rename: string | undefined, actor: string, now: string): Promise<{ id: string; validation: Validation }> {
    let files: PackageFiles;
    try { files = await zipToPackage(zip); } catch (e) { throw new ThemeError(400, (e as Error).message); }
    if (rename) files = { ...files, theme: { ...files.theme, id: rename } };
    const validation = await this.create(files, actor, now);
    return { id: files.theme.id, validation };
  }

  /** Removes a custom theme, its versions and files. Never a built-in or the active theme. */
  async remove(id: string, actor: string, now: string): Promise<void> {
    if (BUILT_IN_IDS.includes(id)) throw new ThemeError(403, 'Built-in themes cannot be deleted');
    if (!(await this.get(id))) throw new ThemeError(404, `No custom theme ${id}`);
    const active = await this.db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(SITE_THEME_SETTING_KEY).first<{ value: string }>();
    if (active && parseSiteThemeValue(active.value).id === id) throw new ThemeError(409, `${id} is the site theme; choose another site theme first`);
    const keys = await this.keys(`themes/${id}/`);
    for (let i = 0; i < keys.length; i += 1000) await this.bucket.delete(keys.slice(i, i + 1000));
    await this.db.batch([
      this.db.prepare('DELETE FROM theme_package_versions WHERE theme_id = ?').bind(id),
      this.db.prepare('DELETE FROM theme_packages WHERE id = ?').bind(id),
      this.log(id, `delete ${id}`, actor, now),
    ]);
  }
}

const EXPECTED: Record<string, string> = { svg: 'svg', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', ico: 'ico', woff2: 'woff2' };
export function assetProblem(path: string, bytes: Uint8Array): string | undefined {
  if (bytes.byteLength > MAX_ASSET_BYTES) return `is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is 2 MB per file`;
  const ext = path.split('.').pop()!.toLowerCase();
  if (sniff(bytes) !== EXPECTED[ext]) return `is not a real .${ext} file`;
  if (ext === 'svg') return svgProblem(new TextDecoder().decode(bytes));
  return undefined;
}
