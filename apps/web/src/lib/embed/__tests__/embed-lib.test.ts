/**
 * @jest-environment node
 *
 * Embeds & sharing helpers (docs/embeds/README.md).
 */
// React.cache exists in Next's server React build, not in the react@18 test copy
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { isValidContentId, normalizeOrigin, parseEmbedParams, parseTime } from '../params';
import {
  EMBED_SIZES,
  embedUrl,
  formatTimestamp,
  iframeSnippet,
  oembedEndpointUrl,
  responsiveSnippet,
  shareTargets,
  watchPageUrl,
} from '../snippets';
import { buildEvent, embedderOrigin, parseCommand, resolvePartnerOrigin } from '../messaging';
import { buildOEmbed, fitSize, parseContentUrl } from '../oembed';
import { viewContextFromBatch } from '../view-context';
import { buildWatchMetadata, declaredPlayerSize } from '../watch-metadata';
import { posterFor, toEmbedVideo, videoAspect } from '../content';
import { isEmbedPath, isOEmbedPath } from '../routes';
import { embedStrings, fill } from '../strings';

const HOST = 'https://videos.qa.alummahnow.net';

describe('parseTime', () => {
  it.each([
    ['754', 754],
    ['754.9', 754],
    ['754s', 754],
    ['12m34s', 754],
    ['1h2m3s', 3723],
    ['2m', 120],
    ['0', 0],
  ])('%s → %s', (input, expected) => {
    expect(parseTime(input)).toBe(expected);
  });

  it.each([null, undefined, '', 'abc', '-5', '1x', 'h', `${49 * 3600}`])('rejects %p', (input) => {
    expect(parseTime(input as string | null | undefined)).toBeNull();
  });
});

describe('parseEmbedParams', () => {
  it('uses safe defaults', () => {
    expect(parseEmbedParams({})).toEqual({
      lang: 'en', start: 0, end: null, autoplay: false, gesture: false, loop: false, showTitle: true, index: 0, origin: null,
    });
  });

  it('reads every documented parameter', () => {
    const params = parseEmbedParams(new URLSearchParams(
      'lang=ar&start=1m&end=90&autoplay=1&loop=1&title=0&index=2&origin=https%3A%2F%2Fwww.alummahnow.net%2Fx',
    ));
    expect(params).toEqual({
      lang: 'ar', start: 60, end: 90, autoplay: true, gesture: false, loop: true, showTitle: false, index: 2, origin: 'https://www.alummahnow.net',
    });
  });

  it('gesture=1 only counts with autoplay=1 (a host-page click started playback)', () => {
    expect(parseEmbedParams({ autoplay: '1', gesture: '1' })).toMatchObject({ autoplay: true, gesture: true });
    expect(parseEmbedParams({ gesture: '1' })).toMatchObject({ autoplay: false, gesture: false });
    expect(parseEmbedParams({ autoplay: '1', gesture: 'yes' })).toMatchObject({ autoplay: true, gesture: false });
  });

  it('accepts t as an alias of start and ignores an end before the start', () => {
    expect(parseEmbedParams({ t: '30', end: '10' })).toMatchObject({ start: 30, end: null });
  });

  it('falls back on invalid values', () => {
    expect(parseEmbedParams({ lang: 'fr', autoplay: 'yes', index: '-1', origin: 'javascript:alert(1)' }))
      .toMatchObject({ lang: 'en', autoplay: false, index: 0, origin: null });
    expect(parseEmbedParams({ lang: ['ar', 'en'] }).lang).toBe('ar');
  });
});

describe('ids and origins', () => {
  it('accepts uuids and refuses path tricks', () => {
    expect(isValidContentId('ddd1c77b-4833-4d75-b1ce-105a4d083480')).toBe(true);
    expect(isValidContentId('../admin')).toBe(false);
    expect(isValidContentId('a/b')).toBe(false);
    expect(isValidContentId('')).toBe(false);
  });
  it('normalizes origins', () => {
    expect(normalizeOrigin('https://example.org/path?q')).toBe('https://example.org');
    expect(normalizeOrigin('data:text/html,hi')).toBeNull();
  });
});

