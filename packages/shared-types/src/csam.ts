/**
 * CSAM matches (Cloudflare CSAM Scanning Tool; docs/specs/CSAM-RESPONSE.md).
 *
 * Cloudflare hashes images served through our zones and, on a match, blocks the URL and emails the
 * matched file paths once a day. It does not report to NCMEC: we do (18 U.S.C. § 2258A). This file
 * is the shared contract: how a matched URL names one of our items, the case and evidence records,
 * and the retention rule (§ 2258A(h)(1): 1 year after the CyberTipline report; owner decision
 * 2026-11-14: configurable longer, never shorter; a legal hold never expires).
 */

import type { AccountEmailSource } from './admin-content';

/** Evidence is kept at least this long after the report (§ 2258A(h)(1) since Pub. L. 118-59). */
export const CSAM_RETENTION_MIN_DAYS = 365;
export const CSAM_RETENTION_MAX_DAYS = 3650;
/** The hold every taken-down item carries (lib/admin/frozen.ts); never lifted by a restore. */
export const CSAM_HOLD = 'csam';
/** The CyberTipline report form (NCMEC); the case checklist links here. */
export const NCMEC_CYBERTIPLINE_URL = 'https://report.cybertip.org/reporting';

export const CSAM_ITEM_KINDS = ['video', 'video_thumbnail', 'post_image', 'channel_image', 'profile_image', 'comment', 'live_stream'] as const;
export type CsamItemKind = (typeof CSAM_ITEM_KINDS)[number];

export const CSAM_CASE_STATUSES = ['unmapped', 'containing', 'contained', 'containment_failed', 'reported', 'closed'] as const;
export type CsamCaseStatus = (typeof CSAM_CASE_STATUSES)[number];

/** What a matched URL says on its own (pure; no lookups). */
export type CsamUrlTarget =
  | { kind: 'video'; videoId: string; file?: string }
  | { kind: 'video_thumbnail'; videoId: string }
  | { kind: 'post_image'; channelId: string; path: string }
  | { kind: 'image'; path: string }
  | { kind: 'page'; page: 'video' | 'shorts' | 'embed' | 'channel'; id: string }
  /** A community post; the channel only when the URL names it */
  | { kind: 'page'; page: 'post'; id: string | null; postId: string; handle?: string }
  /** One comment of a video or a post: never the video or the post it is on */
  | { kind: 'comment'; on: 'video' | 'post'; parentId: string; commentId: string }
  | { kind: 'live_stream'; streamId: string }
  /** A file of the live edge: the session's stream is looked up */
  | { kind: 'live_session'; sessionId: string }
  /** A scholar site page, on its alummahnow.org subdomain or its own domain (the host is looked up) */
  | { kind: 'site'; host: string; ours: boolean; item: 'video' | 'post' | null; id: string | null }
  /** Our host, but nothing on it is named: a list, a search, a file we do not know. A person maps it */
  | { kind: 'other'; host: string; path: string };

/** An item a URL was mapped to, with its uploader (api-videos lib/csam/resolve.ts). */
export interface CsamResolution {
  kind: CsamItemKind;
  /** The video, for video and video_thumbnail */
  videoId?: string;
  channelId?: string | null;
  /** A post that shows the image, when found */
  postId?: string;
  /** comment: the comment, and the video or post it is on (which is never touched) */
  commentId?: string;
  commentOn?: 'video' | 'post';
  commentParentId?: string;
  /** live_stream */
  streamId?: string;
  /** Path on images.alummahnow.net (`/…`), for image kinds */
  imagePath?: string;
  /** profile_image / channel_image: which field shows it */
  imageField?: 'avatarUrl' | 'coverUrl';
  /** The account that uploaded it (frozen) */
  uploaderId: string | null;
}

export interface CsamEvidenceFile {
  /** Stable name inside the case: `01-matched-image.jpg`, `02-video-original.mp4`, `record-video.json` */
  name: string;
  /** Where it was copied from (bucket/key or URL without tokens) */
  source: string;
  contentType: string;
  /** Plaintext bytes */
  bytes: number;
  /** SHA-256 of each plaintext chunk, hex (integrity without one pass over a multi-GB file) */
  chunkSha256: string[];
  chunkBytes: number;
  /** Encryption key version (CSAM_EVIDENCE_KEY rotation) */
  keyVersion: number;
  copiedAt: string;
}

