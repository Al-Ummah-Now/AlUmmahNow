/**
 * Popular viewer counts (wiki AUN-D1-SCALING D1-3a). discovery_viewers keeps one row per viewer,
 * video and day for the 91-day Popular window: about 1.3 GB at 100k monthly users. The ranking job
 * only ever reads COUNT(*) per video and day, so each closed day (two days back) is moved into
 * discovery_viewer_days, one video at a time: one D1 batch adds that video's count for the day and
 * deletes the same rows. A move is atomic, so a count is never lost or doubled, a run can stop
 * anywhere, and a view that arrives late for a moved day is moved by the next run.
 */
import { DAY_MS, POPULAR_PARAMS } from './rank';

/** Days back that are closed: today and yesterday still take views. */
export const ROLLUP_CLOSED_AFTER_DAYS = 2;
/** Videos moved per D1 batch (two statements each). */
export const ROLLUP_VIDEOS_PER_BATCH = 50;
/** Wall time one rollup may take inside a ranking run; the rest waits for the next run. */
export const ROLLUP_TIME_BOX_MS = 15_000;

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export const ROLLUP_SQL = {
  /** A seek on the primary key (day first): does this day still have raw rows? */
  hasRows: 'SELECT 1 AS hit FROM discovery_viewers WHERE day = ?1 LIMIT 1',
  /** The next videos of a day with raw rows, in primary-key order */
  videos: 'SELECT DISTINCT video_id FROM discovery_viewers WHERE day = ?1 AND video_id > ?2 ORDER BY video_id LIMIT ?3',
  add: `INSERT INTO discovery_viewer_days (day, video_id, viewers)
        SELECT day, video_id, COUNT(*) FROM discovery_viewers WHERE day = ?1 AND video_id = ?2 GROUP BY day, video_id
        ON CONFLICT (day, video_id) DO UPDATE SET viewers = viewers + excluded.viewers`,
  remove: 'DELETE FROM discovery_viewers WHERE day = ?1 AND video_id = ?2',
  purge: 'DELETE FROM discovery_viewer_days WHERE day < ?1',
} as const;

export interface RollupOutcome {
  days: number;
  videos: number;
  /** Stopped at the time box with closed days still to move */
  timedOut: boolean;
}

/**
 * Moves every closed day of the Popular window that still has raw rows. Days are found by
 * primary-key seeks (one per day of the window), never a scan.
 */
export async function rollupViewerDays(db: D1Database, now = Date.now(), clock: () => number = Date.now): Promise<RollupOutcome> {
  const started = clock();
  const out: RollupOutcome = { days: 0, videos: 0, timedOut: false };
  for (let back = POPULAR_PARAMS.days + 1; back >= ROLLUP_CLOSED_AFTER_DAYS; back--) {
    const day = utcDay(now - back * DAY_MS);
    if (!(await db.prepare(ROLLUP_SQL.hasRows).bind(day).first())) continue;
    let after = '';
    for (;;) {
      if (clock() - started >= ROLLUP_TIME_BOX_MS) {
        out.timedOut = true;
        return out;
      }
      const ids = ((await db.prepare(ROLLUP_SQL.videos).bind(day, after, ROLLUP_VIDEOS_PER_BATCH).all<{ video_id: string }>()).results ?? []).map((r) => r.video_id);
      if (!ids.length) break;
      await db.batch(ids.flatMap((id) => [db.prepare(ROLLUP_SQL.add).bind(day, id), db.prepare(ROLLUP_SQL.remove).bind(day, id)]));
      out.videos += ids.length;
      after = ids[ids.length - 1]!;
      if (ids.length < ROLLUP_VIDEOS_PER_BATCH) break;
    }
    out.days++;
  }
  return out;
}

/** Counts past the Popular window go (a primary-key range, day first). */
export async function purgeViewerDays(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare(ROLLUP_SQL.purge).bind(utcDay(now - (POPULAR_PARAMS.days + 1) * DAY_MS)).run();
}
