/**
 * Where a request came from (owner 2026-11-18: "include where the request came from … for
 * analytics, and included on sources, errors and so on"). One model for errors, analytics,
 * audit and jobs, classified at the edge from the request itself.
 *
 * Privacy (cookie-consent rules, wiki AUN-SEO D-SEO-9): per request, no identifiers. Never an IP,
 * a raw User-Agent, an email, a full URL, a path beyond a route template or a query beyond
 * utm_source. The referrer is a host only. Nothing here sets or reads a cookie.
 *
 *   surface      which client: web, admin, ios, ipados, macos, android, android_tv, apple_tv,
 *                windows, linux, tizen, embed, api (M2M / scripts), bot, unknown
 *   app/version  native apps say so in `X-AUN-Client: <app>/<version> (<os> <osver>)`
 *   release      the build that served or sent it (git sha or tag)
 *   source       direct | search:<engine> | social:<network> | platform (our sites) | site
 *                (another website) | short_link | embed | email | push | campaign
 *   referrerHost the other site's host (bounded by the analytics caps)
 *   campaign     utm_source only, lower-case, ≤ 40 characters
 *   entry        route template of the first page (/:locale/video/:id), never ids
 *   country      ISO 3166-1 alpha-2 from Cloudflare (cf.country), XX when unknown
 *   device       phone | tablet | desktop | tv | unknown (client hint, else the UA family)
 */
import { visitSourceOf } from './site-visits';

export const CLIENT_SURFACES = ['web', 'admin', 'ios', 'ipados', 'macos', 'android', 'android_tv', 'apple_tv', 'windows', 'linux', 'tizen', 'embed', 'api', 'bot', 'unknown'] as const;
export type ClientSurface = (typeof CLIENT_SURFACES)[number];

