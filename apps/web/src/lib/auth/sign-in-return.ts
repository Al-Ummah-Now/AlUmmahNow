/**
 * The one allowlist of pages a sign-in may name as its return (login's `returnTo`), whatever
 * page it started from. Anything else falls back to the Referer (lib/auth/silent-sign-in.ts):
 * - a Studio page (a Studio sign-in names its page);
 * - the locale's home, exactly `/en` or `/ar` for the sign-in's own locale (the home page's
 *   sign-in banner: the Referer can arrive as just the origin, "/", which the middleware sends
 *   to the browser's preferred locale, so naming it keeps an /ar visitor on /ar);
 * - the request page, `/{locale}/upgrade` for the sign-in's own locale (wiki AUN-TIER-REQUESTS:
 *   "Sign in to request" on /upgrade and "Request tier" on the home banner).
 * Only these exact paths on this site, never a full URL.
 */
import { safeStudioReturn } from '@/lib/studio/resolve';

/** /en/upgrade or /ar/upgrade: the request page in the page language. */
export const upgradePath = (lang: string) => `/${lang === 'ar' ? 'ar' : 'en'}/upgrade`;

export function safeSignInReturn(value: unknown, locale: string): string | null {
  const studio = safeStudioReturn(value);
  if (studio) return studio;
  if (locale !== 'en' && locale !== 'ar') return null;
  return value === `/${locale}` || value === `/${locale}/upgrade` ? value : null;
}
