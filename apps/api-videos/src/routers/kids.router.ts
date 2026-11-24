/**
 * Ummah Kids catalog, curated Kids playlists, and Studio review-request routes
 * (wiki E20 §5.2; story E20-2).
 *
 * Every route sits behind `ummahKids` in `FEATURE_ROUTES` (404 `feature_off` while off).
 * Public catalog & playlist endpoints collect zero user tracking data, verify live
 * approval/visibility/staff-channel state on every served page, and support bounded
 * keyset traversal past the KV/Cache browse snapshot.
 */
import { Hono, type Context } from 'hono';
import {
  KIDS_AGE_BANDS,
  can,
  isKidsActiveAgeBand,
  isKidsAgeBand,
  isKidsTargetType,
  isKidsTopic,
  matchingKidsAgeBands,
  normalizeSearchText,
  parseKidsTopicsJson,
  type KidsAgeBand,
  type KidsCatalogStatus,
  type KidsTopic,
  type KidsTargetType,
  type SearchDb,
} from '@al-ummah/shared-types';
import type { AppBindings } from '../base';
import { apiError } from '../lib/api-error';
import { roleOnChannel } from '../lib/channelAccess';
import {
  KIDS_SNAPSHOT_KV_KEY,
  invalidateKidsBrowseSnapshot,
  kidsCacheEnvironment,
  kidsSnapshotCacheUrl,
} from '../lib/kids/revoke-on-edit';
import { logger } from '../lib/logger';
import type { PlaylistType } from '../lib/playlists';
import R2Repository from '../lib/r2Repo';

export { invalidateKidsBrowseSnapshot };

type Env = { Bindings: AppBindings; Variables: { userId?: string } };
type C = Context<Env>;

const D1_IN_CHUNK = 80;
const EDGE_CACHE_TTL_SECONDS = 60;
const SNAPSHOT_MAX_PER_BRANCH = 200;
const SNAPSHOT_MAX_ITEMS = 300;
const SNAPSHOT_MAX_PLAYLIST_R2 = 50;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_PLAYLIST_VIDEOS = 500;
const TAIL_BRANCH_LIMIT = 100;
const MAX_TAIL_ROUNDS = 10;

const ALLOWED_VIDEO_KEYS = [
  'id',
  'title',
  'channelId',
  'channelName',
  'duration',
  'thumbnailUrl',
  'posterUrl',
  'thumbnail',
  'thumbnailSizes',
  'thumbnailType',
  'playUrl',
  'hlsUrl',
  'streamUrl',
  'delivery',
  'sources',
  'r2',
  'bunnyLibraryId',
  'bunnyVideoId',
  'bunnyGuid',
  'aspectRatio',
  'width',
  'height',
  'language',
  'category',
  'subtitles',
  'captions',
  'chapters',
  'publishedAt',
  'uploadedAt',
  'dateCreated',
  'dateModified',
] as const;

const EXTERNAL_LINK_RE =
  /\b(?:https?:\/\/|www\.)[^\s<>"')]+|(?<![\d.])\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|me|tv|gg|ly|be|to|dev|app|info|biz|xyz|online|site|club|link|click|shop|store|blog|live|news|stream|video|tube|watch|social|page|cc|ws|fm|uk|ca|de|fr|au|in|pk|id|my|eg|sa|ae|qa|kw|tr)(?:\/[^\s<>"')]*)?(?=$|[\s.,!?;:)\]"'])/gi;

interface CatalogRow {
  id: string;
  target_type: KidsTargetType;
  target_id: string;
  age_band: KidsAgeBand;
  status: KidsCatalogStatus;
  topics_json: string;
  position: number;
  approved_at: string;
}

interface PayloadRow {
  id: string;
  payload: string;
}

function chunkIds<T>(items: readonly T[], size = D1_IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Strips URLs and bare domain links while preserving line breaks cleanly. */
function stripExternalLinks(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(EXTERNAL_LINK_RE, '').replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeLocalizedMap(raw: unknown, stripUrls = false): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') continue;
    const cleaned = stripUrls ? stripExternalLinks(v) : v.trim();
    if (cleaned) out[k] = cleaned;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Strict allow-list sanitizer for public Kids videos (omits social metrics, tags, userId, playerLinks, cards, endScreen). */
function sanitizeKidsVideoPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_VIDEO_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  const titleLocalized = sanitizeLocalizedMap(raw.titleLocalized);
  if (titleLocalized) out.titleLocalized = titleLocalized;
  const channelNameLocalized = sanitizeLocalizedMap(raw.channelNameLocalized);
  if (channelNameLocalized) out.channelNameLocalized = channelNameLocalized;
  if (typeof raw.description === 'string') {
    const cleaned = stripExternalLinks(raw.description);
    if (cleaned) out.description = cleaned;
  }
  const descLocalized = sanitizeLocalizedMap(raw.descriptionLocalized, true);
  if (descLocalized) out.descriptionLocalized = descLocalized;
  out.commentSettings = 'off';
  out.autoplayNext = false;
  return out;
}

function videoCoverUrl(video: Record<string, unknown> | undefined): string | null {
  if (!video) return null;
  for (const key of ['thumbnailUrl', 'posterUrl', 'thumbnail']) {
    const val = video[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return null;
}

/**
 * Builds the public Kids playlist shape (`S-K`): omits unapproved/index-only fields
 * (`coverVideoIds`, raw `thumbnailUrl`, total `videosCount`, raw `videos`, `userId`),
 * strips links from descriptions, and derives cover & count solely from approved videos.
 */
function sanitizeKidsPlaylistPayload(
  raw: Record<string, unknown>,
  approvedVideos: ReadonlyArray<{ coverUrl: string | null }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: typeof raw.id === 'string' ? raw.id : '',
    title: typeof raw.title === 'string' ? raw.title : '',
  };
  const titleLocalized = sanitizeLocalizedMap(raw.titleLocalized);
  if (titleLocalized) out.titleLocalized = titleLocalized;
  if (typeof raw.description === 'string') {
    const cleaned = stripExternalLinks(raw.description);
    if (cleaned) out.description = cleaned;
  }
  const descLocalized = sanitizeLocalizedMap(raw.descriptionLocalized, true);
  if (descLocalized) out.descriptionLocalized = descLocalized;
  if (typeof raw.channelId === 'string' && raw.channelId) out.channelId = raw.channelId;
  if (typeof raw.channelName === 'string' && raw.channelName) out.channelName = raw.channelName;
  const channelNameLocalized = sanitizeLocalizedMap(raw.channelNameLocalized);
  if (channelNameLocalized) out.channelNameLocalized = channelNameLocalized;
  out.approvedVideosCount = approvedVideos.length;
  out.approvedCoverUrl = approvedVideos.find((v) => v.coverUrl)?.coverUrl ?? null;
  return out;
}

async function loadStaffChannelIds(db: SearchDb): Promise<Set<string>> {
  const row = await db
    .prepare("SELECT staff_channel_ids_json FROM kids_policy_settings WHERE key = 'default'")
    .first<{ staff_channel_ids_json: string | null }>();
  if (!row?.staff_channel_ids_json) return new Set();
  try {
    const parsed = JSON.parse(row.staff_channel_ids_json);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()));
  } catch {
    return new Set();
  }
}