describe('routes', () => {
  it('matches embed frames only', () => {
    expect(isEmbedPath('/embed/v/abc')).toBe(true);
    expect(isEmbedPath('/embed/p/abc/')).toBe(true);
    expect(isEmbedPath('/embed/comments/abc')).toBe(true);
    expect(isEmbedPath('/embed/widget.js')).toBe(false);
    expect(isEmbedPath('/en/video/abc')).toBe(false);
    expect(isEmbedPath('/embed/v/abc/extra')).toBe(false);
    expect(isOEmbedPath('/oembed')).toBe(true);
    expect(isOEmbedPath('/oembedx')).toBe(false);
  });
});

describe('snippets', () => {
  it('builds embed and watch URLs', () => {
    expect(embedUrl(HOST + '/', 'video', 'v1')).toBe(`${HOST}/embed/v/v1`);
    expect(embedUrl(HOST, 'video', 'v1', { start: 754.6, autoplay: true, lang: 'ar' }))
      .toBe(`${HOST}/embed/v/v1?start=754&autoplay=1&lang=ar`);
    expect(embedUrl(HOST, 'playlist', 'p1')).toBe(`${HOST}/embed/p/p1`);
    expect(watchPageUrl(HOST, 'ar', 'v1', 90)).toBe(`${HOST}/ar/video/v1?t=90`);
    expect(watchPageUrl(HOST, 'en', 'v1', 0)).toBe(`${HOST}/en/video/v1`);
    expect(watchPageUrl(HOST, 'en', 'v1', 30, { id: 'pl1', index: 2 })).toBe(`${HOST}/en/video/v1?list=pl1&index=2&t=30`);
    expect(oembedEndpointUrl(HOST, `${HOST}/en/video/v1`))
      .toBe(`${HOST}/oembed?url=${encodeURIComponent(`${HOST}/en/video/v1`)}&format=json`);
  });

  it('builds the fixed-size iframe snippet with the documented attributes', () => {
    const html = iframeSnippet(`${HOST}/embed/v/v1`, EMBED_SIZES[0], 'A "quoted" <title>');
    expect(html).toBe(
      `<iframe src="${HOST}/embed/v/v1" width="560" height="315" title="A &quot;quoted&quot; &lt;title&gt;" ` +
      'frameborder="0" loading="lazy" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen ' +
      'referrerpolicy="strict-origin-when-cross-origin"></iframe>',
    );
  });

  it('builds the responsive snippet', () => {
    const html = responsiveSnippet(`${HOST}/embed/v/v1`, 'T');
    expect(html).toContain('aspect-ratio:16/9');
    expect(html).toContain(`src="${HOST}/embed/v/v1"`);
  });

  it('offers the four 16:9 sizes', () => {
    expect(EMBED_SIZES.map((s) => `${s.width}x${s.height}`)).toEqual(['560x315', '640x360', '853x480', '1280x720']);
    for (const size of EMBED_SIZES) expect(Math.abs(size.width / size.height - 16 / 9)).toBeLessThan(0.01);
  });

  it('formats timestamps', () => {
    expect(formatTimestamp(754)).toBe('12:34');
    expect(formatTimestamp(3723)).toBe('1:02:03');
    expect(formatTimestamp(-3)).toBe('0:00');
  });

  it('encodes share targets', () => {
    const targets = shareTargets('https://x.org/a?b=1', 'Tafsir & more');
    expect(targets.map((t) => t.id)).toEqual(['whatsapp', 'telegram', 'x', 'facebook', 'email']);
    expect(targets.find((t) => t.id === 'facebook')!.href).toBe('https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fx.org%2Fa%3Fb%3D1');
    expect(targets.find((t) => t.id === 'email')!.href).toContain('subject=Tafsir%20%26%20more');
  });
});

