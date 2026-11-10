/**
 * Scholars (AlUmmahNowCMS docs/SCHOLARS.md): a scholar writes articles in the CMS and has a page on
 * www. The videos site links to both. Their hosts follow the auth issuer's environment:
 *   https://auth.alummahnow.net    → https://cms.alummahnow.net, https://www.alummahnow.net
 *   https://auth.qa.alummahnow.net → https://cms.qa.alummahnow.net, https://www.qa.alummahnow.net
 * Anything else (localhost) gives '' unless CMS_URL / WWW_URL are set: the links are then hidden.
 */

function sibling(issuer: string | undefined, sub: 'cms' | 'www'): string {
  if (!issuer) return '';
  try {
    const url = new URL(issuer);
    if (url.protocol !== 'https:' || !url.hostname.startsWith('auth.') || !url.hostname.endsWith('alummahnow.net')) return '';
    return `https://${sub}.${url.hostname.slice('auth.'.length)}`;
  } catch {
    return '';
  }
}

const trim = (u: string | undefined) => (u ?? '').replace(/\/+$/, '');

export function deriveCmsUrl(issuer: string | undefined, explicit?: string): string {
  return trim(explicit) || sibling(issuer, 'cms');
}

export function deriveWwwUrl(issuer: string | undefined, explicit?: string): string {
  return trim(explicit) || sibling(issuer, 'www');
}

/** The auth role that writes articles. Token roles are display names ("Scholar"). */
export function isScholar(roles: readonly string[] | undefined): boolean {
  return !!roles?.some((r) => typeof r === 'string' && r.trim().toLowerCase() === 'scholar');
}

/**
 * CMS deep links. The CMS signs the browser in through SSO and comes back to `return`, so a
 * signed-in scholar lands on the editor without a second sign-in.
 */
export function cmsLinks(cmsUrl: string, lang: string): { write: string; articles: string; profile: string } | null {
  if (!cmsUrl) return null;
  const l = lang === 'ar' ? 'ar' : 'en';
  return {
    write: `${cmsUrl}/posts/new?locale=${l}&lang=${l}`,
    articles: `${cmsUrl}/posts?lang=${l}`,
    profile: `${cmsUrl}/scholars/me?lang=${l}`,
  };
}

/** A scholar's page on www. */
export function scholarPageUrl(wwwUrl: string, lang: string, slug: string): string {
  return `${wwwUrl}/${lang === 'ar' ? 'ar' : 'en'}/scholars/${encodeURIComponent(slug)}/`;
}
