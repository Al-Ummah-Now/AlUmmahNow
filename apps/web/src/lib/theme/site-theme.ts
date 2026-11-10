import { DEFAULT_SITE_THEME, isBuiltInSiteTheme, resolveSiteTheme, type PublicSiteTheme } from '@al-ummah/shared-types';

/** How long a change may take to reach visitors. */
const TTL_SECONDS = 30;
/** The theme must never hold up the page; on a slow answer the default renders. */
const TIMEOUT_MS = 500;
/** A published package's CSS never changes; it is fetched once per version and kept. */
const PACKAGE_TTL_SECONDS = 86400;
const PACKAGE_TIMEOUT_MS = 1500;
const MAX_CSS_BYTES = 1024 * 1024;

/** The theme for the first HTML: its data-theme id, and the CSS of a theme package made in the admin. */
export interface ActiveSiteTheme {
  id: string;
  /** Compiled CSS of a custom package (built-in themes ship in the site's stylesheet) */
  css: string | null;
}

const fallback: ActiveSiteTheme = { id: DEFAULT_SITE_THEME, css: null };

/** A custom package's compiled CSS, or null when it cannot be used. */
async function packageCss(url: string, id: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PACKAGE_TIMEOUT_MS), next: { revalidate: PACKAGE_TTL_SECONDS } });
    if (!response.ok) return null;
    const css = await response.text();
    // Compiled from a validated package; still never let it out of its <style> or past its scope
    if (css.length > MAX_CSS_BYTES || /<\/?style|<script/i.test(css) || !css.includes(`html[data-theme='${id}']`)) return null;
    return css;
  } catch {
    return null;
  }
}

/** A build-time theme, used by the demo workers, wins. Any failure renders Fawanees. */
export async function getSiteTheme(): Promise<ActiveSiteTheme> {
  const pinned = process.env.NEXT_PUBLIC_ACTIVE_THEME;
  if (pinned) return { id: resolveSiteTheme(pinned), css: null };
  const adminApi = process.env.ADMIN_API_URL;
  if (!adminApi) return fallback;
  try {
    const response = await fetch(`${adminApi}/public/site-theme`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: TTL_SECONDS },
    });
    if (!response.ok) return fallback;
    const answer = (await response.json()) as Partial<PublicSiteTheme>;
    if (isBuiltInSiteTheme(answer.theme)) return { id: answer.theme, css: null };
    const pkg = answer.package;
    if (!pkg || pkg.id !== answer.theme || !/^[a-z][a-z0-9-]{1,39}$/.test(pkg.id) || !/^https?:\/\//.test(pkg.css)) return fallback;
    const css = await packageCss(pkg.css, pkg.id);
    return css ? { id: pkg.id, css } : fallback;
  } catch {
    return fallback;
  }
}
