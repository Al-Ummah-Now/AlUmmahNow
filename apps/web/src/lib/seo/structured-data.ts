/**
 * Page metadata and JSON-LD for the videos site (wiki AUN-SEO, "Page templates" and "Structured
 * data"). Values are in the page's language; thumbnails are always the stable /thumb image, never a
 * signed CDN URL; the Organization @id is shared with www. The site's default description comes
 * from the root layout (D-SEO-6, the copy PR); nothing here sets one.
 */
import type { Metadata } from 'next';
import type { EmbedVideo } from '@/lib/embed/content';
import { canonicalWatchUrl, embedUrl } from '@/lib/embed/snippets';
import { shareImageUrl } from '@/lib/embed/share-image';

export const WWW_ORGANIZATION_ID = 'https://www.alummahnow.net/#organization';

export const siteName = (locale: string) => (locale === 'ar' ? 'الأمة الآن' : 'Al Ummah Now');

/** The description a watch page uses when its video has none. */
export function watchFallbackDescription(locale: string, title: string, channelName?: string): string {
  if (locale === 'ar') return channelName ? `شاهد «${title}» من ${channelName} على الأمة الآن.` : `شاهد «${title}» على الأمة الآن.`;
  return channelName ? `Watch “${title}” from ${channelName} on Al Ummah Now.` : `Watch “${title}” on Al Ummah Now.`;
}

/** The description a channel page uses when the channel has none. */
export function channelFallbackDescription(locale: string, name: string): string {
  return locale === 'ar' ? `${name} على الأمة الآن: المرئيات والمقاطع القصيرة والمنشورات.` : `${name} on Al Ummah Now: videos, Shorts and posts.`;
}

/** The description a playlist page uses when the playlist has none. */
export function playlistFallbackDescription(locale: string, title: string, channelName?: string): string {
  if (locale === 'ar') return channelName ? `قائمة التشغيل «${title}» من ${channelName} على الأمة الآن.` : `قائمة التشغيل «${title}» على الأمة الآن.`;
  return channelName ? `The “${title}” playlist from ${channelName} on Al Ummah Now.` : `The “${title}” playlist on Al Ummah Now.`;
}

/**
 * A list page (videos, channels, sections): the full title as is (it already names the site),
 * self-canonical, each language its own canonical with x-default English (D-SEO-1).
 */
export function listPageMetadata(locale: string, path: string, name: string, description?: string): Metadata {
  const title = `${name} | ${siteName(locale)}`;
  const at = (lang: string) => `/${lang}${path}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: at(locale), languages: { en: at('en'), ar: at('ar'), 'x-default': at('en') } },
    openGraph: { title, description, type: 'website', url: at(locale), siteName: siteName(locale) },
  };
}

/** ISO 8601 duration (PT1H2M3S) for whole seconds; undefined when unknown. */
export function isoDuration(seconds?: number): string | undefined {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}

/** A watch page's VideoObject. Only for public videos: never for unlisted or private ones. */
export function videoObjectLd(video: EmbedVideo, locale: string, origin: string) {
  const lang = locale === 'ar' ? 'ar' : 'en';
  const name = video.titleLocalized?.[lang] || video.title;
  const own = (video.descriptionLocalized?.[lang] || video.description || '').replace(/\s+/g, ' ').trim();
  // A Short's page is /shorts/{id} (D-SEO-10)
  const page = canonicalWatchUrl(origin, lang, video);
  const duration = isoDuration(video.duration);
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    '@id': `${page}#video`,
    name,
    description: (own || watchFallbackDescription(lang, name, video.channelName)).slice(0, 2048),
    ...(video.poster ? { thumbnailUrl: [shareImageUrl(origin, video.id)] } : {}),
    ...(video.uploadDate ? { uploadDate: video.uploadDate } : {}),
    ...(duration ? { duration } : {}),
    embedUrl: embedUrl(origin, 'video', video.id),
    url: page,
    inLanguage: lang,
    ...(typeof video.views === 'number'
      ? { interactionStatistic: { '@type': 'InteractionCounter', interactionType: { '@type': 'WatchAction' }, userInteractionCount: video.views } }
      : {}),
    ...(video.channelName
      ? { author: { '@type': 'Organization', name: video.channelName, ...(video.channelHandle ? { url: `${origin}/${lang}/@${video.channelHandle}` } : {}) } }
      : {}),
    publisher: { '@id': WWW_ORGANIZATION_ID },
    ...(video.isLive ? { publication: { '@type': 'BroadcastEvent', isLiveBroadcast: true } } : {}),
  };
}

export function breadcrumbLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: item.url })),
  };
}

/** The videos site's home: WebSite with its search box, published by the shared Organization. */
export function websiteLd(locale: string, origin: string) {
  const lang = locale === 'ar' ? 'ar' : 'en';
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: siteName(lang),
    alternateName: siteName(lang === 'ar' ? 'en' : 'ar'),
    url: `${origin}/${lang}`,
    inLanguage: lang,
    publisher: { '@id': WWW_ORGANIZATION_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${origin}/${lang}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** A channel page: a ProfilePage about the channel. */
export function channelLd(channel: { name: string; description?: string; avatarUrl?: string; url: string; sameAs?: string[] }, locale: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: channel.url,
    inLanguage: locale === 'ar' ? 'ar' : 'en',
    mainEntity: {
      '@type': 'Organization',
      '@id': `${channel.url}#channel`,
      name: channel.name,
      url: channel.url,
      ...(channel.description ? { description: channel.description.slice(0, 500) } : {}),
      ...(channel.avatarUrl ? { image: channel.avatarUrl } : {}),
      ...(channel.sameAs?.length ? { sameAs: channel.sameAs } : {}),
    },
  };
}

/** JSON for a <script type="application/ld+json">: `<` escaped so content can never close the tag. */
export const jsonLdText = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
