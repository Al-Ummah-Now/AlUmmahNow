import { appLinks, appUrlsFromIssuer } from '@al-ummah/shared-types';

/** The account menu's "Al Ummah Now apps" section (docs/design/NAV.md). */
describe('appLinks', () => {
  const urls = appUrlsFromIssuer('https://auth.qa.alummahnow.net');

  it('derives every app from the auth server', () => {
    expect(urls).toEqual({
      www: 'https://www.qa.alummahnow.net',
      videos: 'https://videos.qa.alummahnow.net',
      cms: 'https://cms.qa.alummahnow.net',
      profile: 'https://profile.auth.qa.alummahnow.net',
      auth: 'https://auth.qa.alummahnow.net',
    });
    expect(appUrlsFromIssuer('http://localhost:3000')).toEqual({});
    expect(appUrlsFromIssuer(undefined)).toEqual({});
  });

  it('a member sees the public apps in the shared order, never the current one', () => {
    expect(appLinks({ current: 'videos', roles: ['user'], lang: 'ar', urls }).map((a) => a.id)).toEqual(['www', 'profile']);
    expect(appLinks({ current: 'www', roles: [], lang: 'en', urls }).map((a) => a.href)).toEqual([
      'https://videos.qa.alummahnow.net/en',
      'https://profile.auth.qa.alummahnow.net/?lang=en',
    ]);
  });

  it('gates staff apps by role like each app guard (role spellings normalized)', () => {
    expect(appLinks({ current: 'videos', roles: ['Scholar'], lang: 'en', urls }).map((a) => a.id)).toEqual(['www', 'profile', 'cms']);
    expect(appLinks({ current: 'videos', roles: ['moderator'], lang: 'en', urls }).map((a) => a.id)).toEqual(['www', 'profile', 'cms', 'admin']);
    expect(appLinks({ current: 'admin', roles: ['Super Admin'], lang: 'en', urls }).map((a) => a.id)).toEqual(['www', 'videos', 'profile', 'cms', 'auth-admin']);
    expect(appLinks({ current: 'videos', roles: ['admin'], lang: 'en', urls }).find((a) => a.id === 'admin')?.href).toBe('https://admin.qa.alummahnow.net');
    expect(appLinks({ current: 'videos', roles: ['admin'], lang: 'en', urls }).find((a) => a.id === 'auth-admin')?.href).toBe('https://admin.auth.qa.alummahnow.net');
  });

  it('leaves out an app whose address is unknown', () => {
    expect(appLinks({ current: 'videos', roles: ['admin'], lang: 'en', urls: { www: 'https://www.example.test' } }).map((a) => a.id)).toEqual(['www', 'admin']);
  });
});
