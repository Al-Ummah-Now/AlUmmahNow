import { DEFAULT_SITE_THEME, SITE_THEME_SETTING_KEY, resolveSiteTheme, type SiteTheme } from '@al-ummah/shared-types';

export interface ThemeState {
  theme: SiteTheme;
  isDefault: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** The current site theme; an unset or unknown stored value is the default. */
export async function readSiteTheme(db: D1Database): Promise<ThemeState> {
  const row = await db
    .prepare('SELECT value, updated_by, updated_at FROM site_settings WHERE key = ?')
    .bind(SITE_THEME_SETTING_KEY)
    .first<{ value: string; updated_by: string; updated_at: string }>();
  if (!row) return { theme: DEFAULT_SITE_THEME, isDefault: true, updatedBy: null, updatedAt: null };
  return { theme: resolveSiteTheme(row.value), isDefault: false, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

/** Saves the theme and its audit row in one batch, so neither can happen alone. */
export async function writeSiteTheme(db: D1Database, theme: SiteTheme, actorId: string, id: string, now: string): Promise<boolean> {
  const current = await db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(SITE_THEME_SETTING_KEY).first<{ value: string }>();
  const previous = current?.value ?? null;
  if ((previous ?? DEFAULT_SITE_THEME) === theme && previous !== null) return false;
  await db.batch([
    db.prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, SITE_THEME_SETTING_KEY, previous, theme, actorId, now),
    db.prepare('INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at').bind(SITE_THEME_SETTING_KEY, theme, actorId, now),
  ]);
  return true;
}
