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
  const words = String(input ?? '')
    .slice(0, 200)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]/)
    .filter(Boolean);
  let slug = '';
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > SITE_SLUG_MAX) break;
    slug = next;
  }
  return slug;
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
export type SiteNavKind = 'home' | 'videos' | 'shorts' | 'posts' | 'about' | 'page' | 'url';
export const SITE_NAV_KINDS: readonly SiteNavKind[] = ['home', 'videos', 'shorts', 'posts', 'about', 'page', 'url'];

export interface SiteNavItem {
  id: string;
  kind: SiteNavKind;
  /** Label per language; built-in kinds fall back to the site's own wording. */
  label?: Partial<Record<SiteLocale, string>>;
  /** `url` only: https:// links. */
  url?: string;
  /** `page` only: the site page's id (SitePageSummary.id). */
  pageId?: string;
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
  /** Own domains being set up or live (§4.2). A domain joins `hosts` (kind custom) once it is live. */
  domains?: SiteDomain[];
  /** Site pages (§7.1 Pages): the list; each page's blocks are their own object (sitePageKey). */
  pages?: SitePageSummary[];
  /** Home (§7.4): a site page whose blocks show above the channel's Home sections. */
  home?: SiteHome;
  seo?: SiteSeo;
  /** Path redirects on the site (old addresses), checked before anything else. */
  redirects?: SiteRedirect[];
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

/** What a site owner may change in Studio (§7.1). Pages and domains have their own calls. */
export interface SiteSettingsUpdate {
  themeRef?: string;
  name?: Partial<Record<SiteLocale, string>>;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  locales?: SiteLocale[];
  navigation?: SiteNavItem[];
  about?: Partial<Record<SiteLocale, string>>;
  home?: SiteHome;
  seo?: SiteSeo;
  redirects?: SiteRedirect[];
}

export type SiteSettingsProblem =
  | 'theme_not_available'
  | 'locales_invalid'
  | 'navigation_too_long'
  | 'navigation_invalid'
  | 'name_too_long'
  | 'about_too_long'
  | 'image_url_invalid'
  | 'home_invalid'
  | 'seo_invalid'
  | 'redirects_invalid';

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
      if (item.kind === 'page' && (typeof item.pageId !== 'string' || !SITE_PAGE_ID.test(item.pageId))) return 'navigation_invalid';
      for (const v of Object.values(item.label ?? {})) if (typeof v !== 'string' || v.length > SITE_NAV_LABEL_MAX) return 'navigation_invalid';
    }
  }
  for (const v of Object.values(update.name ?? {})) if (typeof v !== 'string' || v.length > SITE_NAME_MAX) return 'name_too_long';
  for (const v of Object.values(update.about ?? {})) if (typeof v !== 'string' || v.length > SITE_ABOUT_MAX) return 'about_too_long';
  for (const url of [update.logoUrl, update.faviconUrl]) if (url !== undefined && url !== null && (typeof url !== 'string' || url.length > 1000 || !IMAGE_URL.test(url))) return 'image_url_invalid';
  if (update.home !== undefined) {
    const h = update.home as SiteHome | null;
    if (!h || typeof h !== 'object' || (h.pageId !== null && (typeof h.pageId !== 'string' || !SITE_PAGE_ID.test(h.pageId)))) return 'home_invalid';
  }
  if (update.seo !== undefined && !validSeo(update.seo)) return 'seo_invalid';
  if (update.redirects !== undefined && !validRedirects(update.redirects)) return 'redirects_invalid';
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
    /** Published pages only (for menus and routing); a page's blocks: GET …/by-host/:host/pages/:slug. */
    pages?: SitePageSummary[];
    home?: SiteHome;
    seo?: SiteSeo;
    redirects?: SiteRedirect[];
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

/**
 * `GET /api/sites/by-channel/:channelId`: where a channel's live site is, for the platform's own
 * canonicals (§4.4, #1215). Only a live site of a channel that isn't suspended has one.
 */
