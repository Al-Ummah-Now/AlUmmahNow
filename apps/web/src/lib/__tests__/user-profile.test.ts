/**
 * Public profile URLs and SEO (Story 29.5).
 */
import { PROFILE_X_ROBOTS, legacyUserProfilePath, userProfilePath, userProfileRewritePath } from '@/lib/user-url';
import { buildUserProfileMetadata } from '@/lib/user-profile-metadata';

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

  it('builds the profile path', () => {
    expect(userProfilePath('ar', '@Sara')).toBe('/ar/u/@Sara');
  });
});

describe('user profile metadata (never indexed: owner, 2026-11-14 "searching users? nope")', () => {
  it('noindex, nofollow; no canonical or hreflang; keeps the title and the share card', () => {
    const meta = buildUserProfileMetadata(profile, 'en');
    expect(meta.title).toBe('Sara (@Sara.K)');
    expect(meta.description).toBe('Hello there');
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBeUndefined();
    expect((meta.openGraph as { type?: string; url?: string }).type).toBe('profile');
    expect((meta.openGraph as { url?: string }).url).toBeUndefined();
    expect(PROFILE_X_ROBOTS).toBe('noindex, nofollow');
  });

  it('uses the localized name and a fallback description without a bio', () => {
    const meta = buildUserProfileMetadata({ ...profile, bio: '' }, 'ar');
    expect(meta.title).toBe('سارة (@Sara.K)');
    expect(meta.description).toBe('سارة على الأمة الآن.');
  });

  it('no profile: still noindex, nofollow', () => {
    expect(buildUserProfileMetadata(null, 'en')).toEqual({ robots: { index: false, follow: false } });
  });
});