describe('postMessage partner origin', () => {
  it('prefers the real ancestor origin', () => {
    expect(resolvePartnerOrigin({ originParam: null, ancestorOrigins: ['https://a.org'], referrer: 'https://b.org/x' })).toBe('https://a.org');
  });
  it('refuses an origin param that differs from the real ancestor', () => {
    expect(resolvePartnerOrigin({ originParam: 'https://evil.org', ancestorOrigins: ['https://a.org'], referrer: '' })).toBeNull();
    expect(resolvePartnerOrigin({ originParam: 'https://a.org', ancestorOrigins: ['https://a.org'], referrer: '' })).toBe('https://a.org');
  });
  it('falls back to the origin param, then the referrer origin, else off', () => {
    expect(resolvePartnerOrigin({ originParam: 'https://c.org', ancestorOrigins: [], referrer: 'https://b.org/x' })).toBe('https://c.org');
    expect(resolvePartnerOrigin({ originParam: null, ancestorOrigins: [], referrer: 'https://b.org/page?q' })).toBe('https://b.org');
    expect(resolvePartnerOrigin({ originParam: null, ancestorOrigins: [], referrer: '' })).toBeNull();
  });
  it('derives the embedding origin for analytics without the path', () => {
    expect(embedderOrigin([], 'https://www.alummahnow.net/articles/1')).toBe('https://www.alummahnow.net');
    expect(embedderOrigin(['https://cms.alummahnow.net'], 'https://other.org/')).toBe('https://cms.alummahnow.net');
    expect(embedderOrigin([], '')).toBeNull();
  });
});

describe('postMessage messages', () => {
  it('validates commands', () => {
    expect(parseCommand({ type: 'aun:v1:command', command: 'play' })).toEqual({ type: 'aun:v1:command', command: 'play' });
    expect(parseCommand({ type: 'aun:v1:command', command: 'seek', seconds: '12.5' })).toEqual({ type: 'aun:v1:command', command: 'seek', seconds: 12.5 });
    expect(parseCommand({ type: 'aun:v1:command', command: 'seek', seconds: -1 })).toBeNull();
    expect(parseCommand({ type: 'aun:v1:command', command: 'eval' })).toBeNull();
    expect(parseCommand({ type: 'aun:v2:command', command: 'play' })).toBeNull();
    expect(parseCommand('play')).toBeNull();
    expect(parseCommand(null)).toBeNull();
  });
  it('builds versioned events', () => {
    expect(buildEvent('timeupdate', { videoId: 'v1', currentTime: 1.23456, duration: NaN, muted: true })).toEqual({
      type: 'aun:v1:event', event: 'timeupdate', videoId: 'v1', currentTime: 1.235, duration: null, muted: true,
    });
    expect(buildEvent('error', { videoId: 'v1', playlistId: 'p1', currentTime: 0, duration: 75, muted: false }, { code: 'unavailable' }))
      .toMatchObject({ event: 'error', playlistId: 'p1', duration: 75, error: { code: 'unavailable' } });
  });
});

