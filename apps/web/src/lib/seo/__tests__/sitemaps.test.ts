/**
 * @jest-environment node
 */
import { channelsSitemapXml, parseSitemapFile, playlistsSitemapXml, sitemapIndexXml, staticSitemapXml, videosSitemapXml } from '../sitemaps';

const O = 'https://videos.alummahnow.net';
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

describe('videos sitemaps (wiki AUN-SEO)', () => {
  it('the index lists static.xml and one file per page of each kind', () => {
    const xml = sitemapIndexXml(O, { pageSize: 2000, kinds: { videos: { count: 2500, pages: 2, lastModified: '2026-11-13T10:00:00.000Z' }, channels: { count: 3, pages: 1, lastModified: null }, playlists: { count: 0, pages: 0, lastModified: null } } });
    expect(locs(xml)).toEqual([`${O}/sitemaps/static.xml`, `${O}/sitemaps/videos-0.xml`, `${O}/sitemaps/videos-1.xml`, `${O}/sitemaps/channels-0.xml`]);
    expect(xml).toContain('<lastmod>2026-11-13T10:00:00.000Z</lastmod>');
  });

  it('lists every page in both languages, each with the en/ar pair and x-default (D-SEO-1)', () => {
    const xml = staticSitemapXml(O);
    expect(locs(xml)).toEqual(expect.arrayContaining([`${O}/en`, `${O}/ar`, `${O}/en/videos`, `${O}/ar/channels`]));
    const home = xml.split('\n').find((l) => l.includes(`<loc>${O}/ar</loc>`))!;
    expect(home).toContain(`hreflang="en" href="${O}/en"`);
    expect(home).toContain(`hreflang="x-default" href="${O}/en"`);
  });

  it('gives each video the video extension with stable thumbnail, player, duration and date', () => {
    const xml = videosSitemapXml(O, [
      { id: 'v1', title: 'Talk & <more>', titleLocalized: { ar: 'محاضرة' }, description: '', duration: 125.4, isLive: false, publishedAt: '2026-11-10T13:21:10.224Z', lastModified: '2026-11-11T00:00:00.000Z', channelName: 'Channel' },
    ]);
    expect(locs(xml)).toEqual([`${O}/en/video/v1`, `${O}/ar/video/v1`]);
    const en = xml.split('\n').find((l) => l.includes(`<loc>${O}/en/video/v1</loc>`))!;
    expect(en).toContain(`<video:thumbnail_loc>${O}/thumb/v1.jpg</video:thumbnail_loc>`);
    expect(en).toContain('<video:title>Talk &amp; &lt;more&gt;</video:title>');
    expect(en).toContain('<video:description>Watch “Talk &amp; &lt;more&gt;” from Channel on Al Ummah Now.</video:description>');
    expect(en).toContain(`<video:player_loc>${O}/embed/v/v1</video:player_loc>`);
    expect(en).toContain('<video:duration>125</video:duration>');
    expect(en).toContain('<video:publication_date>2026-11-10T13:21:10.224Z</video:publication_date>');
    expect(en).not.toContain('token=');
    const ar = xml.split('\n').find((l) => l.includes(`<loc>${O}/ar/video/v1</loc>`))!;
    expect(ar).toContain('<video:title>محاضرة</video:title>');
  });

  it('adds content_loc only for a public MP4 the API sent, before player_loc (#1200, D-SEO-11)', () => {
    const base = { title: 'Talk', duration: 60, isLive: false, publishedAt: null, lastModified: null };
    const mp4 = 'https://media.alummahnow.net/pub/v1/e29db4ad6918a943/video.mp4';
    const xml = videosSitemapXml(O, [
      { ...base, id: 'v1', contentUrl: mp4 },
      { ...base, id: 'v2' },
      { ...base, id: 'v3', contentUrl: 'https://media.alummahnow.net/priv/v3/abc/video.mp4?token=x' },
      { ...base, id: 'v4', contentUrl: 'http://media.alummahnow.net/pub/v4/abc/video.mp4' },
    ]);
    const line = (id: string) => xml.split('\n').find((l) => l.includes(`<loc>${O}/en/video/${id}</loc>`))!;
    expect(line('v1')).toContain(`<video:content_loc>${mp4}</video:content_loc><video:player_loc>`);
    expect(xml.split('\n').filter((l) => l.includes('<video:content_loc>'))).toHaveLength(2);
    for (const id of ['v2', 'v3', 'v4']) expect(line(id)).not.toContain('content_loc');
    expect(xml).not.toContain('priv/');
  });

  it('uses channel handles and playlist ids', () => {
    expect(locs(channelsSitemapXml(O, [{ id: 'c1', handle: 'one', name: 'One', lastModified: null }, { id: 'c2', name: 'Two', lastModified: null }]))).toEqual([`${O}/en/@one`, `${O}/ar/@one`, `${O}/en/channels/c2`, `${O}/ar/channels/c2`]);
    expect(locs(playlistsSitemapXml(O, [{ id: 'p1', title: 'Series', lastModified: null }]))).toEqual([`${O}/en/playlist/p1`, `${O}/ar/playlist/p1`]);
  });

  it('parses sitemap file names', () => {
    expect(parseSitemapFile('static.xml')).toEqual({ kind: 'static' });
    expect(parseSitemapFile('videos-3.xml')).toEqual({ kind: 'videos', page: 3 });
    expect(parseSitemapFile('users-0.xml')).toBeNull();
    expect(parseSitemapFile('videos-x.xml')).toBeNull();
  });
});
