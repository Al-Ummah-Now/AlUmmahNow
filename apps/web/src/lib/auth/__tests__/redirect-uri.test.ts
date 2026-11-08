/**
 * Release regression R1 (unit): the redirect_uri a flow authorizes with must be
 * exactly the one its callback exchanges with.
 */
import { authorizeRedirectUri, exchangeRedirectUri, originFromHost, CALLBACK_PATH, MULTI_ACCOUNT_CALLBACK_PATH } from '../redirect-uri';

/** What the issuer does: redirect to redirect_uri with code and state appended. */
function issuerRedirect(redirectUri: string): URL {
  const url = new URL(redirectUri);
  url.searchParams.set('code', 'c0de');
  url.searchParams.set('state', 's7a7e');
  return url;
}

describe('redirect_uri round trip', () => {
  it.each([
    ['sign-in', CALLBACK_PATH, 'en'],
    ['sign-in (Arabic)', CALLBACK_PATH, 'ar'],
    ['add account', MULTI_ACCOUNT_CALLBACK_PATH, 'en'],
    ['add account (Arabic)', MULTI_ACCOUNT_CALLBACK_PATH, 'ar'],
    ['sign-in without locale', CALLBACK_PATH, undefined],
  ])('%s: exchange uses the authorize redirect_uri', (_name, path, locale) => {
    const authorize = authorizeRedirectUri('https://videos.alummahnow.net', path, locale);
    expect(exchangeRedirectUri(issuerRedirect(authorize))).toBe(authorize);
  });

  it('keeps the locale in the authorize redirect_uri', () => {
    expect(authorizeRedirectUri('https://videos.alummahnow.net', MULTI_ACCOUNT_CALLBACK_PATH, 'ar')).toBe(
      'https://videos.alummahnow.net/api/callback/multi-account?locale=ar',
    );
  });

  it('uses http only for localhost', () => {
    expect(originFromHost('localhost:3000')).toBe('http://localhost:3000');
    expect(originFromHost('videos.alummahnow.net')).toBe('https://videos.alummahnow.net');
  });
});