async function hydratePayloads(
  db: SearchDb,
  table: 'search_videos' | 'search_playlists',
  ids: string[],
  sanitizeVideo = false,
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  for (const group of chunkIds(unique)) {
    const placeholders = group.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, payload FROM ${table} WHERE id IN (${placeholders}) AND visible = 1`)
      .bind(...group)
      .all<PayloadRow>();
    for (const row of results ?? []) {
      const parsed = parseJsonObject(row.payload);
      if (!parsed) continue;
      out.set(row.id, sanitizeVideo ? sanitizeKidsVideoPayload(parsed) : parsed);
    }
  }
  return out;
}

async function hydrateStaffPlaylists(
  db: SearchDb,
  ids: string[],
  staffChannels: ReadonlySet<string>,
): Promise<Map<string, { channelId: string; payload: Record<string, unknown> }>> {
  const out = new Map<string, { channelId: string; payload: Record<string, unknown> }>();
  if (ids.length === 0 || staffChannels.size === 0) return out;
  const unique = [...new Set(ids)];
  for (const group of chunkIds(unique)) {
    const placeholders = group.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id, channel_id, payload FROM search_playlists WHERE id IN (${placeholders}) AND visible = 1`)
      .bind(...group)
      .all<{ id: string; channel_id: string | null; payload: string }>();
    for (const row of results ?? []) {
      const parsed = parseJsonObject(row.payload);
      if (!parsed) continue;
      const channelId =
        typeof row.channel_id === 'string' && row.channel_id
          ? row.channel_id
          : typeof parsed.channelId === 'string'
            ? parsed.channelId
            : '';
      if (!channelId || !staffChannels.has(channelId)) continue;
      out.set(row.id, { channelId, payload: parsed });
    }
  }
  return out;
}