/** The encrypted manifest of a case's evidence (`cases/<caseId>/manifest.bin`). */
export interface CsamEvidenceManifest {
  v: 1;
  caseId: string;
  matchedUrl: string;
  resolution: CsamResolution;
  files: CsamEvidenceFile[];
  /** Files that could not be copied (gone at the source), with why */
  missing: Array<{ name: string; source: string; reason: string }>;
  createdAt: string;
  completedAt?: string;
}

/** Facts the CyberTipline report asks for (§ 2258A(b)), pre-filled on the case checklist. */
/** Accounts by user id for a case's report facts, deleted ones that are not purged yet included (POST /internal/csam/accounts). */
export interface CsamAccounts {
  accounts: Record<string, { email: string; deleted: boolean }>;
}

export interface CsamReportFacts {
  matchedUrl: string;
  detectedAt: string;
  incidentTimeZone: 'UTC';
  itemKind: CsamItemKind;
  itemId: string | null;
  uploadedAt: string | null;
  uploader: {
    userId: string | null;
    /** The sign-in account's email, read by user id when the case was captured */
    email: string | null;
    /** Where `email` is from (`deleted_account`: the account was deleted before the capture); absent on older cases */
    emailSource?: AccountEmailSource | null;
    displayName: string | null;
    handle: string | null;
    channelId: string | null;
    channelName: string | null;
    /** Not collected by the platform; left for the reporter to state */
    ipAddress: null;
  };
  evidenceFiles: Array<{ name: string; bytes: number; contentType: string }>;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const UUID_ISH = /^[A-Za-z0-9_-]{6,80}$/;
const MEDIA_HOST = /^media(?:\.(?:qa|stage))?\.alummahnow\.(?:net|org)$/;
const IMAGE_HOST = /^images\.alummahnow\.(?:net|org)$/;
/** The videos site and www (and the apex), per environment; alummahnow.com and the old .org names redirect to them. */
const SITE_HOST = /^(?:(?:www|videos)\.)?(?:(?:qa|stage)\.)?alummahnow\.(?:net|org|com)$/;
const SHORT_LINK_HOST = /^(?:(?:qa|stage)\.)?alummahnow\.link$/;
/** The live edge (api-videos LIVE_PUBLIC_HOST) */
const LIVE_HOST = /^live(?:\.(?:qa|stage))?\.alummahnow\.net$/;
/** Scholar sites: `<slug>.alummahnow.org`, `<slug>.stage.alummahnow.org`, `<slug>.qa.alummahnow.org` (shared-types site.ts) */
const SCHOLAR_HOST = /^[a-z0-9][a-z0-9-]*(?:\.(?:qa|stage))?\.alummahnow\.org$/;
/** Any other name in our zones (cms, auth, …). Anchored at a dot, so look-alikes never match */
const OUR_HOST = /^(?:[a-z0-9-]+\.)*alummahnow\.(?:net|org|com|link|app)$/;
/** The test own domains of QA and stage scholar sites (site.ts SITE_TEST_DOMAIN_SUFFIX); real own domains are only known by lookup */
const SCHOLAR_TEST_HOST = /^(?:[a-z0-9-]+\.)+(?:qa|stage)-sites\.alummahnow\.com$/;
/** The consoles: they show no user content themselves, and their links turn up in pasted text */
const CONSOLE_HOST = /^(?:admin|status)\.(?:api\.)?(?:(?:qa|stage)\.)?(?:api\.)?alummahnow\.net$/;
const SITE_PAGE_PATH = /^\/(?:en|ar)\/(?:watch|posts)\/[A-Za-z0-9_-]{6,80}\/?$/;
const BUNNY_HOST = /^vz-[a-z0-9-]+\.b-cdn\.net$/;

/** Parses what a person pasted: a full URL, or a path Cloudflare's email lists (`host/path`). */
export function toCsamUrl(input: string): URL | null {
  const text = input.trim().replace(/^<|>$/g, '');
  if (!text || text.length > 4096) return null;
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, '')}`);
  } catch {
    return null;
  }
}

/**
 * The image an optimizer URL wraps: Next.js `/_next/image?url=…` and Cloudflare
 * `/cdn-cgi/image/<options>/<url or path>`. Others come back unchanged. At most 3 levels.
 */
export function unwrapImageUrl(url: URL): URL {
  let current = url;
  for (let i = 0; i < 3; i++) {
    if (current.pathname === '/_next/image' && current.searchParams.get('url')) {
      const inner = current.searchParams.get('url')!;
      try {
        current = new URL(inner, `${current.protocol}//${current.host}`);
        continue;
      } catch {
        return current;
      }
    }
    // The site's share card of one image: /og/i/<base64url of its URL>.jpg (apps/web lib/share-card)
    const card = /^\/og\/i\/([A-Za-z0-9_-]{8,4096})\.jpe?g$/i.exec(current.pathname);
    if (card && SITE_HOST.test(hostOf(current))) {
      try {
        current = new URL(atob(card[1]!.replace(/-/g, '+').replace(/_/g, '/')));
        continue;
      } catch {
        return current;
      }
    }
    const cdn = /^\/cdn-cgi\/image\/[^/]+\/(.+)$/.exec(current.pathname);
    if (cdn) {
      try {
        const rest = decodeURIComponent(cdn[1]!);
        current = /^https?:\/\//i.test(rest) ? new URL(rest) : new URL(`/${rest.replace(/^\/+/, '')}`, `${current.protocol}//${current.host}`);
        continue;
      } catch {
        return current;
      }
    }
    return current;
  }
  return current;
}

