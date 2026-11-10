import { type NextRequest, NextResponse } from 'next/server';
import { getOpenAuthClient } from '@/lib/auth/openauth-client';
import { withAuthorizeLocale } from '@/lib/auth/authorize-locale';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { RETURN_COOKIE, SILENT_COOKIE, parsePrompt, safeReturnPath } from '@/lib/auth/silent-sign-in';
import { PKCE_COOKIE, STATE_COOKIE, newStateNonce, pkceCookieValue, stateCookieOptions, withState } from '@/lib/auth/oauth-state';

/**
 * GET /api/auth/login?prompt=none|login&return=/en/watch/...&locale=en
 *
 * Starts a sign-in from the browser without a form post: the silent sign-in
 * of the client probe and of account switching (prompt=none: the auth server
 * answers with a code for its active account, or error=login_required, never
 * with UI). The return path and whether the attempt is silent travel to the
 * callback in short-lived cookies, because redirect_uri must stay
 * byte-identical at /authorize and /token.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const prompt = parsePrompt(url.searchParams.get('prompt'));
  const localeParam = url.searchParams.get('locale');
  const locale = localeParam && isLocaleSupported(localeParam) ? localeParam : DEFAULT_LOCALE;
  const returnPath = safeReturnPath(url.searchParams.get('return'));

  const host = req.headers.get('host') ?? url.host;
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const { url: authorizeUrl, challenge } = await getOpenAuthClient().authorize(`${protocol}://${host}/api/callback`, 'code', { pkce: true });
  // Bind the callback to this browser (login CSRF)
  const nonce = newStateNonce();
  const target = new URL(withAuthorizeLocale(withState(authorizeUrl, nonce), locale));
  if (prompt) target.searchParams.set('prompt', prompt);

  const response = NextResponse.redirect(target.toString(), 302);
  const cookie = { httpOnly: true, sameSite: 'lax' as const, secure: protocol === 'https', path: '/', maxAge: 600 };
  response.cookies.set('auth_locale', locale, cookie);
  response.cookies.set(STATE_COOKIE, nonce, stateCookieOptions(protocol === 'https'));
  if (challenge.verifier) response.cookies.set(PKCE_COOKIE, pkceCookieValue(nonce, challenge.verifier), stateCookieOptions(protocol === 'https'));
  if (returnPath) response.cookies.set(RETURN_COOKIE, returnPath, cookie);
  else response.cookies.delete(RETURN_COOKIE);
  if (prompt === 'none') response.cookies.set(SILENT_COOKIE, '1', cookie);
  else response.cookies.delete(SILENT_COOKIE);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