async function fetchApprovedVideosWithBands(
  db: SearchDb,
  videoIds: string[],
  bands: readonly KidsAgeBand[],
): Promise<Map<string, KidsAgeBand>> {
  const out = new Map<string, KidsAgeBand>();
  if (videoIds.length === 0) return out;
  const unique = [...new Set(videoIds)];
  const bandPlaceholders = bands.map(() => '?').join(', ');
  for (const group of chunkIds(unique)) {
    const idPlaceholders = group.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT target_id, age_band FROM kids_catalog_items
         WHERE target_type = 'video' AND status = 'approved'
           AND age_band IN (${bandPlaceholders})
           AND target_id IN (${idPlaceholders})`,
      )
      .bind(...bands, ...group)
      .all<{ target_id: string; age_band: KidsAgeBand }>();
    for (const row of results ?? []) out.set(row.target_id, row.age_band);
  }
  return out;
}

function compareCatalogRows(
  a: { position: number; approved_at?: string; approvedAt?: string; id: string },
  b: { position: number; approved_at?: string; approvedAt?: string; id: string },
): number {
  const posDiff = (Number(a.position) || 0) - (Number(b.position) || 0);
  if (posDiff !== 0) return posDiff;
  const aAt = a.approved_at ?? a.approvedAt ?? '';
  const bAt = b.approved_at ?? b.approvedAt ?? '';
  if (aAt !== bAt) return aAt > bAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

async function fetchOrderedCatalogBranches(
  db: SearchDb,
  targetTypes: readonly ('video' | 'playlist')[],
  bands: readonly KidsAgeBand[],
  perBranchLimit: number,
  afterCursor: CatalogCursor | null = null,
): Promise<{ rows: CatalogRow[]; cutoffRow: CatalogRow | null }> {
  const queries: Promise<CatalogRow[]>[] = [];
  for (const targetType of targetTypes) {
    for (const band of bands) {
      const sql = afterCursor
        ? `SELECT id, target_type, target_id, age_band, status, topics_json, position, approved_at
           FROM kids_catalog_items
           WHERE status = 'approved' AND target_type = ? AND age_band = ?
             AND (position > ? OR (position = ? AND approved_at < ?) OR (position = ? AND approved_at = ? AND id > ?))
           ORDER BY position ASC, approved_at DESC, id ASC
           LIMIT ?`
        : `SELECT id, target_type, target_id, age_band, status, topics_json, position, approved_at
           FROM kids_catalog_items
           WHERE status = 'approved' AND target_type = ? AND age_band = ?
           ORDER BY position ASC, approved_at DESC, id ASC
           LIMIT ?`;
      const binds = afterCursor
        ? [targetType, band, afterCursor.pos, afterCursor.pos, afterCursor.at, afterCursor.pos, afterCursor.at, afterCursor.id, perBranchLimit]
        : [targetType, band, perBranchLimit];
      queries.push(
        db
          .prepare(sql)
          .bind(...binds)
          .all<CatalogRow>()
          .then((r) => r.results ?? []),
      );
    }
  }
  const branchResults = await Promise.all(queries);
  let cutoffRow: CatalogRow | null = null;
  for (const list of branchResults) {
    if (list.length >= perBranchLimit) {
      const tail = list[list.length - 1]!;
      if (!cutoffRow || compareCatalogRows(tail, cutoffRow) < 0) cutoffRow = tail;
    }
  }
  const merged = branchResults.flat();
  merged.sort(compareCatalogRows);
  return { rows: merged, cutoffRow };
}

async function resolvePlaylistVideos(
  c: C,
  db: SearchDb,
  playlistPayloads: Map<string, { channelId: string; payload: Record<string, unknown> }>,
  bands: readonly KidsAgeBand[],
): Promise<Map<string, Array<{ videoId: string; ageBand: KidsAgeBand; video: Record<string, unknown> }>>> {
  const out = new Map<string, Array<{ videoId: string; ageBand: KidsAgeBand; video: Record<string, unknown> }>>();
  if (playlistPayloads.size === 0) return out;

  const r2Repo = c.env.playlists ? new R2Repository<PlaylistType>(c.env.playlists) : null;
  const r2Objects = await Promise.all(
    [...playlistPayloads.keys()].map(async (plId) => {
      const obj = r2Repo ? await r2Repo.getObject(plId) : null;
      return [plId, obj] as const;
    }),
  );

  const orderedByPlaylist = new Map<string, string[]>();
  const allCandidateVideoIds: string[] = [];
  for (const [plId, obj] of r2Objects) {
    const payload = playlistPayloads.get(plId)?.payload;
    const rawList = Array.isArray(obj?.videos)
      ? obj.videos
      : Array.isArray(payload?.videos)
        ? payload.videos
        : [];
    const ordered = rawList.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, MAX_PLAYLIST_VIDEOS);
    orderedByPlaylist.set(plId, ordered);
    for (const vid of ordered) allCandidateVideoIds.push(vid);
  }

  const approvedMap = await fetchApprovedVideosWithBands(db, allCandidateVideoIds, bands);
  const visibleVideos = await hydratePayloads(db, 'search_videos', [...approvedMap.keys()], true);

  for (const [plId, ordered] of orderedByPlaylist.entries()) {
    const valid = ordered
      .filter((vid) => approvedMap.has(vid) && visibleVideos.has(vid))
      .map((vid) => ({ videoId: vid, ageBand: approvedMap.get(vid)!, video: visibleVideos.get(vid)! }));
    out.set(plId, valid);
  }
  return out;
}

function matchesSearchText(payload: Record<string, unknown>, needle: string): boolean {
  const candidates: string[] = [];
  for (const key of ['title', 'name', 'channelName', 'description']) {
    const v = payload[key];
    if (typeof v === 'string' && v) candidates.push(v);
  }
  for (const locKey of ['titleLocalized', 'nameLocalized', 'channelNameLocalized', 'descriptionLocalized']) {
    const loc = payload[locKey];
    if (loc && typeof loc === 'object') {
      for (const v of Object.values(loc as Record<string, unknown>)) {
        if (typeof v === 'string' && v) candidates.push(v);
      }
    }
  }
  const normalizedNeedle = normalizeSearchText(needle);
  if (!normalizedNeedle) return true;
  return candidates.some((c) => normalizeSearchText(c).includes(normalizedNeedle));
}

function safeWaitUntil(c: C, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // Non-worker runtimes (unit tests) lack ExecutionContext
  }
}

async function withEdgeCache(c: C, cacheKeyUrl: string, produce: () => Promise<Response>): Promise<Response> {
  const hasKidsSessionHeader = Boolean(c.req.header('x-kids-session') || c.req.header('cookie')?.includes('aun_kids_session='));
  const cacheStorage = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (hasKidsSessionHeader || !cacheStorage) {
    return produce();
  }
  const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });
  try {
    const hit = await cacheStorage.match(cacheKey);
    if (hit) return hit;
  } catch {
    // Ignore edge cache read failures
  }
  const res = await produce();
  if (res.status === 200 || res.status === 404) {
    const cloned = res.clone();
    safeWaitUntil(
      c,
      cacheStorage.put(cacheKey, cloned).catch((err) =>
        logger.warn('[KidsCatalog] Edge cache put failed', { error: err instanceof Error ? err.message : String(err) }),
      ),
    );
  }
  return res;
}

interface SnapshotVideoEntry {
  id: string;
  targetType: 'video';
  targetId: string;
  ageBand: KidsAgeBand;
  topics: KidsTopic[];
  position: number;
  approvedAt: string;
  item: Record<string, unknown>;
}

interface SnapshotPlaylistEntry {
  id: string;
  targetType: 'playlist';
  targetId: string;
  ageBand: KidsAgeBand;
  topics: KidsTopic[];
  position: number;
  approvedAt: string;
  channelId: string;
  rawPlaylist: Record<string, unknown>;
  /** Compact per-video references only (no full video payloads embedded inside playlists). */
  videos: Array<{ videoId: string; ageBand: KidsAgeBand; coverUrl: string | null }>;
}

type SnapshotEntry = SnapshotVideoEntry | SnapshotPlaylistEntry;

interface CatalogCursor {
  pos: number;
  at: string;
  id: string;
}

interface KidsBrowseSnapshot {
  builtAt: number;
  exhausted: boolean;
  cutoff: CatalogCursor | null;
  entries: SnapshotEntry[];
}

function toCursor(row: { position: number; approved_at?: string; approvedAt?: string; id: string }): CatalogCursor {
  return {
    pos: Number(row.position) || 0,
    at: row.approved_at ?? row.approvedAt ?? '',
    id: row.id,
  };
}

function decodeCatalogCursor(raw: string | undefined): CatalogCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(raw)) as Partial<CatalogCursor>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.pos === 'number' &&
      Number.isInteger(parsed.pos) &&
      typeof parsed.at === 'string' &&
      typeof parsed.id === 'string'
    ) {
      return parsed as CatalogCursor;
    }
  } catch {
    // Validated below by caller
  }
  return null;
}

async function readCachedSnapshot(c: C): Promise<KidsBrowseSnapshot | null> {
  const cacheStorage = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (cacheStorage) {
    try {
      const hit = await cacheStorage.match(new Request(kidsSnapshotCacheUrl(c.env), { method: 'GET' }));
      if (hit) {
        const parsed = (await hit.json()) as KidsBrowseSnapshot;
        if (parsed && Array.isArray(parsed.entries) && typeof parsed.exhausted === 'boolean') return parsed;
      }
    } catch {
      // Fall through to KV
    }
  }
  if (c.env.APP_CONFIG) {
    try {
      const parsed = (await c.env.APP_CONFIG.get(KIDS_SNAPSHOT_KV_KEY, 'json')) as KidsBrowseSnapshot | null;
      if (parsed && Array.isArray(parsed.entries) && typeof parsed.exhausted === 'boolean') return parsed;
    } catch {
      // Rebuild from D1
    }
  }
  return null;
}

async function buildEntriesFromRows(
  c: C,
  db: SearchDb,
  rows: CatalogRow[],
  staffChannels: ReadonlySet<string>,
): Promise<SnapshotEntry[]> {
  if (rows.length === 0) return [];
  const videoIds = rows.filter((r) => r.target_type === 'video').map((r) => r.target_id);
  const playlistIds = rows.filter((r) => r.target_type === 'playlist').map((r) => r.target_id);

  const [videos, playlists] = await Promise.all([
    hydratePayloads(db, 'search_videos', videoIds, true),
    hydrateStaffPlaylists(db, playlistIds, staffChannels),
  ]);
  const playlistVideos = await resolvePlaylistVideos(c, db, playlists, KIDS_AGE_BANDS);

  const entries: SnapshotEntry[] = [];
  for (const row of rows) {
    const position = Number(row.position) || 0;
    const topics = parseKidsTopicsJson(row.topics_json);
    if (row.target_type === 'video') {
      const item = videos.get(row.target_id);
      if (!item) continue;
      entries.push({
        id: row.id,
        targetType: 'video',
        targetId: row.target_id,
        ageBand: row.age_band,
        topics,
        position,
        approvedAt: row.approved_at,
        item,
      });
    } else if (row.target_type === 'playlist') {
      const pl = playlists.get(row.target_id);
      const valid = playlistVideos.get(row.target_id) ?? [];
      if (!pl || valid.length === 0) continue;
      entries.push({
        id: row.id,
        targetType: 'playlist',
        targetId: row.target_id,
        ageBand: row.age_band,
        topics,
        position,
        approvedAt: row.approved_at,
        channelId: pl.channelId,
        rawPlaylist: pl.payload,
        videos: valid.map((v) => ({
          videoId: v.videoId,
          ageBand: v.ageBand,
          coverUrl: videoCoverUrl(v.video),
        })),
      });
    }
  }
  return entries;
}

async function getOrBuildBrowseSnapshot(c: C, db: SearchDb): Promise<KidsBrowseSnapshot> {
  const cached = await readCachedSnapshot(c);
  if (cached) return cached;

  const [staffChannels, { rows, cutoffRow }] = await Promise.all([
    loadStaffChannelIds(db),
    fetchOrderedCatalogBranches(db, ['video', 'playlist'], KIDS_AGE_BANDS, SNAPSHOT_MAX_PER_BRANCH),
  ]);

  let clipped = cutoffRow !== null;
  const boundedRows: CatalogRow[] = [];
  let playlistCount = 0;
  for (const row of rows) {
    if (cutoffRow && compareCatalogRows(row, cutoffRow) > 0) {
      clipped = true;
      break;
    }
    if (boundedRows.length >= SNAPSHOT_MAX_ITEMS) {
      clipped = true;
      break;
    }
    if (row.target_type === 'playlist') {
      playlistCount += 1;
      if (playlistCount > SNAPSHOT_MAX_PLAYLIST_R2) {
        clipped = true;
        break;
      }
    }
    boundedRows.push(row);
  }

  let entries = await buildEntriesFromRows(c, db, boundedRows, staffChannels);
  let lastRowForCutoff: CatalogRow | undefined = boundedRows[boundedRows.length - 1];

  // Enforce MAX_SNAPSHOT_BYTES by trimming tail entries while preserving exact cutoff cursor.
  while (entries.length > 0) {
    const tentative: KidsBrowseSnapshot = {
      builtAt: Date.now(),
      exhausted: !clipped,
      cutoff: lastRowForCutoff ? toCursor(lastRowForCutoff) : null,
      entries,
    };
    const serialized = JSON.stringify(tentative);
    if (serialized.length <= MAX_SNAPSHOT_BYTES) break;
    clipped = true;
    entries = entries.slice(0, Math.max(1, Math.floor(entries.length / 2)));
    const lastEntry = entries[entries.length - 1];
    lastRowForCutoff = lastEntry
      ? {
          id: lastEntry.id,
          target_type: lastEntry.targetType,
          target_id: lastEntry.targetId,
          age_band: lastEntry.ageBand,
          status: 'approved',
          topics_json: JSON.stringify(lastEntry.topics),
          position: lastEntry.position,
          approved_at: lastEntry.approvedAt,
        }
      : undefined;
    if (entries.length === 1 && serialized.length > MAX_SNAPSHOT_BYTES) {
      entries = [];
      lastRowForCutoff = undefined;
      break;
    }
  }

  const snapshot: KidsBrowseSnapshot = {
    builtAt: Date.now(),
    exhausted: !clipped,
    cutoff: !clipped ? null : lastRowForCutoff ? toCursor(lastRowForCutoff) : null,
    entries,
  };
  const serialized = JSON.stringify(snapshot);
  const writes: Promise<unknown>[] = [];
  const cacheStorage = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (cacheStorage) {
    writes.push(
      cacheStorage.put(
        new Request(kidsSnapshotCacheUrl(c.env), { method: 'GET' }),
        new Response(serialized, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}`,
          },
        }),
      ),
    );
  }
  if (c.env.APP_CONFIG) {
    writes.push(c.env.APP_CONFIG.put(KIDS_SNAPSHOT_KV_KEY, serialized, { expirationTtl: EDGE_CACHE_TTL_SECONDS }));
  }
  if (writes.length > 0) {
    try {
      await Promise.all(writes);
    } catch (err) {
      logger.error('[KidsCatalog] Snapshot cache write failed', {
        bytes: serialized.length,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
  return snapshot;
}

/**
 * Live-verifies snapshot candidate entries against D1 by primary keys (`kids_catalog_items`,
 * `search_videos`, `search_playlists`, and `staffChannels`) so revocations, unpublishes,
 * and staff-channel removals take effect immediately even while KV/Cache snapshots are warm.
 */
async function verifySnapshotCandidates(
  c: C,
  db: SearchDb,
  candidates: SnapshotEntry[],
  bands: readonly KidsAgeBand[],
  staffChannels: ReadonlySet<string>,
): Promise<Array<{ entry: SnapshotEntry; item: Record<string, unknown> }>> {
  if (candidates.length === 0) return [];
  const catalogIds = candidates.map((e) => e.id);
  const videoTargetIds = candidates.filter((e) => e.targetType === 'video').map((e) => e.targetId);
  const playlistTargetIds = candidates.filter((e) => e.targetType === 'playlist').map((e) => e.targetId);
  const playlistVideoIds = candidates
    .filter((e): e is SnapshotPlaylistEntry => e.targetType === 'playlist')
    .flatMap((e) => e.videos.map((v) => v.videoId));

  const approvedCatalogIds = new Set<string>();
  for (const group of chunkIds([...new Set(catalogIds)])) {
    const placeholders = group.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id FROM kids_catalog_items WHERE status = 'approved' AND id IN (${placeholders})`)
      .bind(...group)
      .all<{ id: string }>();
    for (const r of results ?? []) approvedCatalogIds.add(r.id);
  }

  const allVideoIds = [...new Set([...videoTargetIds, ...playlistVideoIds])];
  const visibleVideoIds = new Set<string>();
  for (const group of chunkIds(allVideoIds)) {
    const placeholders = group.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT id FROM search_videos WHERE visible = 1 AND id IN (${placeholders})`)
      .bind(...group)
      .all<{ id: string }>();
    for (const r of results ?? []) visibleVideoIds.add(r.id);
  }

  const livePlaylistIds = new Set<string>();
  if (playlistTargetIds.length > 0 && staffChannels.size > 0) {
    for (const group of chunkIds([...new Set(playlistTargetIds)])) {
      const placeholders = group.map(() => '?').join(', ');
      const { results } = await db
        .prepare(`SELECT id, channel_id FROM search_playlists WHERE visible = 1 AND id IN (${placeholders})`)
        .bind(...group)
        .all<{ id: string; channel_id: string | null }>();
      for (const r of results ?? []) {
        if (r.channel_id && staffChannels.has(r.channel_id)) livePlaylistIds.add(r.id);
      }
    }
  }

  const approvedPlaylistVideos = await fetchApprovedVideosWithBands(db, playlistVideoIds, bands);
  const verified: Array<{ entry: SnapshotEntry; item: Record<string, unknown> }> = [];
  let sawStale = false;

  for (const entry of candidates) {
    if (!approvedCatalogIds.has(entry.id)) {
      sawStale = true;
      continue;
    }
    if (entry.targetType === 'video') {
      if (!visibleVideoIds.has(entry.targetId)) {
        sawStale = true;
        continue;
      }
      verified.push({ entry, item: entry.item });
    } else {
      if (!livePlaylistIds.has(entry.targetId)) {
        sawStale = true;
        continue;
      }
      const bandVideos = entry.videos.filter(
        (v) => bands.includes(v.ageBand) && approvedPlaylistVideos.has(v.videoId) && visibleVideoIds.has(v.videoId),
      );
      if (bandVideos.length < entry.videos.filter((v) => bands.includes(v.ageBand)).length) {
        sawStale = true;
      }
      if (bandVideos.length === 0) continue;
      verified.push({
        entry,
        item: sanitizeKidsPlaylistPayload(entry.rawPlaylist, bandVideos),
      });
    }
  }

  if (sawStale) {
    safeWaitUntil(c, invalidateKidsBrowseSnapshot(c.env));
  }
  return verified;
}

export const kidsRouter = new Hono<Env>();

kidsRouter.get('/catalog', async (c: C) => {
  const db = c.env.SEARCH_DB as unknown as SearchDb | undefined;
  if (!db) return apiError(c, 503, 'search_unavailable');

  const ageBandRaw = c.req.query('ageBand');
  if (ageBandRaw && !isKidsActiveAgeBand(ageBandRaw)) return apiError(c, 400, 'invalid_request');
  const ageBand = ageBandRaw && isKidsActiveAgeBand(ageBandRaw) ? ageBandRaw : null;
  const topicRaw = c.req.query('topic');
  if (topicRaw && !isKidsTopic(topicRaw)) return apiError(c, 400, 'invalid_request');
  const topic = topicRaw && isKidsTopic(topicRaw) ? topicRaw : null;
  const targetTypeParam = c.req.query('targetType');
  if (targetTypeParam && !isKidsTargetType(targetTypeParam)) return apiError(c, 400, 'invalid_request');
  const queryText = c.req.query('q')?.trim() ?? '';
  const limitRaw = Number(c.req.query('limit') ?? 24);
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, 50) : 24;
  const cursorRaw = c.req.query('cursor');
  const cursor = decodeCatalogCursor(cursorRaw);
  if (cursorRaw !== undefined && !cursor) return apiError(c, 400, 'invalid_request');

  // Channel-wide approvals stay omitted until channel admission semantics are built and shipped.
  if (targetTypeParam === 'channel') {
    c.header('Cache-Control', `public, max-age=${EDGE_CACHE_TTL_SECONDS}`);
    return c.json({ success: true, items: [], hasMore: false, nextCursor: null });
  }

  let snapshot: KidsBrowseSnapshot;
  let staffChannels: Set<string>;
  try {
    [snapshot, staffChannels] = await Promise.all([getOrBuildBrowseSnapshot(c, db), loadStaffChannelIds(db)]);
  } catch (err) {
    logger.warn('[KidsCatalog] Snapshot build failed', { error: err instanceof Error ? err.message : String(err) });
    return apiError(c, 503, 'service_unavailable');
  }

  const bands = matchingKidsAgeBands(ageBand);
  const matching: Array<{
    id: string;
    targetType: KidsTargetType;
    targetId: string;
    ageBand: KidsAgeBand;
    topics: KidsTopic[];
    position: number;
    approvedAt: string;
    item: Record<string, unknown>;
  }> = [];

  // Phase 1: prefiltered candidates from snapshot, live-verified in bounded batches against D1
  const prefiltered: SnapshotEntry[] = [];
  for (const entry of snapshot.entries) {
    if (targetTypeParam && entry.targetType !== targetTypeParam) continue;
    if (!bands.includes(entry.ageBand)) continue;
    if (topic && !entry.topics.includes(topic)) continue;
    if (cursor && compareCatalogRows(entry, { position: cursor.pos, approvedAt: cursor.at, id: cursor.id }) <= 0) continue;
    if (entry.targetType === 'playlist' && !entry.videos.some((v) => bands.includes(v.ageBand))) continue;
    if (queryText) {
      const prelimItem =
        entry.targetType === 'video' ? entry.item : sanitizeKidsPlaylistPayload(entry.rawPlaylist, entry.videos);
      if (!matchesSearchText(prelimItem, queryText)) continue;
    }
    prefiltered.push(entry);
  }

  const BATCH_SIZE = Math.max(limit + 1, 25);
  for (let i = 0; i < prefiltered.length && matching.length <= limit; i += BATCH_SIZE) {
    const slice = prefiltered.slice(i, i + BATCH_SIZE);
    const live = await verifySnapshotCandidates(c, db, slice, bands, staffChannels);
    for (const { entry, item } of live) {
      if (queryText && !matchesSearchText(item, queryText)) continue;
      matching.push({
        id: entry.id,
        targetType: entry.targetType,
        targetId: entry.targetId,
        ageBand: entry.ageBand,
        topics: entry.topics,
        position: entry.position,
        approvedAt: entry.approvedAt,
        item,
      });
      if (matching.length > limit) break;
    }
  }

  // Phase 2: if snapshot clipped or tail extends further, traverse D1 keyset branches cleanly
  let tailCursorForMore: CatalogCursor | null = null;
  if (matching.length <= limit && !snapshot.exhausted && snapshot.cutoff) {
    const targetTypes: readonly ('video' | 'playlist')[] =
      targetTypeParam === 'video' ? ['video'] : targetTypeParam === 'playlist' ? ['playlist'] : ['video', 'playlist'];
    let waveCursor: CatalogCursor =
      cursor &&
      compareCatalogRows(
        { position: cursor.pos, approvedAt: cursor.at, id: cursor.id },
        { position: snapshot.cutoff.pos, approvedAt: snapshot.cutoff.at, id: snapshot.cutoff.id },
      ) > 0
        ? cursor
        : snapshot.cutoff;

    for (let round = 0; round < MAX_TAIL_ROUNDS && matching.length <= limit; round++) {
      const { rows, cutoffRow } = await fetchOrderedCatalogBranches(db, targetTypes, bands, TAIL_BRANCH_LIMIT, waveCursor);
      const bounded = cutoffRow ? rows.filter((r) => compareCatalogRows(r, cutoffRow) <= 0) : rows;
      const filteredRows = bounded.filter((r) => !topic || parseKidsTopicsJson(r.topics_json).includes(topic));
      const entries = await buildEntriesFromRows(c, db, filteredRows, staffChannels);

      for (const entry of entries) {
        if (!bands.includes(entry.ageBand)) continue;
        let item: Record<string, unknown> | null = null;
        if (entry.targetType === 'video') {
          item = entry.item;
        } else {
          const bandVideos = entry.videos.filter((v) => bands.includes(v.ageBand));
          if (bandVideos.length > 0) item = sanitizeKidsPlaylistPayload(entry.rawPlaylist, bandVideos);
        }
        if (!item) continue;
        if (queryText && !matchesSearchText(item, queryText)) continue;
        matching.push({
          id: entry.id,
          targetType: entry.targetType,
          targetId: entry.targetId,
          ageBand: entry.ageBand,
          topics: entry.topics,
          position: entry.position,
          approvedAt: entry.approvedAt,
          item,
        });
        if (matching.length > limit) break;
      }

      if (!cutoffRow) {
        tailCursorForMore = null;
        break;
      }
      waveCursor = toCursor(cutoffRow);
      tailCursorForMore = waveCursor;
    }
  }

  const hasMore = matching.length > limit || tailCursorForMore !== null;
  const page = matching.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = !hasMore
    ? null
    : last
      ? btoa(JSON.stringify({ pos: last.position, at: last.approvedAt, id: last.id }))
      : tailCursorForMore
        ? btoa(JSON.stringify(tailCursorForMore))
        : null;

  c.header('Cache-Control', `public, max-age=${EDGE_CACHE_TTL_SECONDS}`);
  return c.json({
    success: true,
    items: page.map(({ position: _p, approvedAt: _a, ...rest }) => rest),
    hasMore,
    nextCursor,
  });
});

kidsRouter.get('/playlists', async (c: C) => {
  const db = c.env.SEARCH_DB as unknown as SearchDb | undefined;
  if (!db) return apiError(c, 503, 'search_unavailable');

  const ageBandRaw = c.req.query('ageBand');
  if (ageBandRaw && !isKidsActiveAgeBand(ageBandRaw)) return apiError(c, 400, 'invalid_request');
  const ageBand = ageBandRaw && isKidsActiveAgeBand(ageBandRaw) ? ageBandRaw : null;
  const topicParam = c.req.query('topic');
  if (topicParam && !isKidsTopic(topicParam)) return apiError(c, 400, 'invalid_request');
  const topic = topicParam && isKidsTopic(topicParam) ? topicParam : null;
  const limitRaw = Number(c.req.query('limit') ?? 50);
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, 50) : 50;
  const cursorRaw = c.req.query('cursor');
  const cursor = decodeCatalogCursor(cursorRaw);
  if (cursorRaw !== undefined && !cursor) return apiError(c, 400, 'invalid_request');

  let snapshot: KidsBrowseSnapshot;
  let staffChannels: Set<string>;
  try {
    [snapshot, staffChannels] = await Promise.all([getOrBuildBrowseSnapshot(c, db), loadStaffChannelIds(db)]);
  } catch (err) {
    logger.warn('[KidsCatalog] Snapshot build failed', { error: err instanceof Error ? err.message : String(err) });
    return apiError(c, 503, 'service_unavailable');
  }

  const bands = matchingKidsAgeBands(ageBand);
  const matching: Array<{
    id: string;
    playlistId: string;
    ageBand: KidsAgeBand;
    topics: KidsTopic[];
    position: number;
    approvedAt: string;
    item: Record<string, unknown>;
  }> = [];

  const candidates = snapshot.entries.filter(
    (entry): entry is SnapshotPlaylistEntry =>
      entry.targetType === 'playlist' &&
      bands.includes(entry.ageBand) &&
      (!topic || entry.topics.includes(topic)) &&
      (!cursor || compareCatalogRows(entry, { position: cursor.pos, approvedAt: cursor.at, id: cursor.id }) > 0) &&
      entry.videos.some((v) => bands.includes(v.ageBand)),
  );

  for (let i = 0; i < candidates.length && matching.length <= limit; i += 25) {
    const live = await verifySnapshotCandidates(c, db, candidates.slice(i, i + 25), bands, staffChannels);
    for (const { entry, item } of live) {
      matching.push({
        id: entry.id,
        playlistId: entry.targetId,
        ageBand: entry.ageBand,
        topics: entry.topics,
        position: entry.position,
        approvedAt: entry.approvedAt,
        item,
      });
      if (matching.length > limit) break;
    }
  }

  let tailCursorForMore: CatalogCursor | null = null;
  if (matching.length <= limit && !snapshot.exhausted && snapshot.cutoff) {
    let waveCursor: CatalogCursor =
      cursor &&
      compareCatalogRows(
        { position: cursor.pos, approvedAt: cursor.at, id: cursor.id },
        { position: snapshot.cutoff.pos, approvedAt: snapshot.cutoff.at, id: snapshot.cutoff.id },
      ) > 0
        ? cursor
        : snapshot.cutoff;
    for (let round = 0; round < MAX_TAIL_ROUNDS && matching.length <= limit; round++) {
      const { rows, cutoffRow } = await fetchOrderedCatalogBranches(db, ['playlist'], bands, TAIL_BRANCH_LIMIT, waveCursor);
      const bounded = cutoffRow ? rows.filter((r) => compareCatalogRows(r, cutoffRow) <= 0) : rows;
      const filteredRows = bounded.filter((r) => !topic || parseKidsTopicsJson(r.topics_json).includes(topic));
      const entries = await buildEntriesFromRows(c, db, filteredRows, staffChannels);
      for (const entry of entries) {
        if (entry.targetType !== 'playlist' || !bands.includes(entry.ageBand)) continue;
        const bandVideos = entry.videos.filter((v) => bands.includes(v.ageBand));
        if (bandVideos.length === 0) continue;
        matching.push({
          id: entry.id,
          playlistId: entry.targetId,
          ageBand: entry.ageBand,
          topics: entry.topics,
          position: entry.position,
          approvedAt: entry.approvedAt,
          item: sanitizeKidsPlaylistPayload(entry.rawPlaylist, bandVideos),
        });
        if (matching.length > limit) break;
      }
      if (!cutoffRow) {
        tailCursorForMore = null;
        break;
      }
      waveCursor = toCursor(cutoffRow);
      tailCursorForMore = waveCursor;
    }
  }

  const hasMore = matching.length > limit || tailCursorForMore !== null;
  const page = matching.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = !hasMore
    ? null
    : last
      ? btoa(JSON.stringify({ pos: last.position, at: last.approvedAt, id: last.id }))
      : tailCursorForMore
        ? btoa(JSON.stringify(tailCursorForMore))
        : null;

  c.header('Cache-Control', `public, max-age=${EDGE_CACHE_TTL_SECONDS}`);
  return c.json({
    success: true,
    items: page.map(({ approvedAt: _a, ...rest }) => rest),
    hasMore,
    nextCursor,
  });
});