/** A host as our zones name it: lowercase, no trailing dot. */
const hostOf = (url: URL): string => url.hostname.toLowerCase().replace(/\.$/, '');

/** Decoded path segments; null for a malformed or traversing path (an encoded slash or dot-segment never reaches a storage path). */
function segmentsOf(pathname: string): string[] | null {
  let parts: string[];
  try {
    parts = pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  } catch {
    return null;
  }
  return parts.some((p) => p === '..' || p === '.' || p.includes('/') || p.includes('\\')) ? null : parts;
}

/** What a site URL says about a comment: its id, `true` when it points at comments without naming one, else null. */
function commentSelector(url: URL): string | true | null {
  for (const key of ['comment', 'commentId', 'lc']) {
    const value = url.searchParams.get(key);
    if (value !== null) return UUID_ISH.test(value) ? value : true;
  }
  let hash = url.hash.replace(/^#/, '');
  try {
    hash = decodeURIComponent(hash);
  } catch {
    // kept as it is
  }
  if (!/^(?:comment|reply)/i.test(hash)) return null;
  const named = /^(?:comment|reply)(?:Id)?[-=:/_]([A-Za-z0-9_-]{6,80})$/i.exec(hash);
  return named ? named[1]! : true;
}

type PageTarget = Extract<CsamUrlTarget, { kind: 'page' }>;

/**
 * A page of the videos site (apps/web). The locale is optional, as the site redirects without it.
 * Anything on the host that names no single item is null (the caller opens it for a hand mapping).
 */
function parseSitePage(url: URL, parts: string[]): CsamUrlTarget | null {
  const p = parts[0] === 'en' || parts[0] === 'ar' ? parts.slice(1) : parts;
  const ok = (id: string | null | undefined): id is string => !!id && UUID_ISH.test(id);
  const comment = commentSelector(url);
  /** A comment's URL is about that comment; one that names no comment is nobody's to act on. */
  const item = (target: PageTarget | null): CsamUrlTarget | null => {
    if (!target || comment === null) return target;
    if (comment === true) return null;
    if (target.page === 'post') return { kind: 'comment', on: 'post', parentId: target.postId, commentId: comment };
    return target.page === 'channel' ? null : { kind: 'comment', on: 'video', parentId: target.id, commentId: comment };
  };
  const post = url.searchParams.get('post');

  switch (p[0]) {
    case 'video':
      // /video/<id>, /video/<id>/edit and the old /video?vid=<id>
      return item(ok(p[1]) ? { kind: 'page', page: 'video', id: p[1] } : p.length === 1 && ok(url.searchParams.get('vid')) ? { kind: 'page', page: 'video', id: url.searchParams.get('vid')! } : null);
    case 'shorts':
      return item(ok(p[1]) ? { kind: 'page', page: 'shorts', id: p[1] } : null);
    case 'embed':
      // /embed/v/<id>; /embed/p and /embed/comments show several items
      if (p[1] === 'comments') return typeof comment === 'string' && ok(p[2]) ? { kind: 'comment', on: 'video', parentId: p[2], commentId: comment } : null;
      return item(p[1] === 'v' && ok(p[2]) ? { kind: 'page', page: 'embed', id: p[2] } : null);
    case 'live':
      return ok(p[1]) && comment === null ? { kind: 'live_stream', streamId: p[1] } : null;
    case 'post':
      return item(ok(p[1]) ? { kind: 'page', page: 'post', id: null, postId: p[1] } : null);
    case 'channels':
      if (!ok(p[1])) return null;
      return item(post === null ? { kind: 'page', page: 'channel', id: p[1] } : ok(post) ? { kind: 'page', page: 'post', id: p[1], postId: post } : null);
    case 'thumb':
      return thumbTarget(p[1]);
    case 'og':
      // /og/v/<videoId>.jpg (unwrapImageUrl has already opened /og/i/<image>)
      return p[1] === 'v' ? thumbTarget(p[2]) : null;
    case 'analytics':
      return p[1] === 'videos' && ok(p[2]) ? { kind: 'page', page: 'video', id: p[2] } : null;
    case 'studio':
      if (p[1] === 'video' && ok(p[2])) return { kind: 'page', page: 'video', id: p[2] };
      if (p[2] === 'content' && p[3] === 'videos' && ok(p[4])) return { kind: 'page', page: 'video', id: p[4] };
      return p[2] === 'content' && p[3] === 'live' && ok(p[4]) ? { kind: 'live_stream', streamId: p[4] } : null;
    case 'studio-download': {
      if (p[1] === 'captions' && ok(p[2])) return { kind: 'page', page: 'video', id: p[2] };
      const clip = p[1] === 'clip' ? /^(.+)\.mp4$/.exec(p[3] ?? '')?.[1] : undefined;
      return ok(clip) ? { kind: 'page', page: 'video', id: clip } : null;
    }
    default: {
      // /@handle?post=<id>, /c/<handle>?post=<id>: the post's own channel is checked against the handle
      const handle = p[0] === 'c' ? p[1] : p[0]?.startsWith('@') ? p[0].slice(1) : undefined;
      if (!handle || !HANDLE.test(handle) || !ok(post)) return null;
      return item({ kind: 'page', page: 'post', id: null, postId: post, handle });
    }
  }
}

const HANDLE = /^[A-Za-z0-9._-]{1,40}$/;

function thumbTarget(file: string | undefined): CsamUrlTarget | null {
  const id = /^([A-Za-z0-9_-]{6,80})\.jpe?g$/i.exec(file ?? '')?.[1];
  return id ? { kind: 'video_thumbnail', videoId: id } : null;
}

/** alummahnow.link/<v|s|p|e>/<id>; the channel, handle and playlist links name several items. */
function parseShortLink(parts: string[]): CsamUrlTarget | null {
  const [prefix, id] = parts;
  if (parts.length !== 2 || !id || !UUID_ISH.test(id)) return null;
  if (prefix === 'v') return { kind: 'page', page: 'video', id };
  if (prefix === 's') return { kind: 'page', page: 'shorts', id };
  if (prefix === 'p') return { kind: 'page', page: 'post', id: null, postId: id };
  if (prefix === 'e') return { kind: 'live_stream', streamId: id };
  return prefix === 'c' ? { kind: 'page', page: 'channel', id } : null;
}

/**
 * What one of our URLs names (pure). Null for hosts that are not ours. A URL on our hosts that names
 * no single item is `other`: the case still opens, and a super admin maps it.
 */
export function parseCsamUrl(input: string | URL): CsamUrlTarget | null {
  const raw = typeof input === 'string' ? toCsamUrl(input) : input;
  if (!raw) return null;
  const url = unwrapImageUrl(raw);
  const host = hostOf(url);
  const bunny = BUNNY_HOST.test(host);
  const ours = OUR_HOST.test(host);
  // Our sites answer on the default ports only
  if ((ours || bunny) && url.port) return null;
  const parts = segmentsOf(url.pathname);
  if (!parts) return null;
  const other: CsamUrlTarget = { kind: 'other', host, path: url.pathname };

  if (MEDIA_HOST.test(host)) {
    // /pub/<videoId>/<rev>/<file> and /priv/<token>/<videoId>/<rev>/<file>
    const at = parts[0] === 'pub' ? 1 : parts[0] === 'priv' ? 2 : -1;
    const videoId = at > 0 ? parts[at] : undefined;
    if (!videoId || !UUID_ISH.test(videoId)) return other;
    const file = parts.slice(at + 2).join('/');
    return /^thumb[^/]*\.(?:jpe?g|png|webp)$/i.test(file) ? { kind: 'video_thumbnail', videoId } : { kind: 'video', videoId, ...(file ? { file } : {}) };
  }
  if (bunny) {
    const videoId = parts.find((p) => UUID_ISH.test(p) && !p.startsWith('bcdn_token'));
    if (!videoId) return null;
    const file = parts.slice(parts.indexOf(videoId) + 1).join('/');
    return /^(?:thumbnail[^/]*|preview[^/]*)\.(?:jpe?g|png|webp|gif)$/i.test(file) ? { kind: 'video_thumbnail', videoId } : { kind: 'video', videoId, ...(file ? { file } : {}) };
  }
  if (IMAGE_HOST.test(host)) {
    const path = `/${parts.join('/')}`;
    if (parts[0] === 'thumbnails' && parts[1] && UUID_ISH.test(parts[1])) return { kind: 'video_thumbnail', videoId: parts[1] };
    if (parts[0] === 'community-posts' && parts[1] && UUID_ISH.test(parts[1])) return { kind: 'post_image', channelId: parts[1], path };
    return parts.length ? { kind: 'image', path } : other;
  }
  if (LIVE_HOST.test(host)) {
    return parts[0] === 'hls' && parts[1] && UUID_ISH.test(parts[1]) ? { kind: 'live_session', sessionId: parts[1] } : other;
  }
  if (SHORT_LINK_HOST.test(host)) return parseShortLink(parts) ?? other;
  if (SITE_HOST.test(host)) return parseSitePage(url, parts) ?? other;
  const sitePage = SITE_PAGE_PATH.test(url.pathname) ? { item: parts[1] === 'watch' ? ('video' as const) : ('post' as const), id: parts[2]! } : null;
  if (SCHOLAR_HOST.test(host) || SCHOLAR_TEST_HOST.test(host)) return { kind: 'site', host, ours: true, item: sitePage?.item ?? null, id: sitePage?.id ?? null };
  if (CONSOLE_HOST.test(host)) return null;
  if (ours) return other;
  // A scholar's own domain shows our videos and posts; only the host index knows which domains those are
  return sitePage && !url.port ? { kind: 'site', host, ours: false, ...sitePage } : null;
}

const CSAM_URL_START = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*alummahnow\.(?:net|org|com|link|app)(?::443)?\/./i;
const BUNNY_URL_START = /^https?:\/\/vz-[a-z0-9-]+\.b-cdn\.net\/./i;
const SITE_URL_START = /^(?:https?:\/\/)?[a-z0-9.-]{1,253}\/(?:en|ar)\/(?:watch|posts)\/[a-z0-9_-]{6,80}\/?[.,;]*$/i;
const TRAILING_PUNCTUATION = '.,;';

/**
 * Every URL-looking string in a pasted email or a webhook body (deduplicated, at most 200). Scholar
 * sites' own domains can only be told from other people's by lookup, so pages shaped like theirs are
 * taken too and resolveCsamUrl refuses the rest. Linear in the input: split on delimiters, then
 * anchored tests per token (an unanchored pattern with nested quantifiers backtracks on long runs of
 * '-' or ',').
 */
export function extractCsamUrls(text: string): string[] {
  const found = new Set<string>();
  for (const raw of text.slice(0, 1_000_000).split(/[\s"'<>)\]]+/)) {
    const lower = raw.toLowerCase();
    // A URL may follow other text in the same token ("URL:https://…", "(alummahnow.net/…"), and may
    // carry another one in its query (an image optimizer's ?url=): the first one counts
    let start = lower.search(/https?:\/\//);
    let bare = lower.indexOf('alummahnow.');
    if (bare > 0) while (bare > 0 && /[a-z0-9.-]/.test(lower[bare - 1]!)) bare--;
    if (bare >= 0 && (start < 0 || bare < start)) start = bare;
    const token = start >= 0 ? raw.slice(start) : raw.replace(/^[^a-z0-9]+/i, '');
    if (!CSAM_URL_START.test(token) && !BUNNY_URL_START.test(token) && !SITE_URL_START.test(token)) continue;
    let end = token.length;
    while (end > 0 && TRAILING_PUNCTUATION.includes(token[end - 1]!)) end--;
    found.add(token.slice(0, end));
    if (found.size >= 200) break;
  }
  return [...found];
}

/** When evidence may be deleted: never before a report, never under a hold; else report + days. */
export function csamRetainUntil(c: { reportedAt: string | null; legalHold: boolean }, retentionDays: number): string | null {
  if (c.legalHold || !c.reportedAt) return null;
  const days = Math.max(CSAM_RETENTION_MIN_DAYS, Math.min(CSAM_RETENTION_MAX_DAYS, Math.floor(retentionDays)));
  return new Date(Date.parse(c.reportedAt) + days * 86_400_000).toISOString();
}

/** A valid retention setting (owner decision 2026-11-14: never below 365 days). */
export function validCsamRetentionDays(days: unknown): days is number {
  return typeof days === 'number' && Number.isInteger(days) && days >= CSAM_RETENTION_MIN_DAYS && days <= CSAM_RETENTION_MAX_DAYS;
}

// ---------------------------------------------------------------------------
// Cases (admin-api csam_cases; admin-web /moderation/csam)
// ---------------------------------------------------------------------------

export const CSAM_ACCESS_ACTIONS = [
  'case.opened',
  'case.viewed',
  'cases.email_checked',
  'case.mapped',
  'manifest.viewed',
  'file.downloaded',
  'takedown.retried',
  'freeze.requested',
  'hold.set',
  'hold.lifted',
  'case.reported',
  'evidence.deleted',
  'settings.changed',
  'webhook.secret.generated',
] as const;
export type CsamAccessAction = (typeof CSAM_ACCESS_ACTIONS)[number];

export interface CsamFreezeState {
  ban?: 'banned' | 'already_banned' | 'no_uploader';
  revokeSessions?: string;
  suspendAccount?: string;
  error?: string;
}

export interface CsamCaseSummary {
  id: string;
  matchedUrl: string;
  source: 'paste' | 'webhook';
  status: CsamCaseStatus;
  itemKind: CsamItemKind | null;
  uploaderId: string | null;
  detectedAt: string;
  reportedAt: string | null;
  legalHold: boolean;
  evidenceDeletedAt: string | null;
  /** When the evidence may be deleted (null: not reported yet, or under a hold) */
  retainUntil: string | null;
}

export interface CsamTakedownJob {
  id: string;
  status: 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed';
  phase: string | null;
  attempts: number;
  lastError: string | null;
  result: Record<string, unknown> | null;
}

export interface CsamAuthRequestState {
  id: string;
  action: 'revoke_sessions' | 'suspend_account';
  status: string | null;
  deliveryStatus: string;
}

export interface CsamCaseDetail extends CsamCaseSummary {
  resolution: CsamResolution | null;
  createdBy: string;
  reportId: string | null;
  reportedBy: string | null;
  legalHoldReason: string | null;
  freeze: CsamFreezeState | null;
  authRequests: CsamAuthRequestState[];
  job: CsamTakedownJob | null;
  evidence: { files: Array<{ name: string; bytes: number; contentType: string; source: string }>; missing: Array<{ name: string; reason: string }>; completedAt: string | null } | null;
  facts: CsamReportFacts;
}

export interface CsamAccessLogEntry {
  id: string;
  caseId: string | null;
  actorId: string;
  action: CsamAccessAction;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface CsamSettings {
  retentionDays: number;
  webhookConfigured: boolean;
  webhookUrl: string | null;
}

/**
 * One open case per matched file: lowercased host and path, optimizer wrappers removed, plus what in
 * the query or fragment names another item on the same path (a post, a comment, the old ?vid=).
 */
export function csamUrlKey(input: string): string | null {
  const url = toCsamUrl(input);
  if (!url) return null;
  const inner = unwrapImageUrl(url);
  let path = inner.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the encoded path
  }
  const host = hostOf(inner);
  const query = new Map<string, string>();
  const post = inner.searchParams.get('post');
  if (post) query.set('post', post);
  if (SITE_HOST.test(host)) {
    const vid = inner.searchParams.get('vid');
    if (vid) query.set('vid', vid);
    const comment = commentSelector(inner);
    if (comment !== null) query.set('comment', comment === true ? '' : comment);
  }
  const tail = [...query].map(([k, v]) => `${k}=${v}`).join('&');
  return `${host}${path}${tail ? `?${tail}` : ''}`;
}
