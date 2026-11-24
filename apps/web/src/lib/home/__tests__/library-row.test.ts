import {
  buildContinueCard,
  buildListCard,
  mergeFreshLibraryCards,
  normalizeWatchHistoryPage,
  withPublicHistoryThumbs,
  type HomeLibraryCard,
} from '../library-row';
import { stableImages } from '@/lib/ssr/stable-images';

const SIGNED = 'https://vz-1.b-cdn.net/v1/thumbnail.jpg?token=abc&expires=1794603600';
const SIGNED_2 = 'https://vz-1.b-cdn.net/v2/thumbnail.jpg?token=def&expires=1794603600';

const historyEntry = (videoId: string, videoThumbnail?: string) => ({
  id: `u1:${videoId}`,
  userId: 'u1',
  videoId,
  videoTitle: `Talk ${videoId}`,
  videoThumbnail,
  videoDuration: 600,
  channelId: 'c1',
  channelName: 'Noor',
  firstWatchedAt: '',
  lastWatchedAt: '',
  watchCount: 1,
  progress: 240,
  completed: false,
  percentageWatched: 40,
});

const libraryVideo = (id: string, thumbnailUrl?: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: `Video ${id}`, thumbnailUrl, channelName: 'Noor', views: 5, isPublic: true, ...extra }) as never;

describe('home library row helpers', () => {
  it('normalizeWatchHistoryPage handles malformed payloads safely', () => {
    expect(normalizeWatchHistoryPage(null)).toEqual({ entries: [], total: 0, hasMore: false });
    expect(normalizeWatchHistoryPage({ total: 4 })).toEqual({ entries: [], total: 0, hasMore: false });
    const entry = historyEntry('v1');
    expect(normalizeWatchHistoryPage({ entries: [entry], total: 5, hasMore: true })).toEqual({
      entries: [entry],
      total: 5,
      hasMore: true,
    });
  });

  it('buildContinueCard returns null when paused, null, or empty', () => {
    const page = { entries: [historyEntry('v1'), historyEntry('v2')], total: 5, hasMore: true };
    expect(buildContinueCard(true, page)).toBeNull();
    expect(buildContinueCard(null, page)).toBeNull();
    expect(buildContinueCard(false, { entries: [], total: 0, hasMore: false })).toBeNull();
    expect(buildContinueCard(false, page)).toMatchObject({ kind: 'continue', total: 5 });
  });

  it('buildListCard uses stored watch-later index and caps Up next to two items', () => {
    const page = {
      items: [libraryVideo('v1'), libraryVideo('v2'), libraryVideo('v3'), libraryVideo('v4')],
      total: 10,
      nextCursor: null,
      playlistId: 'wl',
      videoIds: ['x', 'y', 'v1', 'v2', 'v3', 'v4'],
    };
    const card = buildListCard('watch-later', page);
    expect(card?.index).toBe(2);
    expect(card?.next.map((v) => v.id)).toEqual(['v2', 'v3']);
  });

  it('withPublicHistoryThumbs swaps signed thumbnails only for known public videos, leaving private/unknown ones for stableImages to strip', () => {
    const cards: HomeLibraryCard[] = [
      {
        kind: 'continue',
        top: historyEntry('v1', SIGNED),
        next: [historyEntry('v2', SIGNED_2)],
        total: 2,
      },
      {
        kind: 'liked',
        top: libraryVideo('v1', SIGNED),
        next: [],
        total: 1,
        index: 0,
      },
    ];

    const stabilized = stableImages(withPublicHistoryThumbs(cards, new Set(['v1'])));
    expect(JSON.stringify(stabilized.value)).not.toMatch(/token=|b-cdn/);
    // v1 became /thumb/v1.jpg, while v2 (unknown visibility) was stripped and marked partial
    expect(stabilized.value[0].kind).toBe('continue');
    if (stabilized.value[0].kind === 'continue') {
      expect(stabilized.value[0].top.videoThumbnail).toBe('/thumb/v1.jpg');
      expect(stabilized.value[0].next[0].videoThumbnail).toBeUndefined();
    }
    expect(stabilized.partial).toBe(true);
  });

  it('mergeFreshLibraryCards updates thumbnails in place without adding, removing, or reordering cards', () => {
    const shown: HomeLibraryCard[] = [
      {
        kind: 'continue',
        top: historyEntry('v1', undefined),
        next: [historyEntry('v2', undefined)],
        total: 2,
      },
      {
        kind: 'watch-later',
        top: libraryVideo('w1', undefined, { isPublic: false }),
        next: [],
        total: 1,
        index: 0,
      },
    ];
    const fresh: HomeLibraryCard[] = [
      {
        kind: 'continue',
        top: historyEntry('v1', SIGNED),
        next: [historyEntry('v2', SIGNED_2), historyEntry('v3', SIGNED)],
        total: 3,
      },
      {
        kind: 'watch-later',
        top: libraryVideo('w1', SIGNED, { isPublic: false }),
        next: [],
        total: 1,
        index: 0,
      },
      {
        kind: 'liked',
        top: libraryVideo('l1', SIGNED),
        next: [],
        total: 1,
        index: 0,
      },
    ];

    const merged = mergeFreshLibraryCards(shown, fresh);
    // Exact same card kinds and order (liked was NOT inserted, v3 was NOT appended)
    expect(merged.map((c) => c.kind)).toEqual(['continue', 'watch-later']);
    if (merged[0].kind === 'continue') {
      expect(merged[0].top.videoThumbnail).toBe(SIGNED);
      expect(merged[0].next.map((e) => e.videoId)).toEqual(['v2']);
      expect(merged[0].next[0].videoThumbnail).toBe(SIGNED_2);
    }
    if (merged[1].kind === 'watch-later') {
      expect(merged[1].top.thumbnailUrl).toBe(SIGNED);
    }
  });
});