kidsRouter.get('/playlists/:id', async (c: C) => {
  const db = c.env.SEARCH_DB as unknown as SearchDb | undefined;
  if (!db) return apiError(c, 503, 'search_unavailable');

  const ageBandRaw = c.req.query('ageBand');
  if (ageBandRaw && !isKidsActiveAgeBand(ageBandRaw)) return apiError(c, 400, 'invalid_request');
  const ageBand = ageBandRaw && isKidsActiveAgeBand(ageBandRaw) ? ageBandRaw : null;
  const bands = matchingKidsAgeBands(ageBand);

  const playlistId = c.req.param('id').trim();
  if (!playlistId) return apiError(c, 400, 'invalid_request');

  const cacheKeyUrl = `https://kids-cache.internal/playlist?env=${encodeURIComponent(kidsCacheEnvironment(c.env))}&id=${encodeURIComponent(playlistId)}&ageBand=${encodeURIComponent(ageBand ?? 'all')}`;

  return withEdgeCache(c, cacheKeyUrl, async () => {
    const [staffChannels, catalogRow] = await Promise.all([
      loadStaffChannelIds(db),
      db
        .prepare(
          `SELECT id, target_type, target_id, age_band, status, topics_json, position, approved_at
           FROM kids_catalog_items
           WHERE target_type = 'playlist' AND target_id = ? AND status = 'approved' AND age_band IN (${bands.map(() => '?').join(', ')})`,
        )
        .bind(playlistId, ...bands)
        .first<CatalogRow>(),
    ]);
    if (!catalogRow) {
      c.header('Cache-Control', 'public, max-age=30');
      return apiError(c, 404, 'not_found');
    }

    const playlists = await hydrateStaffPlaylists(db, [playlistId], staffChannels);
    const playlistEntry = playlists.get(playlistId);
    if (!playlistEntry) {
      c.header('Cache-Control', 'public, max-age=30');
      return apiError(c, 404, 'not_found');
    }

    let playlistVideosMap: Map<string, Array<{ videoId: string; ageBand: KidsAgeBand; video: Record<string, unknown> }>>;
    try {
      playlistVideosMap = await resolvePlaylistVideos(c, db, new Map([[playlistId, playlistEntry]]), bands);
    } catch {
      return apiError(c, 503, 'service_unavailable');
    }

    const approvedList = playlistVideosMap.get(playlistId) ?? [];
    const items = approvedList.map((entry, position) => ({
      position,
      videoId: entry.videoId,
      video: entry.video,
    }));

    return c.json(
      {
        success: true,
        playlist: {
          id: catalogRow.id,
          playlistId,
          ageBand: catalogRow.age_band,
          topics: parseKidsTopicsJson(catalogRow.topics_json),
          position: Number(catalogRow.position) || 0,
          item: sanitizeKidsPlaylistPayload(
            playlistEntry.payload,
            approvedList.map((entry) => ({ coverUrl: videoCoverUrl(entry.video) })),
          ),
        },
        items,
      },
      200,
      { 'Cache-Control': `public, max-age=${EDGE_CACHE_TTL_SECONDS}` },
    );
  });
});

