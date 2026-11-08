import { withAuthorizeLocale } from '../authorize-locale';

const AUTHORIZE =
  'https://auth.example/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fweb.example%2Fapi%2Fcallback&response_type=code&state=s1';

describe('withAuthorizeLocale', () => {
  it('asks the auth server for Arabic', () => {
    const url = new URL(withAuthorizeLocale(AUTHORIZE, 'ar'));
    expect(url.searchParams.get('lang')).toBe('ar');
    expect(url.searchParams.get('ui_locales')).toBe('ar');
  });

  it('leaves the OAuth parameters untouched', () => {
    const url = new URL(withAuthorizeLocale(AUTHORIZE, 'en'));
    expect(url.origin + url.pathname).toBe('https://auth.example/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('https://web.example/api/callback');
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('lang')).toBe('en');
  });

  it('ignores a locale the site does not support', () => {
    expect(withAuthorizeLocale(AUTHORIZE, 'xx')).toBe(AUTHORIZE);
  });
});
