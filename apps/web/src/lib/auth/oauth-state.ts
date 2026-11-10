/**
 * OAuth `state` bound to the browser that started the sign-in.
 *
 * Every authorize this site starts (sign in, add account, silent sign-in)
 * puts a fresh random nonce in `state` and in a short-lived httpOnly cookie
 * scoped to /api/callback (which covers /api/callback/multi-account). The
 * callbacks refuse a code whose state does not match the cookie, without
 * exchanging it and without touching the session: a forged callback link can
 * no longer sign the visitor in as someone else (login CSRF).
 *
 * No Next.js imports: shared by server actions, route handlers and tests.
 */

export const STATE_COOKIE = 'auth_state';
export const STATE_COOKIE_PATH = '/api/callback';
export const STATE_MAX_AGE = 600; // 10 minutes

export function stateCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: STATE_COOKIE_PATH, maxAge: STATE_MAX_AGE };
}

/** Options that delete the state cookie (same name and path). */
export const CLEAR_STATE_COOKIE = { name: STATE_COOKIE, path: STATE_COOKIE_PATH } as const;

/** A fresh unguessable nonce (hex, 256 bits). */
export function newStateNonce(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

/** The authorize URL with its state replaced by `nonce`. */
export function withState(authorizeUrl: string, nonce: string): string {
  const url = new URL(authorizeUrl);
  url.searchParams.set('state', nonce);
  return url.toString();
}

/**
 * PKCE (RFC 7636): every authorize also sends an S256 code_challenge; its
 * verifier is kept next to the state cookie (same path and lifetime), bound
 * to the state nonce, and sent with the code exchange. A leaked code can't
 * be redeemed without it, and the auth server can then require PKCE.
 */
export const PKCE_COOKIE = 'auth_pkce';
export const CLEAR_PKCE_COOKIE = { name: PKCE_COOKIE, path: STATE_COOKIE_PATH } as const;

/** Cookie value binding a verifier to the state nonce. */
export function pkceCookieValue(nonce: string, verifier: string): string {
  return `${nonce}.${verifier}`;
}

/** The verifier stored for this callback's `state`, if any. */
export function pkceVerifierFor(state: string | null | undefined, cookie: string | null | undefined): string | undefined {
  if (!state || !cookie) return undefined;
  const dot = cookie.indexOf('.');
  if (dot <= 0 || !stateMatches(state, cookie.slice(0, dot))) return undefined;
  return cookie.slice(dot + 1) || undefined;
}

/** The callback belongs to this browser's sign-in: `state` equals the cookie. */
export function stateMatches(state: string | null | undefined, cookie: string | null | undefined): boolean {
  if (!state || !cookie || !/^[A-Za-z0-9_-]{16,128}$/.test(state) || state.length !== cookie.length) return false;
  let diff = 0;
  for (let i = 0; i < state.length; i++) diff |= state.charCodeAt(i) ^ cookie.charCodeAt(i);
  return diff === 0;
}