describe('oEmbed', () => {
  const host = 'videos.qa.alummahnow.net';
  it.each([
    [`${HOST}/en/video/v1`, { kind: 'video', id: 'v1' }],
    [`${HOST}/ar/video/v1/`, { kind: 'video', id: 'v1' }],
    [`${HOST}/en/video?vid=v1&t=1m`, { kind: 'video', id: 'v1', start: 60 }],
    [`${HOST}/embed/v/v1?start=30`, { kind: 'video', id: 'v1', start: 30 }],
    [`${HOST}/en/playlist/p1`, { kind: 'playlist', id: 'p1' }],
    [`${HOST}/embed/p/p1`, { kind: 'playlist', id: 'p1' }],
    // A video in a public playlist keeps the list; the viewer's private aliases never do
    [`${HOST}/en/video/v1?list=p1&index=2`, { kind: 'video', id: 'v1', list: 'p1' }],
    [`${HOST}/en/video/v1?list=WL&index=2`, { kind: 'video', id: 'v1' }],
    [`${HOST}/en/video/v1?list=LL`, { kind: 'video', id: 'v1' }],
  ])('recognises %s', (url, expected) => {
    expect(parseContentUrl(url, host)).toEqual(expected);
  });

  it.each([
    'https://evil.example/en/video/v1',
    'https://videos.alummahnow.net/en/video/v1',
    `${HOST}/en/channels/c1`,
    `${HOST}/fr/video/v1`,
    `${HOST}/en/video/..%2Fx`,
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s', (url) => {
    expect(parseContentUrl(url, host)).toBeNull();
  });

  it('a playlist embed starts at the given item', () => {
    const doc = buildOEmbed(HOST, { kind: 'playlist', id: 'p1', index: 2 }, { width: 640, height: 360 }, { title: 'List' });
    expect(doc.html).toContain('/embed/p/p1?index=2');
    expect(doc.aun_playlist_id).toBe('p1');
  });

  it('fits 16:9 sizes within the limits', () => {
    expect(fitSize(null, null)).toEqual({ width: 640, height: 360 });
    expect(fitSize('480', null)).toEqual({ width: 480, height: 270 });
    expect(fitSize('5000', '5000')).toEqual({ width: 1280, height: 720 });
    expect(fitSize('1000', '300')).toEqual({ width: 533, height: 300 });
    expect(fitSize('50', null)).toEqual({ width: 200, height: 113 });
    expect(fitSize('abc', '-4')).toEqual({ width: 640, height: 360 });
    // a Short (9:16): tall, never a 16:9 box
    expect(fitSize(null, null, 9 / 16)).toEqual({ width: 360, height: 640 });
    expect(fitSize('5000', '5000', 9 / 16)).toEqual({ width: 720, height: 1280 });
    expect(fitSize('550', '550', 9 / 16)).toEqual({ width: 309, height: 550 });
    // square
    expect(fitSize(null, null, 1)).toEqual({ width: 640, height: 640 });
    expect(fitSize('500', '400', 1)).toEqual({ width: 400, height: 400 });
  });

  it('builds a valid oEmbed 1.0 video response', () => {
    const response = buildOEmbed(HOST, { kind: 'video', id: 'v1', start: 30 }, { width: 640, height: 360 }, {
      title: 'Tafsir', authorName: 'Channel', authorUrl: `${HOST}/en/@chan`, thumbnailUrl: 'https://cdn/x.jpg', duration: 75.4,
    });
    expect(response).toEqual({
      version: '1.0',
      type: 'video',
      provider_name: 'Al Ummah Now',
      provider_url: HOST,
      title: 'Tafsir',
      author_name: 'Channel',
      author_url: `${HOST}/en/@chan`,
      thumbnail_url: 'https://cdn/x.jpg',
      thumbnail_width: 1280,
      thumbnail_height: 720,
      width: 640,
      height: 360,
      html: iframeSnippet(`${HOST}/embed/v/v1?start=30`, { width: 640, height: 360 }, 'Tafsir'),
      aun_video_id: 'v1',
      aun_duration: 75,
    });
  });

  it('builds a playlist response without video-only fields', () => {
    const response = buildOEmbed(HOST, { kind: 'playlist', id: 'p1' }, { width: 640, height: 360 }, { title: 'List' });
    expect(response.aun_playlist_id).toBe('p1');
    expect(response.aun_video_id).toBeUndefined();
    expect(response.html).toContain(`${HOST}/embed/p/p1`);
    expect(response).not.toHaveProperty('thumbnail_url');
  });
});

describe('viewContextFromBatch', () => {
  it('accepts embed context with a clean origin', () => {
    expect(viewContextFromBatch({ source: 'embed', embedOrigin: 'https://a.org/page' })).toEqual({ source: 'embed', embedOrigin: 'https://a.org' });
    expect(viewContextFromBatch({ source: 'embed', embedOrigin: 'nope' })).toEqual({ source: 'embed' });
  });
  it('defaults everything else to a watch-page view', () => {
    expect(viewContextFromBatch(undefined)).toEqual({ source: 'watch' });
    expect(viewContextFromBatch({ source: 'other', embedOrigin: 'https://a.org' })).toEqual({ source: 'watch' });
    expect(viewContextFromBatch('embed')).toEqual({ source: 'watch' });
  });
});

