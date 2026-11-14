/**
 * Where a channel's scholar site is, for this site's canonicals (wiki AUN-SCHOLAR-SITES §4.4, #1215):
 * "the canonical follows the brand host".
 *   - posts of a channel with a live site are canonical on the site (subdomain or own domain);
 *   - videos are canonical on the site only when it is on the scholar's own domain (SS7).
 * The API answers GET /api/sites/by-channel/:id (404 = no live site). Anything else (API down, bad
 * answer) keeps this site canonical: a page never fails or changes its status because of this lookup.
 */
import { cache } from 'react';
import { siteAlternates, siteUrl, type PublicSiteLink } from '@al-ummah/shared-types';
import { buildApiUrl } from '@/lib/api/api-client';
import { logger } from '@/lib/logger-server';

const MEMO_MS = 60_000;
const memo = new Map<string, { at: number; link: PublicSiteLink | null }>();

/** Tests: forget the per-isolate memo. */
export function resetSiteLinkMemo(): void {
  memo.clear();
}

function isSiteLink(value: unknown, channelId: string): value is PublicSiteLink {
  const v = value as Partial<PublicSiteLink> | null;
  return (
    !!v &&
    v.channelId === channelId &&
    typeof v.primaryHost === 'string' &&
    /^[a-z0-9.-]+$/.test(v.primaryHost) &&
    (v.primaryKind === 'subdomain' || v.primaryKind === 'custom') &&
    Array.isArray(v.locales) &&
    v.locales.length > 0 &&
    v.locales.every((l) => l === 'en' || l === 'ar')
  );
}

async function fetchSiteLink(channelId: string, now: number): Promise<PublicSiteLink | null> {
  const hit = memo.get(channelId);
  if (hit && now - hit.at < MEMO_MS) return hit.link;
  try {
    const response = await fetch(buildApiUrl(`/api/sites/by-channel/${encodeURIComponent(channelId)}`), {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
    });
    if (response.status === 404) {
      memo.set(channelId, { at: now, link: null });
      return null;
    }
    if (!response.ok) {
      logger.warn('[seo] site link lookup failed; this site stays canonical', { channelId, status: response.status });
      return null;
    }
    const body: unknown = await response.json();
    const link = isSiteLink(body, channelId) ? body : null;
    memo.set(channelId, { at: now, link });
    return link;
  } catch (error) {
    logger.warn('[seo] site link lookup error; this site stays canonical', { channelId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** The channel's live site, or null. Per request memoised, and per isolate for a minute. */
export const loadSiteLink = cache((channelId: string | undefined | null): Promise<PublicSiteLink | null> =>
  channelId ? fetchSiteLink(channelId, Date.now()) : Promise.resolve(null));

/** A video's page on the site when the site holds its canonical (own domain), else null. */
export function siteWatchCanonical(link: PublicSiteLink | null, locale: string, videoId: string): { canonical: string; languages: Record<string, string> } | null {
  if (!link || link.primaryKind !== 'custom') return null;
  const path = `watch/${encodeURIComponent(videoId)}/`;
  return { canonical: siteUrl(link, locale, path), languages: siteAlternates(link, path) };
}

/** A community post's page on the site when the channel has a live site, else null. */
export function sitePostCanonical(link: PublicSiteLink | null, locale: string, postId: string): { canonical: string; languages: Record<string, string> } | null {
  if (!link) return null;
  const path = `posts/${encodeURIComponent(postId)}/`;
  return { canonical: siteUrl(link, locale, path), languages: siteAlternates(link, path) };
}