export interface PublicSiteLink {
  channelId: string;
  primaryHost: string;
  /** `custom`: the scholar's own domain, so the channel's watch pages are canonical on the site too (SS7). */
  primaryKind: 'subdomain' | 'custom';
  /** Languages the site serves; the first is its default. */
  locales: SiteLocale[];
}

/**
 * A page on the site in one language: `siteUrl(link, 'ar', 'posts/abc/')` →
 * `https://<host>/ar/posts/abc/`. A language the site doesn't serve gets the site's default.
 */
export function siteUrl(link: Pick<PublicSiteLink, 'primaryHost' | 'locales'>, locale: string, pathAfterLocale: string): string {
  const lang = (link.locales as string[]).includes(locale) ? locale : (link.locales[0] ?? 'en');
  return `https://${link.primaryHost}/${lang}/${pathAfterLocale.replace(/^\/+/, '')}`;
}

/** The site's hreflang set for a page: its languages plus x-default (its default), or one entry for a single-language site. */
export function siteAlternates(link: Pick<PublicSiteLink, 'primaryHost' | 'locales'>, pathAfterLocale: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of link.locales) out[l] = siteUrl(link, l, pathAfterLocale);
  if (link.locales.length > 1) out['x-default'] = siteUrl(link, link.locales[0], pathAfterLocale);
  return out;
}

/** The site's primary host (the subdomain until an own domain is made primary). */
export function primarySiteHost(settings: Pick<SiteSettings, 'hosts' | 'slug'>, env: SiteEnvironment): SiteHost {
  return settings.hosts.find((h) => h.primary) ?? { host: siteSubdomainHost(settings.slug, env), kind: 'subdomain', primary: true };
}

// ---------------------------------------------------------------------------------------------
// Own domains (§4.2, #1212): Cloudflare for SaaS custom hostnames on the alummahnow.org zone.
// admin-api talks to Cloudflare (token `sites-saas-token`); api-videos keeps the state in the
// site's settings and the host index.
// ---------------------------------------------------------------------------------------------

/** waiting_dns → issuing → live; failed when Cloudflare gives up (the owner can check again). */
export type SiteDomainStatus = 'waiting_dns' | 'issuing' | 'live' | 'failed';
export const SITE_DOMAIN_STATUSES: readonly SiteDomainStatus[] = ['waiting_dns', 'issuing', 'live', 'failed'];

/** A DNS record the owner adds at their DNS provider. */
export interface SiteDnsRecord {
  type: 'CNAME' | 'TXT';
  name: string;
  value: string;
  /** traffic: points the domain at the sites; ownership / certificate: Cloudflare's checks. */
  purpose: 'traffic' | 'ownership' | 'certificate';
}

export interface SiteDomain {
  host: string;
  /** The Cloudflare custom hostname id; null while it is being created. */
  cfId: string | null;
  status: SiteDomainStatus;
  records: SiteDnsRecord[];
  addedAt: string;
  addedBy: string;
  checkedAt: string | null;
  /** Cloudflare's reason when it could not verify or issue (shown to the owner). */
  error: string | null;
}

/** Status checks: every 10 minutes for 72 hours after adding, then daily (§4.2). */
export const SITE_DOMAIN_FAST_CHECK_MS = 10 * 60 * 1000;
export const SITE_DOMAIN_FAST_WINDOW_MS = 72 * 60 * 60 * 1000;
export const SITE_DOMAIN_SLOW_CHECK_MS = 24 * 60 * 60 * 1000;

export function nextDomainCheck(addedAt: string, now: number): number {
  const age = now - Date.parse(addedAt);
  return now + (Number.isFinite(age) && age < SITE_DOMAIN_FAST_WINDOW_MS ? SITE_DOMAIN_FAST_CHECK_MS : SITE_DOMAIN_SLOW_CHECK_MS);
}

export type SiteDomainProblem = 'domain_invalid' | 'domain_platform' | 'domain_limit' | 'domain_exists' | 'domain_test_only';

