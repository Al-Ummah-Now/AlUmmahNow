// Theme packages made in the admin theme builder (docs/themes/README.md).
//
// R2 (binding theme_packages):
//   themes/<id>/draft/theme.json, themes/<id>/draft/assets/...      the editable draft
//   themes/<id>/<version>/theme.json, assets/..., theme.css         a published version, never changed
//   themes/<id>/<version>/art/<light|dark>.svg                      its art (imagery.headerGraphic) with its colours
//                                                                   written in, which theme.css names
// D1 (REPORTS_DB): theme_packages and theme_package_versions hold the metadata the lists read.
// Every create, import, publish, delete, restore and purge appends a row to site_settings_log (key theme.package).
// Delete is a soft delete (migration 0013): the theme leaves every list, the editor, the public files and the
// site theme picker, and can be restored for 30 days. purge() (run only by the cleanup, lib/trash.ts) is the
// only code that removes its R2 files and rows.
import {
  BUILT_IN_IDS,
  ID_PATTERN,
  SCHEMA,
  checkSchema,
  artSvgPaths,
  MAX_ASSET_BYTES,
  MAX_PACKAGE_BYTES,
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
import { auditOriginJson } from './request-origin';
import { logger } from './logger';

type Db = AdminBindings['REPORTS_DB'];

export const THEME_LOG_KEY = 'theme.package';
/** importZip's rename value that asks for an id made from the name (never a valid id itself). */
export const NEW_THEME_ID = '*new';

/**
 * A new theme's id base from its English name (admins never type ids, #1479; the rule Add tier
 * follows, #1443): lowercase ASCII words joined by dashes, at most 40 characters, starting with a
 * letter. Null when the name has no usable Latin letters (an Arabic-only name): a random id then.
 */
export function themeIdBase(name: string): string | null {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '')
    .slice(0, 36)
    .replace(/-+$/, '');
  return ID_PATTERN.test(slug) ? slug : null;
}

