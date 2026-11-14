import { metaDescription } from '@/lib/seo/description';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { Channel } from '@al-ummah/shared-types';
import { channelPath } from '@/lib/channel-url';
import { channelFallbackDescription, channelLd, siteName } from '@/lib/seo/structured-data';

/** Absolute origin of the current request (canonical links need absolute URLs). */
async function requestOrigin(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    if (!host) return null;
    const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

/**
 * Channel page metadata: title/description in the page locale and a canonical
 * link to /{locale}/@{handle} (old /channels/{id} URLs keep working but point
 * search engines at the handle URL).
 */
export async function buildChannelMetadata(channel: Channel | null, locale: string): Promise<Metadata> {
  if (!channel) return {};
  const title = channel.nameLocalized?.[locale] || channel.name;
  // A channel without a description gets one naming it, never the site's default text
  const description = metaDescription((channel.descriptionLocalized?.[locale] || channel.description || '').trim() || channelFallbackDescription(locale, title));
  const origin = await requestOrigin();
  const path = channelPath(locale, channel);
  const otherLocale = locale === 'ar' ? 'en' : 'ar';
  const image = channel.avatarUrl || undefined;
  return {
    title,
    description,
    alternates: origin
      ? {
          canonical: `${origin}${path}`,
          // Each language is its own canonical; x-default is English (D-SEO-1)
          languages: { [locale]: `${origin}${path}`, [otherLocale]: `${origin}${channelPath(otherLocale, channel)}`, 'x-default': `${origin}${channelPath('en', channel)}` },
        }
      : undefined,
    // The channel's own card (it used to inherit the site's, with og:url = the site root)
    openGraph: {
      type: 'profile',
      title,
      description,
      siteName: siteName(locale),
      ...(origin ? { url: `${origin}${path}` } : {}),
      ...(image ? { images: [{ url: image, alt: title }] } : {}),
    },
    twitter: { card: 'summary', title, description, ...(image ? { images: [image] } : {}) },
  };
}

/** The channel page's JSON-LD (ProfilePage about the channel), or null without an origin. */
export async function buildChannelJsonLd(channel: Channel | null, locale: string, sameAs: string[] = []) {
  if (!channel) return null;
  const origin = await requestOrigin();
  if (!origin) return null;
  const name = channel.nameLocalized?.[locale] || channel.name;
  return channelLd({
    name,
    description: (channel.descriptionLocalized?.[locale] || channel.description || '').trim() || undefined,
    avatarUrl: channel.avatarUrl || undefined,
    url: `${origin}${channelPath(locale, channel)}`,
    sameAs,
  }, locale);
}
