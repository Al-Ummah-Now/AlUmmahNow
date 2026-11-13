/**
 * Daily retention for error data (admin-api cron): D1 samples, references
 * and hourly counts older than 30 days (lib/errors-store.ts pruneErrorData),
 * and private source maps in R2 older than 90 days.
 */
import { pruneErrorData } from './errors-store';
import { logger } from './logger';
import type { D1Database } from './types';

// QA's bucket (al-ummah-now-sourcemaps-qa) also has an R2 lifecycle rule, `expire-14d`, set 2026-11-13:
// QA deploys add 2-4 GB of maps a day, more than this daily prune's 20 list pages delete.
export const SOURCEMAP_RETENTION_DAYS = 90;

export interface ListableBucket {
  list(opts: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string; uploaded: Date }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}

/** Deletes source maps uploaded more than `days` ago; at most `maxPages` list pages per run. */
export async function pruneSourceMaps(bucket: ListableBucket | undefined, now: Date, days = SOURCEMAP_RETENTION_DAYS, maxPages = 20): Promise<number> {
  if (!bucket) return 0;
  const cutoff = now.getTime() - days * 86400_000;
  let cursor: string | undefined;
  let deleted = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await bucket.list({ cursor, limit: 1000 });
    const old = res.objects.filter((o) => new Date(o.uploaded).getTime() < cutoff).map((o) => o.key);
    for (let i = 0; i < old.length; i += 1000) await bucket.delete(old.slice(i, i + 1000));
    deleted += old.length;
    if (!res.truncated || !res.cursor) break;
    cursor = res.cursor;
  }
  return deleted;
}

export async function runErrorRetention(env: { REPORTS_DB: D1Database; SOURCEMAPS?: ListableBucket }, now = new Date()): Promise<void> {
  try {
    const d1 = await pruneErrorData(env.REPORTS_DB, now);
    const maps = await pruneSourceMaps(env.SOURCEMAPS, now);
    logger.info('[Errors] Retention done', { ...d1, sourceMaps: maps });
  } catch (error) {
    logger.error('[Errors] Retention failed', { error: error instanceof Error ? error.message : String(error) });
  }
}
