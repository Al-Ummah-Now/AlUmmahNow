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
  | { kind: 'site'; host: string; ours: boolean; item: 'video' | 'post' | null; id: string | null; commentId?: string }
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
    // Only our own hosts are opened, also behind one another
    if (!OUR_HOST.test(hostOf(current)) || current.port) return current;
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

/** Query keys and fragments that point inside a page: at a comment, a reply or a chat message. */
const COMMENT_KEYS = ['comment', 'commentid', 'comment_id', 'lc', 'reply', 'replyid', 'reply_id'];
const PART_KEYS = [...COMMENT_KEYS, 'message', 'messageid', 'message_id', 'chat', 'chatid', 'chat_id'];
const PART_HASH = /^(?:comment|repl(?:y|ies)|message|chat)/i;
const NAMED_HASH = /^(?:comments?|reply)(?:Id)?[-=:/_]([A-Za-z0-9_-]{6,80})$/i;

/**
 * The one place that decides whether a URL is about a part of a page: a comment, a reply or a chat message,
 * whatever the host and path. Null: it is not. `{ commentId }`: exactly one comment is named. `{}`: it points
 * at a part, but not at one comment (several ids, none, a chat message): nobody can tell which, so the URL
 * maps to nothing, and least of all to the page it is on.
 */
