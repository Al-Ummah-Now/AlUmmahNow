/**
 * Unique qualified viewers for discovery ranking (wiki E07 "Discovery ranking";
 * NOTIFICATIONS_DB.discovery_viewers, migration 0018).
 *
 * api-videos decides whether a view may count (never the owner, staff, test
 * accounts, crawlers or autoplay) and sends its viewer key as `rankViewer` on
 * the tracked view. Here each such view becomes one (day, video, viewer) row,
 * inserted with INSERT OR IGNORE: a viewer counts once per video per day, and a
 * retried message never counts twice. The ranking job reads the counts.
 */
import type { D1Database, D1PreparedStatement } from '../types';
import { isTrackedView, toUtcDay, type ViewEventPayload } from './analytics-rollup';

export type RankViewerRow = readonly [day: string, videoId: string, viewer: string];

const VIEWER = /^(u:[^\s]{1,128}|a:[0-9a-f]{16})$/;

/** Pure: the viewer row of a tracked view that may count, or null. */
export function rankViewerRow(payload: ViewEventPayload & { rankViewer?: unknown; timestamp?: unknown }, messageTimestamp: number | string): RankViewerRow | null {
  if (!isTrackedView(payload)) return null;
  const viewer = payload.rankViewer;
  if (typeof viewer !== 'string' || !VIEWER.test(viewer)) return null;
  const day = toUtcDay(typeof payload.timestamp === 'string' ? payload.timestamp : messageTimestamp);
  return [day, payload.videoId as string, viewer];
}

/** Rows per statement (one JSON parameter). */
const ROWS_PER_STATEMENT = 500;

export function rankViewerStatements(db: D1Database, rows: readonly RankViewerRow[]): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    out.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO discovery_viewers (day, video_id, viewer)
           SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]') FROM json_each(?1) AS j`,
        )
        .bind(JSON.stringify(rows.slice(i, i + ROWS_PER_STATEMENT))),
    );
  }
  return out;
}

/** Collects a batch's viewer rows (deduplicated) and writes them in one D1 batch. */
export class RankViewerBatch {
  private rows = new Map<string, RankViewerRow>();

  add(row: RankViewerRow | null): boolean {
    if (!row) return false;
    this.rows.set(row.join('\u0000'), row);
    return true;
  }

  get size(): number {
    return this.rows.size;
  }

  clear(): void {
    this.rows.clear();
  }

  /** Returns the batch's statements and empties it (so a caller can share one D1 transaction). */
  drainStatements(db: D1Database): D1PreparedStatement[] {
    if (this.rows.size === 0) return [];
    const statements = rankViewerStatements(db, [...this.rows.values()]);
    this.rows.clear();
    return statements;
  }

  async flush(db: D1Database): Promise<void> {
    const statements = this.drainStatements(db);
    if (statements.length === 0) return;
    await db.batch(statements);
  }
}
