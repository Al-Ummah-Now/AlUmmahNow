/**
 * The About page's metadata. CMS pages belong to www (wiki AUN-SEO, "One canonical URL for each piece
 * of content, on the host that owns it"), so the videos site's /{l}/about is canonical to www's
 * /{l}/about/ and its hreflang links name www's pages, as a channel's scholar-site pages do
 * (lib/seo/site-link.ts). Without a www URL (local dev) the page is its own canonical.
 */
import type { Metadata } from 'next';
import { siteName } from '@/lib/seo/structured-data';
import { ogImages, twitterImages } from '@/lib/seo/site-share-image';
import type { CmsPage } from './cms-page';
import { parseMarkdown, plainText } from './markdown';

export const ABOUT_SLUG = 'about';

/** www's address of a CMS page in a language. */
export const wwwPageUrl = (wwwUrl: string, locale: string, slug: string) => `${wwwUrl}/${locale}/${encodeURIComponent(slug)}/`;

export function aboutLinks(page: CmsPage, locale: 'en' | 'ar', wwwUrl: string): { canonical: string; languages: Record<string, string> } {
  const at = (l: string, slug: string) => (wwwUrl ? wwwPageUrl(wwwUrl, l, slug) : `/${l}/about`);
  const slugs: Record<string, string> = { [page.locale]: page.slug };
  for (const a of page.alternates) slugs[a.locale] = a.slug;
  const languages: Record<string, string> = {};
  for (const l of ['en', 'ar'] as const) if (slugs[l]) languages[l] = at(l, slugs[l]!);
  languages['x-default'] = languages.en ?? languages[page.locale]!;
  // The page in the language asked for; a borrowed language (no translation) points to the original
  return { canonical: at(page.locale, page.slug), languages: page.locale === locale ? languages : { [page.locale]: at(page.locale, page.slug) } };
}

export function aboutMetadata(page: CmsPage, locale: 'en' | 'ar', wwwUrl: string): Metadata {
  const title = `${page.seo_title || page.title} | ${siteName(locale)}`;
  const description = page.seo_description || page.summary || plainText(parseMarkdown(page.body, { wwwUrl, locale: page.locale }));
  const { canonical, languages } = aboutLinks(page, locale, wwwUrl);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical, languages },
    openGraph: { title, description, type: 'website', url: canonical, siteName: siteName(locale), images: ogImages(null, title) },
    twitter: { card: 'summary', title, description, images: twitterImages(null) },
  };
}
