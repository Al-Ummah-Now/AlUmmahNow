/**
 * Runs a bulk edit in batches: one request per batch of ≤ BATCH_SIZE videos
 * of one channel (the channelId header must be one the caller acts as).
 * Progress is reported after every batch and the run stops between batches
 * when cancelled. Every batch of one run carries the same operation id, so
 * a retried batch never applies twice and one undo covers the whole run.
 */

export const BULK_BATCH_SIZE = 25;

export interface BulkOutcome {
  videoId: string;
  success: boolean;
  changed?: boolean;
  replayed?: boolean;
  code?: string;
  error?: string;
}

export interface BulkResponse {
  success: boolean;
  results: BulkOutcome[];
}

export interface RunGroup {
  channelId: string;
  ids: string[];
}

export interface RunProgress {
  done: number;
  total: number;
  succeeded: number;
  failed: number;
}

export interface RunResult extends RunProgress {
  outcomes: Map<string, BulkOutcome>;
  cancelled: boolean;
}

export function newOperationId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `be_${random}`.slice(0, 40);
}

/** Groups ids by channel, keeping the order they were given. */
export function groupByChannel(ids: readonly string[], channelOf: (id: string) => string): RunGroup[] {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const channelId = channelOf(id);
    groups.set(channelId, [...(groups.get(channelId) ?? []), id]);
  }
  return Array.from(groups, ([channelId, list]) => ({ channelId, ids: list }));
}

export async function runInBatches(
  groups: readonly RunGroup[],
  send: (ids: string[], channelId: string) => Promise<BulkResponse | null>,
  options: { signal?: AbortSignal; onProgress?: (progress: RunProgress) => void; batchSize?: number } = {},
): Promise<RunResult> {
  const size = options.batchSize ?? BULK_BATCH_SIZE;
  const total = groups.reduce((n, g) => n + g.ids.length, 0);
  const outcomes = new Map<string, BulkOutcome>();
  let done = 0;
  let succeeded = 0;
  let failed = 0;
  const report = () => options.onProgress?.({ done, total, succeeded, failed });

  for (const group of groups) {
    for (let i = 0; i < group.ids.length; i += size) {
      if (options.signal?.aborted) return { outcomes, cancelled: true, done, total, succeeded, failed };
      const ids = group.ids.slice(i, i + size);
      let response: BulkResponse | null = null;
      try {
        response = await send(ids, group.channelId);
      } catch {
        response = null;
      }
      const byId = new Map((response?.results ?? []).map((r) => [r.videoId, r]));
      for (const id of ids) {
        const outcome = byId.get(id) ?? { videoId: id, success: false, code: 'failed' };
        outcomes.set(id, outcome);
        if (outcome.success) succeeded++;
        else failed++;
      }
      done += ids.length;
      report();
    }
  }
  return { outcomes, cancelled: false, done, total, succeeded, failed };
}

/** Failure reasons with counts, most common first: "Too many tags (2)". */
export function failureReasons(outcomes: Iterable<BulkOutcome>): Array<{ code: string; count: number }> {
  const counts = new Map<string, number>();
  for (const o of outcomes) {
    if (o.success) continue;
    const code = o.code ?? 'failed';
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return Array.from(counts, ([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
}
