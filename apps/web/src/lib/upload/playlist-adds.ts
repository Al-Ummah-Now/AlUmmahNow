/**
 * Playlists for new uploads (single and batch upload): which playlists each
 * video goes to, and what the uploader is told about the queued adds
 * (api-videos lib/playlistUploadAdds.ts runs them on a queue with retries).
 */

export type PlaylistAddStatus = 'pending' | 'added' | 'retrying' | 'failed';

/** One requested add as the page knows it. `unsent`: the request has not reached the API yet (sent again). */
export interface PlaylistAddItem {
  videoId: string;
  playlistId: string;
  status: PlaylistAddStatus | 'unsent';
}

export interface PlaylistAddNotice {
  playlistId: string;
  kind: 'retrying' | 'failed';
  count: number;
}

/** Position of the `index`-th video of an upload batch (api-videos sorts these as strings). */
export function orderKeyFor(batchId: string, index: number): string {
  return `${batchId}:${String(Math.max(0, Math.floor(index))).padStart(6, '0')}`;
}

/** A new batch id: letters, digits and dashes (the API accepts nothing else in an order key). */
export function newBatchId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return random.replace(/[^A-Za-z0-9-]/g, '');
}

/** The playlists of one batch row: its own choice when it has one, else the batch's. */
export function rowPlaylists(batch: readonly string[], override: readonly string[] | undefined): string[] {
  return [...(override ?? batch)];
}

/** The `ids` minus `id`, or plus it (keeping the order things were picked in). */
export function togglePlaylist(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Playlists whose name contains the query (any case; the query trimmed). */
export function filterPlaylists<T extends { title?: string; name?: string }>(playlists: readonly T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...playlists];
  return playlists.filter((p) => (p.name || p.title || '').toLocaleLowerCase().includes(q));
}

/** Whether an add still needs watching (its outcome is not known yet). */
export function isOpen(item: Pick<PlaylistAddItem, 'status'>): boolean {
  return item.status === 'pending' || item.status === 'retrying' || item.status === 'unsent';
}

/**
 * What the uploader is told, per playlist: videos whose add is being retried
 * ("we'll retry"; also requests the page could not send yet, which it sends
 * again) and videos that will not be added. Pending and added adds are quiet.
 */
export function playlistAddNotices(items: readonly PlaylistAddItem[]): PlaylistAddNotice[] {
  const byPlaylist = new Map<string, { retrying: Set<string>; failed: Set<string> }>();
  for (const item of items) {
    if (item.status !== 'retrying' && item.status !== 'unsent' && item.status !== 'failed') continue;
    const entry = byPlaylist.get(item.playlistId) ?? { retrying: new Set<string>(), failed: new Set<string>() };
    (item.status === 'failed' ? entry.failed : entry.retrying).add(item.videoId);
    byPlaylist.set(item.playlistId, entry);
  }
  const notices: PlaylistAddNotice[] = [];
  for (const [playlistId, { retrying, failed }] of byPlaylist) {
    if (retrying.size) notices.push({ playlistId, kind: 'retrying', count: retrying.size });
    if (failed.size) notices.push({ playlistId, kind: 'failed', count: failed.size });
  }
  return notices;
}

/** Merges the API's statuses into the page's list (a status the API does not know yet keeps the page's). */
export function mergeStatuses(items: readonly PlaylistAddItem[], answers: ReadonlyArray<{ videoId: string; playlistId: string; status: PlaylistAddStatus }>): PlaylistAddItem[] {
  const known = new Map(answers.map((a) => [`${a.videoId}/${a.playlistId}`, a.status]));
  return items.map((item) => {
    const status = known.get(`${item.videoId}/${item.playlistId}`);
    return status && item.status !== 'unsent' ? { ...item, status } : item;
  });
}

/** Delay before the next status read: every 5 s for the first minute, then every 20 s. */
export function pollDelayMs(elapsedMs: number): number {
  return elapsedMs < 60_000 ? 5_000 : 20_000;
}

/** The page stops watching after this long (the queue keeps retrying; admins see what still fails). */
export const WATCH_LIMIT_MS = 15 * 60_000;