const randomThemeId = () => `theme-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
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
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
  purge_requested_at?: string | null;
  purge_requested_by?: string | null;
  purge_started_at?: string | null;
}
export interface VersionRow { theme_id: string; version: string; size_bytes: number; published_by: string; published_at: string }

export class ThemeError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413 | 422, message: string, readonly issues: Issue[] = []) {
    super(message);
  }
}

const prefix = (id: string, version: 'draft' | string) => `themes/${id}/${version}/`;
const bytesOf = (s: string) => new TextEncoder().encode(s);
const IMMUTABLE_FILE = 'public, max-age=31536000, immutable';
const CSS_TYPE = 'text/css; charset=utf-8';
/** The published files theme.css names for the art, one per mode (served beside the assets) */
export const ART_PATH = /^art\/(light|dark)\.svg$/;
/** theme.css carries the art part (compile.ts artCss) once this is in it */
export const ART_MARKER = '--fanous-header-graphic:';
/** theme.css carries the shared header part (compile.ts navCss: band, edge, control font) once this is in it */
export const NAV_MARKER = '--aun-header-band:';

/**
 * A version's CSS with its art: the art is compiled from the package's own SVG with the theme's colours
 * written in, and kept as files (art/<mode>.svg) the CSS links, so a large drawing never swells the
 * stylesheet (the videos site refuses one over 1 MB) and is fetched only where it is painted.
 */
export function compileVersion(theme: ThemePackage, id: string, version: string, svgText: (path: string) => string | undefined) {
  const art: Record<string, string> = {};
  const compiled = compilePackage(theme, {
    assetUrl: publicAssetUrl(id, version),
    svgText,
    artUrl: (mode, svg) => { art[`art/${mode}.svg`] = svg; return publicAssetUrl(id, version)(`art/${mode}.svg`); },
  });
  return { css: compiled.css, artCss: compiled.art, navCss: compiled.nav, art };
}

export class ThemeStore {
  constructor(private readonly db: Db, private readonly bucket: R2Bucket) {}

  async list(): Promise<(ThemeRow & { versions: VersionRow[] })[]> {
    const { results: themes } = await this.db.prepare('SELECT * FROM theme_packages WHERE deleted_at IS NULL ORDER BY created_at, id').all<ThemeRow>();
    const { results: versions } = await this.db.prepare('SELECT * FROM theme_package_versions ORDER BY published_at DESC').all<VersionRow>();
    return themes.map((t) => ({ ...t, versions: versions.filter((v) => v.theme_id === t.id) }));
  }

  /** A theme that is not soft-deleted, with its versions, or null. */
  async get(id: string): Promise<(ThemeRow & { versions: VersionRow[] }) | null> {
    const row = await this.db.prepare('SELECT * FROM theme_packages WHERE id = ? AND deleted_at IS NULL').bind(id).first<ThemeRow>();
    if (!row) return null;
    const { results } = await this.db.prepare('SELECT * FROM theme_package_versions WHERE theme_id = ? ORDER BY published_at DESC').bind(id).all<VersionRow>();
    return { ...row, versions: results };
  }

  /** The theme's row, deleted or not. */
  private async row(id: string): Promise<ThemeRow | null> {
    return this.db.prepare('SELECT * FROM theme_packages WHERE id = ?').bind(id).first<ThemeRow>();
  }

  /** True when the theme exists and is not soft-deleted (public files of a deleted theme are not served). */
  async isLive(id: string): Promise<boolean> {
    return !!(await this.db.prepare('SELECT 1 AS ok FROM theme_packages WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ ok: number }>());
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

  /**
   * A published version's theme.css. Versions published before the art part, or before the shared
   * header part (the band, edge and control font aun-nav.css reads), existed lack it: each missing
   * part is built here, from the version's own theme.json and SVG files, on the first read, and written
   * back (art files first, then the CSS), so every later read is a plain file read. Idempotent: two reads
   * at once write the same bytes, and a CSS that has both parts is never touched. If building fails the
   * stored CSS is served as it is (the banner shows no art, the header its plain nav colour), `art` says
   * so (the caller flags the admin), and the next read or the admin's Retry tries again.
   */
  async publishedCss(id: string, version: string): Promise<{ css: string; etag: string; art: 'present' | 'added' | 'failed'; error?: string } | null> {
    const at = prefix(id, version);
    const obj = await this.bucket.get(`${at}theme.css`);
    if (!obj) return null;
    const stored = await obj.text();
    const hasArt = stored.includes(ART_MARKER);
    const hasNav = stored.includes(NAV_MARKER);
    if (hasArt && hasNav) return { css: stored, etag: obj.httpEtag, art: 'present' };
    try {
      const json = await this.bucket.get(`${at}theme.json`);
      if (!json) throw new Error('theme.json is missing');
      const theme = (await json.json()) as ThemePackage;
      const svgs: Record<string, string> = {};
      if (!hasArt) {
        for (const path of artSvgPaths(theme)) {
          const file = ASSET_PATH.test(path) ? await this.bucket.get(`${at}${path}`) : null;
          if (file) svgs[path] = await file.text();
        }
      }
      const { artCss, navCss, art } = compileVersion(theme, id, version, (path) => svgs[path]);
      if (!hasArt) for (const [path, svg] of Object.entries(art)) await this.bucket.put(`${at}${path}`, bytesOf(svg), { httpMetadata: { contentType: 'image/svg+xml', cacheControl: IMMUTABLE_FILE } });
      const css = `${stored.replace(/\n*$/, '\n')}${hasArt ? '' : artCss}${hasNav ? '' : navCss}`;
      const put = await this.bucket.put(`${at}theme.css`, bytesOf(css), { httpMetadata: { contentType: CSS_TYPE, cacheControl: IMMUTABLE_FILE } });
      logger.info('[Themes] Added the parts a version published before them lacked', { id, version, art: !hasArt, header: !hasNav, files: hasArt ? [] : Object.keys(art) });
      return { css, etag: put?.httpEtag ?? obj.httpEtag, art: 'added' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[Themes] Could not add the art to a published version; serving its CSS without it', { id, version, error: message });
      return { css: stored, etag: obj.httpEtag, art: 'failed', error: message };
    }
  }

  private log(id: string, entry: string, actor: string, now: string) {
    return this.db
      .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), THEME_LOG_KEY, id, entry, actor, now, auditOriginJson());
  }

  /** True when the id was ever used: built in, a theme (also in Recently deleted), or one purged since (its create log). */
  private async idTaken(id: string): Promise<boolean> {
    if (BUILT_IN_IDS.includes(id)) return true;
    if (await this.row(id)) return true;
    // idx_site_settings_log_key: only this key's rows are read
    return !!(await this.db
      .prepare("SELECT 1 AS n FROM site_settings_log WHERE key = ? AND old_value = ? AND new_value LIKE 'create %' LIMIT 1")
      .bind(THEME_LOG_KEY, id)
      .first());
  }

  /** A new theme's id, made from its name and never reused (the slug, then slug-2…, else a random id). */
  async newId(name: string): Promise<string> {
    const base = themeIdBase(name);
    if (base) {
      for (let n = 1; n <= 20; n++) {
        const id = n === 1 ? base : `${base}-${n}`;
        if (!(await this.idTaken(id))) return id;
      }
    }
    for (;;) {
      const id = randomThemeId();
      if (!(await this.idTaken(id))) return id;
    }
  }

  /** A new custom theme from a whole package (duplicate or import). Its draft is the package. */
  async create(files: PackageFiles, actor: string, now: string): Promise<Validation> {
    const { theme } = files;
    if (typeof theme?.id !== 'string' || !ID_PATTERN.test(theme.id)) throw new ThemeError(400, 'id must be 2-40 lowercase letters, digits or dashes, starting with a letter');
    if (BUILT_IN_IDS.includes(theme.id)) throw new ThemeError(409, `${theme.id} is a built-in theme; choose another id`);
    const existing = await this.row(theme.id);
    if (existing?.deleted_at) throw new ThemeError(409, `A deleted theme with id ${theme.id} is in Recently deleted; restore it or choose another id`);
    if (existing) throw new ThemeError(409, `A theme with id ${theme.id} already exists`);
    let size = 0;
    for (const [path, bytes] of Object.entries(files.assets)) {
      checkAsset(path, bytes);
      size += bytes.byteLength;
    }
    if (size > MAX_PACKAGE_BYTES) throw new ThemeError(413, 'The assets are larger than 12 MB');
    const draft: ThemePackage = { ...theme, kind: 'custom' };
    const validation = validatePackage(draft, { assets: files.assets });
    // A draft may be incomplete; only the schema's shape for the list (id and names) is required
    if (!hasThemeNames(draft) || (draft.basedOn !== undefined && checkSchema(draft.basedOn, SCHEMA.properties.basedOn).length)) {
      throw new ThemeError(422, 'The package needs valid metadata', validation.errors);
    }
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
    if (!hasThemeNames(draft)) throw new ThemeError(422, 'The package needs name.en and name.ar');
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
    checkAsset(path, bytes);
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
    const svgText = (path: string) => (path.endsWith('.svg') && files.assets[path] ? new TextDecoder().decode(files.assets[path]) : undefined);
    const { css, art } = compileVersion(theme, id, version, svgText);
    const at = prefix(id, version);
    let size = 0;
    for (const [path, bytes] of Object.entries(files.assets)) {
      size += bytes.byteLength;
      await this.bucket.put(`${at}${path}`, bytes, { httpMetadata: { contentType: contentTypeOf(path), cacheControl: 'public, max-age=31536000, immutable' } });
    }
    for (const [path, svg] of Object.entries(art)) await this.bucket.put(`${at}${path}`, bytesOf(svg), { httpMetadata: { contentType: 'image/svg+xml', cacheControl: IMMUTABLE_FILE } });
    await this.bucket.put(`${at}theme.json`, bytesOf(JSON.stringify(theme, null, 2)), { httpMetadata: { contentType: 'application/json' } });
    // theme.css last: a version is served only once its CSS exists
    await this.bucket.put(`${at}theme.css`, bytesOf(css), { httpMetadata: { contentType: CSS_TYPE, cacheControl: IMMUTABLE_FILE } });
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

  /**
   * A new custom theme from a .zip. rename: the id to use instead of the package's; 'new' makes one
   * from the package's English name (Duplicate: the admin never types an id, #1479).
   */
  async importZip(zip: Uint8Array, rename: string | undefined, actor: string, now: string): Promise<{ id: string; validation: Validation }> {
    let files: PackageFiles;
    try { files = await zipToPackage(zip); } catch (e) { throw new ThemeError(400, (e as Error).message); }
    if (rename === NEW_THEME_ID) {
      const name = files.theme?.name;
      if (typeof name?.en !== 'string' || typeof name.ar !== 'string' || !name.en.trim() || !name.ar.trim()) {
        throw new ThemeError(422, 'The package needs name.en and name.ar');
      }
      rename = await this.newId(name.en);
    }
    if (rename) files = { ...files, theme: { ...files.theme, id: rename } };
    const issues = checkSchema({ ...files.theme, kind: 'custom' }, SCHEMA);
    if (issues.length) throw new ThemeError(422, 'Invalid theme.json', issues);
    const validation = await this.create(files, actor, now);
    return { id: files.theme.id, validation };
  }

  /** The site theme's id, from site_settings. */
  private async activeId(): Promise<string | null> {
    const active = await this.db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(SITE_THEME_SETTING_KEY).first<{ value: string }>();
    return active ? parseSiteThemeValue(active.value).id : null;
  }

  /**
   * Admin delete (soft): hides a custom theme everywhere and keeps its files and rows for 30 days.
   * Never a built-in or the site theme (the site would lose its styling).
   */
  async remove(id: string, actor: string, now: string, reason: string | null = null): Promise<void> {
    if (BUILT_IN_IDS.includes(id)) throw new ThemeError(403, 'Built-in themes cannot be deleted');
    if (!(await this.get(id))) throw new ThemeError(404, `No custom theme ${id}`);
    if ((await this.activeId()) === id) throw new ThemeError(409, `${id} is the site theme; choose another site theme first`);
    await this.db.batch([
      this.db
        .prepare('UPDATE theme_packages SET deleted_at = ?, deleted_by = ?, delete_reason = ?, purge_requested_at = NULL, purge_requested_by = NULL WHERE id = ? AND deleted_at IS NULL')
        .bind(now, actor, reason, id),
      this.log(id, `delete ${id}`, actor, now),
    ]);
  }

  /** Soft-deleted themes, most recently deleted first. */
  async listDeleted(limit = 100): Promise<ThemeRow[]> {
    const { results } = await this.db.prepare('SELECT * FROM theme_packages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id LIMIT ?').bind(limit).all<ThemeRow>();
    return results ?? [];
  }

  /** Brings a soft-deleted theme back (also when queued for permanent deletion). */
  async restore(id: string, actor: string, now: string): Promise<void> {
    const row = await this.row(id);
    if (!row?.deleted_at) throw new ThemeError(404, `No deleted theme ${id}`);
    if (row.purge_started_at) throw new ThemeError(409, `${id} is being deleted permanently and can no longer be restored`);
    await this.db.batch([
      this.db
        .prepare('UPDATE theme_packages SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, purge_requested_at = NULL, purge_requested_by = NULL WHERE id = ? AND deleted_at IS NOT NULL AND purge_started_at IS NULL')
        .bind(id),
      this.log(id, `restore ${id}`, actor, now),
    ]);
  }

  /** "Delete permanently now": queues a soft-deleted theme for the next cleanup; nothing is removed here. */
  async requestPurge(id: string, actor: string, now: string): Promise<void> {
    const row = await this.row(id);
    if (!row?.deleted_at) throw new ThemeError(404, `No deleted theme ${id}`);
    await this.db
      .prepare('UPDATE theme_packages SET purge_requested_at = COALESCE(purge_requested_at, ?), purge_requested_by = COALESCE(purge_requested_by, ?) WHERE id = ? AND deleted_at IS NOT NULL')
      .bind(now, actor, id)
      .run();
  }

  /**
   * The cleanup's purge, the only code that removes a custom theme: for up to `limit` soft-deleted
   * themes deleted at or before `cutoff` or queued for permanent deletion (or whose purge started),
   * claims the row (purge_started_at: no restore from here on), deletes the R2 files
   * (themes/<id>/...) and then the rows. Idempotent: an interrupted purge keeps its claimed row and
   * the next run finishes it. A theme that is somehow the site theme is skipped.
   */
  async purge(cutoff: string, actor: string, now: string, limit: number): Promise<{ purged: string[]; failed: { id: string; error: string }[] }> {
    const { results } = await this.db
      .prepare('SELECT id FROM theme_packages WHERE deleted_at IS NOT NULL AND (deleted_at <= ? OR purge_requested_at IS NOT NULL OR purge_started_at IS NOT NULL) ORDER BY deleted_at LIMIT ?')
      .bind(cutoff, limit)
      .all<{ id: string }>();
    const purged: string[] = [];
    const failed: { id: string; error: string }[] = [];
    const active = await this.activeId();
    for (const { id } of results ?? []) {
      if (id === active || BUILT_IN_IDS.includes(id)) {
        failed.push({ id, error: 'is the site theme' });
        continue;
      }
      try {
        await this.db.prepare('UPDATE theme_packages SET purge_started_at = COALESCE(purge_started_at, ?) WHERE id = ? AND deleted_at IS NOT NULL').bind(now, id).run();
        const claimed = await this.row(id);
        if (!claimed?.deleted_at || !claimed.purge_started_at) continue;
        const keys = await this.keys(`themes/${id}/`);
        for (let i = 0; i < keys.length; i += 1000) await this.bucket.delete(keys.slice(i, i + 1000));
        await this.db.batch([
          this.db.prepare('DELETE FROM theme_package_versions WHERE theme_id = ? AND EXISTS (SELECT 1 FROM theme_packages WHERE id = ? AND deleted_at IS NOT NULL)').bind(id, id),
          this.db.prepare('DELETE FROM theme_packages WHERE id = ? AND deleted_at IS NOT NULL').bind(id),
          this.log(id, `purge ${id}`, actor, now),
        ]);
        purged.push(id);
      } catch (error) {
        failed.push({ id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { purged, failed };
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

function hasThemeNames(theme: ThemePackage): boolean {
  return typeof theme.name?.en === 'string' && typeof theme.name?.ar === 'string'
    && theme.name.en.length <= 80 && theme.name.ar.length <= 80;
}

function checkAsset(path: string, bytes: Uint8Array): void {
  if (!ASSET_PATH.test(path) || path.split('/').some((part) => !part || part === '.')) {
    throw new ThemeError(400, 'The package contains an invalid asset path');
  }
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new ThemeError(413, 'The asset is larger than 2 MB');
  const problem = assetProblem(path, bytes);
  if (problem) throw new ThemeError(422, `${path} ${problem}`);
}
