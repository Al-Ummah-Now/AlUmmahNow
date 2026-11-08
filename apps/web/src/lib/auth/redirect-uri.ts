/**
 * The redirect_uri sent to /authorize and the one sent with the code exchange
 * must be byte-for-byte equal: the issuer rejects the code otherwise. Both sides
 * build it here, so they cannot drift (incident 2026-11-07: login() added
 * ?locale= at authorize, the callbacks exchanged without it, and every sign-in
 * and "add account" failed).
 */

export const CALLBACK_PATH = '/api/callback';
export const MULTI_ACCOUNT_CALLBACK_PATH = '/api/callback/multi-account';

/** redirect_uri for /authorize: the callback path, carrying the locale to return to. */
export function authorizeRedirectUri(origin: string, callbackPath: string, locale?: string | null): string {
  return `${origin}${callbackPath}${locale ? `?locale=${encodeURIComponent(locale)}` : ''}`;
}

/**
 * redirect_uri for the code exchange, rebuilt from the URL the issuer redirected
 * to: same origin and path, same locale (other parameters such as code and state
 * were added by the issuer and are not part of it).
 */
export function exchangeRedirectUri(callbackUrl: URL): string {
  return authorizeRedirectUri(callbackUrl.origin, callbackUrl.pathname, callbackUrl.searchParams.get('locale'));
}

/** Origin of the current request from its Host header (http only for localhost). */
export function originFromHost(host: string | null): string {
  const protocol = host?.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}`;
}
