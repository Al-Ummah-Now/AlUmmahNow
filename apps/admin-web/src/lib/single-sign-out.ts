/**
 * Single sign-out with the auth server.
 *
 * One sign-in covers videos, admin, profile and the auth admin. Signing out
 * of admin goes through the auth server's /logout, which ends the shared
 * sign-in (`__session`) and walks every app's front-channel endpoint
 * (here: GET /api/auth/logout?next=<auth>/logout?...), so each app clears
 * its own session and follows `next` back to the auth server. Without it the
 * next visit to /login signed the user straight back in (#295).
 *
 * Same contract as apps/web/src/lib/auth/single-sign-out.ts.
 */

/** Cookies that can carry admin credentials. */
export const SIGN_IN_COOKIES = ['admin_session', 'access_token', 'refresh_token'] as const;

/** Auth server URL that starts single sign-out and returns to `returnTo`. */
export function startSingleSignOut(issuer: string, returnTo: string): string {
  const url = new URL('/logout', new URL(issuer).origin);
  url.searchParams.set('return', returnTo);
  return url.toString();
}

/**
 * Where the front-channel endpoint goes next: `next` when it is the auth
 * server's /logout (never anywhere else: no open redirect), otherwise it
 * starts single sign-out itself and comes back to this app's home page.
 *
 * On Cloudflare (OpenNext) the query string can reach the route already
 * percent-decoded once, so `next=<auth>/logout?step=2%26return=…` arrives as
 * `next=<auth>/logout?step=2` plus a separate top-level `return`. Other
 * top-level parameters are therefore folded back into `next`.
 */
export function singleSignOutNext(issuer: string, query: URLSearchParams, appOrigin: string): string {
  const auth = new URL(issuer);
  const next = query.get('next');
  if (next) {
    try {
      const target = new URL(next);
      if (target.origin === auth.origin && target.pathname === '/logout') {
        for (const [key, value] of query) {
          if (key !== 'next' && !target.searchParams.has(key)) target.searchParams.set(key, value);
        }
        return target.toString();
      }
    } catch {
      // ignore a malformed next
    }
  }
  return startSingleSignOut(issuer, `${appOrigin}/`);
}
