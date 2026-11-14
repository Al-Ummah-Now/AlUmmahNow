/**
 * CSAM matches (Cloudflare CSAM Scanning Tool; docs/specs/CSAM-RESPONSE.md).
 *
 * Cloudflare hashes images served through our zones and, on a match, blocks the URL and emails the
 * matched file paths once a day. It does not report to NCMEC: we do (18 U.S.C. § 2258A). This file
 * is the shared contract: how a matched URL names one of our items, the case and evidence records,
 * and the retention rule (§ 2258A(h)(1): 1 year after the CyberTipline report; owner decision
 * 2026-11-14: configurable longer, never shorter; a legal hold never expires).
 */

/** Evidence is kept at least this long after the report (§ 2258A(h)(1) since Pub. L. 118-59). */
export const CSAM_RETENTION_MIN_DAYS = 365;
export const CSAM_RETENTION_MAX_DAYS = 3650;
/** The hold every taken-down item carries (lib/admin/frozen.ts); never lifted by a restore. */
export const CSAM_HOLD = 'csam';
/** The CyberTipline report form (NCMEC); the case checklist links here. */
export const NCMEC_CYBERTIPLINE_URL = 'https://report.cybertip.org/reporting';

export const CSAM_ITEM_KINDS = ['video', 'video_thumbnail', 'post_image', 'channel_image', 'profile_image'] as const;
export type CsamItemKind = (typeof CSAM_ITEM_KINDS)[number];

export const CSAM_CASE_STATUSES = ['unmapped', 'containing', 'contained', 'containment_failed', 'reported', 'closed'] as const;
export type CsamCaseStatus = (typeof CSAM_CASE_STATUSES)[number];

/** What a matched URL says on its own (pure; no lookups). */
export type CsamUrlTarget =
  | { kind: 'video'; videoId: string; file?: string }
  | { kind: 'video_thumbnail'; videoId: string }
  | { kind: 'post_image'; channelId: string; path: string }
  | { kind: 'image'; path: string }
  | { kind: 'page'; page: 'video' | 'shorts' | 'embed' | 'channel' | 'post'; id: string; postId?: string };

/** An item a URL was mapped to, with its uploader (api-videos lib/csam/resolve.ts). */
export interface CsamResolution {
  kind: CsamItemKind;
  /** The video, for video and video_thumbnail */
  videoId?: string;
  channelId?: string | null;
  /** A post that shows the image, when found */
  postId?: string;
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
export interface CsamReportFacts {
  matchedUrl: string;
  detectedAt: string;
  incidentTimeZone: 'UTC';
  itemKind: CsamItemKind;
  itemId: string | null;
  uploadedAt: string | null;
  uploader: {
    userId: string | null;
    email: string | null;
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
const SITE_HOST = /^(?:www\.)?(?:qa\.|stage\.)?alummahnow\.(?:net|org)$/;
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
    const cdn = /^\/cdn-cgi\/image\/[^/]+\/(.+)$/.exec(current.pathname);
    if (cdn) {
      const rest = decodeURIComponent(cdn[1]!);
      try {
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

/** What one of our URLs names (pure). Null for hosts and shapes that are not ours. */
export function parseCsamUrl(input: string | URL): CsamUrlTarget | null {
  const raw = typeof input === 'string' ? toCsamUrl(input) : input;
  if (!raw) return null;
  const url = unwrapImageUrl(raw);
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  // Decoded segments: an encoded slash or dot-segment never reaches a storage path
  if (parts.some((p) => p === '..' || p === '.' || p.includes('/') || p.includes('\\'))) return null;

  if (MEDIA_HOST.test(host)) {
    // /pub/<videoId>/<rev>/<file> and /priv/<token>/<videoId>/<rev>/<file>
    const at = parts[0] === 'pub' ? 1 : parts[0] === 'priv' ? 2 : -1;
    const videoId = at > 0 ? parts[at] : undefined;
    if (!videoId || !UUID_ISH.test(videoId)) return null;
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
    if (parts[0] === 'thumbnails' && parts[1] && UUID_ISH.test(parts[1])) return { kind: 'video_thumbnail', videoId: parts[1] };
    if (parts[0] === 'community-posts' && parts[1] && UUID_ISH.test(parts[1])) return { kind: 'post_image', channelId: parts[1], path };
    return parts.length ? { kind: 'image', path } : null;
  }
  if (SITE_HOST.test(host)) {
    // Optional locale: /en/video/<id>, /ar/shorts/<id>, /embed/v/<id>, /channels/<id>?post=<postId>
    const p = parts[0] === 'en' || parts[0] === 'ar' ? parts.slice(1) : parts;
    const id = p[1];
    if (!id || !UUID_ISH.test(id)) return null;
    if (p[0] === 'video') return { kind: 'page', page: 'video', id };
    if (p[0] === 'shorts') return { kind: 'page', page: 'shorts', id };
    if (p[0] === 'embed' && p[1] === 'v' && p[2] && UUID_ISH.test(p[2])) return { kind: 'page', page: 'embed', id: p[2] };
    if (p[0] === 'channels') {
      const postId = url.searchParams.get('post');
      return postId && UUID_ISH.test(postId) ? { kind: 'page', page: 'post', id, postId } : { kind: 'page', page: 'channel', id };
    }
    return null;
  }
  return null;
}

const CSAM_URL_START = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*alummahnow\.(?:net|org)\/./i;
const BUNNY_URL_START = /^https?:\/\/vz-[a-z0-9-]+\.b-cdn\.net\/./i;
const TRAILING_PUNCTUATION = '.,;';

/**
 * Every URL-looking string in a pasted email or a webhook body (deduplicated, at most 200).
 * Linear in the input: split on delimiters, then one anchored test per token (an unanchored
 * pattern with nested quantifiers backtracks on long runs of '-' or ',').
 */
export function extractCsamUrls(text: string): string[] {
  const found = new Set<string>();
  for (const raw of text.slice(0, 1_000_000).split(/[\s"'<>)\]]+/)) {
    const lower = raw.toLowerCase();
    // A URL may follow other text in the same token ("URL:https://…", "(alummahnow.net/…")
    let start = lower.indexOf('http');
    if (start < 0) {
      start = lower.indexOf('alummahnow.');
      if (start < 0) continue;
      while (start > 0 && /[a-z0-9.-]/.test(lower[start - 1])) start--;
    }
    const token = raw.slice(start);
    if (!CSAM_URL_START.test(token) && !BUNNY_URL_START.test(token)) continue;
    let end = token.length;
    while (end > 0 && TRAILING_PUNCTUATION.includes(token[end - 1])) end--;
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
