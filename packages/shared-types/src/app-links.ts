/**
 * The account menu's "Al Ummah Now apps" section (docs/design/NAV.md): the same apps, order and
 * role gates in every app. The roles mirror the profile app's catalog (AlUmmahNowAuth
 * apps/profile/src/apps.ts), which mirrors each app's own access guard, so a link is never shown
 * to someone the app would turn away. The current app is left out.
 */
import { normalizeRole } from './roles';

export type AppLinkId = 'www' | 'videos' | 'profile' | 'cms' | 'admin' | 'auth-admin';

export interface AppLinkUrls {
  www?: string;
  videos?: string;
  profile?: string;
  cms?: string;
  /** The auth server (issuer); the auth admin is `admin.<its host>`. */
  auth?: string;
}

export interface AppLink {
  id: AppLinkId;
  href: string;
}

const ORDER: { id: AppLinkId; roles: readonly string[] }[] = [
  { id: 'www', roles: [] },
  { id: 'videos', roles: [] },
  { id: 'profile', roles: [] },
  { id: 'cms', roles: ['super_admin', 'admin', 'moderator', 'scholar'] },
  { id: 'admin', roles: ['super_admin', 'admin', 'moderator'] },
  { id: 'auth-admin', roles: ['super_admin', 'admin'] },
];


/** `https://www.qa.alummahnow.net` → `https://admin.qa.alummahnow.net` (the videos admin). */
function withHost(url: string | undefined, rewrite: (host: string) => string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const host = rewrite(u.host);
    return host ? `${u.protocol}//${host}` : '';
  } catch {
    return '';
  }
}

function hrefFor(id: AppLinkId, urls: AppLinkUrls, lang: string): string {
  const trim = (u?: string) => (u ?? '').replace(/\/$/, '');
  switch (id) {
    case 'www':
      return urls.www ? `${trim(urls.www)}/${lang}/` : '';
    case 'videos':
      return urls.videos ? `${trim(urls.videos)}/${lang}` : '';
    case 'profile':
      return urls.profile ? `${trim(urls.profile)}/?lang=${lang}` : '';
    case 'cms':
      return urls.cms ? `${trim(urls.cms)}/?lang=${lang}` : '';
    case 'admin':
      return withHost(urls.www, (h) => (h.startsWith('www.') ? `admin.${h.slice(4)}` : null));
    case 'auth-admin':
      return withHost(urls.auth, (h) => `admin.${h}`);
  }
}

export function appLinks(opts: { current: AppLinkId; roles?: readonly string[]; lang: string; urls: AppLinkUrls }): AppLink[] {
  const roles = new Set((opts.roles ?? []).filter((r): r is string => typeof r === 'string').map(normalizeRole));
  return ORDER.filter((a) => a.id !== opts.current && (a.roles.length === 0 || a.roles.some((r) => roles.has(r))))
    .map((a) => ({ id: a.id, href: hrefFor(a.id, opts.urls, opts.lang) }))
    .filter((a) => a.href !== '');
}

/**
 * Every app's origin from the auth server's: `https://auth.qa.alummahnow.net` gives
 * www/videos/cms `.qa.alummahnow.net` and `profile.auth.qa.alummahnow.net`. For an app that has
 * only the issuer (the videos admin). Empty for an issuer that is not `auth.<domain>` (local dev).
 */
export function appUrlsFromIssuer(issuer: string | undefined): AppLinkUrls {
  if (!issuer) return {};
  try {
    const u = new URL(issuer);
    if (!u.host.startsWith('auth.')) return {};
    const base = u.host.slice('auth.'.length);
    const at = (sub: string) => `${u.protocol}//${sub}.${base}`;
    return { www: at('www'), videos: at('videos'), cms: at('cms'), profile: `${u.protocol}//profile.${u.host}`, auth: u.origin };
  } catch {
    return {};
  }
}