export function csamUrlPart(url: URL): { commentId?: string } | null {
  const ids = new Set<string>();
  let points = false;
  let unclear = false;
  for (const [key, value] of url.searchParams) {
    if (!PART_KEYS.includes(key.toLowerCase())) continue;
    points = true;
    if (!COMMENT_KEYS.includes(key.toLowerCase()) || !UUID_ISH.test(value)) unclear = true;
    else ids.add(value);
  }
  let hash = url.hash.replace(/^#/, '');
  try {
    hash = decodeURIComponent(hash);
  } catch {
    // kept as it is
  }
  if (PART_HASH.test(hash)) {
    points = true;
    const named = NAMED_HASH.exec(hash);
    if (named) ids.add(named[1]!);
    else unclear = true;
  }
  if (!points) return null;
  return !unclear && ids.size === 1 ? { commentId: [...ids][0]! } : {};
}


/** Query keys of our pages that change how a page is shown or say where the visitor came from, never what it is about. */
const PLAIN_KEYS = new Set(['t', 'start', 'end', 'list', 'index', 'lang', 'locale', 'autoplay', 'loop', 'mute', 'muted', 'controls', 'quality', 'w', 'h', 'width', 'height', 'maxwidth', 'maxheight', 'sort', 'fbclid', 'gclid', 'dclid', 'msclkid', 'igshid', 'mc_cid', 'mc_eid', 'si', 'feature', 'ref', '_rsc']);
const PLAIN_TABS = new Set(['home', 'videos', 'shorts', 'live', 'playlists', 'community', 'posts', 'about']);
const PLAIN_HASH = /^(?:|top|main-content|t=\d{1,6}s?)$/;

/**
 * Whether the query and the fragment of one of our pages say nothing but what we know they say: a part of the page
 * (csamUrlPart), its own id, or how it is shown. Anything else may name a comment or another item, so the URL maps
 * to nothing and a person looks at it.
 */
function onlyKnown(url: URL): boolean {
  let posts: string[] = [];
  for (const [name, value] of url.searchParams) {
    const key = name.toLowerCase();
    if (key === 'post') posts = [...posts, value];
    if (key === 'vid' || key === 'post' || PART_KEYS.includes(key) || PLAIN_KEYS.has(key) || key.startsWith('utm_')) continue;
    if (key === 'tab' && PLAIN_TABS.has(value.toLowerCase())) continue;
    return false;
  }
  let hash = url.hash.replace(/^#/, '');
  try {
    hash = decodeURIComponent(hash);
  } catch {
    return false;
  }
  // #post-<id> scrolls to the post the page is about
  return PART_HASH.test(hash) || PLAIN_HASH.test(hash) || posts.some((id) => hash === `post-${id}`);
}

const ok = (id: string | null | undefined): id is string => !!id && UUID_ISH.test(id);
const isLocale = (segment: string | undefined) => /^(?:en|ar)$/i.test(segment ?? '');
const withoutLocale = (parts: string[]) => (isLocale(parts[0]) ? parts.slice(1) : parts);

/** Every value of a query key, whatever its case. */
const queryValues = (url: URL, name: string): string[] => [...new Set([...url.searchParams].filter(([key]) => key.toLowerCase() === name).map(([, value]) => value))];

/** The query names an item other than the one its path does. */
const namesAnother = (url: URL, id: string): boolean => [...queryValues(url, 'vid'), ...queryValues(url, 'post')].some((v) => v !== id);

/**
 * A page of the videos site (apps/web), without its comment part. The locale is optional, as the site redirects
 * without it. Only whole paths the site has: anything on the host that names no single item, names two, or goes on
 * after the item (its comments, say) is null (the caller opens it for a hand mapping).
 */
function parseSitePage(url: URL, parts: string[]): CsamUrlTarget | null {
  const p = withoutLocale(parts);
  /** The fixed segments, whatever their case; ids keep theirs */
  const at = p.map((part) => part.toLowerCase());
  const posts = queryValues(url, 'post');
  const vids = queryValues(url, 'vid');
  /** A video's page with another item's id in its query names two items. */
  const video = (page: 'video' | 'shorts' | 'embed', id: string | null | undefined): CsamUrlTarget | null =>
    ok(id) && vids.every((v) => v === id) && !posts.length ? { kind: 'page', page, id } : null;
  const thumb = (file: string | undefined): CsamUrlTarget | null => {
    const target = thumbTarget(file);
    return target?.kind === 'video_thumbnail' && !namesAnother(url, target.videoId) ? target : null;
  };
  const stream = (id: string | undefined): CsamUrlTarget | null => (ok(id) && !vids.length && !posts.length ? { kind: 'live_stream', streamId: id } : null);
  const VIDEO_TABS = ['edit', 'analytics'];

  switch (at[0]) {
    case 'video':
      // /video/<id>, /video/<id>/edit and the old /video?vid=<id>
      if (p.length === 1) return vids.length === 1 ? video('video', vids[0]) : null;
      return p.length === 2 || (p.length === 3 && at[2] === 'edit') ? video('video', p[1]) : null;
    case 'shorts':
      return p.length === 2 ? video('shorts', p[1]) : null;
    case 'embed':
      // /embed/v/<id>; /embed/p shows several items, and /embed/comments/<id> is about its comments (parseCsamUrl)
      return at[1] === 'v' && p.length === 3 ? video('embed', p[2]) : null;
    case 'live':
      return p.length === 2 ? stream(p[1]) : null;
    case 'post':
      return p.length === 2 && ok(p[1]) && !vids.length && posts.every((v) => v === p[1]) ? { kind: 'page', page: 'post', id: null, postId: p[1] } : null;
    case 'channels':
      if (p.length !== 2 || !ok(p[1]) || vids.length || posts.length > 1) return null;
      return !posts.length ? { kind: 'page', page: 'channel', id: p[1] } : ok(posts[0]) ? { kind: 'page', page: 'post', id: p[1], postId: posts[0] } : null;
    case 'thumb':
      return p.length === 2 ? thumb(p[1]) : null;
    case 'og':
      // /og/v/<videoId>.jpg (unwrapImageUrl has already opened /og/i/<image>)
      return at[1] === 'v' && p.length === 3 ? thumb(p[2]) : null;
    case 'analytics':
      return at[1] === 'videos' && p.length === 3 ? video('video', p[2]) : null;
    case 'studio': {
      // /studio/video/<id>/<tab> and /studio/<channel>/content/(videos/<id>/<tab>|live/<stream>)
      if (at[1] === 'video') return p.length === 3 || (p.length === 4 && VIDEO_TABS.includes(at[3]!)) ? video('video', p[2]) : null;
      if (at[2] !== 'content') return null;
      if (at[3] === 'videos') return p.length === 5 || (p.length === 6 && VIDEO_TABS.includes(at[5]!)) ? video('video', p[4]) : null;
      return at[3] === 'live' && p.length === 5 ? stream(p[4]) : null;
    }
    case 'studio-download': {
      if (at[1] === 'captions') return p.length <= 5 ? video('video', p[2]) : null;
      return at[1] === 'clip' && p.length === 4 ? video('video', /^(.+)\.mp4$/i.exec(p[3]!)?.[1]) : null;
    }
    default: {
      // /@handle?post=<id>, /c/<handle>?post=<id>: the post's own channel is checked against the handle
      const handle = at[0] === 'c' ? (p.length === 2 ? p[1] : undefined) : p.length === 1 && p[0]!.startsWith('@') ? p[0]!.slice(1) : undefined;
      if (!handle || !HANDLE.test(handle) || vids.length || posts.length !== 1 || !ok(posts[0])) return null;
      return { kind: 'page', page: 'post', id: null, postId: posts[0], handle };
    }
  }
}

const HANDLE = /^[A-Za-z0-9._-]{1,40}$/;

function thumbTarget(file: string | undefined): CsamUrlTarget | null {
  const id = /^([A-Za-z0-9_-]{6,80})\.jpe?g$/i.exec(file ?? '')?.[1];
  return id ? { kind: 'video_thumbnail', videoId: id } : null;
}

/** alummahnow.link/<v|s|p|e>/<id>; the channel, handle and playlist links name several items. */
function parseShortLink(url: URL, parts: string[]): CsamUrlTarget | null {
  const [kind, id] = parts;
  if (parts.length !== 2 || !ok(id) || namesAnother(url, id)) return null;
  const prefix = kind!.toLowerCase();
  if (prefix === 'v') return { kind: 'page', page: 'video', id };
  if (prefix === 's') return { kind: 'page', page: 'shorts', id };
  if (prefix === 'p') return { kind: 'page', page: 'post', id: null, postId: id };
  if (prefix === 'e') return { kind: 'live_stream', streamId: id };
  return prefix === 'c' ? { kind: 'page', page: 'channel', id } : null;
}

/** /<lang>/watch/<id> or /<lang>/posts/<id> of a scholar site. */
function sitePageOf(url: URL, parts: string[]): { item: 'video' | 'post'; id: string } | null {
  if (parts.length !== 3 || !isLocale(parts[0]) || !ok(parts[2]) || namesAnother(url, parts[2])) return null;
  const kind = parts[1]!.toLowerCase();
  return kind === 'watch' ? { item: 'video', id: parts[2] } : kind === 'posts' ? { item: 'post', id: parts[2] } : null;
}

/** The comment a page URL names, on that page's video or post. Null when the page has no comments of its own. */
function commentOf(target: CsamUrlTarget | null, commentId: string): CsamUrlTarget | null {
  if (target?.kind === 'page') {
    if (target.page === 'post') return { kind: 'comment', on: 'post', parentId: target.postId, commentId };
    if (target.page !== 'channel') return { kind: 'comment', on: 'video', parentId: target.id, commentId };
  }
  if (target?.kind === 'site' && target.item) return { ...target, commentId };
  return null;
}

const hasUserInfo = (url: URL): boolean => !!url.username || !!url.password;

/** Why a URL opens no case at all. */
export type CsamUrlRefusal = 'not_a_url' | 'other_site' | 'console' | 'port';

export function csamUrlRefusal(input: string | URL): CsamUrlRefusal | null {
  const raw = typeof input === 'string' ? toCsamUrl(input) : input;
  // A name in front of the host (user@host) is how a URL is made to look like another one
  if (!raw || hasUserInfo(raw)) return 'not_a_url';
  const host = hostOf(raw);
  if (CONSOLE_HOST.test(host)) return 'console';
  const ours = OUR_HOST.test(host) || SCHOLAR_TEST_HOST.test(host) || BUNNY_HOST.test(host);
  if (ours && raw.port) return 'port';
  return parseCsamUrl(raw) ? null : 'other_site';
}

/**
 * What one of our URLs names (pure). Null for hosts that are not ours. A URL on our hosts that names
 * no single item is `other`: the case still opens, and a super admin maps it.
 */
export function parseCsamUrl(input: string | URL): CsamUrlTarget | null {
  const raw = typeof input === 'string' ? toCsamUrl(input) : input;
  if (!raw || hasUserInfo(raw)) return null;
  // Our sites answer on the default ports only, and only they unwrap (an optimizer on another site is not ours)
  const rawHost = hostOf(raw);
  if (CONSOLE_HOST.test(rawHost)) return null;
  if (OUR_HOST.test(rawHost) || BUNNY_HOST.test(rawHost)) {
    if (raw.port) return null;
  } else {
    return parseOwnDomain(raw);
  }
  const url = unwrapImageUrl(raw);
  const unwrapped = url !== raw;
  const host = hostOf(url);
  const other: CsamUrlTarget = { kind: 'other', host: rawHost, path: raw.pathname };
  if (unwrapped && (!(OUR_HOST.test(host) || BUNNY_HOST.test(host)) || CONSOLE_HOST.test(host) || url.port || hasUserInfo(url) || !/^https?:$/.test(url.protocol))) return other;

  // A comment, a reply or a chat message: decided here, once, for every shape
  const part = csamUrlPart(url) ?? (unwrapped ? csamUrlPart(raw) : null);
  const parts = segmentsOf(url.pathname);
  if (!parts) return other;
  const page = withoutLocale(parts);
  const aboutComments = SITE_HOST.test(host) && page[0]?.toLowerCase() === 'embed' && page[1]?.toLowerCase() === 'comments';
  if (part || aboutComments) {
    if (!part?.commentId) return other;
    const id = page[2];
    if (aboutComments) return page.length === 3 && onlyKnown(url) && ok(id) && !namesAnother(url, id) ? { kind: 'comment', on: 'video', parentId: id, commentId: part.commentId } : other;
    return commentOf(parseItem(url, host, parts), part.commentId) ?? other;
  }
  return parseItem(url, host, parts) ?? other;
}

/** The item a URL on our hosts names, ignoring any part of it. Null when it names none. */
function parseItem(url: URL, host: string, parts: string[]): CsamUrlTarget | null {
  if (MEDIA_HOST.test(host)) {
    // /pub/<videoId>/<rev>/<file> and /priv/<token>/<videoId>/<rev>/<file>
    const access = parts[0]?.toLowerCase();
    const at = access === 'pub' ? 1 : access === 'priv' ? 2 : -1;
    const videoId = at > 0 ? parts[at] : undefined;
    if (!ok(videoId)) return null;
    const file = parts.slice(at + 2).join('/');
    return /^thumb[^/]*\.(?:jpe?g|png|webp)$/i.test(file) ? { kind: 'video_thumbnail', videoId } : { kind: 'video', videoId, ...(file ? { file } : {}) };
  }
  if (BUNNY_HOST.test(host)) {
    const videoId = parts.find((p) => UUID_ISH.test(p) && !p.startsWith('bcdn_token'));
    if (!videoId) return null;
    const file = parts.slice(parts.indexOf(videoId) + 1).join('/');
    return /^(?:thumbnail[^/]*|preview[^/]*)\.(?:jpe?g|png|webp|gif)$/i.test(file) ? { kind: 'video_thumbnail', videoId } : { kind: 'video', videoId, ...(file ? { file } : {}) };
  }
  if (IMAGE_HOST.test(host)) {
    const path = `/${parts.join('/')}`;
    if (parts[0] === 'thumbnails' && ok(parts[1])) return { kind: 'video_thumbnail', videoId: parts[1] };
    if (parts[0] === 'community-posts' && ok(parts[1])) return { kind: 'post_image', channelId: parts[1], path };
    return parts.length ? { kind: 'image', path } : null;
  }
  if (LIVE_HOST.test(host)) return parts[0] === 'hls' && ok(parts[1]) ? { kind: 'live_session', sessionId: parts[1] } : null;
  // Files carry what their delivery adds to their query; a page's says what it is about
  if ((SHORT_LINK_HOST.test(host) || SITE_HOST.test(host)) && !onlyKnown(url)) return null;
  if (SHORT_LINK_HOST.test(host)) return parseShortLink(url, parts);
  if (SITE_HOST.test(host)) return parseSitePage(url, parts);
  if (SCHOLAR_HOST.test(host) || SCHOLAR_TEST_HOST.test(host)) {
    const page = onlyKnown(url) ? sitePageOf(url, parts) : null;
    return { kind: 'site', host, ours: true, item: page?.item ?? null, id: page?.id ?? null };
  }
  return null;
}

/** A scholar's own domain shows our videos and posts; only the host index knows which domains those are. */
function parseOwnDomain(url: URL): CsamUrlTarget | null {
  const parts = segmentsOf(url.pathname);
  const page = parts ? sitePageOf(url, parts) : null;
  if (!page || url.port || !/^https?:$/.test(url.protocol)) return null;
  const target = { kind: 'site', host: hostOf(url), ours: false, ...page } as const;
  const part = csamUrlPart(url);
  if (!onlyKnown(url)) return { ...target, item: null, id: null };
  if (!part) return target;
  return part.commentId ? { ...target, commentId: part.commentId } : { ...target, item: null, id: null };
}

const CSAM_URL_START = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*alummahnow\.(?:net|org|com|link|app)\.?(?::\d{1,5})?\/./i;
const BUNNY_URL_START = /^(?:https?:\/\/)?vz-[a-z0-9-]+\.b-cdn\.net\/./i;
const SITE_URL_START = /^(?:https?:\/\/)?[a-z0-9.-]{1,253}\/+(?:en|ar)\/+(?:watch|posts)\/+[a-z0-9_-]{6,80}(?:[/?#.,;]|$)/i;
const ANY_URL_START = /^(?:https?:\/\/[^/]|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?\/.)/i;
const TRAILING_PUNCTUATION = '.,;';

/** The URL a token is, or null: only a token that starts with a real host counts, never a host named inside another URL. */
function urlOfToken(raw: string): string | null {
  // It starts after some punctuation and at most one label ("URL:"); a URL further in belongs to another one
  const head = /^[^a-z0-9]{0,20}(?:[a-z]{1,20}:(?!\/\/|\d))?[^a-z0-9]{0,20}/i.exec(raw)!;
  const start = head[0].length;
  if (/[/?#@=&\\%]/.test(head[0])) return null;
  let end = raw.length;
  while (end > start && TRAILING_PUNCTUATION.includes(raw[end - 1]!)) end--;
  const token = raw.slice(start, end);
  return ANY_URL_START.test(token) ? token : null;
}

/**
 * The URLs in a pasted email or a webhook body (deduplicated): `urls` are the ones that may be ours (at most
 * 200), `others` the rest (at most 50, to tell the person what was left out). Scholar sites' own domains can
 * only be told from other people's by lookup, so pages shaped like theirs are in `urls` and resolveCsamUrl
 * refuses the rest. Linear in the input: split on delimiters, then anchored tests per token (an unanchored
 * pattern with nested quantifiers backtracks on long runs of '-' or ',').
 */
export function scanCsamUrls(text: string): { urls: string[]; others: string[] } {
  const urls = new Set<string>();
  const others = new Set<string>();
  for (const raw of text.slice(0, 1_000_000).split(/[\s"'<>)\]]+/)) {
    const url = urlOfToken(raw);
    if (!url) continue;
    if (CSAM_URL_START.test(url) || BUNNY_URL_START.test(url) || SITE_URL_START.test(url)) urls.add(url);
    else if (others.size < 50) others.add(url.slice(0, 500));
    if (urls.size >= 200) break;
  }
  return { urls: [...urls], others: [...others] };
}

export const extractCsamUrls = (text: string): string[] => scanCsamUrls(text).urls;

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

/** A URL in the pasted text that opened no case, and why. */
export interface CsamRefusedUrl {
  url: string;
  reason: CsamUrlRefusal;
}

export interface CsamFreezeState {
  ban?: 'banned' | 'already_banned' | 'no_uploader';
  revokeSessions?: string;
  suspendAccount?: string;
  error?: string;
  /** The account alone is frozen (its videos profile was erased: there is nothing to ban there, and the case names no uploader) */
  account?: string;
  /** Its sign-in email when it was frozen, for the report (the case itself names no uploader) */
  accountEmail?: string | null;
  accountEmailSource?: AccountEmailSource | null;
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
  const vid = SITE_HOST.test(host) ? inner.searchParams.get('vid') : null;
  if (vid) query.set('vid', vid);
  const part = csamUrlPart(inner);
  if (part) query.set('comment', part.commentId ?? '');
  const tail = [...query].map(([k, v]) => `${k}=${v}`).join('&');
  return `${host}${path}${tail ? `?${tail}` : ''}`;
}
