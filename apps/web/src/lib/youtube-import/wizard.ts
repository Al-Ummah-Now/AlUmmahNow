/**
 * The Move from YouTube wizard's pure logic (wiki AUN-YT-IMPORT): which step
 * to open, what the selection and matches calls send, how review groups and
 * progress are counted. No React and no I/O, so it is unit-tested directly.
 */
import { matchTakeoutFiles, normalizeTitle, YT_IMPORT_ERRORS, type TakeoutFile, type TakeoutVideoRow, type YtFileMatch, type YtImport, type YtImportItem, type YtImportPlaylist, type YtVisibilityMode } from '@al-ummah/shared-types';
import { keyOfMatch, toFileMatch } from './takeout';

export const WIZARD_STEPS = ['connect', 'pick', 'files', 'review', 'import'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Where the wizard opens for the creator's latest import. */
export function initialStep(current: YtImport | null): WizardStep {
  if (!current) return 'connect';
  switch (current.status) {
    case 'ready':
      return 'pick';
    case 'importing':
    case 'finished':
      return 'import';
    default:
      // listing shows "Reading your channel" on Connect; cancelled and failed start again
      return 'connect';
  }
}

/** Items that can be picked (an earlier import already brought `imported` ones). */
export const pickable = (item: YtImportItem) => item.state !== 'imported';

/** PUT selection: the full selected sets, in YouTube order, never an imported item. */
export function selectionPayload(
  items: readonly YtImportItem[],
  selectedItems: ReadonlySet<string>,
  selectedPlaylists: ReadonlySet<string>,
  playlists: readonly YtImportPlaylist[],
  visibilityMode: YtVisibilityMode,
): { itemIds: string[]; playlistIds: string[]; visibilityMode: YtVisibilityMode } {
  return {
    itemIds: items.filter((i) => pickable(i) && selectedItems.has(i.id)).map((i) => i.id),
    playlistIds: playlists.filter((p) => selectedPlaylists.has(p.ytPlaylistId)).map((p) => p.ytPlaylistId),
    visibilityMode,
  };
}

/** The pickable items of a playlist (its YouTube ids that are in this import). */
export function playlistItemIds(playlist: YtImportPlaylist, items: readonly YtImportItem[]): string[] {
  const byYt = new Map(items.map((i) => [i.ytVideoId, i]));
  return playlist.ytVideoIds.map((id) => byYt.get(id)).filter((i): i is YtImportItem => !!i && pickable(i)).map((i) => i.id);
}

/** Search by title (accents, case and punctuation ignored, like file matching). */
export function filterItems(items: readonly YtImportItem[], query: string): YtImportItem[] {
  const q = normalizeTitle(query);
  if (!q) return [...items];
  return items.filter((i) => normalizeTitle(i.title).includes(q) || i.ytVideoId === query.trim());
}

/**
 * Matches for the selected items. A creator's own choice (manual, or a choice
 * already saved) stays while its file is still picked; the rest is matched by
 * id, videos.csv, then title.
 */
export function computeMatches(
  selected: readonly YtImportItem[],
  files: readonly TakeoutFile[],
  csv: readonly TakeoutVideoRow[],
  kept: ReadonlyMap<string, YtFileMatch | null> = new Map(),
): Map<string, YtFileMatch | null> {
  const present = new Set(files.map((f) => f.key));
  const result = new Map<string, YtFileMatch | null>();
  const claimed = new Set<string>();
  for (const item of selected) {
    const own = kept.has(item.id) ? kept.get(item.id)! : item.match;
    if (kept.has(item.id) && own === null) {
      // Left out on purpose
      result.set(item.id, null);
      continue;
    }
    if (own && present.has(keyOfMatch(own)) && (own.by === 'manual' || kept.has(item.id))) {
      result.set(item.id, own);
      claimed.add(keyOfMatch(own));
    }
  }
  const open = selected.filter((i) => !result.has(i.id));
  const auto = matchTakeoutFiles(
    open.map((i) => ({ id: i.id, ytVideoId: i.ytVideoId, title: i.title })),
    files.filter((f) => !claimed.has(f.key)),
    csv,
  );
  for (const item of open) {
    const hit = auto.get(item.id);
    result.set(item.id, hit ? toFileMatch(hit.file, hit.by) : null);
  }
  return result;
}

/** PUT matches: one entry per selected item (null = no file). The client splits it into calls of 500. */
export function matchesPayload(selected: readonly YtImportItem[], matches: ReadonlyMap<string, YtFileMatch | null>): { itemId: string; match: YtFileMatch | null }[] {
  return selected.map((item) => ({ itemId: item.id, match: matches.get(item.id) ?? null }));
}

export type ReviewGroup = 'byId' | 'byTitle' | 'manual' | 'noFile';

export function reviewGroup(match: YtFileMatch | null | undefined): ReviewGroup {
  if (!match) return 'noFile';
  return match.by === 'id' ? 'byId' : match.by === 'title' ? 'byTitle' : 'manual';
}

/** Files no other item uses: what the review picker offers for `itemId`. */
export function freeFiles(files: readonly TakeoutFile[], matches: ReadonlyMap<string, YtFileMatch | null>, itemId: string): TakeoutFile[] {
  const used = new Set<string>();
  for (const [id, m] of matches) if (m && id !== itemId) used.add(keyOfMatch(m));
  return files.filter((f) => !used.has(f.key));
}

/** What the uploader does on this page for one item (the server's state, overlaid with the page's own upload). */
export type LivePhase = 'waiting' | 'preparing' | 'uploading' | 'processing' | 'ready' | 'failed' | 'needsFile';

export interface LiveState {
  phase: LivePhase;
  percent?: number;
  reconnecting?: boolean;
  /** A key of t.studio.youtube.progress.errors */
  errorCode?: string;
  /** The error reference shown with the message */
  reference?: string;
}

/** The phase a row shows. The page's own upload wins while the server still says selected/uploading. */
export function rowPhase(item: YtImportItem, live: LiveState | undefined): LivePhase {
  if (item.state === 'ready') return 'ready';
  if (item.state === 'processing') return 'processing';
  if (item.state === 'failed' && live?.phase !== 'preparing' && live?.phase !== 'uploading') return 'failed';
  if (live) return live.phase;
  if (!item.match) return 'needsFile';
  return 'waiting';
}

export interface ProgressCounts {
  ready: number;
  active: number;
  failed: number;
  waiting: number;
  total: number;
}

export function progressCounts(items: readonly YtImportItem[], live: ReadonlyMap<string, LiveState>): ProgressCounts {
  const counts: ProgressCounts = { ready: 0, active: 0, failed: 0, waiting: 0, total: 0 };
  for (const item of items) {
    const phase = rowPhase(item, live.get(item.id));
    counts.total++;
    if (phase === 'ready') counts.ready++;
    else if (phase === 'failed') counts.failed++;
    else if (phase === 'preparing' || phase === 'uploading' || phase === 'processing') counts.active++;
    else counts.waiting++;
  }
  return counts;
}

/** The items of an import the wizard follows on the Import step: the selected ones that have a file. */
export function importItems(items: readonly YtImportItem[]): YtImportItem[] {
  return items.filter((i) => i.selected && pickable(i) && (i.match || i.state !== 'selected'));
}

/** Items whose bytes still have to go up from this browser. */
export function needsUpload(item: YtImportItem): boolean {
  return item.selected && !!item.match && (item.state === 'selected' || item.state === 'uploading');
}

/** True when every followed item is settled (ready or failed) and nothing uploads. */
export function isSettled(items: readonly YtImportItem[], live: ReadonlyMap<string, LiveState>): boolean {
  return importItems(items).every((i) => {
    const phase = rowPhase(i, live.get(i.id));
    return phase === 'ready' || phase === 'failed';
  });
}

/** "1:02:03" / "4:05". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** The error code the Connect step shows for ?error= (unknown codes read as "failed"). */
export function connectErrorKey(code: string | null): 'youtube_denied' | 'youtube_no_channel' | 'failed' | null {
  if (!code) return null;
  return code === 'youtube_denied' || code === 'youtube_no_channel' ? code : 'failed';
}

/** The server's reason for a failed item (YtImportItem.error) as a key of t.studio.youtube.progress.errors. */
export function itemErrorKey(code: string | null | undefined): 'video_removed' | 'upload_failed' | 'generic' {
  return code === 'video_removed' || code === 'upload_failed' ? code : 'generic';
}

/** Why the server gave up on the whole import (YtImport.error), shown on Connect. */
export function importErrorKey(code: string | null | undefined): 'import_disconnected' | 'import_failed' {
  return code === 'youtube_not_connected' ? 'import_disconnected' : 'import_failed';
}

export type FinishErrorKey = 'connect_other_account' | 'connect_expired' | 'youtube_denied' | 'youtube_no_channel';

/**
 * Why `POST oauth/finish` refused the connection, for the message beside "Connect again":
 * 403 another account on this site started it (the consent is used up); 404
 * `youtube_connect_expired` the connect token is unknown, used or older than 5 minutes; 400/409
 * Google's own refusals. null: not a refusal (502, network), shown as a reported failure.
 */
export function finishErrorKey(status: number | undefined, code?: string | null): FinishErrorKey | null {
  // Switched off: not a refusal to explain (the page leaves for the dashboard)
  if (code === YT_IMPORT_ERRORS.notEnabled) return null;
  if (code === YT_IMPORT_ERRORS.denied || code === YT_IMPORT_ERRORS.noChannel) return code;
  if (status === 403) return 'connect_other_account';
  if (code === YT_IMPORT_ERRORS.connectExpired || status === 404 || status === 410) return 'connect_expired';
  return null;
}
