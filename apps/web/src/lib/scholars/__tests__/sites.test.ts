import { cmsLinks, deriveCmsUrl, deriveWwwUrl, isScholar, scholarPageUrl } from '../sites';

describe('scholar links', () => {
  it('derives the CMS and www hosts from the auth issuer, per environment', () => {
    expect(deriveCmsUrl('https://auth.alummahnow.net')).toBe('https://cms.alummahnow.net');
    expect(deriveWwwUrl('https://auth.qa.alummahnow.net/')).toBe('https://www.qa.alummahnow.net');
    expect(deriveCmsUrl('http://localhost:8787')).toBe('');
    expect(deriveCmsUrl('https://auth.evil.test')).toBe('');
    expect(deriveCmsUrl('https://auth.notalummahnow.net')).toBe('');
    expect(deriveCmsUrl('https://auth.alummahnow.net.evil.test')).toBe('');
    expect(deriveCmsUrl(undefined, 'http://localhost:8585/')).toBe('http://localhost:8585');
  });

  it('only the Scholar role gets the article links', () => {
    expect(isScholar(['Member', 'Scholar'])).toBe(true);
    expect(isScholar(['scholar'])).toBe(true);
    expect(isScholar(['Moderator'])).toBe(false);
    expect(isScholar(undefined)).toBe(false);
  });

  it('deep links land on the CMS editor and the scholar page', () => {
    expect(cmsLinks('https://cms.qa.alummahnow.net', 'ar')).toEqual({
      write: 'https://cms.qa.alummahnow.net/posts/new?locale=ar&lang=ar',
      articles: 'https://cms.qa.alummahnow.net/posts?lang=ar',
      profile: 'https://cms.qa.alummahnow.net/scholars/me?lang=ar',
    });
    expect(cmsLinks('', 'en')).toBeNull();
    expect(scholarPageUrl('https://www.alummahnow.net', 'en', 'aisha-rahman')).toBe('https://www.alummahnow.net/en/scholars/aisha-rahman/');
  });
});
