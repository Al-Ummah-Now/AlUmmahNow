/**
 * White-label scholar sites (wiki AUN-SCHOLAR-SITES, phase 2).
 *
 * A site belongs to one channel (SS2): the channel's owner and admins run it. It is granted by a
 * platform admin as a channel add-on with two tiers (SS1). Its data lives in api-videos' existing
 * R2 buckets (SS4), never in a new database:
 *   - `channel_sections`: `site/{channelId}/settings.json` (this file's SiteSettings)
 *   - `channel_tabs`:     `site-hosts/{host}.json` (SiteHostEntry; create-only, like channel handles)
 * The sites Worker (AlUmmahNowUI apps/sites) reads `GET /api/sites/by-host/:host` (PublicSite).
 */

export type SiteLocale = 'en' | 'ar';
export const SITE_LOCALES: readonly SiteLocale[] = ['en', 'ar'];

/**
 * `setup`: granted, not yet public (only previews render). `live`: public. `suspended`: a neutral
 * "unavailable" page on every host. `revoked`: the add-on was taken away; hosts stay reserved and
 * redirect to the channel, and an admin can restore it within SITE_RESTORE_DAYS.
 */
export type SiteStatus = 'setup' | 'live' | 'suspended' | 'revoked';
export const SITE_STATUSES: readonly SiteStatus[] = ['setup', 'live', 'suspended', 'revoked'];
export const SITE_RESTORE_DAYS = 30;

/** The two add-on tiers (SS1). Values are the seeds; admins may change limits per site. */
export type SiteTier = 'white-label' | 'white-label-domain';
export const SITE_TIERS: readonly SiteTier[] = ['white-label', 'white-label-domain'];

export type SitePlatformMark = 'required' | 'minimal' | 'none';
export const SITE_PLATFORM_MARKS: readonly SitePlatformMark[] = ['required', 'minimal', 'none'];

/** The `site.*` entitlement keys, as held on the site (copied at grant, edited by admins). */
export interface SiteLimits {
  /** `site.customDomains.max`: own domains (0 = the alummahnow.org subdomain only). */
  customDomainsMax: number;
  /** `site.platformMark`. */
  platformMark: SitePlatformMark;
  /** `site.pages.max`. */
  pagesMax: number;
  /** `site.navigation.max`: items in the main menu. */
  navigationMax: number;
  /** `site.analytics`. */
  analytics: boolean;
  /** `site.brandedSignIn`. */
  brandedSignIn: boolean;
}

export const SITE_TIER_SEEDS: Readonly<Record<SiteTier, { name: { en: string; ar: string }; limits: SiteLimits }>> = {
  'white-label': {
    name: { en: 'White-label', ar: 'العلامة الخاصة' },
    limits: { customDomainsMax: 0, platformMark: 'minimal', pagesMax: 20, navigationMax: 8, analytics: true, brandedSignIn: false },
  },
  'white-label-domain': {
    name: { en: 'White-label + domain', ar: 'العلامة الخاصة + نطاق' },
    limits: { customDomainsMax: 2, platformMark: 'none', pagesMax: 100, navigationMax: 12, analytics: true, brandedSignIn: true },
  },
};

/** The entitlement key of each limit (Epic 27 catalogue). */
export const SITE_LIMIT_KEYS: Readonly<Record<keyof SiteLimits, string>> = {
  customDomainsMax: 'site.customDomains.max',
  platformMark: 'site.platformMark',
  pagesMax: 'site.pages.max',
  navigationMax: 'site.navigation.max',
  analytics: 'site.analytics',
  brandedSignIn: 'site.brandedSignIn',
};

// ---------------------------------------------------------------------------------------------
// Hosts and slugs (§4.1, §4.3)
// ---------------------------------------------------------------------------------------------

export type SiteEnvironment = 'production' | 'stage' | 'qa' | 'local';

/** The zone every platform subdomain lives under, per environment. */
export const SITE_HOST_SUFFIX: Readonly<Record<SiteEnvironment, string>> = {
  production: 'alummahnow.org',
  stage: 'stage.alummahnow.org',
  qa: 'qa.alummahnow.org',
  // Local stack: `<slug>.sites.localhost` (browsers resolve *.localhost to 127.0.0.1)
  local: 'sites.localhost',
};

