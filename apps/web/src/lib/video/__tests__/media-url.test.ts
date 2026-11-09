/** Same-video detection for source changes (lib/video/media-url.ts) */
import { isSameMediaUrl } from '../media-url';

const BASE = 'https://alummahnow.com/en/watch/abc';

describe('isSameMediaUrl', () => {
  it('treats a relative source and its absolute form as the same video', () => {
    expect(isSameMediaUrl('/media/a/master.m3u8', 'https://alummahnow.com/media/a/master.m3u8', BASE)).toBe(true);
  });

  it('tells different videos apart', () => {
    expect(isSameMediaUrl('/media/a/master.m3u8', '/media/b/master.m3u8', BASE)).toBe(false);
    expect(isSameMediaUrl('https://cdn.example/a.m3u8', 'https://alummahnow.com/a.m3u8', BASE)).toBe(false);
  });

  it('keeps the query: a different query is a different resource', () => {
    expect(isSameMediaUrl('/a.m3u8?token=1', '/a.m3u8?token=2', BASE)).toBe(false);
  });

  it('is false when either side is missing', () => {
    expect(isSameMediaUrl('', '/a.m3u8', BASE)).toBe(false);
    expect(isSameMediaUrl('/a.m3u8', undefined, BASE)).toBe(false);
  });
});
