/**
 * review_alerts rows (NOTIFICATIONS_DB, migration 0014) and the admin settings read.
 * One row per held review item: who was alerted and the held → decided timings.
 */
import {
  parseReviewAlertSettings,
  REVIEW_ALERT_SETTINGS_KEY,
  type D1Database,
  type ReviewAlertPayload,
  type ReviewAlertSettings,
} from '@al-ummah/shared-types';

export interface ReviewAlertRow {
  review_id: string;
  video_id: string | null;
  reason: string;
  senior_only: number;
  deadline_at: number | null;
  held_at: number;
  alerted_at: number | null;
  escalated_at: number | null;
  seniors_at: number | null;
  opened_at: number | null;
  opened_by: string | null;
  claimed_at: number | null;
  claimed_by: string | null;
  decided_at: number | null;
  alerted_users: string;
}

/** 400 days: a year of daily timings plus a margin. */
export const REVIEW_ALERT_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;

/** The admin-managed rota and escalation times (reports D1 site_settings; defaults when unset). */
export async function readReviewAlertSettings(reportsDb: D1Database): Promise<ReviewAlertSettings> {
  const row = await reportsDb.prepare('SELECT value FROM site_settings WHERE key = ?').bind(REVIEW_ALERT_SETTINGS_KEY).first<{ value: string }>();
  return parseReviewAlertSettings(row?.value);
}

export async function getReviewAlert(db: D1Database, reviewId: string): Promise<ReviewAlertRow | null> {
  return db.prepare('SELECT * FROM review_alerts WHERE review_id = ?').bind(reviewId).first<ReviewAlertRow>();
}

export function alertedUsers(row: Pick<ReviewAlertRow, 'alerted_users'> | null): string[] {
  if (!row) return [];
  try {
    const list = JSON.parse(row.alerted_users);
    return Array.isArray(list) ? list.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Starts (or restarts, for a new hold of the same review such as an appeal) the item's row.
 * A queue retry of the same `held` message (same `at`) keeps the row, so nobody is alerted twice.
 */
export async function startReviewAlert(db: D1Database, p: ReviewAlertPayload): Promise<ReviewAlertRow> {
  await db
    .prepare(
      `INSERT INTO review_alerts (review_id, video_id, reason, senior_only, deadline_at, held_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(review_id) DO UPDATE SET video_id = excluded.video_id, reason = excluded.reason,
         senior_only = excluded.senior_only, deadline_at = excluded.deadline_at, held_at = excluded.held_at,
         alerted_at = NULL, escalated_at = NULL, seniors_at = NULL, opened_at = NULL, opened_by = NULL,
         claimed_at = NULL, claimed_by = NULL, decided_at = NULL, alerted_users = '[]'
       WHERE review_alerts.held_at != excluded.held_at`,
    )
    .bind(p.reviewId, p.videoId ?? null, p.reason!, p.seniorOnly ? 1 : 0, p.deadlineAt ?? null, p.at)
    .run();
  return (await getReviewAlert(db, p.reviewId))!;
}

const STEP_COLUMN = { 0: null, 1: 'escalated_at', 2: 'seniors_at' } as const;

/** Records a step: who was pushed (merged) and, when someone got it, the first alert time. */
export async function recordAlertStep(db: D1Database, row: ReviewAlertRow, step: 0 | 1 | 2, pushed: string[], at: number): Promise<void> {
  const users = [...new Set([...alertedUsers(row), ...pushed])].sort();
  const column = STEP_COLUMN[step];
  await db
    .prepare(
      `UPDATE review_alerts SET alerted_users = ?, alerted_at = CASE WHEN ? THEN COALESCE(alerted_at, ?) ELSE alerted_at END
       ${column ? `, ${column} = COALESCE(${column}, ?)` : ''} WHERE review_id = ?`,
    )
    .bind(JSON.stringify(users), pushed.length > 0 ? 1 : 0, at, ...(column ? [at] : []), row.review_id)
    .run();
}

/** opened / claimed / decided: the first time is kept (the measured one); a later claim takes the item over. */
export async function recordReviewerEvent(db: D1Database, event: 'opened' | 'claimed' | 'decided', reviewId: string, userId: string | undefined, at: number): Promise<boolean> {
  const sql =
    event === 'opened'
      ? 'UPDATE review_alerts SET opened_at = COALESCE(opened_at, ?), opened_by = COALESCE(opened_by, ?) WHERE review_id = ?'
      : event === 'claimed'
        ? 'UPDATE review_alerts SET claimed_at = COALESCE(claimed_at, ?), claimed_by = ? WHERE review_id = ?'
        : 'UPDATE review_alerts SET decided_at = COALESCE(decided_at, ?) WHERE review_id = ?';
  const binds = event === 'decided' ? [at, reviewId] : [at, userId ?? null, reviewId];
  const res = await db.prepare(sql).bind(...binds).run();
  return ((res.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

export interface ReviewTimingDay {
  /** UTC day, YYYY-MM-DD */
  day: string;
  held: number;
  decided: number;
  /** Seconds from held to each stage: median and 90th percentile (null without data). */
  toAlert: { p50: number | null; p90: number | null };
  toOpen: { p50: number | null; p90: number | null };
  toClaim: { p50: number | null; p90: number | null };
  toDecision: { p50: number | null; p90: number | null };
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i] ?? null;
}

const spread = (values: number[]) => {
  const s = values.sort((a, b) => a - b);
  return { p50: percentile(s, 0.5), p90: percentile(s, 0.9) };
};

type TimingRow = Pick<ReviewAlertRow, 'held_at' | 'alerted_at' | 'opened_at' | 'claimed_at' | 'decided_at'>;

/** Daily median and p90 of held → alerted / opened / claimed / decided (indexed range read on held_at). */
export async function reviewTimings(db: D1Database, sinceMs: number, untilMs: number): Promise<ReviewTimingDay[]> {
  const { results } = await db
    .prepare('SELECT held_at, alerted_at, opened_at, claimed_at, decided_at FROM review_alerts WHERE held_at >= ? AND held_at < ? ORDER BY held_at LIMIT 20000')
    .bind(sinceMs, untilMs)
    .all<TimingRow>();
  const days = new Map<string, TimingRow[]>();
  for (const r of results ?? []) {
    const day = new Date(r.held_at).toISOString().slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), r]);
  }
  const secs = (rows: TimingRow[], key: 'alerted_at' | 'opened_at' | 'claimed_at' | 'decided_at') =>
    rows.filter((r) => r[key] !== null).map((r) => Math.max(0, Math.round(((r[key] as number) - r.held_at) / 1000)));
  return [...days.entries()].map(([day, rows]) => ({
    day,
    held: rows.length,
    decided: rows.filter((r) => r.decided_at !== null).length,
    toAlert: spread(secs(rows, 'alerted_at')),
    toOpen: spread(secs(rows, 'opened_at')),
    toClaim: spread(secs(rows, 'claimed_at')),
    toDecision: spread(secs(rows, 'decided_at')),
  }));
}

export async function purgeExpiredReviewAlerts(db: D1Database, now: number): Promise<number> {
  const res = await db.prepare('DELETE FROM review_alerts WHERE held_at < ?').bind(now - REVIEW_ALERT_RETENTION_MS).run();
  return (res.meta as { changes?: number } | undefined)?.changes ?? 0;
}
