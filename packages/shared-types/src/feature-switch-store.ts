/**
 * Feature switch storage (FEAT-4, wiki AUN-FEATURES §5.3, decision O39): the `feature_switches` and
 * `feature_switch_changes` tables in the search D1 (api-videos migration 0077), shared by admin-api
 * (writes, history) and api-videos (reads, old-setting overlay).
 *
 * A switch's stored value is its row, else its old setting (`legacy`, read by api-videos), else
 * the registry default. Its effective value also needs every required switch on and no
 * FEATURES_FORCE_OFF override (local stack and E2E: `all` or a comma list of keys). Rows are
 * memoised per isolate for 30 s: every server refuses within 30 s of a change.
 */
import {
  FEATURE_KEYS,
  DEFAULT_FEATURE_SWITCHES,
  FEATURE_REGISTRY,
  effectiveSwitches,
  isFeatureKey,
  type FeatureKey,
  type FeatureSwitches,
} from './feature-registry';

export interface SwitchRow {
  key: FeatureKey;
  enabled: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface SwitchesEnv {
  SEARCH_DB?: unknown;
  /** `all`, or a comma list of keys, forced off whatever is stored (local stack, E2E) */
  FEATURES_FORCE_OFF?: string;
}

interface Db {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results?: T[] }>;
      run(): Promise<unknown>;
    };
    all<T>(): Promise<{ results?: T[] }>;
  };
  batch(statements: unknown[]): Promise<unknown[]>;
}

export const SWITCHES_TTL_MS = 30_000;

let memo: { db: unknown; at: number; rows: ReadonlyMap<FeatureKey, SwitchRow> } | null = null;

/** Drops this isolate's memo (after a write here, and in tests). */
export function forgetFeatureSwitches(): void {
  memo = null;
}

const isMissingTable = (error: unknown) => /no such table/i.test(error instanceof Error ? error.message : String(error));

async function loadRows(db: Db): Promise<Map<FeatureKey, SwitchRow>> {
  const out = new Map<FeatureKey, SwitchRow>();
  try {
    const { results } = await db
      .prepare('SELECT key, enabled, version, updated_by, updated_at FROM feature_switches')
      .all<{ key: string; enabled: number; version: number; updated_by: string; updated_at: string }>();
    for (const r of results ?? []) {
      if (!isFeatureKey(r.key)) continue;
      out.set(r.key, { key: r.key, enabled: r.enabled === 1, version: r.version, updatedBy: r.updated_by, updatedAt: r.updated_at });
    }
  } catch (error) {
    // Before the migration reaches an environment: no rows, the old settings rule
    if (!isMissingTable(error)) throw error;
  }
  return out;
}

/** The stored rows, at most 30 s old (one indexed read per isolate per 30 s). `fresh` skips the memo. */
export async function readSwitchRows(env: SwitchesEnv, opts: { fresh?: boolean; now?: number } = {}): Promise<ReadonlyMap<FeatureKey, SwitchRow>> {
  const db = env.SEARCH_DB as Db | undefined;
  if (!db) return new Map();
  const now = opts.now ?? Date.now();
  if (!opts.fresh && memo && memo.db === db && now - memo.at < SWITCHES_TTL_MS) return memo.rows;
  const rows = await loadRows(db);
  memo = { db, at: now, rows };
  return rows;
}

/** Keys FEATURES_FORCE_OFF turns off. */
export function forcedOff(env: SwitchesEnv): ReadonlySet<FeatureKey> {
  const raw = (env.FEATURES_FORCE_OFF ?? '').trim();
  if (!raw) return new Set();
  if (raw === 'all' || raw === '*') return new Set(FEATURE_KEYS);
  return new Set(raw.split(',').map((k) => k.trim()).filter(isFeatureKey));
}

function storedFrom(rows: ReadonlyMap<FeatureKey, SwitchRow>, legacy: Partial<Record<FeatureKey, boolean>> = {}): FeatureSwitches {
  const out = { ...DEFAULT_FEATURE_SWITCHES };
  for (const key of FEATURE_KEYS) {
    const row = rows.get(key);
    if (row) out[key] = row.enabled;
    else if (typeof legacy[key] === 'boolean') out[key] = legacy[key] as boolean;
  }
  return out;
}

