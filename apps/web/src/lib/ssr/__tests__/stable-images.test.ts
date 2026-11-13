import { hasStableThumb, isSignedMediaUrl, stableImages } from '../stable-images';

const SIGNED = 'https://vz-1.b-cdn.net/v1/thumbnail.jpg?token=abc&expires=1794603600';
const PATH_SIGNED = 'https://vz-1.b-cdn.net/bcdn_token=abc&expires=1794603600&token_path=%2Fv1%2F/v1/playlist.m3u8';

describe('stable images for server-rendered data (#1209)', () => {
  it('should recognise Bunny tokens and R2 private links', () => {
    expect(isSignedMediaUrl(SIGNED)).toBe(true);
    expect(isSignedMediaUrl(PATH_SIGNED)).toBe(true);
    expect(isSignedMediaUrl('https://media.alummahnow.net/priv/1794603600.abc/v1/master.m3u8')).toBe(true);
    expect(isSignedMediaUrl('https://images.alummahnow.net/thumbnails/v1/custom.jpg?width=640')).toBe(false);
    expect(isSignedMediaUrl('/thumb/v1.jpg')).toBe(false);
  });

  it('should move public video thumbnails to /thumb and drop every other signed URL', () => {
    const { value, partial } = stableImages({
      data: [{ id: 'v1', title: 'T', thumbnailUrl: SIGNED, thumbnailSizes: { hd: SIGNED }, playUrl: PATH_SIGNED, views: 3, isPublic: true }],
      cursor: 'c2',
    });
    expect(value).toEqual({ data: [{ id: 'v1', title: 'T', thumbnailUrl: '/thumb/v1.jpg', views: 3, isPublic: true }], cursor: 'c2' });
    expect(partial).toBe(false);
    expect(JSON.stringify(value)).not.toMatch(/token=|b-cdn/);
  });

  it('should drop the thumbnail of a video only the viewer may see and mark the data partial', () => {
    const { value, partial } = stableImages([{ id: 'v2', title: 'Mine', thumbnailUrl: SIGNED, views: 0, isPublic: false }]);
    expect(value).toEqual([{ id: 'v2', title: 'Mine', views: 0, isPublic: false }]);
    expect(partial).toBe(true);
  });

  it('should give a playlist cover taken from a video that video\'s /thumb image', () => {
    const { value } = stableImages({ id: 'p1', name: 'List', videos: ['v1'], cover: { videoId: 'v1', thumbnailUrl: SIGNED } });
    expect(value).toEqual({ id: 'p1', name: 'List', videos: ['v1'], cover: { videoId: 'v1', thumbnailUrl: '/thumb/v1.jpg' } });
  });

  it('should keep unsigned images as they are', () => {
    const custom = 'https://images.alummahnow.net/thumbnails/c1/avatar.jpg';
    expect(stableImages({ id: 'c1', name: 'Channel', avatarUrl: custom }).value).toEqual({ id: 'c1', name: 'Channel', avatarUrl: custom });
  });

  it('should only serve /thumb for videos anyone may watch', () => {
    expect(hasStableThumb({ id: 'v', isPublic: true })).toBe(true);
    expect(hasStableThumb({ id: 'v', isPublic: false, isUnlisted: true })).toBe(true);
    expect(hasStableThumb({ id: 'v', isPublic: false })).toBe(false);
    expect(hasStableThumb({ id: 'v', uploadStatus: 'processing' })).toBe(false);
  });
});
