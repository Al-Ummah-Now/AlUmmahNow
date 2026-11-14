/**
 * @jest-environment node
 */
import { breadcrumbLd, chapterClips, isoDuration, listPageMetadata, videoObjectLd, websiteLd } from '../structured-data';

const O = 'https://videos.alummahnow.net';

describe('structured data (wiki AUN-SEO)', () => {
  it('VideoObject: stable thumbnail, upload date, ISO duration, embed and views', () => {
    const ld = videoObjectLd({ id: 'v1', title: 'Talk', playUrl: 'x', poster: '/thumb/v1.jpg', duration: 3725, uploadDate: '2026-11-10T13:21:10.224Z', views: 11, channelName: 'Channel', channelHandle: 'chan' }, 'en', O);
    expect(ld).toMatchObject({
      '@type': 'VideoObject',
      name: 'Talk',
      description: 'Watch “Talk” from Channel on Al Ummah Now.',
      thumbnailUrl: [`${O}/thumb/v1.jpg`],
      uploadDate: '2026-11-10T13:21:10.224Z',
      duration: 'PT1H2M5S',
      embedUrl: `${O}/embed/v/v1`,
      url: `${O}/en/video/v1`,
      author: { name: 'Channel', url: `${O}/en/@chan` },
      publisher: { '@id': 'https://www.alummahnow.net/#organization' },
      interactionStatistic: { userInteractionCount: 11 },
    });
    expect(ld).not.toHaveProperty('contentUrl');
  });

  it('VideoObject in Arabic uses the Arabic title and fallback', () => {
    const ld = videoObjectLd({ id: 'v1', title: 'Talk', titleLocalized: { ar: 'محاضرة' }, playUrl: 'x' }, 'ar', O);
    expect(ld.name).toBe('محاضرة');
    expect(ld.description).toBe('شاهد «محاضرة» على الأمة الآن.');
    expect(ld.inLanguage).toBe('ar');
  });

  it('a live video carries a BroadcastEvent', () => {
    expect(videoObjectLd({ id: 'v1', title: 'Live', playUrl: 'x', isLive: true }, 'en', O).publication).toEqual({ '@type': 'BroadcastEvent', isLiveBroadcast: true });
  });

  it('chapters become Clip parts linking to the watch page at their start (key moments)', () => {
    const chapters = [
      { startTime: 125.7, title: 'Second', titleLocalized: { ar: 'الثاني' } },
      { startTime: 0, endTime: 125, title: 'Intro' },
      { startTime: 125.2, title: 'Duplicate start' },
      { startTime: 400, title: 'Past the end' },
      { startTime: 200, title: '   ' },
    ];
    const ld = videoObjectLd({ id: 'v1', title: 'Talk', playUrl: 'x', duration: 300, hasChapters: true }, 'en', O, chapters);
    expect(ld.hasPart).toEqual([
      { '@type': 'Clip', name: 'Intro', startOffset: 0, endOffset: 125, url: `${O}/en/video/v1?t=0` },
      { '@type': 'Clip', name: 'Second', startOffset: 125, endOffset: 300, url: `${O}/en/video/v1?t=125` },
    ]);
    // The page's language, and a Short's own URL
    const ar = chapterClips(chapters, `${O}/ar/shorts/v1`, 'ar', 300);
    expect(ar[1]).toMatchObject({ name: 'الثاني', url: `${O}/ar/shorts/v1?t=125` });
    // Unknown duration: the last clip has no end
    expect(chapterClips(chapters.slice(0, 2), `${O}/en/video/v1`, 'en')[1]).not.toHaveProperty('endOffset');
  });

  it('one usable chapter, no chapters or a live stream give no Clip parts', () => {
    const v = { id: 'v1', title: 'Talk', playUrl: 'x', duration: 300 };
    expect(videoObjectLd(v, 'en', O, [{ startTime: 0, title: 'Only' }]).hasPart).toBeUndefined();
    expect(videoObjectLd(v, 'en', O).hasPart).toBeUndefined();
    expect(videoObjectLd({ ...v, isLive: true }, 'en', O, [{ startTime: 0, title: 'A' }, { startTime: 60, title: 'B' }]).hasPart).toBeUndefined();
  });

  it('isoDuration', () => {
    expect(isoDuration(59)).toBe('PT59S');
    expect(isoDuration(60)).toBe('PT1M');
    expect(isoDuration(0)).toBeUndefined();
  });

  it('WebSite has the search action; breadcrumbs are positioned', () => {
    expect(websiteLd('ar', O).potentialAction.target.urlTemplate).toBe(`${O}/ar/search?q={search_term_string}`);
    expect(breadcrumbLd([{ name: 'A', url: 'u1' }, { name: 'B', url: 'u2' }]).itemListElement[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'B', item: 'u2' });
  });

  it('list pages: absolute title, self-canonical, x-default', () => {
    const meta = listPageMetadata('ar', '/videos', 'جميع المرئيات', 'وصف');
    expect(meta.title).toEqual({ absolute: 'جميع المرئيات | الأمة الآن' });
    expect(meta.alternates).toEqual({ canonical: '/ar/videos', languages: { en: '/en/videos', ar: '/ar/videos', 'x-default': '/en/videos' } });
  });
});
