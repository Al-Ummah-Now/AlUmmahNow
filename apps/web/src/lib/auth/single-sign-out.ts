/**
 * Single sign-out with the auth server (auth.alummahnow.net).
 *
 * One sign-in covers web, profile and admin. Signing out of any of them goes
 * through the auth server's /logout, which ends the shared sign-in and asks
 * each app to clear its own session by calling its front-channel endpoint
 * (here: GET /api/auth/logout?next=<auth>/logout?...). Each app then follows
 * `next` back to the auth server.
 */

/** Cookies that hold this app's sign-in. */
export const SIGN_IN_COOKIES = ["al_ummah_session", "access_token", "refresh_token"] as const;

/** Auth server URL that starts single sign-out and returns to `returnTo`. */
export function startSingleSignOut(issuer: string, returnTo: string): string {
  const url = new URL("/logout", new URL(issuer).origin);
  url.searchParams.set("return", returnTo);
  return url.toString();
}

/**
 * Where the front-channel endpoint goes next: `next` when it is the auth
 * server's /logout (never anywhere else: no open redirect), otherwise it
 * starts single sign-out itself.
 */
export function singleSignOutNext(issuer: string, next: string | null, appOrigin: string): string {
  const auth = new URL(issuer);
  if (next) {
    try {
      const target = new URL(next);
      if (target.origin === auth.origin && target.pathname === "/logout") return target.toString();
    } catch {
      // ignore a malformed next
    }
  }
  return startSingleSignOut(issuer, `${appOrigin}/`);
}
