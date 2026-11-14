import { originFromHost } from '@/lib/embed/request-origin';
import {
  channelsSitemapXml,
  parseSitemapFile,
  playlistsSitemapXml,
  postsSitemapXml,
  SITEMAP_HEADERS,
  staticSitemapXml,
  videosSitemapXml,
  type SitemapChannel,
  type SitemapPlaylist,
  type SitemapPost,
  type SitemapVideo,
} from '@/lib/seo/sitemaps';
import { sitemapPageData, unavailable } from '@/lib/seo/sitemap-data';

export const dynamic = 'force-dynamic';

/** One sitemap file: static.xml, videos-{n}.xml, channels-{n}.xml, playlists-{n}.xml or posts-{n}.xml. */
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await params;
  const parsed = parseSitemapFile(file);
  const host = request.headers.get('host');
  if (!parsed || !host) return new Response('Not found', { status: 404 });
  const origin = originFromHost(host);
  if (parsed.kind === 'static') return new Response(staticSitemapXml(origin), { headers: SITEMAP_HEADERS });

  if (parsed.kind === 'videos') {
    const data = await sitemapPageData<SitemapVideo>('videos', parsed.page);
    if (!data) return unavailable();
    if (data.items.length === 0 && parsed.page > 0) return new Response('Not found', { status: 404 });
    return new Response(videosSitemapXml(origin, data.items), { headers: SITEMAP_HEADERS });
  }
  if (parsed.kind === 'channels') {
    const data = await sitemapPageData<SitemapChannel>('channels', parsed.page);
    if (!data) return unavailable();
    if (data.items.length === 0 && parsed.page > 0) return new Response('Not found', { status: 404 });
    return new Response(channelsSitemapXml(origin, data.items), { headers: SITEMAP_HEADERS });
  }
  if (parsed.kind === 'posts') {
    const data = await sitemapPageData<SitemapPost>('posts', parsed.page);
    if (!data) return unavailable();
    if (data.items.length === 0 && parsed.page > 0) return new Response('Not found', { status: 404 });
    return new Response(postsSitemapXml(origin, data.items), { headers: SITEMAP_HEADERS });
  }
  const data = await sitemapPageData<SitemapPlaylist>('playlists', parsed.page);
  if (!data) return unavailable();
  if (data.items.length === 0 && parsed.page > 0) return new Response('Not found', { status: 404 });
  return new Response(playlistsSitemapXml(origin, data.items), { headers: SITEMAP_HEADERS });
}
