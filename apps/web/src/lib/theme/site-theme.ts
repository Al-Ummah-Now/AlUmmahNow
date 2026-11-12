import { DEFAULT_SITE_THEME, isBuiltInSiteTheme, resolveSiteTheme, type PublicSiteTheme } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger';

/** How long a change may take to reach visitors. */
const TTL_SECONDS = 30;
/** The theme must never hold up the page; on a slow answer the default renders. */
const TIMEOUT_MS = 500;
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
/** Package CSS per published version (immutable): a few themes per isolate at most. */
const MAX_PACKAGES = 8;

/** The theme for the first HTML: its data-theme id, and the CSS of a theme package made in the admin. */
export interface ActiveSiteTheme {
  id: string;
  /** Compiled CSS of a custom package (built-in themes ship in the site's stylesheet) */
  css: string | null;
}

const fallback: ActiveSiteTheme = { id: DEFAULT_SITE_THEME, css: null };

let lastGood: { theme: ActiveSiteTheme; at: number } | null = null;
const packages = new Map<string, string>();

/** Forgets the isolate's last theme and package CSS (tests). */
export function resetSiteThemeCache(): void {
  lastGood = null;
  packages.clear();
}

function rendered(theme: ActiveSiteTheme): ActiveSiteTheme {
  lastGood = { theme, at: Date.now() };
  return theme;
}

/** A read that did not answer (slow, down, or not OK): the last theme while recent, else the default. */
function unanswered(what: string, detail: unknown): ActiveSiteTheme {
  const recent = lastGood && Date.now() - lastGood.at < LAST_GOOD_MS ? lastGood.theme : null;
  logger.warn('[site-theme] read failed: rendering the last theme or the default', { what, detail: String(detail), rendering: (recent ?? fallback).id });
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
  let answer: Partial<PublicSiteTheme>;
  try {
    const response = await fetch(`${adminApi}/public/site-theme`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: TTL_SECONDS },
    });
    if (!response.ok) return unanswered('setting', response.status);
    answer = (await response.json()) as Partial<PublicSiteTheme>;
  } catch (error) {
    return unanswered('setting', error);
  }
  if (isBuiltInSiteTheme(answer.theme)) return rendered({ id: answer.theme, css: null });
  const pkg = answer.package;
  if (!pkg || pkg.id !== answer.theme || !/^[a-z][a-z0-9-]{1,39}$/.test(pkg.id) || !/^https?:\/\//.test(pkg.css)) return fallback;
  const css = await packageCss(pkg.css, pkg.id);
  if (css === undefined) return unanswered('package', pkg.css);
  return css ? rendered({ id: pkg.id, css }) : fallback;
}