export async function handleStudioKidsReviewRequest(c: C): Promise<Response> {
  const userId = c.get('userId') as string | undefined;
  if (!userId) return apiError(c, 401, 'authentication_required');

  const channelId = c.req.param('channelId')?.trim() ?? '';
  if (!channelId) return apiError(c, 400, 'invalid_request');

  const role = await roleOnChannel(c.env as never, channelId, userId);
  if (!can(role, 'channel.edit') && !can(role, 'video.edit')) {
    return apiError(c, 403, 'forbidden');
  }

  const db = c.env.SEARCH_DB as unknown as SearchDb | undefined;
  if (!db) return apiError(c, 503, 'service_unavailable');

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError(c, 400, 'invalid_request');
  if (body.targetType !== 'video') {
    return apiError(c, 400, 'invalid_request');
  }
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId || targetId.length > 128) return apiError(c, 400, 'invalid_request');

  const suggestedAgeBand = body.suggestedAgeBand ?? 'all';
  if (!isKidsAgeBand(suggestedAgeBand)) return apiError(c, 400, 'invalid_request');
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null;

  const row = await db
    .prepare('SELECT channel_id, visible FROM search_videos WHERE id = ?')
    .bind(targetId)
    .first<{ channel_id: string | null; visible: number }>();
  if (!row) return apiError(c, 404, 'video_not_found');
  if (row.channel_id !== channelId) return apiError(c, 403, 'forbidden');
  if (Number(row.visible) !== 1) return apiError(c, 400, 'invalid_request');

  const id = `krev_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO kids_review_requests (id, target_type, target_id, channel_id, requested_by, suggested_age_band, notes, status, created_at)
         VALUES (?, 'video', ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .bind(id, targetId, channelId, userId, suggestedAgeBand, notes, now)
      .run();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('UNIQUE constraint failed')) return apiError(c, 409, 'kids_review_pending');
    logger.error('[KidsReview] Failed to insert review request', { channelId, targetId, error: msg });
    throw error;
  }

  return c.json(
    {
      success: true,
      request: {
        id,
        targetType: 'video',
        targetId,
        channelId,
        suggestedAgeBand,
        notes,
        status: 'pending',
        createdAt: now,
      },
    },
    201,
  );
}