describe('toEmbedVideo (visibility)', () => {
  const base = { id: 'v1', title: 'T', playUrl: 'https://vz.b-cdn.net/tok/v1/playlist.m3u8', isPublic: true, uploadStatus: 'ready', duration: '75' };
  it('maps a public, ready video', () => {
    expect(toEmbedVideo(base)).toMatchObject({ id: 'v1', duration: 75, poster: '/thumb/v1.jpg', thumbnailSource: 'https://vz.b-cdn.net/tok/v1/thumbnail.jpg' });
  });
  it.each([
    ['private', { isPublic: false }],
    ['deleted', { isDeleted: true }],
    ['hidden', { isHidden: true }],
    ['processing', { uploadStatus: 'processing' }],
    ['failed', { uploadStatus: 'failed' }],
    ['without a stream', { playUrl: undefined }],
  ])('refuses a %s video', (_label, overrides) => {
    expect(toEmbedVideo({ ...base, ...overrides })).toBeNull();
  });
  it('keeps legacy videos without an upload status', () => {
    expect(toEmbedVideo({ ...base, uploadStatus: undefined })).not.toBeNull();
  });
  it('prefers the API thumbnail (custom thumbnails, the chosen source) over the playlist directory', () => {
    expect(posterFor('https://vz/t/v1/playlist.m3u8', 'https://images.alummahnow.net/t/v1/a.webp')).toBe('https://images.alummahnow.net/t/v1/a.webp');
    expect(toEmbedVideo({ ...base, playUrl: 'https://vz/t/v1/playlist.m3u8', thumbnailUrl: undefined })?.thumbnailSource).toBe('https://vz/t/v1/thumbnail.jpg');
  });
  it('derives posters', () => {
    expect(posterFor(undefined, 'cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg');
    expect(posterFor('https://a/v.mp4', undefined)).toBeUndefined();
  });
});

describe('buildWatchMetadata', () => {
  const video = toEmbedVideo({
    id: 'v1', title: 'Title', titleLocalized: { en: 'Title', ar: 'العنوان' }, description: 'x'.repeat(300),
    playUrl: 'https://vz/t/v1/playlist.m3u8', isPublic: true,
  });

  it('renders OG video, a Twitter player card, hreflang and the oEmbed link', () => {
    const meta = buildWatchMetadata(video, 'ar', HOST);
    expect(meta.title).toBe('العنوان');
    expect((meta.description as string).length).toBeLessThanOrEqual(200);
    expect(meta.alternates?.canonical).toBe(`${HOST}/ar/video/v1`);
    expect(meta.alternates?.languages).toEqual({ en: `${HOST}/en/video/v1`, ar: `${HOST}/ar/video/v1` });
    expect(meta.alternates?.types).toEqual({
      'application/json+oembed': [{ url: oembedEndpointUrl(HOST, `${HOST}/ar/video/v1`), title: 'العنوان' }],
    });
    expect(meta.openGraph).toMatchObject({
      type: 'video.other',
      videos: [{ url: `${HOST}/embed/v/v1?lang=ar`, type: 'text/html', width: 1280, height: 720 }],
    });
    expect(meta.twitter).toMatchObject({ card: 'player', players: [{ playerUrl: `${HOST}/embed/v/v1?lang=ar`, width: 1280, height: 720 }] });
  });

  it('adds nothing for unavailable videos', () => {
    expect(buildWatchMetadata(null, 'en', HOST)).toEqual({});
  });

  it("declares the video's own ratio: a Short is 9:16, so X gives it a tall card (2026-11-12)", () => {
    const short = toEmbedVideo({ id: 's1', title: 'Short', playUrl: 'https://vz/t/s1/playlist.m3u8', isPublic: true, width: 720, height: 1280, isShort: true });
    const meta = buildWatchMetadata(short, 'en', HOST);
    expect(meta.twitter).toMatchObject({ card: 'player', players: [{ playerUrl: expect.stringContaining('/embed/v/s1'), width: 405, height: 720 }] });
    expect(meta.openGraph).toMatchObject({ videos: [{ type: 'text/html', width: 405, height: 720 }] });
    // a Short flag with no size is still 9:16; a square is square; unknown stays 1280x720
    expect(declaredPlayerSize({ isShort: true })).toEqual({ width: 405, height: 720 });
    expect(declaredPlayerSize({ width: 1080, height: 1080 })).toEqual({ width: 720, height: 720 });
    expect(declaredPlayerSize({ width: 427, height: 240 })).toEqual({ width: 1280, height: 719 });
    expect(declaredPlayerSize({})).toEqual({ width: 1280, height: 720 });
  });

  it('declares the encoded size, not a fixed 9:16: production Short 720x1256 → 413x720, oEmbed 367x640 (2026-11-12 Twitterbot fetch)', () => {
    const short = toEmbedVideo({ id: 's2', title: 'Short', playUrl: 'https://vz/t/s2/playlist.m3u8', isPublic: true, width: 720, height: 1256, isShort: true });
    const meta = buildWatchMetadata(short, 'ar', HOST);
    expect(meta.twitter).toMatchObject({ players: [{ width: 413, height: 720 }] });
    expect(meta.openGraph).toMatchObject({ videos: [{ width: 413, height: 720 }], images: [{ width: 413, height: 720 }] });
    expect(fitSize(null, null, 720 / 1256)).toEqual({ width: 367, height: 640 });
    // a landscape video keeps a 16:9 card
    const wide = toEmbedVideo({ id: 'w1', title: 'Wide', playUrl: 'https://vz/t/w1/playlist.m3u8', isPublic: true, width: 1920, height: 1080 });
    expect(buildWatchMetadata(wide, 'en', HOST).twitter).toMatchObject({ players: [{ width: 1280, height: 720 }] });
  });
});

describe('player box ratio', () => {
  it('videoAspect: the encoded size, else 9:16 for a Short, else unknown', () => {
    expect(videoAspect({ width: 1280, height: 720 })).toBeCloseTo(16 / 9);
    expect(videoAspect({ isShort: true })).toBeCloseTo(9 / 16);
    expect(videoAspect({})).toBeNull();
    expect(toEmbedVideo({ id: 'v', playUrl: 'https://vz/t/v/playlist.m3u8', isPublic: true, width: 0, height: 720 })).not.toHaveProperty('width');
  });
});

describe('share images', () => {
  // 2026-11-12: crawlers cache og:image / twitter:image; a signed Bunny URL breaks once its token expires
  it('og:image and twitter:image are the stable /thumb URL, never a signed CDN URL', () => {
    for (const thumbnailUrl of [
      'https://vz-215a1ffd-a5a.b-cdn.net/bcdn_token=T&expires=1794459600&token_path=%2Fv1%2F/v1/thumbnail_1.jpg',
      'https://vz-215a1ffd-a5a.b-cdn.net/v1/thumbnail.jpg?token=T&expires=1794459600',
    ]) {
      const signed = toEmbedVideo({
        id: 'v1', title: 'T', isPublic: true, thumbnailUrl,
        playUrl: 'https://vz-215a1ffd-a5a.b-cdn.net/bcdn_token=P&expires=1794535200&token_path=%2Fv1%2F/v1/playlist.m3u8',
      });
      const meta = buildWatchMetadata(signed, 'en', HOST);
      const images = JSON.stringify([meta.openGraph?.images, meta.twitter?.images]);
      expect(images).not.toMatch(/bcdn_token|token=/);
      expect(meta.openGraph?.images).toEqual([expect.objectContaining({ url: `${HOST}/thumb/v1.jpg` })]);
      expect(meta.twitter?.images).toEqual([`${HOST}/thumb/v1.jpg`]);
    }
  });
});

describe('strings', () => {
  it('has the same keys in both languages and fills templates', () => {
    expect(Object.keys(embedStrings('ar')).sort()).toEqual(Object.keys(embedStrings('en')).sort());
    expect(fill(embedStrings('en').startAt, { time: '1:00' })).toBe('Start at 1:00');
    expect(fill('{a} {b}', { a: 1 })).toBe('1 {b}');
  });
});
