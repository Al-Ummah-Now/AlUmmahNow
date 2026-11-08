import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { Channel } from '@al-ummah/shared-types';
import { channelPath } from '@/lib/channel-url';

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
  const description = channel.descriptionLocalized?.[locale] || channel.description || undefined;
  const origin = await requestOrigin();
  const path = channelPath(locale, channel);
  const otherLocale = locale === 'ar' ? 'en' : 'ar';
  return {
    title,
    description,
    alternates: origin
      ? {
          canonical: `${origin}${path}`,
          languages: { [locale]: `${origin}${path}`, [otherLocale]: `${origin}${channelPath(otherLocale, channel)}` },
        }
      : undefined,
  };
}
