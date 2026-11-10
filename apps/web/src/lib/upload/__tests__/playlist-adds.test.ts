/**
 * Playlists for new uploads: which playlists a row goes to, the search, the
 * order key, and what the uploader is told about queued adds.
 */
import {
  filterPlaylists,
  isOpen,
  mergeStatuses,
  newBatchId,
  orderKeyFor,
  playlistAddNotices,
  pollDelayMs,
  rowPlaylists,
  togglePlaylist,
  type PlaylistAddItem,
} from '../playlist-adds';

describe('playlist-adds', () => {
  it('builds order keys the API accepts and that sort in upload order', () => {
    const id = newBatchId();
    expect(id).toMatch(/^[A-Za-z0-9-]+$/);
    const keys = [orderKeyFor(id, 10), orderKeyFor(id, 2), orderKeyFor(id, 0)];
    expect([...keys].sort()).toEqual([orderKeyFor(id, 0), orderKeyFor(id, 2), orderKeyFor(id, 10)]);
    expect(orderKeyFor('b', 3)).toBe('b:000003');
  });

  it("uses a row's own playlists when it has some, else the batch's", () => {
    expect(rowPlaylists(['a', 'b'], undefined)).toEqual(['a', 'b']);
    expect(rowPlaylists(['a', 'b'], ['c'])).toEqual(['c']);
    expect(rowPlaylists(['a'], [])).toEqual([]);
  });

  it('toggles a playlist in the order it was picked', () => {
    expect(togglePlaylist(['a'], 'b')).toEqual(['a', 'b']);
    expect(togglePlaylist(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('searches names in any case, Arabic too', () => {
    const list = [{ title: 'Tafsir Juz Amma' }, { name: 'سيرة النبي', title: 'x' }, { title: 'Fiqh' }];
    expect(filterPlaylists(list, ' tafsir ')).toEqual([list[0]]);
    expect(filterPlaylists(list, 'سيرة')).toEqual([list[1]]);
    expect(filterPlaylists(list, '')).toEqual(list);
  });

  it('tells the uploader per playlist about retried and failed adds, quiet otherwise', () => {
    const items: PlaylistAddItem[] = [
      { videoId: 'v1', playlistId: 'p1', status: 'retrying' },
      { videoId: 'v2', playlistId: 'p1', status: 'unsent' },
      { videoId: 'v3', playlistId: 'p1', status: 'added' },
      { videoId: 'v1', playlistId: 'p2', status: 'failed' },
      { videoId: 'v2', playlistId: 'p2', status: 'pending' },
    ];
    expect(playlistAddNotices(items)).toEqual([
      { playlistId: 'p1', kind: 'retrying', count: 2 },
      { playlistId: 'p2', kind: 'failed', count: 1 },
    ]);
    expect(playlistAddNotices([{ videoId: 'v1', playlistId: 'p1', status: 'pending' }])).toEqual([]);
  });

  it("merges the API's statuses, never over a request the page has not sent yet", () => {
    const items: PlaylistAddItem[] = [
      { videoId: 'v1', playlistId: 'p1', status: 'pending' },
      { videoId: 'v2', playlistId: 'p1', status: 'unsent' },
    ];
    const merged = mergeStatuses(items, [
      { videoId: 'v1', playlistId: 'p1', status: 'added' },
      { videoId: 'v2', playlistId: 'p1', status: 'added' },
    ]);
    expect(merged.map((i) => i.status)).toEqual(['added', 'unsent']);
    expect(merged.filter(isOpen)).toHaveLength(1);
  });

  it('reads status often at first, then less often', () => {
    expect(pollDelayMs(0)).toBe(5000);
    expect(pollDelayMs(120_000)).toBe(20_000);
  });
});
