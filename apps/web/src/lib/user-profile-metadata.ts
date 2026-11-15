/**
 * Public profile SEO (Story 29.5, wiki AUN-SEO): one canonical URL per profile (/{locale}/u/@{handle}
 * in the stored casing), each language its own canonical with x-default English (D-SEO-1), an
 * `og:type=profile` card and `ProfilePage` JSON-LD about a `Person`. Profiles are not in the sitemaps.
 * Missing, removed and handle-less profiles are real 404s (noindex) from the route.
 */

import type { Metadata } from 'next';
import { publicProfileTranslations } from '@al-ummah/shared-types';
import { metaDescription } from '@/lib/seo/description';
import { ogImages, twitterImages } from '@/lib/seo/site-share-image';
import { siteName } from '@/lib/seo/structured-data';
import { userProfilePath } from '@/lib/user-url';
import type { PublicUserProfile } from '@/lib/api/public-profile';

type ProfileFields = Pick<PublicUserProfile, 'handle' | 'resolvedDisplayName' | 'displayNameLocalized' | 'bio' | 'bioLocalized' | 'avatarUrl'>;

export function profileName(profile: ProfileFields, locale: string): string {
  return profile.displayNameLocalized?.[locale] || profile.resolvedDisplayName || `@${profile.handle}`;
}

export function profileBio(profile: ProfileFields, locale: string): string {
  return (profile.bioLocalized?.[locale] || profile.bio || '').trim();
}

export function buildUserProfileMetadata(profile: ProfileFields | null, locale: string, origin: string | null): Metadata {
  if (!profile) return {};
  const name = profileName(profile, locale);
  const title = `${name} (@${profile.handle})`;
  const description = metaDescription(profileBio(profile, locale) || publicProfileTranslations(locale).page.fallbackDescription.replace('{name}', name));
  const path = userProfilePath(locale, profile.handle);
  const otherLocale = locale === 'ar' ? 'en' : 'ar';
  return {
    title,
    description,
    alternates: origin
      ? {
          canonical: `${origin}${path}`,
          languages: {
            [locale]: `${origin}${path}`,
            [otherLocale]: `${origin}${userProfilePath(otherLocale, profile.handle)}`,
            'x-default': `${origin}${userProfilePath('en', profile.handle)}`,
          },
        }
      : undefined,
    robots: { index: true, follow: true },
    openGraph: {
      type: 'profile',
      title,
      description,
      siteName: siteName(locale),
      username: profile.handle,
      ...(origin ? { url: `${origin}${path}` } : {}),
      images: ogImages(profile.avatarUrl, name),
    },
    twitter: { card: 'summary', title, description, images: twitterImages(profile.avatarUrl) },
  };
}

export function buildUserProfileJsonLd(profile: ProfileFields | null, locale: string, origin: string | null) {
  if (!profile || !origin) return null;
  const url = `${origin}${userProfilePath(locale, profile.handle)}`;
  const bio = profileBio(profile, locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    inLanguage: locale === 'ar' ? 'ar' : 'en',
    mainEntity: {
      '@type': 'Person',
      '@id': `${url}#person`,
      name: profileName(profile, locale),
      alternateName: `@${profile.handle}`,
      url,
      ...(bio ? { description: bio.slice(0, 500) } : {}),
      ...(profile.avatarUrl ? { image: profile.avatarUrl } : {}),
    },
  };
}