/** The Cloudflare for SaaS fallback origin own domains CNAME to. */
export const SITE_SAAS_TARGET = 'sites.alummahnow.org';

export const SITE_SLUG_MIN = 3;
export const SITE_SLUG_MAX = 40;
const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Labels no site may take: the zone's own names, every platform host label and generic words
 * (§4.3). Kept in one place; api-videos and the admin check both read it.
 */
export const SITE_RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // the alummahnow.org zone itself
  'www', 'sites', 'qa', 'stage', 'app',
  // platform host labels
  'videos', 'api', 'auth', 'admin', 'cms', 'media', 'images', 'realtime', 'profile', 'dev', 'mail', 'status',
  'docs', 'help', 'embed', 'cdn', 'static', 'assets',
  // generic words
  'login', 'account', 'support', 'blog', 'shop', 'pay', 'billing', 'about', 'news', 'live', 'kids', 'quran',
  'scholars', 'ummah', 'alummah',
]);

export type SiteSlugProblem = 'too_short' | 'too_long' | 'invalid' | 'reserved';

/** Format and reserved-word check (uniqueness is the host index's job). */
export function validateSiteSlug(slug: string): SiteSlugProblem | null {
  if (slug.length < SITE_SLUG_MIN) return 'too_short';
  if (slug.length > SITE_SLUG_MAX) return 'too_long';
  if (!SLUG.test(slug) || slug.includes('--')) return 'invalid';
  if (SITE_RESERVED_SLUGS.has(slug)) return 'reserved';
  return null;
}

/** A best-effort slug from a name or handle (the admin can always type another). */
export function suggestSiteSlug(input: string): string {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SITE_SLUG_MAX)
    .replace(/-+$/g, '');
}

export function siteSubdomainHost(slug: string, env: SiteEnvironment): string {
  return `${slug}.${SITE_HOST_SUFFIX[env]}`;
}

/** Lowercase, no port, no trailing dot; null when it is not a plausible hostname. */
export function normalizeSiteHost(input: string): string | null {
  const host = String(input ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (host.length < 4 || host.length > 253) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) return null;
  return host;
}

/** Platform hosts (alummahnow.net and friends) can never be attached to a site. */
export function isPlatformHost(host: string): boolean {
  return /(^|\.)alummahnow\.(net|com|app|link)$/.test(host);
}

// ---------------------------------------------------------------------------------------------
// Theme (§5.3): a site chooses one of the platform's themes, pinned `<id>@<version>`.
// ---------------------------------------------------------------------------------------------

/**
 * Themes a site may choose today, with their current versions. Only the built-in themes: the
 * www and sites renderers can't render admin-made packages yet (AlUmmahNowUI#55). Must match
 * packages/theme-packages/src/builtins.generated.ts (checked by a theme-packages test).
 */
export const SITE_THEME_CHOICES: readonly { id: string; version: string; name: { en: string; ar: string } }[] = [
  { id: 'lantern', version: '1.0.0', name: { en: 'Lantern', ar: 'الفانوس' } },
  { id: 'zujaj', version: '1.0.0', name: { en: 'Zujaj', ar: 'زجاج' } },
  { id: 'nahas', version: '1.0.0', name: { en: 'Nahas', ar: 'نحاس' } },
  { id: 'fawanees', version: '1.2.0', name: { en: 'Fawanees', ar: 'فوانيس' } },
];

