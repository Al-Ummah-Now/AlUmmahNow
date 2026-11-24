import type { WatchHistoryItem, WatchHistoryPage } from '@/services/api/watch-history';
import type { LibraryPage, LibraryVideo, WatchLaterPage } from '@/services/api/library';
import { shareImagePath } from '@/lib/embed/share-image';
import { isSignedMediaUrl } from '@/lib/ssr/stable-images';
import { storedIndexOf } from '@/lib/playlists/playlist-utils';

/** How many videos a home library card loads: its cover's and the two a lone wide card lists under "Up next" */
export const LIBRARY_ROW_LOAD = 3;

export type LibraryListKind = 'watch-later' | 'liked';

export interface ContinueLibraryCard {
  kind: 'continue';
  top: WatchHistoryItem;
  next: WatchHistoryItem[];
  total: number;
}

export interface ListLibraryCard {
  kind: LibraryListKind;
  top: LibraryVideo;
  next: LibraryVideo[];
  total: number;
  /** The first video's index in the list's stored order (the watch URL's `index`) */
  index: number;
}

export type HomeLibraryCard = ContinueLibraryCard | ListLibraryCard;

/** Continue watching card from pause setting + unfinished history page, or null when paused/empty. */
export function buildContinueCard(
  paused: boolean | null,
  page: WatchHistoryPage | null | undefined,
): ContinueLibraryCard | null {
  if (paused !== false || !page || !Array.isArray(page.entries) || page.entries.length === 0) return null;
  return {
    kind: 'continue',
    top: page.entries[0],
    next: page.entries.slice(1, LIBRARY_ROW_LOAD),
    total: Math.max(page.total || 0, page.entries.length),
  };
}

/** Watch later / Liked videos card from a library list page, or null when empty. */
export function buildListCard(
  kind: LibraryListKind,
  page: WatchLaterPage | LibraryPage<LibraryVideo> | null | undefined,
): ListLibraryCard | null {
  if (!page || !Array.isArray(page.items) || page.items.length === 0) return null;
  const top = page.items[0];
  const storedIds = 'videoIds' in page && Array.isArray(page.videoIds) ? page.videoIds : null;
  return {
    kind,
    top,
    next: page.items.slice(1, LIBRARY_ROW_LOAD),
    total: Math.max(page.total || 0, page.items.length),
    index: storedIndexOf(storedIds, top.id, 0),
  };
}

/**
 * Watch history entries don't carry `isPublic`, so `stableImages` has to drop signed
 * `videoThumbnail` URLs on them. For any video already known to have a public `/thumb/<id>.jpg`
 * (from the home feed, rails, or Watch later / Liked cards in the same SSR pass), swap the
 * signed URL to `/thumb/<id>.jpg` up front so SSR carries the cover with zero client refresh.
 */
export function withPublicHistoryThumbs(
  cards: HomeLibraryCard[],
  publicVideoIds: ReadonlySet<string>,
): HomeLibraryCard[] {
  if (publicVideoIds.size === 0) return cards;
  const stabilizeEntry = (entry: WatchHistoryItem): WatchHistoryItem => {
    if (
      typeof entry.videoThumbnail === 'string' &&
      isSignedMediaUrl(entry.videoThumbnail) &&
      publicVideoIds.has(entry.videoId)
    ) {
      return { ...entry, videoThumbnail: shareImagePath(entry.videoId) };
    }
    return entry;
  };
  return cards.map((card) =>
    card.kind === 'continue'
      ? { ...card, top: stabilizeEntry(card.top), next: card.next.map(stabilizeEntry) }
      : card,
  );
}

/**
 * Replaces thumbnails/fields of server-rendered cards in place after a partial SSR load (when a
 * private video's signed thumbnail was stripped). Keeps the exact same cards, order, and "Up next"
 * count so the row never changes height or causes a layout shift.
 */
export function mergeFreshLibraryCards(
  shown: HomeLibraryCard[],
  fresh: HomeLibraryCard[] | null | undefined,
): HomeLibraryCard[] {
  if (!fresh?.length) return shown;
  const byKind = new Map(fresh.map((card) => [card.kind, card]));
  return shown.map((card) => {
    const updated = byKind.get(card.kind);
    if (!updated) return card;
    if (card.kind === 'continue' && updated.kind === 'continue') {
      const freshById = new Map([updated.top, ...updated.next].map((e) => [e.videoId, e]));
      return {
        ...card,
        top: freshById.get(card.top.videoId) ?? card.top,
        next: card.next.map((e) => freshById.get(e.videoId) ?? e),
      };
    }
    if (card.kind !== 'continue' && updated.kind === card.kind) {
      const freshById = new Map([updated.top, ...updated.next].map((v) => [v.id, v]));
      return {
        ...card,
        top: freshById.get(card.top.id) ?? card.top,
        next: card.next.map((v) => freshById.get(v.id) ?? v),
      };
    }
    return card;
  });
}
