import { deviceClass, fallbackReasonFor, playbackList, playbackSourcesOf } from '../delivery';

describe('fallbackReasonFor', () => {
  it('names the failure from the playlist status first, then the MediaError code', () => {
    expect(fallbackReasonFor({ code: 2, status: 403 })).toBe('manifest_4xx');
    expect(fallbackReasonFor({ code: 4, status: 404 })).toBe('manifest_4xx');
    expect(fallbackReasonFor({ code: 2, status: 503 })).toBe('manifest_5xx');
    expect(fallbackReasonFor({ code: 2, status: 0 })).toBe('cors');
    expect(fallbackReasonFor({ code: 2 })).toBe('network');
    expect(fallbackReasonFor({ code: 3 })).toBe('decode');
    expect(fallbackReasonFor({ code: 4 })).toBe('unsupported');
    expect(fallbackReasonFor({})).toBe('other');
  });
});

describe('deviceClass', () => {
  it('classifies common agents', () => {
    expect(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(deviceClass('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(deviceClass('Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Safari/537.36')).toBe('tablet');
    expect(deviceClass('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')).toBe('mobile');
    expect(deviceClass('Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0)')).toBe('tv');
    expect(deviceClass('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
  });
});

describe('playback sources', () => {
  const R2 = 'https://media.alummahnow.net/pub/v/r/master.m3u8';
  const BUNNY = 'https://vz-1.b-cdn.net/v/playlist.m3u8';

  it('keeps only https sources of known providers, once each, in the API order', () => {
    expect(playbackSourcesOf([
      { provider: 'r2', src: R2 },
      { provider: 'r2', src: 'https://other/master.m3u8' },
      { provider: 'akamai', src: 'https://x/y.m3u8' },
      { provider: 'bunny', src: 'http://insecure/playlist.m3u8' },
      null,
      { provider: 'bunny', src: BUNNY, type: 'video/mp4' },
    ])).toEqual([
      { provider: 'r2', src: R2, type: 'application/x-mpegURL' },
      { provider: 'bunny', src: BUNNY, type: 'application/x-mpegURL' },
    ]);
    expect(playbackSourcesOf('nope')).toEqual([]);
  });

  it('plays the sources, else the single playUrl labelled by delivery (older responses)', () => {
    const sources = [{ provider: 'bunny' as const, src: BUNNY, type: 'application/x-mpegURL' as const }];
    expect(playbackList({ playUrl: R2, sources, delivery: { source: 'r2' } })).toBe(sources);
    expect(playbackList({ playUrl: R2, delivery: { source: 'r2' } })).toEqual([{ provider: 'r2', src: R2, type: 'application/x-mpegURL' }]);
    expect(playbackList({ playUrl: BUNNY })).toEqual([{ provider: 'bunny', src: BUNNY, type: 'application/x-mpegURL' }]);
    expect(playbackList({})).toEqual([]);
  });
});
