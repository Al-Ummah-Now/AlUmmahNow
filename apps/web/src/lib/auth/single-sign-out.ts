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
 * Single sign-out that lands back on this app's home page in `locale`.
 * `host` is the request's Host header; only en and ar exist, anything else
 * (the locale comes from the client) becomes en.
 */
export function singleSignOutToHome(issuer: string, host: string, locale: string): string {
  const protocol = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https";
  return startSingleSignOut(issuer, `${protocol}://${host}/${locale === "ar" ? "ar" : "en"}`);
}

/**
 * Where the front-channel endpoint goes next: `next` when it is the auth
 * server's /logout (never anywhere else: no open redirect), otherwise it
 * starts single sign-out itself.
 *
 * On Cloudflare (OpenNext) the query string reaches the route already
 * percent-decoded once, so `next=<auth>/logout?step=2%26return=…` arrives as
 * `next=<auth>/logout?step=2` plus a separate top-level `return`. Any other
 * top-level parameters are therefore folded back into `next`.
 */
export function singleSignOutNext(issuer: string, query: URLSearchParams, appOrigin: string): string {
  const auth = new URL(issuer);
  const next = query.get("next");
  if (next) {
    try {
      const target = new URL(next);
      if (target.origin === auth.origin && target.pathname === "/logout") {
        for (const [key, value] of query) {
          if (key !== "next" && !target.searchParams.has(key)) target.searchParams.set(key, value);
        }
        return target.toString();
      }
    } catch {
      // ignore a malformed next
    }
  }
  return startSingleSignOut(issuer, `${appOrigin}/`);
}
