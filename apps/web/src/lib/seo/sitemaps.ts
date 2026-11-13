/**
 * The videos site's sitemaps (wiki AUN-SEO, "Sitemap architecture"):
 *
 *   /sitemap.xml                 sitemap index
 *   /sitemaps/static.xml         home and list pages
 *   /sitemaps/videos-{n}.xml     public videos and Shorts, with the video extension
 *   /sitemaps/channels-{n}.xml   public channels
 *   /sitemaps/playlists-{n}.xml  public playlists
 *
 * Data: the api's GET /api/sitemap and /api/sitemap/:kind (public items only: never unlisted,
 * private, scheduled or removed). Every page is listed in both languages, each its own canonical
 * with an en/ar pair and x-default English (D-SEO-1).
 */
import { watchFallbackDescription } from './structured-data';

export const SITEMAP_KINDS = ['videos', 'channels', 'playlists'] as const;
export type SitemapKind = (typeof SITEMAP_KINDS)[number];

export interface SitemapSummary {
  pageSize: number;
  kinds: Partial<Record<SitemapKind, { count: number; pages: number; lastModified: string | null }>>;
}
export interface SitemapVideo {
  id: string;
  title: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  duration: number | null;
  isShort?: boolean;
  isLive: boolean;
  publishedAt: string | null;
  lastModified: string | null;
  channelName?: string;
}
export interface SitemapChannel { id: string; handle?: string; name: string; lastModified: string | null }
export interface SitemapPlaylist { id: string; title: string; lastModified: string | null }

const LOCALES = ['en', 'ar'] as const;
/** Static pages listed in static.xml ('' is the home page). */
export const STATIC_PATHS = ['', '/videos', '/channels', '/sections', '/live'] as const;

const xml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
// Characters XML 1.0 forbids (control characters) are dropped from text nodes
const clean = (text: string) => xml(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ''));
const day = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso : null);

const URLSET_OPEN = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">';

function alternates(urlFor: (lang: string) => string): string {
  return [
    ...LOCALES.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${xml(urlFor(l))}"/>`),
    `<xhtml:link rel="alternate" hreflang="x-default" href="${xml(urlFor('en'))}"/>`,
  ].join('');
}

function urlEntries(urlFor: (lang: string) => string, lastModified: string | null, extra: (lang: string) => string = () => ''): string[] {
  const lastmod = day(lastModified);
  const alts = alternates(urlFor);
  return LOCALES.map((l) => `<url><loc>${xml(urlFor(l))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${alts}${extra(l)}</url>`);
}

export function sitemapIndexXml(origin: string, summary: SitemapSummary): string {
  const files: { loc: string; lastmod: string | null }[] = [{ loc: `${origin}/sitemaps/static.xml`, lastmod: null }];
  for (const kind of SITEMAP_KINDS) {
    const k = summary.kinds[kind];
    for (let n = 0; n < (k?.pages ?? 0); n += 1) files.push({ loc: `${origin}/sitemaps/${kind}-${n}.xml`, lastmod: day(k?.lastModified) });
  }
  const body = files.map((f) => `<sitemap><loc>${xml(f.loc)}</loc>${f.lastmod ? `<lastmod>${f.lastmod}</lastmod>` : ''}</sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export function staticSitemapXml(origin: string): string {
  const urls = STATIC_PATHS.flatMap((path) => urlEntries((l) => `${origin}/${l}${path}`, null));
  return `${URLSET_OPEN}\n${urls.join('\n')}\n</urlset>\n`;
}

export function videosSitemapXml(origin: string, videos: SitemapVideo[]): string {
  const urls = videos.flatMap((v) =>
    urlEntries(
      // A Short's page is /shorts/{id} (D-SEO-10)
      (l) => `${origin}/${l}/${v.isShort ? 'shorts' : 'video'}/${encodeURIComponent(v.id)}`,
      v.lastModified ?? v.publishedAt,
      (l) => {
        const title = v.titleLocalized?.[l] || v.title;
        if (!title) return '';
        const description = (v.description || watchFallbackDescription(l, title, v.channelName)).slice(0, 2048);
        const duration = v.duration && v.duration > 0 ? Math.min(Math.round(v.duration), 28800) : null;
        return [
          '<video:video>',
          `<video:thumbnail_loc>${xml(`${origin}/thumb/${encodeURIComponent(v.id)}.jpg`)}</video:thumbnail_loc>`,
          `<video:title>${clean(title.slice(0, 100))}</video:title>`,
          `<video:description>${clean(description)}</video:description>`,
          `<video:player_loc>${xml(`${origin}/embed/v/${encodeURIComponent(v.id)}`)}</video:player_loc>`,
          duration ? `<video:duration>${duration}</video:duration>` : '',
          day(v.publishedAt) ? `<video:publication_date>${v.publishedAt}</video:publication_date>` : '',
          '<video:family_friendly>yes</video:family_friendly>',
          v.isLive ? '<video:live>yes</video:live>' : '',
          '</video:video>',
        ].join('');
      },
    ),
  );
  return `${URLSET_OPEN}\n${urls.join('\n')}\n</urlset>\n`;
}

export function channelsSitemapXml(origin: string, channels: SitemapChannel[]): string {
  const urls = channels.flatMap((c) =>
    urlEntries((l) => (c.handle ? `${origin}/${l}/@${encodeURIComponent(c.handle)}` : `${origin}/${l}/channels/${encodeURIComponent(c.id)}`), c.lastModified),
  );
  return `${URLSET_OPEN}\n${urls.join('\n')}\n</urlset>\n`;
}

export function playlistsSitemapXml(origin: string, playlists: SitemapPlaylist[]): string {
  const urls = playlists.flatMap((p) => urlEntries((l) => `${origin}/${l}/playlist/${encodeURIComponent(p.id)}`, p.lastModified));
  return `${URLSET_OPEN}\n${urls.join('\n')}\n</urlset>\n`;
}

/** A sitemap file name: static.xml or <kind>-<page>.xml; null for anything else. */
export function parseSitemapFile(file: string): { kind: 'static' } | { kind: SitemapKind; page: number } | null {
  if (file === 'static.xml') return { kind: 'static' };
  const match = /^(videos|channels|playlists)-(\d{1,5})\.xml$/.exec(file);
  return match ? { kind: match[1] as SitemapKind, page: Number(match[2]) } : null;
}

export const SITEMAP_HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400',
};
