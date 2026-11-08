import { isLocaleSupported } from '@/lib/i18n/utils';

/**
 * Asks the auth server to render its pages in the visitor's language (#293).
 * The auth theme reads `lang` and keeps it on its own links; `ui_locales` is
 * the OIDC name for the same request. Added to the URL from client.authorize()
 * rather than to the redirect_uri, which must stay byte-identical at /token.
 */
export function withAuthorizeLocale(authorizeUrl: string, locale: string): string {
  if (!isLocaleSupported(locale)) return authorizeUrl;
  const url = new URL(authorizeUrl);
  url.searchParams.set('lang', locale);
  url.searchParams.set('ui_locales', locale);
  return url.toString();
}