/**
 * Every environment's own domains are custom hostnames on the one alummahnow.org zone, so they
 * share one namespace: a host added from QA could not be added from production any more. QA and
 * stage therefore take only hosts under their test suffix (routed to their sites Worker; the
 * alummahnow.com zone is ours), and production refuses them as platform hosts. Local has no Cloudflare.
 */
export const SITE_TEST_DOMAIN_SUFFIX: Readonly<Record<SiteEnvironment, string | null>> = {
  production: null,
  stage: 'stage-sites.alummahnow.com',
  qa: 'qa-sites.alummahnow.com',
  local: null,
};

/** Whether `host` may be added as an own domain of this site; the host index still refuses a host another site holds. */
export function checkNewSiteDomain(rawHost: string, settings: Pick<SiteSettings, 'domains' | 'hosts' | 'limits'>, env: SiteEnvironment = 'production'): { host: string } | { problem: SiteDomainProblem } {
  // People paste addresses: drop a scheme, a path and a trailing dot
  let typed = String(rawHost ?? '').trim().toLowerCase();
  const scheme = typed.indexOf('://');
  if (scheme !== -1) typed = typed.slice(scheme + 3);
  const slash = typed.indexOf('/');
  if (slash !== -1) typed = typed.slice(0, slash);
  const host = normalizeSiteHost(typed);
  if (!host || !host.includes('.')) return { problem: 'domain_invalid' };
  // Test domains sit under alummahnow.com, a platform domain, so they are allowed before that check
  const testSuffix = SITE_TEST_DOMAIN_SUFFIX[env];
  const isTestDomain = !!testSuffix && host.endsWith(`.${testSuffix}`);
  if (testSuffix && !isTestDomain) return { problem: 'domain_test_only' };
  if (!isTestDomain && (isPlatformHost(host) || host === 'alummahnow.org' || host.endsWith('.alummahnow.org'))) return { problem: 'domain_platform' };
  const domains = settings.domains ?? [];
  if (domains.some((d) => d.host === host) || settings.hosts.some((h) => h.host === host)) return { problem: 'domain_exists' };
  if (domains.length >= settings.limits.customDomainsMax) return { problem: 'domain_limit' };
  return { host };
}

/** The traffic record shown before Cloudflare answers (the CNAME every own domain needs). */
export const siteTrafficRecord = (host: string): SiteDnsRecord => ({ type: 'CNAME', name: host, value: SITE_SAAS_TARGET, purpose: 'traffic' });

// ---------------------------------------------------------------------------------------------
// Pages, home, SEO and redirects (§7.1, SS16: Studio self-service from day one)
// ---------------------------------------------------------------------------------------------

export const SITE_PAGE_ID = /^pg_[a-z0-9]{8,24}$/;
export const SITE_PAGE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
/** Page slugs the site's own routes use. */
export const SITE_RESERVED_PAGE_SLUGS: ReadonlySet<string> = new Set(['en', 'ar', 'videos', 'shorts', 'posts', 'watch', 'about', 'auth', 'api', 'search', 'sitemap', 'robots', 'feed', 'assets', 'favicon']);
export const SITE_PAGE_TITLE_MAX = 120;
export const SITE_PAGE_DESCRIPTION_MAX = 300;
export const SITE_BLOCKS_MAX = 60;
export const SITE_MARKDOWN_MAX = 20000;
export const SITE_PAGE_REVISIONS = 10;
export const SITE_REDIRECTS_MAX = 50;

export type SitePageStatus = 'draft' | 'published';

export interface SitePageSummary {
  id: string;
  slug: string;
  title: Partial<Record<SiteLocale, string>>;
  status: SitePageStatus;
  updatedAt: string;
}

/** The blocks a site page is made of (rendered by packages/render on the sites Worker). */
export type SiteBlock =
  | { id: string; type: 'markdown'; text: string }
  | { id: string; type: 'image'; url: string; alt: string; caption?: string | null }
  | { id: string; type: 'video'; videoId: string }
  | { id: string; type: 'cta'; label: string; href: string }
  | { id: string; type: 'quote'; text: string; cite?: string | null }
  | { id: string; type: 'divider' }
  | { id: string; type: 'posts'; count: number }
  | { id: string; type: 'videos'; count: number; playlistId?: string | null };