function applyForced(effective: FeatureSwitches, env: SwitchesEnv): FeatureSwitches {
  const forced = forcedOff(env);
  if (!forced.size) return effective;
  const out = { ...effective };
  for (const key of forced) out[key] = false;
  return out;
}

/** Every switch: stored (row, old setting, default) and effective. `legacy` comes from the old readers. */
export async function readFeatureSwitches(
  env: SwitchesEnv,
  legacy: Partial<Record<FeatureKey, boolean>> = {},
  opts: { fresh?: boolean } = {},
): Promise<{ rows: ReadonlyMap<FeatureKey, SwitchRow>; stored: FeatureSwitches; effective: FeatureSwitches; forced: ReadonlySet<FeatureKey> }> {
  const rows = await readSwitchRows(env, opts);
  const stored = storedFrom(rows, legacy);
  return { rows, stored, effective: applyForced(effectiveSwitches(stored), env), forced: forcedOff(env) };
}

export class SwitchWriteError extends Error {
  constructor(
    readonly status: 400 | 409 | 503,
    readonly code: 'invalid_request' | 'feature_changed' | 'unavailable',
    readonly current?: { enabled: boolean; version: number },
  ) {
    super(code);
    this.name = 'SwitchWriteError';
  }
}

export interface SwitchWrite {
  key: string;
  enabled: unknown;
  /** The version the admin saw (0: no row yet) */
  expectedVersion: unknown;
  actorId: string;
  undo?: boolean;
  /** Written by an old settings page's toggle (recorded as source legacy_page) */
  legacyPage?: boolean;
  /** The value in force before the first write (old setting or default), recorded as the previous */
  currentStored: boolean;
  now?: string;
  id?: string;
}

/**
 * Writes one switch and its change in one D1 batch, guarded by the version the admin saw: a
 * stale `expectedVersion` gets 409 feature_changed with the current state, and nothing changes.
 */
export async function writeFeatureSwitch(env: SwitchesEnv, w: SwitchWrite): Promise<{ previous: boolean; enabled: boolean; version: number; changeId: string }> {
  const db = env.SEARCH_DB as Db | undefined;
  if (!db) throw new SwitchWriteError(503, 'unavailable');
  if (!isFeatureKey(w.key) || typeof w.enabled !== 'boolean' || !Number.isInteger(w.expectedVersion) || (w.expectedVersion as number) < 0) {
    throw new SwitchWriteError(400, 'invalid_request');
  }
  const key = w.key;
  const enabled = w.enabled;
  const expected = w.expectedVersion as number;
  const now = w.now ?? new Date().toISOString();
  const changeId = w.id ?? crypto.randomUUID();
  const row = await db.prepare('SELECT enabled, version FROM feature_switches WHERE key = ?').bind(key).first<{ enabled: number; version: number }>();
  const currentVersion = row?.version ?? 0;
  const previous = row ? row.enabled === 1 : w.currentStored;
  if (currentVersion !== expected) throw new SwitchWriteError(409, 'feature_changed', { enabled: previous, version: currentVersion });

  const nextVersion = currentVersion + 1;
  // The upsert only applies at the version read above; the change row is written only when it did
  const upsert = row
    ? db.prepare('UPDATE feature_switches SET enabled = ?, version = ?, updated_by = ?, updated_at = ? WHERE key = ? AND version = ?').bind(enabled ? 1 : 0, nextVersion, w.actorId, now, key, currentVersion)
    : db.prepare('INSERT INTO feature_switches (key, enabled, version, updated_by, updated_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT (key) DO NOTHING').bind(key, enabled ? 1 : 0, w.actorId, now);
  const change = db
    .prepare(
      'INSERT OR IGNORE INTO feature_switch_changes (id, key, version, old_enabled, new_enabled, actor_id, source, created_at) ' +
        'SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM feature_switches WHERE key = ? AND version = ? AND updated_at = ? AND updated_by = ?)',
    )
    .bind(changeId, key, nextVersion, row ? (previous ? 1 : 0) : null, enabled ? 1 : 0, w.actorId, w.undo ? 'undo' : w.legacyPage ? 'legacy_page' : 'features_page', now, key, nextVersion, now, w.actorId);
  await db.batch([upsert, change]);

  const written = await db.prepare('SELECT 1 AS ok FROM feature_switch_changes WHERE id = ?').bind(changeId).first<{ ok: number }>();
  if (!written) {
    const after = await db.prepare('SELECT enabled, version FROM feature_switches WHERE key = ?').bind(key).first<{ enabled: number; version: number }>();
    throw new SwitchWriteError(409, 'feature_changed', { enabled: after ? after.enabled === 1 : previous, version: after?.version ?? 0 });
  }
  forgetFeatureSwitches();
  return { previous, enabled, version: nextVersion, changeId };
}