const THEME_REF = /^([a-z][a-z0-9-]{1,39})@((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/;

export function parseSiteThemeRef(ref: unknown): { id: string; version: string } | null {
  const m = typeof ref === 'string' ? THEME_REF.exec(ref) : null;
  return m ? { id: m[1], version: m[2] } : null;
}

/** A ref a site may be pinned to now: a choosable theme at its current version. */
export function isChoosableThemeRef(ref: unknown): boolean {
  const parsed = parseSiteThemeRef(ref);
  return !!parsed && SITE_THEME_CHOICES.some((t) => t.id === parsed.id && t.version === parsed.version);
}

/** The pinned ref of a theme id at its current version (null when not choosable). */
export function currentThemeRef(id: string): string | null {
  const t = SITE_THEME_CHOICES.find((x) => x.id === id);
  return t ? `${t.id}@${t.version}` : null;
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

/** Built-in destinations for menu items; `page` links a site page, `url` an outside link. */
export type SiteNavKind = 'home' | 'videos' | 'shorts' | 'posts' | 'about' | 'url';
export const SITE_NAV_KINDS: readonly SiteNavKind[] = ['home', 'videos', 'shorts', 'posts', 'about', 'url'];

export interface SiteNavItem {
  id: string;
  kind: SiteNavKind;
  /** Label per language; built-in kinds fall back to the site's own wording. */
  label?: Partial<Record<SiteLocale, string>>;
  /** `url` only: https:// links. */
  url?: string;
}

export interface SiteHost {
  host: string;
  kind: 'subdomain' | 'custom';
  primary: boolean;
}

export interface SiteRedirectHost {
  host: string;
  /** ISO time after which the old subdomain stops redirecting (12 months after a rename, SS12). */
  until: string;
}

export interface SiteSettings {
  schemaVersion: 1;
  channelId: string;
  slug: string;
  status: SiteStatus;
  tier: SiteTier;
  limits: SiteLimits;
  /** `<themeId>@<version>`, never empty and never "follow the platform" (§5.3). */
  themeRef: string;
  /** Site name per language; empty falls back to the channel name. */
  name: Partial<Record<SiteLocale, string>>;
  /** Square logo (crop and resize only); empty falls back to the channel avatar. */
  logoUrl: string | null;
  faviconUrl: string | null;
  /** Languages the site serves, in order; the first is the default (SS13: may be one). */
  locales: SiteLocale[];
  navigation: SiteNavItem[];
  /** The About page text (markdown) per language; empty uses the channel description. */
  about: Partial<Record<SiteLocale, string>>;
  hosts: SiteHost[];
  redirectHosts: SiteRedirectHost[];
  /** Bumped on every save: part of the sites Worker's cache key. */
  configVersion: number;
  /** Set while `revoked`: when it happened (restore window SITE_RESTORE_DAYS). */
  revokedAt?: string | null;
  /** The status to go back to on restore. */
  statusBeforeRevoke?: SiteStatus | null;
  grantedAt: string;
  grantedBy: string;
  updatedAt: string;
  updatedBy: string;
}

/** The R2 key of a site's settings (bucket `channel_sections`). */
export const siteSettingsKey = (channelId: string) => `site/${channelId}/settings.json`;
/** The R2 key of a host index entry (bucket `channel_tabs`). */
export const siteHostKey = (host: string) => `site-hosts/${host}.json`;
/** Studio previews: `site/{channelId}/previews/{token}.json` (10 minutes). */
export const sitePreviewKey = (channelId: string, token: string) => `site/${channelId}/previews/${token}.json`;
export const SITE_PREVIEW_TTL_MS = 10 * 60 * 1000;

export interface SiteHostEntry {
  host: string;
  channelId: string;
  kind: 'subdomain' | 'custom' | 'redirect';
  /** `redirect` entries only. */
  until?: string;
  createdAt: string;
}

export const SITE_NAV_LABEL_MAX = 40;
export const SITE_NAME_MAX = 80;
export const SITE_ABOUT_MAX = 8000;

/** What a site owner may change in Studio (§7.1, phase 2 MVP). */
export interface SiteSettingsUpdate {
  themeRef?: string;
  name?: Partial<Record<SiteLocale, string>>;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  locales?: SiteLocale[];
  navigation?: SiteNavItem[];
  about?: Partial<Record<SiteLocale, string>>;
}

export type SiteSettingsProblem =
  | 'theme_not_available'
  | 'locales_invalid'
  | 'navigation_too_long'
  | 'navigation_invalid'
  | 'name_too_long'
  | 'about_too_long'
  | 'image_url_invalid';

const IMAGE_URL = /^https:\/\/[^\s"'<>]+$/;

/** Validates a Studio update against the site's limits; returns the first problem or null. */
export function validateSiteSettingsUpdate(update: SiteSettingsUpdate, limits: SiteLimits): SiteSettingsProblem | null {
  if (update.themeRef !== undefined && !isChoosableThemeRef(update.themeRef)) return 'theme_not_available';
  if (update.locales !== undefined) {
    const l = update.locales;
    if (!Array.isArray(l) || l.length < 1 || l.length > 2 || new Set(l).size !== l.length || !l.every((x) => (SITE_LOCALES as string[]).includes(x))) return 'locales_invalid';
  }
  if (update.navigation !== undefined) {
    if (!Array.isArray(update.navigation)) return 'navigation_invalid';
    if (update.navigation.length > limits.navigationMax) return 'navigation_too_long';
    const ids = new Set<string>();
    for (const item of update.navigation) {
      if (!item || typeof item.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(item.id) || ids.has(item.id)) return 'navigation_invalid';
      ids.add(item.id);
      if (!(SITE_NAV_KINDS as string[]).includes(item.kind)) return 'navigation_invalid';
      if (item.kind === 'url' && (typeof item.url !== 'string' || !/^https:\/\/[^\s"'<>]{3,500}$/.test(item.url))) return 'navigation_invalid';
      if (item.kind === 'url' && !item.label?.en && !item.label?.ar) return 'navigation_invalid';
      for (const v of Object.values(item.label ?? {})) if (typeof v !== 'string' || v.length > SITE_NAV_LABEL_MAX) return 'navigation_invalid';
    }
  }
  for (const v of Object.values(update.name ?? {})) if (typeof v !== 'string' || v.length > SITE_NAME_MAX) return 'name_too_long';
  for (const v of Object.values(update.about ?? {})) if (typeof v !== 'string' || v.length > SITE_ABOUT_MAX) return 'about_too_long';
  for (const url of [update.logoUrl, update.faviconUrl]) if (url !== undefined && url !== null && (typeof url !== 'string' || url.length > 1000 || !IMAGE_URL.test(url))) return 'image_url_invalid';
  return null;
}

// ---------------------------------------------------------------------------------------------
// What the sites Worker reads
// ---------------------------------------------------------------------------------------------

export interface PublicSiteChannel {
  id: string;
  name: string;
  nameLocalized?: Partial<Record<SiteLocale, string>>;
  handle: string | null;
  avatarUrl: string | null;
  description: string | null;
  descriptionLocalized?: Partial<Record<SiteLocale, string>>;
  links?: { title?: string; url: string }[];
}

/**
 * `GET /api/sites/by-host/:host`. `redirectTo` is set when the host is not the site's primary host
 * (or an old subdomain within its 12 months): the Worker 301s there and renders nothing.
 */
export interface PublicSite {
  host: string;
  redirectTo: string | null;
  site: {
    channelId: string;
    slug: string;
    status: SiteStatus;
    themeRef: string;
    name: Partial<Record<SiteLocale, string>>;
    logoUrl: string | null;
    faviconUrl: string | null;
    locales: SiteLocale[];
    navigation: SiteNavItem[];
    about: Partial<Record<SiteLocale, string>>;
    platformMark: SitePlatformMark;
    primaryHost: string;
    /** `custom`: the primary host is the scholar's own domain (videos canonical on the site, SS7). */
    primaryKind: 'subdomain' | 'custom';
    configVersion: number;
  };
  channel: PublicSiteChannel;
  /** A Studio preview (unsaved settings): never cached, always noindex. */
  preview: boolean;
}

/** The site's primary host (the subdomain until an own domain is made primary). */
export function primarySiteHost(settings: Pick<SiteSettings, 'hosts' | 'slug'>, env: SiteEnvironment): SiteHost {
  return settings.hosts.find((h) => h.primary) ?? { host: siteSubdomainHost(settings.slug, env), kind: 'subdomain', primary: true };
}
