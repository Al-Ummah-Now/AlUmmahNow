import {
  formatDuration,
  getPlayAllHref,
  getPlaylistHref,
  getWatchHref,
  moveItem,
  normalizePlaylistTitle,
} from '../playlist-utils';

describe('playlist-utils', () => {
  it('builds watch and playlist URLs', () => {
    expect(getWatchHref('en', 'abc')).toBe('/en/video?vid=abc');
    expect(getPlaylistHref('ar', 'p 1')).toBe('/ar/playlist/p%201');
  });

  it('play all targets the first video in order', () => {
    expect(getPlayAllHref('en', [{ id: 'first' }, { id: 'second' }])).toBe('/en/video?vid=first');
    expect(getPlayAllHref('en', [])).toBeNull();
  });

  it('moves items without mutating the input', () => {
    const items = ['a', 'b', 'c'];
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(items, 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(items, 0, 5)).toEqual(['a', 'b', 'c']);
    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('formats durations', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });

  it('normalizes playlist titles', () => {
    expect(normalizePlaylistTitle('  My   list ')).toBe('My list');
    expect(normalizePlaylistTitle('   ')).toBeNull();
    expect(normalizePlaylistTitle('x'.repeat(200))).toHaveLength(150);
  });
});
