/**
 * Social auto-post and scheduler-tool support (wiki AUN-SOCIAL, SOC-1; docs/specs/social-media-management.md).
 *
 * Owner decisions 2026-11-14 (wiki SM-6): no Facebook, Instagram or Threads integration and no Meta business
 * verification. Channels auto-post to the networks that need no business entity (X, Telegram, Bluesky,
 * Mastodon), and creators who use Hootsuite, Buffer, Zapier and the like get feeds, link previews, oEmbed,
 * signed webhooks and a share kit.
 *
 * Pure and shared: api-videos (connect, plan, publish), the processor (queue driver), admin-api and the web
 * apps read the same rules.
 */

export const SOCIAL_NETWORKS = ['x', 'telegram', 'bluesky', 'mastodon'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export function isSocialNetwork(value: unknown): value is SocialNetwork {
  return typeof value === 'string' && (SOCIAL_NETWORKS as readonly string[]).includes(value);
}

/** What a rule reacts to: a long-form video published, a Short published, a live stream started, a community post published. */
export const SOCIAL_EVENTS = ['video', 'short', 'live', 'post'] as const;
export type SocialEvent = (typeof SOCIAL_EVENTS)[number];

export function isSocialEvent(value: unknown): value is SocialEvent {
  return typeof value === 'string' && (SOCIAL_EVENTS as readonly string[]).includes(value);
}

/**
 * What is posted (owner decisions 2 and 3, spec §6.1.1): the video itself natively, or a link post. Both are
 * offered as equal choices and a failed video post never falls back to a link by itself. A live stream has no
 * file yet and a community post is text: both are always `link`.
 */
export const SOCIAL_FORMATS = ['video', 'link'] as const;
export type SocialFormat = (typeof SOCIAL_FORMATS)[number];

export function formatsFor(event: SocialEvent): readonly SocialFormat[] {
  return event === 'video' || event === 'short' ? SOCIAL_FORMATS : ['link'];
}

/** The preselected format of a new rule: the video itself wherever there is one (owner decision 3). */
export function defaultFormat(event: SocialEvent): SocialFormat {
  return formatsFor(event)[0]!;
}

export const SOCIAL_LANGUAGES = ['en', 'ar'] as const;
export type SocialLanguage = (typeof SOCIAL_LANGUAGES)[number];

export type SocialAccountStatus = 'active' | 'needs_reconnect' | 'revoked' | 'suspended';

export type SocialDeliveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'blocked' | 'cancelled';

/** One channel's connected account, as Studio sees it (never any token). */
export interface SocialAccountView {
  id: string;
  channelId: string;
  network: SocialNetwork;
  handle: string;
  displayName: string;
  /** Mastodon instance or Bluesky PDS host; Telegram: the chat's public @username when it has one */
  instance?: string;
  profileUrl?: string;
  language: SocialLanguage;
  status: SocialAccountStatus;
  statusReason?: string;
  connectedAt: string;
  rules: SocialRuleView[];
  /** Mastodon: the instance's own character limit, when known (posts and Studio's preview are cut to it) */
  maxChars?: number;
}

export interface SocialRuleView {
  event: SocialEvent;
  enabled: boolean;
  format: SocialFormat;
  /** X only: add the watch link to a video post (X bills a post with a URL at the link price, spec §6.1.1). */
  includeLink: boolean;
}

export interface SocialDeliveryView {
  id: string;
  accountId: string;
  network: SocialNetwork;
  handle: string;
  event: SocialEvent;
  entityId: string;
  entityTitle?: string;
  format: SocialFormat;
  status: SocialDeliveryStatus;
  attempts: number;
  error?: string;
  remoteUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocialTemplate {
  event: SocialEvent;
  lang: SocialLanguage;
  body: string;
}

/** Placeholders a template may use. */
export const SOCIAL_TEMPLATE_FIELDS = ['title', 'channel', 'url', 'text'] as const;
export type SocialTemplateField = (typeof SOCIAL_TEMPLATE_FIELDS)[number];

/**
 * Default templates: placeholders only, no wording of ours, so a channel's posts say what the channel says.
 * The creator edits them per event and language in Studio.
 */
export function defaultTemplate(event: SocialEvent): string {
  return event === 'post' ? '{text}\n\n{url}' : '{title}\n\n{url}';
}

export const SOCIAL_TEMPLATE_MAX = 1000;

/** Fills a template. Unknown placeholders stay as typed; runs of blank lines collapse. */
export function renderTemplate(template: string, values: Partial<Record<SocialTemplateField, string>>): string {
  const out = template.replace(/\{(title|channel|url|text)\}/g, (_m, key: SocialTemplateField) => values[key] ?? '');
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Template problems Studio shows before saving. */
export function templateProblems(event: SocialEvent, body: string): string[] {
  const problems: string[] = [];
  if (!body.trim()) problems.push('empty');
  if (body.length > SOCIAL_TEMPLATE_MAX) problems.push('too_long');
  const unknown = [...body.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]!).filter((k) => !(SOCIAL_TEMPLATE_FIELDS as readonly string[]).includes(k));
  if (unknown.length) problems.push('unknown_field');
  if (event !== 'post' && body.includes('{text}')) problems.push('text_only_for_posts');
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Per-network rules (spec §6.3, checked 2026-11-09). Data, so a change is a data edit.
// ---------------------------------------------------------------------------------------------

export interface SocialNetworkRules {
  network: SocialNetwork;
  /** How text is measured */
  count: 'x-weighted' | 'graphemes' | 'chars-url23' | 'chars';
  /** Text limit of a text or link post */
  maxText: number;
  /** Text limit when the post carries a video (Telegram captions are shorter) */
  maxCaption: number;
  /** Largest video file the adapter sends natively, bytes */
  maxVideoBytes: number;
  /** Longest video, seconds */
  maxVideoSeconds: number;
  /** Needs a paid API (spend cap applies) */
  paid: boolean;
}

const MB = 1024 * 1024;

export const SOCIAL_NETWORK_RULES: Record<SocialNetwork, SocialNetworkRules> = {
  // tweet_video: 0.5 s–20 min for every account (spec §6.3). The adapter uploads in 5 MB chunks; 512 MB keeps one
  // upload inside a queue delivery.
  x: { network: 'x', count: 'x-weighted', maxText: 280, maxCaption: 280, maxVideoBytes: 512 * MB, maxVideoSeconds: 20 * 60, paid: true },
  // Cloud Bot API: uploads up to 50 MB; caption 1,024
  telegram: { network: 'telegram', count: 'chars', maxText: 4096, maxCaption: 1024, maxVideoBytes: 50 * MB, maxVideoSeconds: 24 * 3600, paid: false },
  // 300 graphemes; video blob ≤ 100 MB and ≤ 3 minutes
  bluesky: { network: 'bluesky', count: 'graphemes', maxText: 300, maxCaption: 300, maxVideoBytes: 100 * MB, maxVideoSeconds: 180, paid: false },
  // Instance defaults (500 characters, URL = 23; 99 MB video); the adapter reads the instance's own limits
  mastodon: { network: 'mastodon', count: 'chars-url23', maxText: 500, maxCaption: 500, maxVideoBytes: 99 * MB, maxVideoSeconds: 24 * 3600, paid: false },
};

/** X pay-per-use prices (spec §18): a post, and a post that contains a URL. Micro-dollars. */
export const X_POST_COST_MICROS = 15_000;
export const X_LINK_POST_COST_MICROS = 200_000;

export function xPostCostMicros(hasUrl: boolean): number {
  return hasUrl ? X_LINK_POST_COST_MICROS : X_POST_COST_MICROS;
}

const URL_RE = /https?:\/\/[^\s]+/g;

function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (!Seg) return Array.from(text);
  return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;

/** X's weighted length (twitter-text v3): most scripts 1, others 2, an emoji 2, a URL 23. */
export function xWeightedLength(text: string): number {
  let length = 0;
  let rest = text;
  for (const m of text.match(URL_RE) ?? []) {
    length += 23;
    rest = rest.replace(m, '');
  }
  for (const g of graphemes(rest)) {
    if (EMOJI_RE.test(g)) {
      length += 2;
      continue;
    }
    for (const ch of g) {
      const cp = ch.codePointAt(0)!;
      const light = cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
      length += light ? 1 : 2;
    }
  }
  return length;
}

export function measureText(rules: Pick<SocialNetworkRules, 'count'>, text: string): number {
  switch (rules.count) {
    case 'x-weighted':
      return xWeightedLength(text);
    case 'graphemes':
      return graphemes(text).length;
    case 'chars-url23': {
      let n = 0;
      let rest = text;
      for (const m of text.match(URL_RE) ?? []) {
        n += 23;
        rest = rest.replace(m, '');
      }
      return n + Array.from(rest).length;
    }
    default:
      return text.length;
  }
}

/**
 * Fits a rendered post into `max`: the text around the link is shortened (with an ellipsis), the link itself is
 * kept whole. Returns the text unchanged when it fits.
 */
export function fitText(rules: Pick<SocialNetworkRules, 'count'>, text: string, max: number): string {
  if (measureText(rules, text) <= max) return text;
  const links = text.match(URL_RE) ?? [];
  const link = links[links.length - 1];
  const before = link ? text.slice(0, text.lastIndexOf(link)) : text;
  const after = link ? text.slice(text.lastIndexOf(link) + link.length) : '';
  const parts = graphemes(before.trimEnd());
  const sep = link ? '\n\n' : '';
  while (parts.length) {
    parts.pop();
    const candidate = `${parts.join('').trimEnd()}…${sep}${link ?? ''}${after}`.trim();
    if (measureText(rules, candidate) <= max) return candidate;
  }
  return (link ?? graphemes(text).slice(0, max).join('')).slice(0, Math.max(0, max * 4));
}

/** What Studio's Post text preview fills a template with: the channel's newest public item of each kind. */
export interface SocialPreviewItem {
  title: Record<SocialLanguage, string>;
  text?: string;
  url: Record<SocialLanguage, string>;
}

export interface SocialPreview {
  channel: Record<SocialLanguage, string>;
  /** The channel's page: the link in the sample used for a kind the channel has nothing of yet */
  channelUrl: Record<SocialLanguage, string>;
  items: Partial<Record<SocialEvent, SocialPreviewItem>>;
}

/** What fills a template's placeholders. */
export type SocialTemplateValues = Record<SocialTemplateField, string>;

export interface SocialPostText {
  /** The text the network receives: filled in, then cut to the network's limit */
  text: string;
  /** Its length the way the network counts it */
  length: number;
  /** The network's limit for this kind of post (a video's caption or a text post) */
  limit: number;
  /** The filled-in text's length before cutting */
  fullLength: number;
  /** The text was longer than the limit and has been cut */
  cut: boolean;
}

/**
 * The text of a social post, exactly as the sender composes it (api-videos lib/social/deliver.ts composePost) and
 * as Studio previews it: the template filled in, the watch link dropped from an X video post unless the rule adds
 * it (X bills a post with a URL at the link price), the title when nothing is left, then cut to the limit.
 */
export function composePostText(input: {
  template: string;
  values: SocialTemplateValues;
  network: SocialNetwork;
  event: SocialEvent;
  format: SocialFormat;
  includeLink: boolean;
  /**
   * The account's own limit when the network has one per server (a Mastodon instance's max_characters, read from
   * the instance). Replaces the network default for the text and the caption; unknown → the default.
   */
  limit?: number | null;
}): SocialPostText {
  const rules = SOCIAL_NETWORK_RULES[input.network];
  let text = renderTemplate(input.template, input.values);
  const asVideo = input.format === 'video' && (input.event === 'video' || input.event === 'short');
  if (asVideo && input.network === 'x' && !input.includeLink) text = stripUrls(text);
  if (!text.trim()) text = input.values.title;
  const own = input.limit && Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : null;
  const limit = own ?? (asVideo ? rules.maxCaption : rules.maxText);
  const fitted = fitText(rules, text, limit);
  return { text: fitted, length: measureText(rules, fitted), limit, fullLength: measureText(rules, text), cut: fitted !== text };
}

/** Drops URLs from a text (X video posts without the watch link). */
export function stripUrls(text: string): string {
  return text.replace(URL_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------------------------
// Platform settings (videos admin, spec §11): kill switches and the X spend cap
// ---------------------------------------------------------------------------------------------

export interface SocialPlatformSettings {
  /** Kill switch for every network: nothing is posted while off (webhooks and feeds keep working). */
  enabled: boolean;
  networks: Record<SocialNetwork, { enabled: boolean }>;
  /**
   * Monthly cap on X spend, US dollars. 0 = nothing is posted to X. The platform's whole budget is $500 a month
   * (wiki O1), so the cap starts at 0 and an admin sets it.
   */
  xMonthlyCapUsd: number;
}

export const DEFAULT_SOCIAL_SETTINGS: SocialPlatformSettings = {
  enabled: true,
  networks: { x: { enabled: false }, telegram: { enabled: true }, bluesky: { enabled: true }, mastodon: { enabled: true } },
  xMonthlyCapUsd: 0,
};

export const X_MONTHLY_CAP_MAX_USD = 500;

/** Merges a stored or submitted settings object onto the defaults; anything malformed is ignored. */
export function normalizeSocialSettings(input: unknown): SocialPlatformSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<SocialPlatformSettings> & { networks?: Record<string, { enabled?: unknown }> };
  const networks = { ...DEFAULT_SOCIAL_SETTINGS.networks };
  for (const n of SOCIAL_NETWORKS) {
    const v = raw.networks?.[n]?.enabled;
    if (typeof v === 'boolean') networks[n] = { enabled: v };
  }
  const cap = Number(raw.xMonthlyCapUsd);
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SOCIAL_SETTINGS.enabled,
    networks,
    xMonthlyCapUsd: Number.isFinite(cap) && cap >= 0 ? Math.min(X_MONTHLY_CAP_MAX_USD, Math.round(cap * 100) / 100) : DEFAULT_SOCIAL_SETTINGS.xMonthlyCapUsd,
  };
}

/** The month a spend counts against (UTC calendar month). */
export function spendMonth(at: Date = new Date()): string {
  return at.toISOString().slice(0, 7);
}

/**
 * Whether one more X post fits the cap. From 90% of the cap, posts with a URL (the expensive kind) pause first;
 * at 100% everything pauses (spec §16.1).
 */
export function xSpendAllows(spentMicros: number, capUsd: number, costMicros: number): boolean {
  const cap = Math.round(capUsd * 1_000_000);
  if (cap <= 0) return false;
  if (spentMicros + costMicros > cap) return false;
  if (costMicros >= X_LINK_POST_COST_MICROS && spentMicros + costMicros > cap * 0.9) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Outgoing webhooks (Zapier, Make, n8n …)
// ---------------------------------------------------------------------------------------------

export const SOCIAL_WEBHOOK_EVENTS = ['video.published', 'short.published', 'live.started', 'post.published'] as const;
export type SocialWebhookEvent = (typeof SOCIAL_WEBHOOK_EVENTS)[number] | 'ping';

export function webhookEventFor(event: SocialEvent): SocialWebhookEvent {
  return event === 'live' ? 'live.started' : (`${event}.published` as SocialWebhookEvent);
}

export const MAX_WEBHOOKS_PER_CHANNEL = 5;

export interface SocialWebhookView {
  id: string;
  url: string;
  events: SocialWebhookEvent[];
  enabled: boolean;
  createdAt: string;
  lastStatus?: string;
  lastDeliveryAt?: string;
  failureCount: number;
}

/** What a webhook receives. `data` is public information only. */
export interface SocialWebhookPayload {
  id: string;
  event: SocialWebhookEvent;
  createdAt: string;
  channel: { id: string; name: string; handle?: string; url: string };
  data?: {
    id: string;
    kind: SocialEvent;
    title: string;
    titleLocalized?: Partial<Record<SocialLanguage, string>>;
    text?: string;
    url: string;
    shortUrl?: string;
    thumbnailUrl?: string;
    durationSeconds?: number;
    publishedAt?: string;
  };
}

export const WEBHOOK_SIGNATURE_HEADER = 'X-AUN-Signature';
/** A receiver should refuse a signature older than this. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` (the same scheme as Stripe's, so receivers know it). */
export async function signWebhook(secret: string, body: string, unixSeconds: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${unixSeconds}.${body}`));
  return `t=${unixSeconds},v1=${hex(mac)}`;
}

/** Receiver side (docs, tests): checks the signature and its age. */
export async function verifyWebhookSignature(secret: string, body: string, header: string | null | undefined, nowSeconds: number, toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS): Promise<boolean> {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = await signWebhook(secret, body, t);
  const a = expected.slice(expected.indexOf('v1=') + 3);
  const b = m[2]!;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Webhook URLs: https on a public hostname, default port, no credentials. Refuses IP literals, localhost,
 * .local / .internal names and our own hosts (no loops into the platform). Local stack and tests pass
 * `allowHosts` for their fake receivers.
 */
export function webhookUrlProblem(raw: string, allowHosts: readonly string[] = []): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'invalid_url';
  }
  const host = url.hostname.toLowerCase();
  if (allowHosts.includes(host)) return null;
  if (url.protocol !== 'https:') return 'https_required';
  if (url.username || url.password) return 'credentials_not_allowed';
  if (url.port && url.port !== '443') return 'port_not_allowed';
  if (raw.length > 2000) return 'too_long';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')) return 'ip_not_allowed';
  if (!host.includes('.') || host === 'localhost' || /\.(local|localhost|internal|lan|home|arpa)$/.test(host)) return 'private_host';
  if (host === 'alummahnow.net' || host.endsWith('.alummahnow.net') || host.endsWith('.alummahnow.link') || host === 'alummahnow.link') return 'own_host';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Feeds (RSS 2.0) for scheduler tools
// ---------------------------------------------------------------------------------------------

export const SOCIAL_FEED_KINDS = ['all', 'videos', 'shorts', 'posts', 'live'] as const;
export type SocialFeedKind = (typeof SOCIAL_FEED_KINDS)[number];

export function isSocialFeedKind(value: unknown): value is SocialFeedKind {
  return typeof value === 'string' && (SOCIAL_FEED_KINDS as readonly string[]).includes(value);
}

/** Path of a channel's feed on the videos web host. */
export function socialFeedPath(channelId: string, kind: SocialFeedKind, lang: SocialLanguage = 'en'): string {
  return `/feeds/${encodeURIComponent(channelId)}/${kind}.xml${lang === 'ar' ? '?lang=ar' : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Queue messages (videos queue, processor)
// ---------------------------------------------------------------------------------------------

/** MessageType.SocialEvent: something announceable happened on a channel. */
export interface SocialEventPayload {
  channelId: string;
  event: SocialEvent;
  entityId: string;
}

/** MessageType.SocialDelivery: one post to one account, or one webhook call. */
export interface SocialDeliveryPayload {
  kind: 'post' | 'webhook';
  deliveryId: string;
}

/** The videos queue retries 3 times: the 4th attempt is the last. */
export const SOCIAL_LAST_ATTEMPT = 4;
export const socialRetryDelaySeconds = (attempts: number) => Math.min(1800, 30 * 2 ** Math.max(0, attempts - 1));
export const socialDeliveryNeedsActionKey = (kind: 'post' | 'webhook', id: string) => `social-${kind}:${id}`;

/** What api-videos answers the processor for one delivery attempt. */
export interface SocialAttemptResult {
  outcome: 'sent' | 'retry' | 'failed' | 'blocked' | 'skipped';
  /** Seconds the network asked us to wait (rate limits) */
  retryAfterSeconds?: number;
  error?: string;
  /** Systemic failure the admin should hear about (a platform credential, the cap), not the creator's own setup */
  flagAdmin?: boolean;
}

/** Why a post failed, in words a person can act on: Studio and the admin page explain a stored error with these. */
export const SOCIAL_FAILURE_REASONS = [
	'paused_by_admin',
	'x_budget_reached',
	'no_longer_public',
	'reconnect_needed',
	'video_too_long',
	'video_too_large',
	'video_not_available',
	'network_not_configured',
	'generic',
] as const;
export type SocialFailureReason = (typeof SOCIAL_FAILURE_REASONS)[number];

/**
 * A delivery's stored error (`<code>: <detail>` from our own checks, or the adapter's `<network> <step>: HTTP <status> <reason>`
 * and `media is <n> MB; ...`) → the reason it is explained with. The raw text stays available for admins.
 */
export function socialFailureReason(error: string | null | undefined): SocialFailureReason {
	if (!error) return 'generic';
	const head = error.split(':')[0]!.trim();
	if ((SOCIAL_FAILURE_REASONS as readonly string[]).includes(head)) return head as SocialFailureReason;
	if (head === 'auth' || /\bHTTP 401\b/.test(error)) return 'reconnect_needed';
	if (/^media is \d+ MB\b/.test(error)) return 'video_too_large';
	return 'generic';
}
