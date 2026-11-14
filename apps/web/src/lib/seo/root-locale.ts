/**
 * `/` → `/en` or `/ar`, answered by the Worker entry (worker.ts) before Next runs: no session refresh,
 * middleware or render, so the hop is as cheap as it can be. Field RUM (p75) put the root redirect
 * at ~330 ms. The language is the visitor's saved choice (the `preferred-language` cookie), else
 * their browser's (Accept-Language), else English.
 *
 * It stays a redirect rather than serving the page at `/`: the app reads the locale from the URL on
 * the client (useLanguage and the components that use usePathname), and a rewritten `/` would render
 * the wrong language there. To make repeat visits free, the browser may keep the answer for 10 minutes;
 * it varies on Cookie and Accept-Language, so a changed language choice is a different entry.
 * Shared caches never keep it (private).
 */
import { LANGUAGE_PREFERENCE_COOKIE } from '@/lib/i18n/utils/localeHelpers';

type Locale = 'en' | 'ar';
const isLocale = (v: string | undefined | null): v is Locale => v === 'en' || v === 'ar';

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** The first of en/ar the browser accepts, by q (ties keep the header's order); null when neither. */
export function acceptedLocale(header: string | null): Locale | null {
  const ranked = (header ?? '')
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.split('-')[0], q: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.map((x) => x.lang).find(isLocale) ?? null;
}

export function rootLocale(request: Request): Locale {
  const saved = cookieValue(request.headers.get('cookie'), LANGUAGE_PREFERENCE_COOKIE);
  if (isLocale(saved)) return saved;
  return acceptedLocale(request.headers.get('accept-language')) ?? 'en';
}

/** The redirect for `/` (GET/HEAD only), the query kept; null for every other request. */
export function rootLocaleRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== '/' || (request.method !== 'GET' && request.method !== 'HEAD')) return null;
  return new Response(null, {
    status: 307,
    headers: {
      Location: `/${rootLocale(request)}${url.search}`,
      'Cache-Control': 'private, max-age=600',
      Vary: 'Cookie, Accept-Language',
    },
  });
}
