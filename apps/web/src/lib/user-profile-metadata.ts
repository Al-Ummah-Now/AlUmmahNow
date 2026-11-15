/**
 * Public profile metadata (Story 29.5). Profiles are never indexed (owner, 2026-11-14: "searching
 * users? nope"): `noindex, nofollow`, no canonical or hreflang, no structured data, and never in the
 * sitemaps (the middleware also sends X-Robots-Tag). The title, description and share card stay, so
 * a link someone pastes still previews.
 */

import type { Metadata } from 'next';
import { publicProfileTranslations } from '@al-ummah/shared-types';
import { metaDescription } from '@/lib/seo/description';
import { ogImages, twitterImages } from '@/lib/seo/site-share-image';
import { siteName } from '@/lib/seo/structured-data';
import type { PublicUserProfile } from '@/lib/api/public-profile';

type ProfileFields = Pick<PublicUserProfile, 'handle' | 'resolvedDisplayName' | 'displayNameLocalized' | 'bio' | 'bioLocalized' | 'avatarUrl'>;

/** Never indexed, never followed: for a profile and for the 404 alike */
export const PROFILE_ROBOTS: Metadata['robots'] = { index: false, follow: false };

export function profileName(profile: ProfileFields, locale: string): string {
  return profile.displayNameLocalized?.[locale] || profile.resolvedDisplayName || `@${profile.handle}`;
}

export function profileBio(profile: ProfileFields, locale: string): string {
  return (profile.bioLocalized?.[locale] || profile.bio || '').trim();
}

export function buildUserProfileMetadata(profile: ProfileFields | null, locale: string): Metadata {
  if (!profile) return { robots: PROFILE_ROBOTS };
  const name = profileName(profile, locale);
  const title = `${name} (@${profile.handle})`;
  const description = metaDescription(profileBio(profile, locale) || publicProfileTranslations(locale).page.fallbackDescription.replace('{name}', name));
  return {
    title,
    description,
    robots: PROFILE_ROBOTS,
    openGraph: {
      type: 'profile',
      title,
      description,
      siteName: siteName(locale),
      username: profile.handle,
      images: ogImages(profile.avatarUrl, name),
    },
    twitter: { card: 'summary', title, description, images: twitterImages(profile.avatarUrl) },
  };
}
