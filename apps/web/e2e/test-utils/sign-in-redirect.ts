import { expect, type Page } from '@playwright/test';
import { webAuthConfig } from './session-login';

/**
 * Signed-out actions that need an account (comment, subscribe, ...) send the
 * visitor to the web app's login route, /api/auth/login?locale=..&return=..,
 * which redirects straight on to the auth server's sign-in page. The route is
 * only a hop, so it is checked on the request, not on the address bar.
 *
 * Returns a check to call after the action: it waits for the login request,
 * verifies the locale and the page to return to, and that the auth server's
 * sign-in page opened in that language.
 */
export function watchSignInRedirect(page: Page, expected: { locale: 'en' | 'ar'; returnPath: string | RegExp }) {
  const seen: URL[] = [];
  const onRequest = (request: { url(): string; isNavigationRequest(): boolean }) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/login' && request.isNavigationRequest()) seen.push(url);
  };
  page.on('request', onRequest);

  return {
    /** True once the login route was requested (for click-until-done loops) */
    requested: () => seen.length > 0,
    async verify() {
      await expect.poll(() => seen.length, { message: 'the login route was opened' }).toBeGreaterThan(0);
      page.off('request', onRequest);
      const login = seen[0];
      expect(login.searchParams.get('locale')).toBe(expected.locale);
      const returned = login.searchParams.get('return') ?? '';
      if (typeof expected.returnPath === 'string') expect(returned).toBe(expected.returnPath);
      else expect(returned).toMatch(expected.returnPath);
      // Ends on the auth server's sign-in page, in the page's language
      const authOrigin = new URL(webAuthConfig().openAuthUrl).origin;
      await expect
        .poll(() => {
          const url = new URL(page.url());
          return url.origin === authOrigin ? url.searchParams.get('lang') : `not on the auth server: ${url.origin}`;
        }, { message: 'the auth server sign-in page opened' })
        .toBe(expected.locale);
    },
  };
}
