/**
 * @jest-environment node
 */
import { breadcrumbLd, isoDuration, listPageMetadata, videoObjectLd, websiteLd } from '../structured-data';

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
