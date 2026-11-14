/**
 * admin-web's side of the root-locale hop. worker.ts is identical in web and admin-web (a test keeps
 * them equal) and the videos site answers `/` with a locale redirect there (web's
 * src/lib/seo/root-locale.ts). Admin pages have no locale prefix and `/` is the dashboard, so here it
 * never answers and the request goes on to Next.
 */
export function rootLocaleRedirect(_request: Request): Response | null {
  return null;
}
