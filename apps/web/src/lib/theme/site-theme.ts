import { DEFAULT_SITE_THEME, isBuiltInSiteTheme, resolveSiteTheme, type PublicSiteTheme } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger';

/** How long a change may take to reach visitors. */
const TTL_SECONDS = 30;
/** The theme must never hold up the page; on a slow answer the default renders. */
const TIMEOUT_MS = 500;
/** A read after the page was rendered may take as long as a cold admin-api needs. */
const REFRESH_TIMEOUT_MS = 5000;
/** A published package's CSS never changes; it is fetched once per version and kept. */
const PACKAGE_TTL_SECONDS = 86400;
const PACKAGE_TIMEOUT_MS = 1500;
const MAX_CSS_BYTES = 1024 * 1024;
/**
 * A slow or failed read renders the theme this isolate rendered last, while it is this recent,
 * instead of the default. Without it a custom theme flipped to Fawanees on any slow answer: the
 * site has no shared fetch cache (open-next.config.ts), so every page reads the setting and the
 * package CSS from admin-api, and on stage one visitor of two got Fawanees seconds after the
 * theme was live (site-theme.spec.ts, v2026.11.12.7).
 */
const LAST_GOOD_MS = 10 * 60 * 1000;
/**
 * The last theme is also kept in the data centre's cache, for this long. A quiet site's visitor meets
 * a new isolate of ours and a cold admin-api, whose answer takes longer than TIMEOUT_MS: every first
 * visit waited and rendered the default (prod 2026-11-25: 14 timeouts in 7 minutes). The kept theme
 * renders at once and is read again after the page, so a change shows on the next visit.
 */
const KEEP_MS = 24 * 60 * 60 * 1000;
/** Package CSS per published version (immutable): a few themes per isolate at most. */
const MAX_PACKAGES = 8;

/** The theme for the first HTML: its data-theme id, and the CSS of a theme package made in the admin. */
export interface ActiveSiteTheme {
  id: string;
  /** Compiled CSS of a custom package (built-in themes ship in the site's stylesheet) */
  css: string | null;
}

const fallback: ActiveSiteTheme = { id: DEFAULT_SITE_THEME, css: null };

/** For a page that is not worth a read (the not-found page of a missing file). */
export const defaultSiteTheme: ActiveSiteTheme = fallback;

interface KeptTheme {
  theme: ActiveSiteTheme;
  at: number;
}

let lastGood: KeptTheme | null = null;
/** When a background read started: one at a time, and never waited for longer than its own time limit. */
let refreshStartedAt = 0;
/** Reads in a row that did not answer in time. One slow answer (a cold admin-api) is expected and invisible. */
let slowReads = 0;
const SLOW_READS_BEFORE_WARNING = 3;
const packages = new Map<string, string>();

/** Forgets the isolate's last theme and package CSS (tests). */
export function resetSiteThemeCache(): void {
  lastGood = null;
  refreshStartedAt = 0;
  slowReads = 0;
  packages.clear();
}

type AfterResponse = (work: Promise<unknown>) => void;

/** Work that goes on after the response; null where the runtime has none (next dev, tests). */
async function afterResponse(): Promise<AfterResponse | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { ctx } = await getCloudflareContext({ async: true });
    return typeof ctx?.waitUntil === 'function' ? (work) => ctx.waitUntil(work.catch(() => undefined)) : null;
  } catch {
    return null;
  }
}

interface EdgeCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

/** The data centre's cache (Workers only). */
function edgeCache(): EdgeCache | null {
  return (globalThis as { caches?: { default?: EdgeCache } }).caches?.default ?? null;
}

const keptUrl = (adminApi: string) => `${adminApi}/public/site-theme?kept-by=web`;

async function readKept(adminApi: string): Promise<KeptTheme | null> {
  try {
    const kept = (await (await edgeCache()?.match(keptUrl(adminApi)))?.json()) as Partial<KeptTheme> | undefined;
    const { theme, at } = kept ?? {};
    if (typeof at !== 'number' || typeof theme?.id !== 'string' || !(theme.css === null || typeof theme.css === 'string')) return null;
    return { theme, at };
  } catch {
    return null;
  }
}

