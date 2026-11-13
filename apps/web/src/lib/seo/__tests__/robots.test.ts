import { isProductionDeployment, legacyWatchRedirect, robotsHeaderFor, robotsTxt } from '../robots';

describe('isProductionDeployment', () => {
  it('follows NEXTJS_ENV when it is set', () => {
    expect(isProductionDeployment('production', 'videos.qa.alummahnow.net')).toBe(true);
    expect(isProductionDeployment('qa', 'videos.alummahnow.net')).toBe(false);
    expect(isProductionDeployment('stage', 'videos.stage.alummahnow.net')).toBe(false);
  });
  it('falls back to the host when NEXTJS_ENV is missing', () => {
    expect(isProductionDeployment(undefined, 'videos.alummahnow.net')).toBe(true);
    expect(isProductionDeployment(undefined, 'VIDEOS.alummahnow.net:443')).toBe(true);
    expect(isProductionDeployment(undefined, 'videos.qa.alummahnow.net')).toBe(false);
    expect(isProductionDeployment(undefined, 'localhost:3000')).toBe(false);
    expect(isProductionDeployment(undefined, null)).toBe(false);
  });
});

describe('robotsHeaderFor', () => {
  it('noindexes every page outside production', () => {
    expect(robotsHeaderFor('/en/video/abc', false)).toBe('noindex, nofollow');
    expect(robotsHeaderFor('/robots.txt', false)).toBe('noindex, nofollow');
  });
  it('keeps public pages indexable on production', () => {
    for (const path of ['/en', '/ar', '/en/video/abc', '/ar/@handle', '/en/c/handle', '/en/channels/1', '/en/playlist/p1', '/en/videos', '/en/explore', '/en/live', '/en/contact', '/en/community-guidelines', '/en/historyx']) {
      expect([path, robotsHeaderFor(path, true)]).toEqual([path, null]);
    }
  });
  it('noindexes search results but follows their links', () => {
    expect(robotsHeaderFor('/en/search', true)).toBe('noindex, follow');
  });
  it('noindexes viewer-only pages and tools on production', () => {
    for (const path of ['/en/history', '/ar/library/watch-later', '/en/settings/channel/1/edit', '/en/upload', '/en/studio/c1/content/videos', '/en/notifications', '/en/profile/edit', '/en/subscriptions', '/en/dashboard/videos', '/en/analytics', '/en/scheduled-videos', '/en/auth/error', '/en/dev/player', '/en/video/abc/edit']) {
      expect([path, robotsHeaderFor(path, true)]).toEqual([path, 'noindex, nofollow']);
    }
  });
});

describe('robotsTxt', () => {
  it('disallows everything outside production', () => {
    expect(robotsTxt(false)).toBe('User-agent: *\nDisallow: /\n');
  });
  it('allows pages on production and keeps the noindexed pages crawlable', () => {
    const body = robotsTxt(true);
    expect(body).toContain('Allow: /');
    expect(body).toContain('Disallow: /api/');
    expect(body).not.toMatch(/Disallow: \/\n/);
    expect(body).not.toContain('history');
  });
});

describe('legacyWatchRedirect', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('moves /<locale>/video?vid= to /<locale>/video/<id>, keeping the rest of the query', () => {
    expect(legacyWatchRedirect('/en/video', q('vid=abc'), 'en')).toBe('/en/video/abc');
    expect(legacyWatchRedirect('/ar/video/', q('vid=abc&t=30&list=p1'), 'en')).toBe('/ar/video/abc?t=30&list=p1');
  });
  it('uses the fallback locale for /video?vid=', () => {
    expect(legacyWatchRedirect('/video', q('vid=abc'), 'ar')).toBe('/ar/video/abc');
  });
  it('encodes the id', () => {
    expect(legacyWatchRedirect('/en/video', q('vid=a/b c'), 'en')).toBe('/en/video/a%2Fb%20c');
  });
  it('leaves every other URL alone', () => {
    expect(legacyWatchRedirect('/en/video', q(''), 'en')).toBeNull();
    expect(legacyWatchRedirect('/en/video/abc', q('vid=x'), 'en')).toBeNull();
    expect(legacyWatchRedirect('/en/videos', q('vid=x'), 'en')).toBeNull();
  });
});
