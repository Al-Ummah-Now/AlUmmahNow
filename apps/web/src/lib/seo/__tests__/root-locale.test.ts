/**
 * @jest-environment node
 */
import { LANGUAGE_PREFERENCE_COOKIE } from '@/lib/i18n/utils/localeHelpers';
import { acceptedLocale, ROOT_LOCALE_COOKIE, rootLocale, rootLocaleRedirect } from '../root-locale';

const req = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Request(`https://videos.alummahnow.net${path}`, { headers, method });

describe('root locale redirect (Field RUM: the / hop)', () => {
  it('picks the saved language, then the browser language, then English', () => {
    expect(rootLocale(req('/', { cookie: 'a=1; preferred-language=ar', 'accept-language': 'en' }))).toBe('ar');
    expect(rootLocale(req('/', { 'accept-language': 'ar-EG,ar;q=0.9,en;q=0.8' }))).toBe('ar');
    expect(rootLocale(req('/', { cookie: 'preferred-language=fr', 'accept-language': 'fr-FR, en;q=0.5' }))).toBe('en');
    expect(rootLocale(req('/'))).toBe('en');
  });

  it('reads the same cookie the language switcher writes, and survives a malformed one', () => {
    expect(ROOT_LOCALE_COOKIE).toBe(LANGUAGE_PREFERENCE_COOKIE);
    expect(rootLocale(req('/', { cookie: 'preferred-language=%E0%A4%A', 'accept-language': 'ar' }))).toBe('ar');
  });

  it('ranks Accept-Language by q and ignores q=0', () => {
    expect(acceptedLocale('en;q=0.4, ar;q=0.9')).toBe('ar');
    expect(acceptedLocale('ar;q=0, en')).toBe('en');
    expect(acceptedLocale('de, fr')).toBeNull();
    expect(acceptedLocale('garbage;;;q=x')).toBeNull();
  });

  it('answers / with a browser-cacheable, private 307 that varies on cookie and language, query kept', () => {
    const res = rootLocaleRedirect(req('/?utm_source=x', { 'accept-language': 'ar' }))!;
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/ar?utm_source=x');
    expect(res.headers.get('cache-control')).toBe('private, max-age=600');
    expect(res.headers.get('vary')).toBe('Cookie, Accept-Language');
  });

  it('leaves every other request alone', () => {
    expect(rootLocaleRedirect(req('/en'))).toBeNull();
    expect(rootLocaleRedirect(req('/', {}, 'POST'))).toBeNull();
  });
});