export const DEVICE_CLASSES = ['phone', 'tablet', 'desktop', 'tv', 'unknown'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** The header native clients send (AlUmmahNowCore's HTTP client). */
export const CLIENT_HEADER = 'X-AUN-Client';

export interface RequestOrigin {
  surface: ClientSurface;
  /** Native app id from X-AUN-Client (e.g. "aun-ios", "aun-studio-android") */
  app?: string;
  appVersion?: string;
  release?: string;
  source: string;
  referrerHost?: string;
  campaign?: string;
  entry?: string;
  country?: string;
  device: DeviceClass;
}

export interface ParsedClientHeader {
  app: string;
  version?: string;
  os?: string;
  osVersion?: string;
}

const TOKEN = /^[A-Za-z0-9._-]{1,40}$/;

/** "aun-ios/1.4.0 (iOS 18.1)" → { app, version, os, osVersion }; null when it isn't one. */
export function parseClientHeader(value: string | null | undefined): ParsedClientHeader | null {
  if (!value || value.length > 200) return null;
  const m = /^\s*([A-Za-z0-9._-]{1,40})(?:\/([A-Za-z0-9._+-]{1,40}))?\s*(?:\(([^)]{1,80})\))?\s*$/.exec(value);
  if (!m) return null;
  const [os, osVersion] = (m[3] ?? '').trim().split(/\s+/, 2);
  return {
    app: m[1]!.toLowerCase(),
    ...(m[2] ? { version: m[2] } : {}),
    ...(os && TOKEN.test(os) ? { os: os.toLowerCase() } : {}),
    ...(osVersion && TOKEN.test(osVersion) ? { osVersion } : {}),
  };
}

/** True when `X-AUN-Client` names an Ummah Kids client (`kids/...`, `aun-kids-ios/...`, etc.). */
export function isKidsClientApp(value: string | null | undefined): boolean {
  const parsed = parseClientHeader(value);
  return !!parsed && /^(?:aun-)?kids(?:-|$)/i.test(parsed.app);
}

const NATIVE_OS: [RegExp, ClientSurface][] = [
  [/^ipados$/, 'ipados'],
  [/^(ios|iphoneos)$/, 'ios'],
  [/^(macos|osx|mac)$/, 'macos'],
  [/^(tvos|appletv)$/, 'apple_tv'],
  [/^(androidtv|android_tv|googletv|firetv|fireos)$/, 'android_tv'],
  [/^android$/, 'android'],
  [/^windows$/, 'windows'],
  [/^linux$/, 'linux'],
  [/^tizen$/, 'tizen'],
];

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|whatsapp|telegrambot|discordbot|linkedinbot|pinterest|bingpreview|headlesschrome|lighthouse|curl\/|wget\/|python-requests|go-http-client|node-fetch|axios\//i;

/** The client surface. UA text is read to classify only; it is never kept. */
export function surfaceOf(input: { client?: ParsedClientHeader | null; userAgent?: string | null; app?: 'web' | 'admin' | 'api' | 'auth' | 'www' | 'cms' | 'other'; embed?: boolean; m2m?: boolean }): ClientSurface {
  const native = input.client?.os ? NATIVE_OS.find(([re]) => re.test(input.client!.os!)) : undefined;
  if (native) return native[1];
  if (input.m2m) return 'api';
  const ua = input.userAgent ?? '';
  if (ua && BOT_UA.test(ua)) return 'bot';
  if (input.embed) return 'embed';
  if (input.app === 'admin') return 'admin';
  if (input.app === 'web' || input.app === 'www' || input.app === 'cms' || input.app === 'auth') return ua ? 'web' : 'unknown';
  if (!ua) return 'unknown';
  // An API call from a browser page is the web surface; from anything else, a script
  return /mozilla\//i.test(ua) ? 'web' : 'api';
}

/** Device class from Sec-CH-UA-Mobile / the UA family (never stored). */
export function deviceClassOf(input: { surface: ClientSurface; chMobile?: string | null; userAgent?: string | null }): DeviceClass {
  switch (input.surface) {
    case 'ios':
    case 'android':
      return 'phone';
    case 'ipados':
      return 'tablet';
    case 'macos':
    case 'windows':
    case 'linux':
      return 'desktop';
    case 'android_tv':
    case 'apple_tv':
    case 'tizen':
      return 'tv';
    case 'api':
    case 'bot':
      return 'unknown';
  }
  // Bounded: a header is never trusted to be short (and no pattern here can backtrack on it)
  const ua = (input.userAgent ?? '').slice(0, 512);
  if (/smart-?tv|tizen|webos|hbbtv|appletv|googletv|android tv|crkey|aft[a-z]/i.test(ua)) return 'tv';
  if (/ipad|tablet|kindle|silk|playbook/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet';
  if (input.chMobile === '?1' || /mobi|iphone|ipod|windows phone/i.test(ua) || (/android/i.test(ua) && /mobile/i.test(ua))) return 'phone';
  if (input.chMobile === '?0' || ua) return 'desktop';
  return 'unknown';
}

const OURS = /(^|\.)alummahnow\.(net|org|app|com)$/;
const SHORT_LINK = /(^|\.)alummahnow\.link$/;
const EMAIL_HOSTS = /(^|\.)(mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com|mail\.proton\.me|mail\.yandex\.[a-z]+|icloud\.com)$/;

function hostOf(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && host.length <= 253 ? host : undefined;
  } catch {
    return undefined;
  }
}

/** utm_source as a campaign name: lower-case letters, digits, . _ - only. */
export function campaignOf(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.slice(0, 200).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  // Trim separators at both ends without a regex (no backtracking on long input)
  let start = 0;
  let end = v.length;
  while (start < end && '-._'.includes(v[start]!)) start++;
  while (end > start && '-._'.includes(v[end - 1]!)) end--;
  return v.slice(start, end).slice(0, 40) || undefined;
}

/**
 * Where the visit came from. `ownHost` is the host serving the request: a referrer on it is an
 * in-site navigation (null source: the caller keeps the session's first source).
 */
export function sourceOf(input: { referrer?: string | null; url?: URL; embed?: boolean; embedHost?: string }): { source: string; referrerHost?: string; campaign?: string } {
  const params = input.url?.searchParams;
  const medium = params?.get('utm_medium')?.toLowerCase();
  const campaign = campaignOf(params?.get('utm_source'));
  const refHost = hostOf(input.referrer ?? undefined);
  if (input.embed) return { source: 'embed', ...(input.embedHost || refHost ? { referrerHost: input.embedHost ?? refHost } : {}) };
  if (medium === 'push' || params?.get('src') === 'push') return { source: 'push', ...(campaign ? { campaign } : {}) };
  if (medium === 'email' || (refHost && EMAIL_HOSTS.test(refHost))) return { source: 'email', ...(campaign ? { campaign } : {}) };
  if (campaign) return { source: 'campaign', campaign, ...(refHost ? { referrerHost: refHost } : {}) };
  if (refHost && SHORT_LINK.test(refHost)) return { source: 'short_link' };
  if (refHost && OURS.test(refHost)) return { source: 'platform', referrerHost: refHost };
  const source = visitSourceOf(refHost ?? null);
  return { source, ...(refHost && source !== 'direct' ? { referrerHost: refHost } : {}) };
}

/** The countries counted by name in analytics; the rest are "other" (owner: top 50 + other). */
export function countryOf(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1' ? value : undefined;
}

export interface OriginOptions {
  /** Which of our apps is classifying */
  app: 'web' | 'admin' | 'api' | 'auth' | 'www' | 'cms' | 'other';
  release?: string;
  /** Route template of the page (callers normalise; ids never) */
  entry?: string;
  /** An M2M / internal-key call (admin-api to Auth, service bindings) */
  m2m?: boolean;
  /** An embed frame request, and the embedding page's host when known */
  embed?: boolean;
  embedHost?: string;
}

/** Classifies a request. Pure; reads headers and request.cf, keeps none of them raw. */
export function originOf(request: Request, options: OriginOptions): RequestOrigin {
  const h = request.headers;
  const client = parseClientHeader(h.get(CLIENT_HEADER));
  const ua = h.get('user-agent');
  const surface = surfaceOf({ client, userAgent: ua, app: options.app, embed: options.embed, m2m: options.m2m });
  let url: URL | undefined;
  try {
    url = new URL(request.url);
  } catch {
    url = undefined;
  }
  const src = sourceOf({ referrer: h.get('referer'), url, embed: options.embed || surface === 'embed', embedHost: options.embedHost });
  const cf = (request as { cf?: { country?: unknown } }).cf;
  const country = countryOf(cf?.country) ?? countryOf(h.get('cf-ipcountry'));
  return compact({
    surface,
    ...(client ? { app: client.app, appVersion: client.version } : {}),
    release: options.release,
    ...src,
    entry: options.entry,
    country,
    device: deviceClassOf({ surface, chMobile: h.get('sec-ch-ua-mobile'), userAgent: ua }),
  });
}

function compact(o: RequestOrigin): RequestOrigin {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as unknown as RequestOrigin;
}

const SOURCE = /^(direct|site|platform|short_link|embed|email|push|campaign|search:[a-z]{1,20}|social:[a-z]{1,20})$/;
const SHORT = /^[A-Za-z0-9._:/@+-]{1,80}$/;

/** Validates an untrusted origin (reports, queue messages). Undefined when it isn't one. */
export function scrubOrigin(raw: unknown): RequestOrigin | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const surface = (CLIENT_SURFACES as readonly string[]).includes(o.surface as string) ? (o.surface as ClientSurface) : null;
  const device = (DEVICE_CLASSES as readonly string[]).includes(o.device as string) ? (o.device as DeviceClass) : 'unknown';
  const source = typeof o.source === 'string' && SOURCE.test(o.source) ? o.source : null;
  if (!surface || !source) return undefined;
  const str = (v: unknown, re = SHORT) => (typeof v === 'string' && re.test(v) ? v : undefined);
  return compact({
    surface,
    app: str(o.app, TOKEN),
    appVersion: str(o.appVersion, /^[A-Za-z0-9._+-]{1,40}$/),
    release: str(o.release),
    source,
    referrerHost: typeof o.referrerHost === 'string' ? hostOf(`https://${o.referrerHost}`) : undefined,
    campaign: campaignOf(typeof o.campaign === 'string' ? o.campaign : undefined),
    entry: typeof o.entry === 'string' && /^\/[A-Za-z0-9/:@._-]{0,200}$/.test(o.entry) ? o.entry : undefined,
    country: countryOf(o.country),
    device,
  });
}
