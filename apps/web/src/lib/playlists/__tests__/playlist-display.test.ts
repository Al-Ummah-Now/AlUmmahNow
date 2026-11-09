import { getPlaylistCoverUrl, getPlaylistDisplayName, getPlaylistVideoCount } from '../playlist-utils';

/**
 * Regression: GET /api/channels/{id}/playlists returns `title` + `videos`
 * without the `name` / `videosCount` aliases, so the channel Playlists tab
 * showed untitled "0 videos" cards.
 */
describe('playlist display helpers', () => {
  it('prefers name, falls back to title', () => {
    expect(getPlaylistDisplayName({ name: 'Named', title: 'Titled' })).toBe('Named');
    expect(getPlaylistDisplayName({ title: 'Titled' })).toBe('Titled');
    expect(getPlaylistDisplayName({})).toBe('');
  });

  it('uses the stored counter, else the ordered video id list', () => {
    expect(getPlaylistVideoCount({ videosCount: 4, videos: ['a'] })).toBe(4);
    expect(getPlaylistVideoCount({ videos: ['a', 'b', 'c'] })).toBe(3);
    expect(getPlaylistVideoCount({})).toBe(0);
  });
});

describe('getPlaylistCoverUrl', () => {
  const cover = { thumbnailUrl: 'derived.jpg' };

  it('prefers the custom thumbnail', () => {
    expect(getPlaylistCoverUrl({ thumbnailUrl: 'custom.jpg', cover }, [{ thumbnailUrl: 'video.jpg' }])).toBe('custom.jpg');
  });

  it('uses the derived cover, then the first loaded video with a thumbnail', () => {
    expect(getPlaylistCoverUrl({ cover }, [{ thumbnailUrl: 'video.jpg' }])).toBe('derived.jpg');
    expect(getPlaylistCoverUrl({}, [{}, { thumbnailUrl: 'second.jpg' }])).toBe('second.jpg');
  });

  it('is null when there is nothing to show', () => {
    expect(getPlaylistCoverUrl({}, [])).toBeNull();
    expect(getPlaylistCoverUrl({})).toBeNull();
  });
});
