import { DEFAULT_SITE_THEME, resolveSiteTheme, type SiteTheme } from '@al-ummah/shared-types';

/** How long a change may take to reach visitors. */
const TTL_SECONDS = 30;
/** The theme must never hold up the page; on a slow answer the default renders. */
const TIMEOUT_MS = 500;

/** The theme for the first HTML. A build-time theme, used by the demo workers, wins. */
export async function getSiteTheme(): Promise<SiteTheme> {
  const pinned = process.env.NEXT_PUBLIC_ACTIVE_THEME;
  if (pinned) return resolveSiteTheme(pinned);
  const adminApi = process.env.ADMIN_API_URL;
  if (!adminApi) return DEFAULT_SITE_THEME;
  try {
    const response = await fetch(`${adminApi}/public/site-theme`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: TTL_SECONDS },
    });
    if (!response.ok) return DEFAULT_SITE_THEME;
    return resolveSiteTheme(((await response.json()) as { theme?: unknown }).theme);
  } catch {
    return DEFAULT_SITE_THEME;
  }
}