export type SiteBlockType = SiteBlock['type'];
export const SITE_BLOCK_TYPES: readonly SiteBlockType[] = ['markdown', 'image', 'video', 'cta', 'quote', 'divider', 'posts', 'videos'];

/** A site page: the summary plus its description and blocks per language. */
export interface SitePage extends SitePageSummary {
  description: Partial<Record<SiteLocale, string>>;
  blocks: Partial<Record<SiteLocale, SiteBlock[]>>;
  createdAt: string;
  updatedBy: string;
  /** The last SITE_PAGE_REVISIONS saved versions, newest first (restorable in Studio). */
  revisions?: { savedAt: string; savedBy: string; title: SitePage['title']; description: SitePage['description']; blocks: SitePage['blocks'] }[];
}

export interface SitePageUpdate {
  slug?: string;
  title?: Partial<Record<SiteLocale, string>>;
  description?: Partial<Record<SiteLocale, string>>;
  blocks?: Partial<Record<SiteLocale, SiteBlock[]>>;
  status?: SitePageStatus;
}

/** R2 key of a site page (bucket `channel_sections`, next to the settings). */
export const sitePageKey = (channelId: string, pageId: string) => `site/${channelId}/pages/${pageId}.json`;

export interface SiteHome {
  /** A published site page shown above the Home sections; null = none. */
  pageId: string | null;
}

export interface SiteSeo {
  /** Page titles: `%s` is the page's own title (for example "%s · Mustafa Elbadry"). */
  titleTemplate?: string | null;
  description?: Partial<Record<SiteLocale, string>>;
  /** Search console verification tokens (the content of their meta tags). */
  googleVerification?: string | null;
  bingVerification?: string | null;
}

export interface SiteRedirect {
  /** A path on the site: /old-page */
  from: string;
  /** A path on the site or an https:// address. */
  to: string;
}

export type SitePageProblem = 'slug_invalid' | 'slug_reserved' | 'title_invalid' | 'description_invalid' | 'blocks_invalid' | 'status_invalid';

const SAFE_TEXT = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const HTTPS_URL = /^https:\/\/[^\s"'<>]{3,1000}$/;
const SITE_PATH = /^\/[A-Za-z0-9\-._~/%]{0,300}$/;
const VERIFICATION = /^[A-Za-z0-9_-]{8,100}$/;

function validBlock(b: unknown): boolean {
  const x = b as Record<string, unknown> | null;
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(x.id)) return false;
  switch (x.type) {
    case 'markdown':
      return SAFE_TEXT(x.text, SITE_MARKDOWN_MAX);
    case 'image':
      return typeof x.url === 'string' && IMAGE_URL.test(x.url) && x.url.length <= 1000 && SAFE_TEXT(x.alt, 300) && (x.caption == null || SAFE_TEXT(x.caption, 300));
    case 'video':
      return typeof x.videoId === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(x.videoId);
    case 'cta':
      return SAFE_TEXT(x.label, 80) && !!(x.label as string).trim() && typeof x.href === 'string' && (HTTPS_URL.test(x.href) || SITE_PATH.test(x.href));
    case 'quote':
      return SAFE_TEXT(x.text, 2000) && !!(x.text as string).trim() && (x.cite == null || SAFE_TEXT(x.cite, 200));
    case 'divider':
      return true;
    case 'posts':
      return Number.isInteger(x.count) && (x.count as number) >= 1 && (x.count as number) <= 12;
    case 'videos':
      return Number.isInteger(x.count) && (x.count as number) >= 1 && (x.count as number) <= 24 && (x.playlistId == null || (typeof x.playlistId === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(x.playlistId)));
    default:
      return false;
  }
}

