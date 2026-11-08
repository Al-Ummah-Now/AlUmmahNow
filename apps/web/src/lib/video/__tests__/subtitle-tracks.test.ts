import { getSubtitleLabel, toPlayerTextTracks } from '../subtitle-tracks';

const opts = { apiUrl: 'https://api.example.com/', videoId: 'vid 1', uiLocale: 'en' };

describe('subtitle-tracks', () => {
  it('labels languages in the viewer locale', () => {
    expect(getSubtitleLabel('ar', 'en')).toBe('Arabic');
    expect(getSubtitleLabel('ar', 'ar')).toBe('العربية');
    expect(getSubtitleLabel('xx', 'en', 'Custom')).toBe('Custom');
    expect(getSubtitleLabel('xx', 'en')).toBe('xx');
  });

  it('maps API tracks to Video.js remote track options', () => {
    const tracks = toPlayerTextTracks([
      { language: 'en', url: 'https://api.example.com/api/videos/v/subtitles/en', status: 'ready', isDefault: false },
      { language: 'ar', url: 'https://api.example.com/api/videos/v/subtitles/ar', status: 'ready', isDefault: true, kind: 'captions' },
    ], opts);

    expect(tracks).toEqual([
      { src: 'https://api.example.com/api/videos/v/subtitles/en', srclang: 'en', label: 'English', kind: 'subtitles', default: false },
      { src: 'https://api.example.com/api/videos/v/subtitles/ar', srclang: 'ar', label: 'Arabic', kind: 'captions', default: true },
    ]);
  });

  it('resolves relative URLs and builds a URL when missing', () => {
    const tracks = toPlayerTextTracks([
      { language: 'en', url: '/api/videos/v/subtitles/en' },
      { language: 'fr', url: '' },
    ], opts);
    expect(tracks[0].src).toBe('https://api.example.com/api/videos/v/subtitles/en');
    expect(tracks[1].src).toBe('https://api.example.com/api/videos/vid%201/subtitles/fr');
  });

  it('skips tracks that are not ready', () => {
    const tracks = toPlayerTextTracks([
      { language: 'en', url: 'https://x/en', status: 'processing' },
      { language: 'ar', url: 'https://x/ar', status: 'error' },
      { language: 'fr', url: 'https://x/fr', status: 'ready' },
    ], opts);
    expect(tracks.map((t) => t.srclang)).toEqual(['fr']);
  });

  it('marks at most one default track', () => {
    const tracks = toPlayerTextTracks([
      { language: 'en', url: 'https://x/en', isDefault: true },
      { language: 'ar', url: 'https://x/ar', isDefault: true },
    ], opts);
    expect(tracks.filter((t) => t.default)).toHaveLength(1);
    expect(tracks[0].default).toBe(true);
  });
});
