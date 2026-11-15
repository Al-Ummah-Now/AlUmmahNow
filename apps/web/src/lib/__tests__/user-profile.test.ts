/**
 * Public profile URLs and SEO (Story 29.5).
 */
import { legacyUserProfilePath, userProfilePath, userProfileRewritePath } from '@/lib/user-url';
import { buildUserProfileJsonLd, buildUserProfileMetadata } from '@/lib/user-profile-metadata';

const profile = { handle: 'Sara.K', resolvedDisplayName: 'Sara', displayNameLocalized: { ar: 'سارة' }, bio: 'Hello there', avatarUrl: 'https://img.example/a.jpg' };

describe('user profile URLs', () => {
  it('rewrites /{l}/u/@handle (and %40) to the route, keeping dots', () => {
    expect(userProfileRewritePath('/en/u/@Sara.K')).toEqual({ locale: 'en', handle: 'Sara.K', path: '/en/u/Sara.K' });
    expect(userProfileRewritePath('/ar/u/%40sara')).toEqual({ locale: 'ar', handle: 'sara', path: '/ar/u/sara' });
    expect(userProfileRewritePath('/en/u/sara')).toBeNull();
    expect(userProfileRewritePath('/en/@sara')).toBeNull();
  });

  it('sends /{l}/u/handle to the @ form', () => {
    expect(legacyUserProfilePath('/en/u/sara.k')).toBe('/en/u/@sara.k');
    expect(legacyUserProfilePath('/en/u/@sara')).toBeNull();
    expect(legacyUserProfilePath('/en/u/sara/extra')).toBeNull();
  });

  it('builds the canonical path', () => {
    expect(userProfilePath('ar', '@Sara')).toBe('/ar/u/@Sara');
  });
});

describe('user profile metadata', () => {
  it('canonical, hreflang pair with x-default English, profile card, indexable', () => {
    const meta = buildUserProfileMetadata(profile, 'en', 'https://videos.example');
    expect(meta.title).toBe('Sara (@Sara.K)');
    expect(meta.description).toBe('Hello there');
    expect(meta.alternates?.canonical).toBe('https://videos.example/en/u/@Sara.K');
    expect(meta.alternates?.languages).toEqual({
      en: 'https://videos.example/en/u/@Sara.K',
      ar: 'https://videos.example/ar/u/@Sara.K',
      'x-default': 'https://videos.example/en/u/@Sara.K',
    });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect((meta.openGraph as { type?: string }).type).toBe('profile');
  });

  it('uses the localized name and a fallback description without a bio', () => {
    const meta = buildUserProfileMetadata({ ...profile, bio: '' }, 'ar', 'https://videos.example');
    expect(meta.title).toBe('سارة (@Sara.K)');
    expect(meta.description).toBe('سارة على الأمة الآن.');
  });

  it('no profile, no metadata', () => {
    expect(buildUserProfileMetadata(null, 'en', 'https://x')).toEqual({});
  });

  it('JSON-LD: ProfilePage about a Person', () => {
    const ld = buildUserProfileJsonLd(profile, 'en', 'https://videos.example') as { "@type": string; mainEntity: Record<string, unknown> };
    expect(ld['@type']).toBe('ProfilePage');
    expect(ld.mainEntity).toMatchObject({ '@type': 'Person', name: 'Sara', alternateName: '@Sara.K', url: 'https://videos.example/en/u/@Sara.K', image: profile.avatarUrl });
    expect(buildUserProfileJsonLd(profile, 'en', null)).toBeNull();
  });
});
