import type { AppContext } from '../base';
import { DEFAULT_SITE_THEME, SITE_THEME_SETTING_KEY, parseSiteThemeValue, siteThemeValue, type PublicSiteTheme, type SiteThemeRef } from '@al-ummah/shared-types';

type Db = AppContext['env']['REPORTS_DB'];

export interface ThemeState {
  /** The theme id the site renders: a built-in id or a custom package id */
  theme: string;
  /** The published version of a custom package; null for a built-in */
  version: string | null;
  isDefault: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** The current site theme; an unset or unknown stored value is the default. */
export async function readSiteTheme(db: Db): Promise<ThemeState> {
  const row = await db
    .prepare('SELECT value, updated_by, updated_at FROM site_settings WHERE key = ?')
    .bind(SITE_THEME_SETTING_KEY)
    .first<{ value: string; updated_by: string; updated_at: string }>();
  if (!row) return { theme: DEFAULT_SITE_THEME, version: null, isDefault: true, updatedBy: null, updatedAt: null };
  const ref = parseSiteThemeValue(row.value);
  return { theme: ref.id, version: ref.version, isDefault: false, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

/** Saves the theme and its audit row in one batch, so neither can happen alone. */
export async function writeSiteTheme(db: Db, ref: SiteThemeRef | string, actorId: string, id: string, now: string): Promise<boolean> {
  const theme = siteThemeValue(typeof ref === 'string' ? parseSiteThemeValue(ref) : ref);
  const current = await db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(SITE_THEME_SETTING_KEY).first<{ value: string }>();
  const previous = current?.value ?? null;
  if ((previous ?? DEFAULT_SITE_THEME) === theme && previous !== null) return false;
  await db.batch([
    db.prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, SITE_THEME_SETTING_KEY, previous, theme, actorId, now),
    db.prepare('INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at').bind(SITE_THEME_SETTING_KEY, theme, actorId, now),
  ]);
  return true;
}

export interface ThemeChange {
  id: string;
  oldValue: string | null;
  newValue: string;
  actorId: string;
  createdAt: string;
}

/** The latest theme changes from the audit log, newest first. */
export async function readSiteThemeHistory(db: Db, limit: number): Promise<ThemeChange[]> {
  const { results } = await db
    .prepare('SELECT id, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(SITE_THEME_SETTING_KEY, limit)
    .all<{ id: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }>();
  return results.map((r) => ({ id: r.id, oldValue: r.old_value, newValue: r.new_value, actorId: r.actor_id, createdAt: r.created_at }));
}

/**
 * What the sites render. A custom package whose published version is gone (or never existed) falls
 * back to the default built-in, so a bad setting can never leave the site unstyled.
 */
export async function publicSiteTheme(db: Db, adminApiOrigin: string): Promise<PublicSiteTheme> {
  const { theme, version } = await readSiteTheme(db);
  if (!version) return { theme };
  const published = await db
    .prepare('SELECT version FROM theme_package_versions WHERE theme_id = ? AND version = ?')
    .bind(theme, version)
    .first<{ version: string }>()
    .catch(() => null);
  if (!published) return { theme: DEFAULT_SITE_THEME };
  return { theme, package: { id: theme, version, css: `${adminApiOrigin}/public/themes/${theme}/${version}/theme.css` } };
}