async function keep(adminApi: string, kept: KeptTheme): Promise<void> {
  const body = JSON.stringify(kept);
  await edgeCache()?.put(keptUrl(adminApi), new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${KEEP_MS / 1000}` } }));
}

function rendered(theme: ActiveSiteTheme): ActiveSiteTheme {
  slowReads = 0;
  lastGood = { theme, at: Date.now() };
  return theme;
}

/** A read that did not answer (slow, down, or not OK): the last theme while recent, else the default. */
function unanswered(what: string, detail: unknown): ActiveSiteTheme {
  const recent = lastGood && Date.now() - lastGood.at < LAST_GOOD_MS ? lastGood.theme : null;
  const slow = (detail as { name?: unknown } | null)?.name === 'TimeoutError';
  slowReads = slow ? slowReads + 1 : 0;
  const log = slow && slowReads < SLOW_READS_BEFORE_WARNING ? logger.info : logger.warn;
  log.call(logger, '[site-theme] read failed: rendering the last theme or the default', { what, detail: String(detail), rendering: (recent ?? fallback).id });
  return recent ?? fallback;
}

/** A custom package's compiled CSS; null when it is not safe to use, undefined when it could not be read. */
async function packageCss(url: string, id: string): Promise<string | null | undefined> {
  const kept = packages.get(url);
  if (kept) return kept;
  let css: string;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PACKAGE_TIMEOUT_MS), next: { revalidate: PACKAGE_TTL_SECONDS } });
    if (!response.ok) {
      logger.warn('[site-theme] package CSS not served', { url, status: response.status });
      return undefined;
    }
    css = await response.text();
  } catch (error) {
    logger.warn('[site-theme] package CSS read failed', { url, error: String(error) });
    return undefined;
  }
  // Compiled from a validated package; still never let it out of its <style> or past its scope
  if (css.length > MAX_CSS_BYTES || /<\/?style|<script/i.test(css) || !css.includes(`html[data-theme='${id}']`)) return null;
  if (packages.size >= MAX_PACKAGES) packages.delete(packages.keys().next().value as string);
  packages.set(url, css);
  return css;
}

/**
 * A build-time theme, used by the demo workers, wins. A setting or package that is not valid
 * renders Fawanees; a read that does not answer renders the last theme (LAST_GOOD_MS), else Fawanees.
 */
export async function getSiteTheme(): Promise<ActiveSiteTheme> {
  const pinned = process.env.NEXT_PUBLIC_ACTIVE_THEME;
  if (pinned) return { id: resolveSiteTheme(pinned), css: null };
  const adminApi = process.env.ADMIN_API_URL;
  if (!adminApi) return fallback;
  // The theme this isolate read in the last TTL_SECONDS is the answer (a change may take that long
  // anyway): one read per isolate per 30 s instead of one per page, which timed out under load
  // (prod 2026-11-16..18: 30 "[site-theme] read failed" in 72 h). A settled value, never a promise.
  if (lastGood && Date.now() - lastGood.at < TTL_SECONDS * 1000) return lastGood.theme;
  const after = await afterResponse();
  if (!after) return readTheme(adminApi, TIMEOUT_MS);
  // A theme this isolate or this data centre had: rendered now, read again after the page
  lastGood ??= await readKept(adminApi);
  const now = Date.now();
  if (lastGood && now - lastGood.at < KEEP_MS) {
    if (now - lastGood.at >= TTL_SECONDS * 1000 && now - refreshStartedAt >= REFRESH_TIMEOUT_MS) {
      refreshStartedAt = now;
      after(readAndKeep(adminApi, REFRESH_TIMEOUT_MS));
    }
    return lastGood.theme;
  }
  // Nothing kept here yet: the page waits TIMEOUT_MS at most, and the next one has an answer
  const theme = await readTheme(adminApi, TIMEOUT_MS);
  after(lastGood ? keep(adminApi, lastGood) : readAndKeep(adminApi, REFRESH_TIMEOUT_MS));
  return theme;
}

async function readAndKeep(adminApi: string, timeoutMs: number): Promise<void> {
  const before = lastGood;
  const theme = await readTheme(adminApi, timeoutMs);
  // A read that answered, with a theme or with one that is not valid (the default)
  if (lastGood !== before && lastGood) await keep(adminApi, lastGood);
  else logger.debug('[site-theme] kept theme not renewed', { rendering: theme.id });
}

/** Reads the setting (and a package's CSS); a read that does not answer is the last theme, else the default. */
async function readTheme(adminApi: string, timeoutMs: number): Promise<ActiveSiteTheme> {
  let answer: Partial<PublicSiteTheme>;
  try {
    const response = await fetch(`${adminApi}/public/site-theme`, {
      signal: AbortSignal.timeout(timeoutMs),
      next: { revalidate: TTL_SECONDS },
    });
    if (!response.ok) return unanswered('setting', response.status);
    answer = (await response.json()) as Partial<PublicSiteTheme>;
  } catch (error) {
    return unanswered('setting', error);
  }
  if (isBuiltInSiteTheme(answer.theme)) return rendered({ id: answer.theme, css: null });
  const pkg = answer.package;
  if (!pkg || pkg.id !== answer.theme || !/^[a-z][a-z0-9-]{1,39}$/.test(pkg.id) || !/^https?:\/\//.test(pkg.css)) return rendered(fallback);
  const css = await packageCss(pkg.css, pkg.id);
  if (css === undefined) return unanswered('package', pkg.css);
  return rendered(css ? { id: pkg.id, css } : fallback);
}
