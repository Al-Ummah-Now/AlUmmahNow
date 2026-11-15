/**
 * The run's objects in the R2 buckets that keep copies of queue messages: the processor's message
 * archive and the legacy-restore backups. They hold personal data, so they are never allowed
 * through; the local teardown deletes them (cleanup.ts).
 *
 * A message sent in the run's last seconds (a report dismissed as the last spec ends) is archived
 * after the processor's batch, so after the teardown's one sweep: the teardown keeps deleting these
 * hits from each leftover scan, by the key the scan found, under the quiet-period rule below.
 */
export const ARCHIVE_BUCKETS = ['al-ummah-now-messages', 'admin-backups'] as const;

export function archiveHits(hits: { store: string; location: string }[]): { bucket: string; key: string }[] {
  const out = new Map<string, { bucket: string; key: string }>();
  for (const hit of hits) {
    const bucket = ARCHIVE_BUCKETS.find((b) => hit.store === `r2:${b}`);
    if (bucket && hit.location) out.set(`${bucket}/${hit.location}`, { bucket, key: hit.location });
  }
  return [...out.values()];
}

/**
 * The processor's longest queue batch wait in ms: the largest max_batch_timeout of its top-level
 * queue consumers (apps/processor/wrangler.jsonc, the config the local stack runs). A message is
 * archived at most this long after it is sent, plus the batch's processing time.
 */
export function processorBatchTimeoutMs(config: unknown): number {
  const consumers = (config as { queues?: { consumers?: { max_batch_timeout?: unknown }[] } })?.queues?.consumers ?? [];
  const seconds = consumers.map((c) => Number(c.max_batch_timeout)).filter((n) => Number.isFinite(n) && n >= 0);
  if (!seconds.length) throw new Error('the processor config has no queue consumer with a max_batch_timeout');
  return Math.max(...seconds) * 1000;
}

/** No new archive copy for this long after the batch window: the run's last messages are in. */
export const ARCHIVE_QUIET_MS = 10_000;
/** Past the batch window, how long the sweep may go on before the teardown fails. */
export const ARCHIVE_SLACK_MS = 60_000;

export interface QuietPeriod {
  /** When the teardown began: the last spec has ended, so no new message is sent after it */
  startedAt: number;
  batchMs: number;
  quietMs?: number;
  /** Hard limit after startedAt (default batchMs + ARCHIVE_SLACK_MS) */
  maxMs?: number;
}

/**
 * The quiet-period rule of the teardown's sweep. Done once nothing but kept-on-purpose rows is left
 * and no new archive copy has appeared for quietMs, counted from the later of the last new copy and
 * the end of the processor's batch window (a message sent as the last spec ended may only be
 * archived then). Timeout at maxMs: the teardown fails with what is left.
 */
export function quietPeriodState(p: QuietPeriod, now: number, lastNewArchiveAt: number | null, otherPending: number): 'done' | 'wait' | 'timeout' {
  const quietFrom = Math.max(p.startedAt + p.batchMs, lastNewArchiveAt ?? 0);
  if (!otherPending && now - quietFrom >= (p.quietMs ?? ARCHIVE_QUIET_MS)) return 'done';
  return now - p.startedAt >= (p.maxMs ?? p.batchMs + ARCHIVE_SLACK_MS) ? 'timeout' : 'wait';
}