export interface SwitchChange {
  id: string;
  /** The switch's version after this change */
  version: number;
  oldEnabled: boolean | null;
  newEnabled: boolean;
  actorId: string;
  source: 'features_page' | 'undo' | 'legacy_page' | 'migration';
  createdAt: string;
}

export const HISTORY_PAGE = 50;

/** A switch's changes, newest first (by version), 50 per page; the cursor is the last item's version. */
export async function readSwitchHistory(env: SwitchesEnv, key: string, cursor?: string | null): Promise<{ items: SwitchChange[]; nextCursor: string | null }> {
  const db = env.SEARCH_DB as Db | undefined;
  if (!db || !isFeatureKey(key)) return { items: [], nextCursor: null };
  const before = Number(cursor);
  const params: unknown[] = [key];
  let where = 'key = ?';
  if (cursor && Number.isInteger(before) && before > 0) {
    where += ' AND version < ?';
    params.push(before);
  }
  try {
    const { results } = await db
      .prepare(`SELECT id, version, old_enabled, new_enabled, actor_id, source, created_at FROM feature_switch_changes WHERE ${where} ORDER BY version DESC LIMIT ?`)
      .bind(...params, HISTORY_PAGE + 1)
      .all<{ id: string; version: number; old_enabled: number | null; new_enabled: number; actor_id: string; source: SwitchChange['source']; created_at: string }>();
    const rows = results ?? [];
    const items = rows.slice(0, HISTORY_PAGE).map((r) => ({
      id: r.id,
      version: r.version,
      oldEnabled: r.old_enabled === null ? null : r.old_enabled === 1,
      newEnabled: r.new_enabled === 1,
      actorId: r.actor_id,
      source: r.source,
      createdAt: r.created_at,
    }));
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > HISTORY_PAGE && last ? String(last.version) : null };
  } catch (error) {
    if (isMissingTable(error)) return { items: [], nextCursor: null };
    throw error;
  }
}


export type FeatureGateResult = { on: true } | { on: false; reason: 'switched_off' | 'required_off' | 'env_override' };

/**
 * The server gate as a function (wiki §5.1): routes use it through `requireFeature`, and queue
 * consumers, crons and Durable Objects call it directly. Switches with an old setting count as on
 * while they have no row: the old reader (api-videos overlaySwitch) still decides those.
 */
export async function featureGate(env: SwitchesEnv, key: FeatureKey): Promise<FeatureGateResult> {
  if (forcedOff(env).has(key)) return { on: false, reason: 'env_override' };
  const rows = await readSwitchRows(env);
  const stored = { ...DEFAULT_FEATURE_SWITCHES };
  for (const k of FEATURE_KEYS) {
    const row = rows.get(k);
    if (row) stored[k] = row.enabled;
    else if (LEGACY_KEYS.has(k)) stored[k] = true;
  }
  if (!stored[key]) return { on: false, reason: 'switched_off' };
  if (!effectiveSwitches(stored)[key]) return { on: false, reason: 'required_off' };
  return { on: true };
}

const LEGACY_KEYS: ReadonlySet<FeatureKey> = new Set(FEATURE_REGISTRY.filter((d) => d.legacy).map((d) => d.key));
