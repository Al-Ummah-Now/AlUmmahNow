/**
 * Where visits to the videos site start and where they come from (owner decision D-SEO-9, wiki
 * AUN-SEO): our own analytics only, no third party, no identifiers. One visit = the first page a
 * browser tab opens on the site. It is counted as daily site counters (processor analytics_daily,
 * entity 'site'), never stored per person.
 *
 *   landing:        the kind of page the visit started on (never an id or a query)
 *   source:         direct | search:<engine> | social:<network> | platform (www, a scholar site) | site (another website)
 *   referrer_host:  the other website's host (bounded; search engines and social networks by name)
 */

export const LANDING_KINDS = [
  'home', 'watch', 'shorts', 'channel', 'playlist', 'search', 'explore', 'videos', 'channels', 'live', 'library', 'other',
] as const;
export type LandingKind = (typeof LANDING_KINDS)[number];

const SECTION_LANDING: Record<string, LandingKind> = {
  video: 'watch',
  shorts: 'shorts',
  channels: 'channel',
  c: 'channel',
  playlist: 'playlist',
  search: 'search',
  explore: 'explore',
  sections: 'explore',
  videos: 'videos',
  live: 'live',
  library: 'library',
  history: 'library',
  subscriptions: 'library',
};

/** The landing kind of a /{locale}/… path. `/channels` alone is the channel directory. */
export function landingKindOf(pathname: string): LandingKind {
  const parts = pathname.split(/[?#]/)[0]!.split('/').filter(Boolean);
  const section = parts[1];
  if (!section) return 'home';
  if (section.startsWith('@')) return 'channel';
  if (section === 'channels' && parts.length === 2) return 'channels';
  return SECTION_LANDING[section] ?? 'other';
}

/** Search engines by the registrable part of their host (google.com, google.co.uk, …). */
const SEARCH_ENGINES: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
  [/(^|\.)yahoo\.[a-z.]+$/, 'yahoo'],
  [/(^|\.)yandex\.[a-z.]+$/, 'yandex'],
  [/(^|\.)baidu\.com$/, 'baidu'],
  [/(^|\.)ecosia\.org$/, 'ecosia'],
  [/(^|\.)search\.brave\.com$/, 'brave'],
  [/(^|\.)naver\.com$/, 'naver'],
  [/(^|\.)seznam\.cz$/, 'seznam'],
  [/(^|\.)qwant\.com$/, 'qwant'],
  [/(^|\.)(chatgpt\.com|perplexity\.ai|copilot\.microsoft\.com|claude\.ai|gemini\.google\.com)$/, 'ai'],
];

const SOCIAL_NETWORKS: [RegExp, string][] = [
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, 'x'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.facebook\.com|l\.facebook\.com)$/, 'facebook'],
  [/(^|\.)(instagram\.com|l\.instagram\.com)$/, 'instagram'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'],
  [/(^|\.)(t\.me|telegram\.org|telegram\.me)$/, 'telegram'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)snapchat\.com$/, 'snapchat'],
  [/(^|\.)threads\.net$/, 'threads'],
];

/** Where a visit came from, by the referrer's host (null: no referrer). */
export function visitSourceOf(referrerHost: string | null | undefined): string {
  if (!referrerHost) return 'direct';
  const host = referrerHost.toLowerCase();
  // Our own sites (www, scholar sites, the other apps)
  if (host === 'alummahnow.net' || host.endsWith('.alummahnow.net')) return 'platform';
  // Gemini is a Google host: check the AI answer engines before Google search
  const ai = SEARCH_ENGINES.find(([re, name]) => name === 'ai' && re.test(host));
  if (ai) return 'search:ai';
  for (const [re, name] of SEARCH_ENGINES) if (re.test(host)) return `search:${name}`;
  for (const [re, name] of SOCIAL_NETWORKS) if (re.test(host)) return `social:${name}`;
  return 'site';
}

/** One visit, as the beacon reports it after the web server classified it. */
export interface SiteVisitEvent {
  landing: LandingKind;
  source: string;
  referrerHost?: string;
  /** Request origin (request-origin.ts): client surface, device class, country, utm_source */
  surface?: string;
  device?: string;
  country?: string;
  campaign?: string;
}

// One letter is a real name: X (social:x)
const SOURCE_PATTERN = /^(direct|site|platform|short_link|embed|email|push|campaign|search:[a-z]{1,20}|social:[a-z]{1,20})$/;
const SURFACE_PATTERN = /^[a-z_]{2,12}$/;
const DEVICE_PATTERN = /^(phone|tablet|desktop|tv|unknown)$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const CAMPAIGN_PATTERN = /^[a-z0-9._-]{1,40}$/;
const optional = (v: unknown, re: RegExp) => v === undefined || (typeof v === 'string' && re.test(v));

export function isSiteVisitEvent(value: unknown): value is SiteVisitEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (LANDING_KINDS as readonly string[]).includes(String(v.landing)) &&
    typeof v.source === 'string' && SOURCE_PATTERN.test(v.source) &&
    (v.referrerHost === undefined || (typeof v.referrerHost === 'string' && v.referrerHost.length <= 253)) &&
    optional(v.surface, SURFACE_PATTERN) &&
    optional(v.device, DEVICE_PATTERN) &&
    optional(v.country, COUNTRY_PATTERN) &&
    optional(v.campaign, CAMPAIGN_PATTERN)
  );
}