/** Validates a page save; returns the first problem or null. */
export function validateSitePageUpdate(update: SitePageUpdate): SitePageProblem | null {
  if (update.slug !== undefined) {
    if (typeof update.slug !== 'string' || !SITE_PAGE_SLUG.test(update.slug) || update.slug.includes('--')) return 'slug_invalid';
    if (SITE_RESERVED_PAGE_SLUGS.has(update.slug)) return 'slug_reserved';
  }
  if (update.title !== undefined) {
    if (!update.title || typeof update.title !== 'object') return 'title_invalid';
    for (const [k, v] of Object.entries(update.title)) if (!(SITE_LOCALES as string[]).includes(k) || !SAFE_TEXT(v, SITE_PAGE_TITLE_MAX)) return 'title_invalid';
  }
  if (update.description !== undefined) {
    if (!update.description || typeof update.description !== 'object') return 'description_invalid';
    for (const [k, v] of Object.entries(update.description)) if (!(SITE_LOCALES as string[]).includes(k) || !SAFE_TEXT(v, SITE_PAGE_DESCRIPTION_MAX)) return 'description_invalid';
  }
  if (update.blocks !== undefined) {
    if (!update.blocks || typeof update.blocks !== 'object') return 'blocks_invalid';
    for (const [k, list] of Object.entries(update.blocks)) {
      if (!(SITE_LOCALES as string[]).includes(k) || !Array.isArray(list) || list.length > SITE_BLOCKS_MAX) return 'blocks_invalid';
      const ids = new Set<string>();
      for (const b of list) {
        if (!validBlock(b) || ids.has((b as SiteBlock).id)) return 'blocks_invalid';
        ids.add((b as SiteBlock).id);
      }
    }
  }
  if (update.status !== undefined && update.status !== 'draft' && update.status !== 'published') return 'status_invalid';
  return null;
}

function validSeo(seo: unknown): boolean {
  const x = seo as SiteSeo | null;
  if (!x || typeof x !== 'object') return false;
  if (x.titleTemplate != null && (!SAFE_TEXT(x.titleTemplate, 120) || !x.titleTemplate.includes('%s'))) return false;
  for (const [k, v] of Object.entries(x.description ?? {})) if (!(SITE_LOCALES as string[]).includes(k) || !SAFE_TEXT(v, SITE_PAGE_DESCRIPTION_MAX)) return false;
  for (const token of [x.googleVerification, x.bingVerification]) if (token != null && (typeof token !== 'string' || !VERIFICATION.test(token))) return false;
  return true;
}

function validRedirects(list: unknown): boolean {
  if (!Array.isArray(list) || list.length > SITE_REDIRECTS_MAX) return false;
  const seen = new Set<string>();
  for (const r of list) {
    const x = r as SiteRedirect | null;
    if (!x || typeof x.from !== 'string' || typeof x.to !== 'string') return false;
    if (!SITE_PATH.test(x.from) || x.from === '/' || seen.has(x.from)) return false;
    if (!(SITE_PATH.test(x.to) || HTTPS_URL.test(x.to)) || x.to === x.from) return false;
    seen.add(x.from);
  }
  return true;
}

/** The page title for the browser tab: the site's template, else "page · site". */
export function sitePageTitle(pageTitle: string, siteName: string, template?: string | null): string {
  if (template && template.includes('%s')) return template.replace('%s', pageTitle);
  return pageTitle && siteName && pageTitle !== siteName ? `${pageTitle} · ${siteName}` : pageTitle || siteName;
}

/** `/a/b//` → `/a/b`; `/` stays `/` (a linear scan, no regex over the input). */
export function trimTrailingSlashes(p: string): string {
  let end = p.length;
  while (end > 1 && p.charCodeAt(end - 1) === 47) end--;
  return p.slice(0, end);
}

/** Where a path redirects, or null. Exact match on the path (no trailing slash difference). */
export function siteRedirectFor(redirects: SiteRedirect[] | undefined, path: string): string | null {
  const hit = (redirects ?? []).find((r) => trimTrailingSlashes(r.from) === trimTrailingSlashes(path));
  return hit ? hit.to : null;
}
