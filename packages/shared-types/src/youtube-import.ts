/**
 * Move from YouTube (wiki AUN-YT-IMPORT): a creator imports their own YouTube
 * channel. Metadata comes from the YouTube Data API (OAuth, read only), the
 * files from the creator's Google Takeout export, read in their browser and
 * uploaded through the normal resumable upload.
 *
 * Shared by api-videos (rows, jobs, the initiate hook), the Studio wizard and
 * admin-web. Pure: no I/O here.
 */
import type { VideoVisibility } from './upload-defaults';

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/** Always asked: read the creator's channel, videos and playlists. */
export const YT_SCOPE_READONLY = 'https://www.googleapis.com/auth/youtube.readonly';
/** Asked only when the creator opts into captions: captions.download accepts no read-only scope. */
export const YT_SCOPE_CAPTIONS = 'https://www.googleapis.com/auth/youtube.force-ssl';

export function youtubeImportScopes(captions: boolean): string[] {
  return captions ? [YT_SCOPE_READONLY, YT_SCOPE_CAPTIONS] : [YT_SCOPE_READONLY];
}

/** Admin settings (global_settings youtube-import/settings.json). The client secret lives in Secrets Store only. */
export interface YoutubeImportSettings {
  enabled: boolean;
  /** Google OAuth Web client id (not a secret) */
  clientId: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_YOUTUBE_IMPORT_SETTINGS: YoutubeImportSettings = { enabled: false, clientId: '', updatedAt: null, updatedBy: null };

/** A Google OAuth Web client id: digits-hash.apps.googleusercontent.com (empty clears it). */
export function isGoogleClientId(value: string): boolean {
  return value === '' || /^[0-9]{6,20}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/.test(value);
}

/** What the admin page shows (never the secret itself). */
export interface YoutubeImportSettingsView extends YoutubeImportSettings {
  secretPresent: boolean;
  /** Redirect URI to register in Google Cloud for this environment */
  redirectUri: string;
  scopes: string[];
  /** On, with a client id and a secret: creators can connect */
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const YT_IMPORT_STATUSES = ['listing', 'ready', 'importing', 'finished', 'cancelled', 'failed'] as const;
export type YtImportStatus = (typeof YT_IMPORT_STATUSES)[number];

export type YtVisibilityMode = 'keep' | 'private';

export interface YtChannelSummary {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  videoCount: number | null;
}

export interface YtImport {
  id: string;
  /** Our channel the videos go to */
  channelId: string;
  userId: string;
  status: YtImportStatus;
  ytChannel: YtChannelSummary | null;
  captions: boolean;
  visibilityMode: YtVisibilityMode;
  /** A Google token is still held (revoked and deleted when the import ends) */
  connected: boolean;
  error: string | null;
  counts: YtImportCounts;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface YtImportCounts {
  videos: number;
  selected: number;
  matched: number;
  uploading: number;
  processing: number;
  ready: number;
  failed: number;
  playlists: number;
}

/**
 * An item's state:
 *  available  listed, not picked
 *  selected   picked, waiting for its file or its upload
 *  uploading  our video exists, bytes are on their way
 *  processing bytes arrived, transcoding
 *  ready      playable here
 *  failed     the upload or processing failed (error says why); Try again
 *  imported   an earlier import already brought it (never picked twice)
 */
export const YT_ITEM_STATES = ['available', 'selected', 'uploading', 'processing', 'ready', 'failed', 'imported'] as const;
export type YtItemState = (typeof YT_ITEM_STATES)[number];

export const YT_STEP_STATES = ['none', 'pending', 'waiting_quota', 'done', 'failed'] as const;
export type YtStepState = (typeof YT_STEP_STATES)[number];

export type YtMatchBy = 'id' | 'title' | 'manual';

export interface YtFileMatch {
  /** The zip part's file name (empty for a loose file) */
  zipName: string;
  /** The entry path in the zip, or the loose file's name */
  entryName: string;
  fileName: string;
  size: number;
  by: YtMatchBy;
}

export interface YtImportItem {
  id: string;
  importId: string;
  ytVideoId: string;
  title: string;
  description: string;
  titleLocalized: Record<string, string>;
  descriptionLocalized: Record<string, string>;
  tags: string[];
  language: string | null;
  publishedAt: string | null;
  /** A private video scheduled on YouTube */
  publishAt: string | null;
  durationSeconds: number | null;
  ytVisibility: VideoVisibility;
  madeForKids: boolean;
  thumbnailUrl: string | null;
  selected: boolean;
  match: YtFileMatch | null;
  videoId: string | null;
  state: YtItemState;
  thumbnail: YtStepState;
  captions: YtStepState;
  captionLanguages: string[];
  error: string | null;
  updatedAt: string;
}

export interface YtImportPlaylist {
  ytPlaylistId: string;
  title: string;
  description: string;
  ytVisibility: VideoVisibility;
  /** YouTube video ids in the playlist's order */
  ytVideoIds: string[];
  selected: boolean;
  playlistId: string | null;
  state: YtStepState;
}

/** Marker on an imported video (VideoObject.importedFrom). */
export interface ImportedFrom {
  platform: 'youtube';
  videoId: string;
  publishedAt: string | null;
  madeForKids: boolean;
  importId: string;
}

/** The initiate body's link to its import item (POST /api/videos/upload/initiate). */
export interface YoutubeImportInitiate {
  importId: string;
  itemId: string;
}

export const YT_IMPORT_ERRORS = {
  /** Switched off or not configured: every user-facing route answers 404 with this code; Studio hides the feature */
  notEnabled: 'feature_off',
  notConnected: 'youtube_not_connected',
  noChannel: 'youtube_no_channel',
  quota: 'youtube_quota',
  denied: 'youtube_denied',
  itemTaken: 'youtube_item_taken',
  notFound: 'youtube_import_not_found',
  /** POST oauth/finish: the consent is unknown, used or older than 5 minutes (connect again) */
  connectExpired: 'youtube_connect_expired',
} as const;

// ---------------------------------------------------------------------------
// Mapping YouTube → Al Ummah Now
// ---------------------------------------------------------------------------

/** YouTube's privacyStatus as our visibility. */
export function ytPrivacyToVisibility(privacy: string | null | undefined): VideoVisibility {
  return privacy === 'public' ? 'public' : privacy === 'unlisted' ? 'unlisted' : 'private';
}

/**
 * The visibility an imported video gets, and a publish time when it was
 * scheduled on YouTube (private with a future publishAt). "Import everything
 * as private" wins over both.
 */
export function importVisibility(
  item: Pick<YtImportItem, 'ytVisibility' | 'publishAt'>,
  mode: YtVisibilityMode,
  now: Date,
): { visibility: VideoVisibility; scheduleAt: string | null } {
  if (mode === 'private') return { visibility: 'private', scheduleAt: null };
  if (item.ytVisibility === 'private' && item.publishAt && Date.parse(item.publishAt) > now.getTime()) {
    return { visibility: 'private', scheduleAt: new Date(Date.parse(item.publishAt)).toISOString() };
  }
  return { visibility: item.ytVisibility, scheduleAt: null };
}

/** ISO 8601 duration (contentDetails.duration, e.g. PT1H2M3S, P1DT2H) in seconds; null when unreadable. */
export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!m || value === 'P' || value === 'PT') return null;
  const [, d, h, mi, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Math.round(Number(s ?? 0));
}

/** The largest thumbnail the API gave (maxres, standard, high, medium, default). */
export function bestThumbnail(thumbnails: Record<string, { url?: string } | undefined> | null | undefined): string | null {
  if (!thumbnails) return null;
  for (const size of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const url = thumbnails[size]?.url;
    if (typeof url === 'string' && /^https:\/\//.test(url)) return url;
  }
  return null;
}

/** en/ar localizations of title and description (other languages are left out: the site has two). */
export function pickLocalizations(
  localizations: Record<string, { title?: string; description?: string }> | null | undefined,
): { titleLocalized: Record<string, string>; descriptionLocalized: Record<string, string> } {
  const titleLocalized: Record<string, string> = {};
  const descriptionLocalized: Record<string, string> = {};
  for (const [lang, value] of Object.entries(localizations ?? {})) {
    const base = lang.toLowerCase().split(/[-_]/)[0];
    if (base !== 'en' && base !== 'ar') continue;
    if (value?.title && !titleLocalized[base]) titleLocalized[base] = value.title;
    if (value?.description && !descriptionLocalized[base]) descriptionLocalized[base] = value.description;
  }
  return { titleLocalized, descriptionLocalized };
}

/** A caption track worth importing: uploaded by the creator (not ASR), not a draft, in a language. */
export function isImportableCaptionTrack(snippet: { trackKind?: string; isDraft?: boolean; language?: string; status?: string } | null | undefined): boolean {
  if (!snippet || !snippet.language) return false;
  if (snippet.trackKind && snippet.trackKind.toLowerCase() === 'asr') return false;
  if (snippet.isDraft) return false;
  return !snippet.status || snippet.status === 'serving';
}

// ---------------------------------------------------------------------------
// Takeout videos.csv
// ---------------------------------------------------------------------------

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export interface TakeoutVideoRow {
  videoId: string;
  title: string;
  durationMs: number | null;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function isYoutubeVideoId(value: string): boolean {
  return YT_ID.test(value);
}

/**
 * Takeout's "video metadata/videos.csv". Its columns are matched by name, not
 * position, because Google names and orders them by export version: the id is
 * the column named like "Video ID", the title "Video Title (Original)" or
 * "Video Title", the length "Approx Duration (ms)".
 */
export function parseTakeoutVideosCsv(text: string): TakeoutVideoRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const idCol = header.findIndex((h) => h === 'video id' || h === 'videoid' || h === 'video_id');
  const titleCol = (() => {
    const original = header.findIndex((h) => h.startsWith('video title') && h.includes('original'));
    if (original >= 0) return original;
    return header.findIndex((h) => h === 'video title' || h === 'title' || h.startsWith('video title'));
  })();
  const durationCol = header.findIndex((h) => h.includes('duration') && h.includes('ms'));
  if (idCol < 0 || titleCol < 0) return [];
  const out: TakeoutVideoRow[] = [];
  for (const r of rows.slice(1)) {
    const videoId = (r[idCol] ?? '').trim();
    if (!YT_ID.test(videoId)) continue;
    const ms = durationCol >= 0 ? Number((r[durationCol] ?? '').trim()) : NaN;
    out.push({ videoId, title: (r[titleCol] ?? '').trim(), durationMs: Number.isFinite(ms) && ms > 0 ? ms : null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matching files to videos
// ---------------------------------------------------------------------------

/**
 * A title or file name reduced to what survives Takeout's file naming: no
 * extension, no " (1)" duplicate marker, letters and digits only (Takeout
 * replaces characters a file name cannot hold), case and width folded.
 */
export function normalizeTitle(value: string): string {
  let s = value.normalize('NFKC').toLowerCase();
  s = s.replace(/\.[a-z0-9]{2,5}$/i, '');
  // Trim first, then an anchored marker: no backtracking over runs of spaces
  s = s.trim().replace(/\(\d+\)$/, '');
  return s.replace(/[^\p{L}\p{N}]+/gu, '');
}

export interface TakeoutFile {
  /** Unique within the import: zipName + '/' + entryName, or the loose file's name */
  key: string;
  zipName: string;
  entryName: string;
  fileName: string;
  size: number;
}

export interface MatchCandidate {
  id: string;
  ytVideoId: string;
  title: string;
}

/**
 * Files matched to items. In order: the YouTube id in the file name; the id's
 * title in videos.csv; the item's own title. A title shared by several files
 * or several videos is left for the creator (never guessed).
 */
export function matchTakeoutFiles(
  items: readonly MatchCandidate[],
  files: readonly TakeoutFile[],
  csv: readonly TakeoutVideoRow[] = [],
): Map<string, { file: TakeoutFile; by: Exclude<YtMatchBy, 'manual'> }> {
  const result = new Map<string, { file: TakeoutFile; by: Exclude<YtMatchBy, 'manual'> }>();
  const claimed = new Set<string>();
  const byStem = new Map<string, TakeoutFile[]>();
  for (const f of files) {
    const stem = normalizeTitle(f.fileName);
    if (!stem) continue;
    byStem.set(stem, [...(byStem.get(stem) ?? []), f]);
  }
  const titleCount = (stem: string, list: readonly { title: string }[]) => list.filter((x) => normalizeTitle(x.title) === stem).length;
  const take = (itemId: string, file: TakeoutFile, by: 'id' | 'title') => {
    result.set(itemId, { file, by });
    claimed.add(file.key);
  };

  // 1. The id written in the file name ("Title [dQw4w9WgXcQ].mp4", "dQw4w9WgXcQ.mp4")
  for (const item of items) {
    // The id as a whole token of the name (ids are [A-Za-z0-9_-]); no pattern built from input
    const file = files.find((f) => !claimed.has(f.key) && f.fileName.replace(/\.[a-z0-9]{2,5}$/i, '').split(/[^A-Za-z0-9_-]+/).includes(item.ytVideoId));
    if (file) take(item.id, file, 'id');
  }
  // 2. videos.csv: id → title → the one file with that title
  const csvById = new Map(csv.map((r) => [r.videoId, r]));
  for (const item of items) {
    if (result.has(item.id)) continue;
    const row = csvById.get(item.ytVideoId);
    if (!row?.title) continue;
    const stem = normalizeTitle(row.title);
    const candidates = (byStem.get(stem) ?? []).filter((f) => !claimed.has(f.key));
    if (candidates.length === 1 && titleCount(stem, csv) === 1) take(item.id, candidates[0]!, 'id');
  }
  // 3. The item's own title, when exactly one file and one video share it
  for (const item of items) {
    if (result.has(item.id)) continue;
    const stem = normalizeTitle(item.title);
    if (!stem) continue;
    const candidates = (byStem.get(stem) ?? []).filter((f) => !claimed.has(f.key));
    if (candidates.length === 1 && titleCount(stem, items) === 1) take(item.id, candidates[0]!, 'title');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Link back (the creator pastes it into YouTube themselves)
// ---------------------------------------------------------------------------

export function linkBackLine(url: string, locale: 'en' | 'ar'): string {
  return locale === 'ar' ? `شاهده أيضًا على الأمة الآن: ${url}` : `Also on Al Ummah Now: ${url}`;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** youtube_video_id,youtube_url,al_ummah_now_url,title — one line per imported video. */
export function linkBackCsv(rows: readonly { ytVideoId: string; url: string; title: string }[]): string {
  const lines = ['youtube_video_id,youtube_url,al_ummah_now_url,title'];
  for (const r of rows) lines.push([r.ytVideoId, `https://www.youtube.com/watch?v=${r.ytVideoId}`, r.url, r.title].map(csvField).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// Queue messages (al-ummah-now-yt-import)
// ---------------------------------------------------------------------------

export type YtImportJob =
  | { kind: 'yt-list'; importId: string; phase: 'videos' | 'playlists' | 'playlist-items'; pageToken?: string; playlistIndex?: number }
  | { kind: 'yt-captions'; importId: string; itemId: string }
  | { kind: 'yt-finalize'; importId: string; itemId: string }
  | { kind: 'yt-playlists'; importId: string }
  | { kind: 'yt-close'; importId: string };

export function isYtImportJob(body: unknown): body is YtImportJob {
  const b = body as { kind?: unknown; importId?: unknown } | null;
  return !!b && typeof b.importId === 'string' && typeof b.kind === 'string' && b.kind.startsWith('yt-');
}
