/**
 * Mobile apps settings (videos admin → Settings → Mobile apps; shared-types mobile-apps.ts).
 *
 * One JSON document in `site_settings` (key `mobile_apps`). Every change writes its audit row to
 * `site_settings_log` in the same batch, as the site theme does, so neither can happen alone.
 * An unset or unreadable row reads as this environment's defaults (the known bundle ids and
 * packages, no Team ID, no fingerprints, attestation off): nothing is published until the admin
 * fills the values in.
 */
import {
  MOBILE_APPS_SETTING_KEY,
  canonicalMobileAppsSettings,
  defaultMobileAppsSettings,
  parseMobileAppsSettings,
  type MobileAppsEnvironment,
  type MobileAppsSettings,
} from '@al-ummah/shared-types';
import type { AppContext } from '../base';
import { auditOriginJson } from './request-origin';

type Db = AppContext['env']['REPORTS_DB'];

export interface MobileAppsState {
  settings: MobileAppsSettings;
  /** True while nothing has been saved (the values are this environment's defaults). */
  isDefault: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** admin-api ENVIRONMENT → the defaults it gets (QA and local builds carry `.qa`). */
export function mobileAppsEnvironment(value: string | undefined): MobileAppsEnvironment {
  if (value === 'production') return 'production';
  if (value === 'stage' || value === 'staging') return 'stage';
  if (value === 'qa') return 'qa';
  return 'local';
}

export async function readMobileApps(db: Db, environment: MobileAppsEnvironment): Promise<MobileAppsState> {
  const row = await db
    .prepare('SELECT value, updated_by, updated_at FROM site_settings WHERE key = ?')
    .bind(MOBILE_APPS_SETTING_KEY)
    .first<{ value: string; updated_by: string; updated_at: string }>();
  if (!row) return { settings: defaultMobileAppsSettings(environment), isDefault: true, updatedBy: null, updatedAt: null };
  return { settings: parseMobileAppsSettings(row.value, environment), isDefault: false, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

/** Saves the document and its audit row in one batch. False when nothing changed (no row written). */
export async function writeMobileApps(db: Db, settings: MobileAppsSettings, actorId: string, id: string, now: string): Promise<boolean> {
  const value = JSON.stringify(canonicalMobileAppsSettings(settings));
  const current = await db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(MOBILE_APPS_SETTING_KEY).first<{ value: string }>();
  const previous = current?.value ?? null;
  if (previous === value) return false;
  await db.batch([
    db
      .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, MOBILE_APPS_SETTING_KEY, previous, value, actorId, now, auditOriginJson()),
    db
      .prepare(
        'INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at'
      )
      .bind(MOBILE_APPS_SETTING_KEY, value, actorId, now),
  ]);
  return true;
}

export interface MobileAppsChange {
  id: string;
  oldValue: MobileAppsSettings | null;
  newValue: MobileAppsSettings;
  actorId: string;
  createdAt: string;
}

/** The latest changes from the audit log, newest first. */
export async function readMobileAppsHistory(db: Db, environment: MobileAppsEnvironment, limit: number): Promise<MobileAppsChange[]> {
  const { results } = await db
    .prepare('SELECT id, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .bind(MOBILE_APPS_SETTING_KEY, limit)
    .all<{ id: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }>();
  return results.map((r) => ({
    id: r.id,
    oldValue: r.old_value === null ? null : parseMobileAppsSettings(r.old_value, environment),
    newValue: parseMobileAppsSettings(r.new_value, environment),
    actorId: r.actor_id,
    createdAt: r.created_at,
  }));
}
