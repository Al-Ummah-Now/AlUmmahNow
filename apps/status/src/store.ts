/**
 * STATUS_DB access (migrations/0001_status.sql). The cron writes
 * component_state and daily; admin-api writes incidents and incident_updates.
 */
import { isClosedStatus, type IncidentImpact, type IncidentKind, type IncidentStatus, type StatusComponentId } from '@al-ummah/shared-types';
import type { ComponentResult, RawState } from './checks';
import type { CheckedState, DayCounts, StoredState } from './state';

export interface StateRow extends StoredState {
  component: StatusComponentId;
  checked_at: string;
  latency_ms: number | null;
  detail: string | null;
  alert_open: number;
}

export async function loadStates(db: D1Database): Promise<Map<string, StateRow>> {
  const rows = (await db.prepare('SELECT component, state, raw, streak, since, checked_at, latency_ms, detail, alert_open FROM component_state').all<StateRow>()).results ?? [];
  return new Map(rows.map((r) => [r.component, r]));
}

export interface RunWrite {
  result: ComponentResult;
  next: StoredState;
  alertOpen: boolean;
  /** Which daily column this run counts in */
  bucket: CheckedState | 'maintenance' | 'unknown';
}

/** One D1 batch per run: the current state rows and today's counters. */
export async function recordRun(db: D1Database, writes: RunWrite[], at: string): Promise<void> {
  const day = at.slice(0, 10);
  const stmts: D1PreparedStatement[] = [];
  for (const w of writes) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO component_state (component, state, raw, streak, since, checked_at, latency_ms, detail, alert_open) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (component) DO UPDATE SET state = excluded.state, raw = excluded.raw, streak = excluded.streak, since = excluded.since,
             checked_at = excluded.checked_at, latency_ms = excluded.latency_ms, detail = excluded.detail, alert_open = excluded.alert_open`,
        )
        .bind(w.result.component, w.next.state, w.next.raw, w.next.streak, w.next.since, at, w.result.latencyMs, w.result.detail, w.alertOpen ? 1 : 0),
    );
    const latency = w.result.latencyMs ?? 0;
    const n = w.result.latencyMs === null ? 0 : 1;
    // The column name comes from a closed set (RunWrite.bucket), never from input
    stmts.push(
      db
        .prepare(
          `INSERT INTO daily (component, day, ${w.bucket}, latency_sum, latency_n) VALUES (?, ?, 1, ?, ?)
           ON CONFLICT (component, day) DO UPDATE SET ${w.bucket} = ${w.bucket} + 1, latency_sum = latency_sum + excluded.latency_sum, latency_n = latency_n + excluded.latency_n`,
        )
        .bind(w.result.component, day, latency, n),
    );
  }
  await db.batch(stmts);
}

export interface DailyRow extends DayCounts {
  component: string;
  latency_sum: number;
  latency_n: number;
}

export async function loadDaily(db: D1Database, fromDay: string): Promise<DailyRow[]> {
  return (await db.prepare('SELECT * FROM daily WHERE day >= ? ORDER BY day').bind(fromDay).all<DailyRow>()).results ?? [];
}

export interface IncidentRow {
  id: string;
  kind: IncidentKind;
  title_en: string;
  title_ar: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  components: string;
  starts_at: string;
  ends_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateRow {
  id: string;
  incident_id: string;
  status: IncidentStatus;
  body_en: string;
  body_ar: string;
  created_at: string;
}

export interface Incident extends Omit<IncidentRow, 'components'> {
  components: StatusComponentId[];
  updates: UpdateRow[];
}

const COLS = 'id, kind, title_en, title_ar, status, impact, components, starts_at, ends_at, resolved_at, created_at, updated_at';

function parseComponents(json: string): StatusComponentId[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is StatusComponentId => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function withUpdates(db: D1Database, rows: IncidentRow[]): Promise<Incident[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const updates = (await db
    .prepare(`SELECT id, incident_id, status, body_en, body_ar, created_at FROM incident_updates WHERE incident_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC`)
    .bind(...ids)
    .all<UpdateRow>()).results ?? [];
  return rows.map((r) => ({ ...r, components: parseComponents(r.components), updates: updates.filter((u) => u.incident_id === r.id) }));
}

/**
 * Incidents for the public page: everything open, maintenance that is
 * upcoming or running, and what closed in the last `historyDays` days.
 */
export async function loadIncidents(db: D1Database, now: Date, historyDays: number): Promise<Incident[]> {
  const since = new Date(now.getTime() - historyDays * 86_400_000).toISOString();
  const rows = (await db
    .prepare(`SELECT ${COLS} FROM incidents WHERE deleted_at IS NULL AND (resolved_at IS NULL OR resolved_at >= ?) ORDER BY starts_at DESC LIMIT 200`)
    .bind(since)
    .all<IncidentRow>()).results ?? [];
  return withUpdates(db, rows);
}

export async function loadIncident(db: D1Database, id: string): Promise<Incident | null> {
  const row = await db.prepare(`SELECT ${COLS} FROM incidents WHERE id = ? AND deleted_at IS NULL`).bind(id).first<IncidentRow>();
  return row ? (await withUpdates(db, [row]))[0] : null;
}

/** For the feeds: the newest incidents and maintenance, open or closed. */
export async function loadFeedIncidents(db: D1Database, limit = 30): Promise<Incident[]> {
  const rows = (await db.prepare(`SELECT ${COLS} FROM incidents WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`).bind(limit).all<IncidentRow>()).results ?? [];
  return withUpdates(db, rows);
}

/** Open incident, or maintenance running now. */
export function isActive(i: Incident, now: Date): boolean {
  if (isClosedStatus(i.status)) return false;
  if (i.kind === 'incident') return true;
  const t = now.toISOString();
  return i.status === 'in_progress' || (i.starts_at <= t && (!i.ends_at || i.ends_at > t));
}

export function isUpcoming(i: Incident, now: Date): boolean {
  return i.kind === 'maintenance' && i.status === 'scheduled' && i.starts_at > now.toISOString();
}

/** Keep 100 days of daily rows; purge incidents soft-deleted 30+ days ago. */
export async function prune(db: D1Database, now: Date): Promise<void> {
  const keepFrom = new Date(now.getTime() - 100 * 86_400_000).toISOString().slice(0, 10);
  const purgeBefore = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM daily WHERE day < ?').bind(keepFrom),
    db.prepare('DELETE FROM incident_updates WHERE incident_id IN (SELECT id FROM incidents WHERE deleted_at IS NOT NULL AND deleted_at < ?)').bind(purgeBefore),
    db.prepare('DELETE FROM incidents WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(purgeBefore),
  ]);
}

export type { RawState };
