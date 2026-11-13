/**
 * The link a share button copies (wiki AUN-SHORT-LINKS): the short link on alummahnow.link when this
 * environment has a short link host, else the page's own URL. Open Graph tags and canonical URLs
 * stay on the real pages; the short link only redirects there.
 *
 * Language: the page's language travels as ?lang=ar on Arabic pages, so a link shared from the
 * Arabic site opens in Arabic as the long /ar/ link did; English is the site default and adds nothing.
 */
import { shortLinkUrl, type ShortLinkOptions, type ShortLinkTarget } from '@al-ummah/shared-types';
import { getShortLinkUrl } from '@/lib/runtime-config';

export function shareLink(target: ShortLinkTarget, fallbackUrl: string, options: Omit<ShortLinkOptions, 'lang'> & { locale?: string } = {}): string {
  const { locale, ...rest } = options;
  return shortLinkUrl(getShortLinkUrl(), target, { ...rest, lang: locale === 'ar' ? 'ar' : null }) ?? fallbackUrl;
}
