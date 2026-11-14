/**
 * Server-side: a CMS content page (AlUmmahNowCMS public API `GET /pages/:slug?locale`), the page www
 * serves at /{locale}/{slug}/. The videos site renders the About page from it (/{locale}/about).
 *
 * The fallback chain, so the page is never blank (the same order www uses, AlUmmahNowUI SPEC §5):
 *   fresh copy in the Cache API (60 s) → the CMS (2.5 s timeout) → the last good copy in the Cache API
 *   (up to 7 days) → the built-in copy. This app has no KV or shared incremental cache
 *   (open-next.config.ts), so the last good copy is the edge cache's: per data centre, refreshed by
 *   every successful read. A 404 is an answer (the page was removed or unpublished), not a failure.
 * Never throws.
 */
import { logger } from '@/lib/logger';
import { deriveCmsUrl } from '@/lib/scholars/sites';

export interface CmsPage {
  slug: string;
  locale: 'en' | 'ar';
  title: string;
  summary: string | null;
  /** Markdown: the whole page as text (the CMS keeps it in step with the page's blocks). */
  body: string;
  seo_title: string | null;
  seo_description: string | null;
  alternates: { locale: 'en' | 'ar'; slug: string }[];
}

export type PageSource = 'cms' | 'cache' | 'builtin';
export type PageLoad = { status: 'ok'; page: CmsPage; source: PageSource } | { status: 'not_found' };

export const FRESH_MS = 60_000;
export const STALE_MS = 7 * 24 * 60 * 60_000;
export const CMS_TIMEOUT_MS = 2_500;
const STORED_AT = 'x-stored-at';

const isLocale = (v: unknown): v is 'en' | 'ar' => v === 'en' || v === 'ar';
const strOrNull = (v: unknown) => v === null || v === undefined || typeof v === 'string';

/** The fields this site renders, checked: anything else is treated as a CMS failure. */
export function toCmsPage(v: unknown): CmsPage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.slug !== 'string' || !isLocale(o.locale) || typeof o.title !== 'string' || !o.title.trim() || typeof o.body !== 'string') return null;
  if (!strOrNull(o.summary) || !strOrNull(o.seo_title) || !strOrNull(o.seo_description)) return null;
  // A list page (curated or filter) is not a content page
  if (o.list_kind !== undefined && o.list_kind !== null) return null;
  const alternates = Array.isArray(o.alternates)
    ? o.alternates.flatMap((a) => (a && typeof a === 'object' && isLocale((a as { locale?: unknown }).locale) && typeof (a as { slug?: unknown }).slug === 'string' ? [{ locale: (a as { locale: 'en' | 'ar' }).locale, slug: (a as { slug: string }).slug }] : []))
    : [];
  return {
    slug: o.slug,
    locale: o.locale,
    title: o.title,
    summary: (o.summary as string | null | undefined) ?? null,
    body: o.body,
    seo_title: (o.seo_title as string | null | undefined) ?? null,
    seo_description: (o.seo_description as string | null | undefined) ?? null,
    alternates,
  };
}

export interface PageDeps {
  cmsUrl: string;
  fetch: typeof fetch;
  cache: Cache | null;
  now: () => number;
}

type Stored = { notFound: true } | { notFound?: false; page: CmsPage };

async function readCache(deps: PageDeps, key: string): Promise<{ value: Stored; ageMs: number } | null> {
  if (!deps.cache) return null;
  try {
    const hit = await deps.cache.match(key);
    if (!hit) return null;
    const storedAt = Number(hit.headers.get(STORED_AT));
    return { value: (await hit.json()) as Stored, ageMs: deps.now() - (Number.isFinite(storedAt) ? storedAt : 0) };
  } catch {
    return null;
  }
}

/** Awaited (a few ms), so the Worker never drops the write when the response is sent. */
async function writeCache(deps: PageDeps, key: string, value: Stored): Promise<void> {
  if (!deps.cache) return;
  const res = new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${(FRESH_MS + STALE_MS) / 1000}`, [STORED_AT]: String(deps.now()) },
  });
  await deps.cache.put(key, res).catch(() => undefined);
}

export async function loadCmsPage(deps: PageDeps, locale: 'en' | 'ar', slug: string, builtin: CmsPage | null): Promise<PageLoad> {
  const fallback = (why: string): PageLoad => {
    logger.warn('[CMS page] falling back to the built-in copy', { slug, locale, why });
    return builtin ? { status: 'ok', page: builtin, source: 'builtin' } : { status: 'not_found' };
  };
  if (!deps.cmsUrl) return fallback('no CMS URL');
  const url = `${deps.cmsUrl}/api/public/v1/pages/${encodeURIComponent(slug)}?locale=${locale}`;
  // The key is the CMS URL itself: an https URL, as the Cache API requires
  const cached = await readCache(deps, url);
  if (cached && cached.ageMs < FRESH_MS) {
    if (cached.value.notFound) return { status: 'not_found' };
    const page = toCmsPage(cached.value.page);
    if (page) return { status: 'ok', page, source: 'cms' };
  }
  let failure: string;
  try {
    const res = await deps.fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(CMS_TIMEOUT_MS), cache: 'no-store' });
    if (res.status === 404) {
      await writeCache(deps, url, { notFound: true });
      return { status: 'not_found' };
    }
    if (res.ok) {
      const page = toCmsPage(await res.json().catch(() => null));
      if (page && page.locale === locale) {
        await writeCache(deps, url, { page });
        return { status: 'ok', page, source: 'cms' };
      }
      failure = 'bad JSON';
    } else {
      failure = `HTTP ${res.status}`;
    }
  } catch (error) {
    failure = String(error);
  }
  logger.warn('[CMS page] CMS read failed', { slug, locale, failure });
  if (cached && cached.ageMs < FRESH_MS + STALE_MS && !cached.value.notFound) {
    const page = toCmsPage(cached.value.page);
    if (page) return { status: 'ok', page, source: 'cache' };
  }
  return fallback(failure);
}

/** The Worker's edge cache (absent in `next dev` on Node). */
function edgeCache(): Cache | null {
  try {
    const c = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
    return c?.default ?? null;
  } catch {
    return null;
  }
}

/** The page for this request, with the env's CMS (CMS_URL, or derived from the auth issuer). */
export function loadPage(locale: 'en' | 'ar', slug: string, builtin: CmsPage | null): Promise<PageLoad> {
  return loadCmsPage(
    { cmsUrl: deriveCmsUrl(process.env.OPENAUTH_ISSUER || process.env.Issuer, process.env.CMS_URL), fetch, cache: edgeCache(), now: Date.now },
    locale,
    slug,
    builtin,
  );
}
