/**
 * Ranked queries over the D1 FTS5 search index (Story 29.8).
 *
 * Relevance = FTS5 bm25 (title weighted 10x body) minus a log-scaled
 * popularity prior stored on each row (lower is better, as with bm25).
 * Results from several entity types are merged by score.
 */

import {
  SEARCH_DATE_WINDOWS_MS,
  SEARCH_DURATION_BOUNDS,
  SEARCH_ENTITY_TYPES,
  SEARCH_TABLES,
  DEFAULT_SUGGESTION_TYPES,
  SUGGESTION_GROUP_ORDER,
  SearchChannelInfo,
  SearchChannelPayload,
  SearchDb,
  SearchEntityType,
  SearchQuery,
  SearchResultItem,
  SearchPlaylistPayload,
  SearchStatement,
  SearchVideoPayload,
  SuggestionType,
  VIDEO_CATEGORIES,
  buildFtsQuery,
  detectTextLanguage,
  normalizeSearchText,
  rankSuggestions,
  scoreSuggestionMatch,
  tokenizeSearchText,
} from '@al-ummah/shared-types';

export const SEARCH_MAX_LIMIT = 50;
export const SEARCH_MAX_OFFSET = 500;

interface IndexRow {
  id: string;
  payload: string;
  created_at: number | null;
  views: number;
  rank: number;
  channel_payload: string | null;
}

/** Which entity types a filter applies to; other types are dropped when it is set. */
const FILTER_TYPES = {
  duration: ['video'],
  format: ['video'],
  category: ['video', 'channel'],
  channelId: ['video', 'playlist', 'post'],
} as const satisfies Record<string, ReadonlyArray<SearchEntityType>>;

export function searchTypesFor(query: SearchQuery): SearchEntityType[] {
  let types: SearchEntityType[] = query.type ? [query.type] : [...SEARCH_ENTITY_TYPES];
  if (query.duration) types = types.filter(t => (FILTER_TYPES.duration as ReadonlyArray<string>).includes(t));
  if (query.format) types = types.filter(t => (FILTER_TYPES.format as ReadonlyArray<string>).includes(t));
  if (query.category) types = types.filter(t => (FILTER_TYPES.category as ReadonlyArray<string>).includes(t));
  if (query.channelId) types = types.filter(t => (FILTER_TYPES.channelId as ReadonlyArray<string>).includes(t));
  return types;
}

export function encodeCursor(offset: number): string {
  return `o${offset}`;
}

export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  const match = /^o(\d{1,4})$/.exec(cursor);
  return match ? Math.min(Number(match[1]), SEARCH_MAX_OFFSET) : 0;
}

function parseJson<T>(text: string | null): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * Build the SELECT for one entity type. `match` null = browse mode (no text query).
 */
export function buildTypeStatement(
  db: SearchDb,
  type: SearchEntityType,
  query: SearchQuery,
  match: string | null,
  take: number,
  offset: number,
  now: number,
): SearchStatement {
  const { base, fts } = SEARCH_TABLES[type];
  const where: string[] = [];
  const binds: unknown[] = [];
  let from: string;
  let rank: string;

  if (match) {
    from = `${fts} JOIN ${base} d ON d.rowid = ${fts}.rowid`;
    where.push(`${fts} MATCH ?`);
    binds.push(match);
    rank = `(bm25(${fts}, 10.0, 2.0) - d.popularity)`;
  } else {
    from = `${base} d`;
    rank = '(0 - d.popularity)';
  }
  from += ' LEFT JOIN search_channels c ON c.id = d.channel_id';
  where.push('d.visible = 1', '(c.id IS NULL OR c.visible = 1)');

  if (query.language) {
    where.push('d.language = ?');
    binds.push(query.language);
  }
  if (query.category) {
    where.push('d.category = ?');
    binds.push(query.category);
  }
  if (query.channelId) {
    where.push('d.channel_id = ?');
    binds.push(query.channelId);
  }
  if (query.duration) {
    const bounds = SEARCH_DURATION_BOUNDS[query.duration];
    if (bounds.min !== undefined) {
      where.push('d.duration >= ?');
      binds.push(bounds.min);
    }
    if (bounds.max !== undefined) {
      where.push('d.duration < ?');
      binds.push(bounds.max);
    }
  }
  if (query.format && type === 'video') {
    // Shorts are never live; live streams are not long-form uploads either
    where.push(query.format === 'short' ? 'd.is_short = 1' : '(d.is_short = 0 AND d.is_live = 0)');
  }
  if (query.date) {
    where.push('d.created_at >= ?');
    binds.push(now - SEARCH_DATE_WINDOWS_MS[query.date]);
  }
  if (query.verified) {
    where.push('(d.is_verified = 1 OR c.is_verified = 1)');
  }

  const sort = query.sort ?? 'relevance';
  const orderBy = sort === 'date' || (sort === 'relevance' && !match)
    ? 'd.created_at DESC, d.rowid DESC'
    : sort === 'popular'
      ? 'd.views DESC, d.popularity DESC, d.rowid DESC'
      : 'rank ASC, d.rowid DESC';

  const sql = `SELECT d.id AS id, d.payload AS payload, d.created_at AS created_at, d.views AS views,
      ${rank} AS rank, c.payload AS channel_payload
    FROM ${from}
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`;
  binds.push(take, offset);
  return db.prepare(sql).bind(...binds);
}

function channelInfo(channelPayload: string | null): SearchChannelInfo | undefined {
  const channel = parseJson<{ id?: string; name?: string; avatarUrl?: string; isVerified?: boolean }>(channelPayload);
  if (!channel?.id) return undefined;
  return { id: channel.id, name: channel.name, avatarUrl: channel.avatarUrl, isVerified: channel.isVerified === true };
}

export function toResultItem(type: SearchEntityType, row: IndexRow): SearchResultItem | null {
  const score = Math.round(-Number(row.rank || 0) * 1000) / 1000;
  const channel = channelInfo(row.channel_payload);
  switch (type) {
    case 'video': {
      const video = parseJson<Extract<SearchResultItem, { type: 'video' }>['video']>(row.payload);
      if (!video) return null;
      if (channel) {
        video.channelName = channel.name ?? video.channelName;
        video.channelAvatarUrl = channel.avatarUrl ?? video.channelAvatarUrl;
      }
      return { type, id: row.id, score, video, channel };
    }
    case 'channel': {
      const payload = parseJson<Extract<SearchResultItem, { type: 'channel' }>['channel']>(row.payload);
      return payload ? { type, id: row.id, score, channel: payload } : null;
    }
    case 'playlist': {
      const playlist = parseJson<Extract<SearchResultItem, { type: 'playlist' }>['playlist']>(row.payload);
      return playlist ? { type, id: row.id, score, playlist, channel } : null;
    }
    case 'post': {
      const post = parseJson<Extract<SearchResultItem, { type: 'post' }>['post']>(row.payload);
      if (!post) return null;
      if (channel) {
        post.channelName = channel.name ?? post.channelName;
        post.channelAvatar = channel.avatarUrl ?? post.channelAvatar;
        post.channelVerified = channel.isVerified || post.channelVerified;
      }
      return { type, id: row.id, score, post, channel };
    }
  }
}

export interface IndexSearchResult {
  results: SearchResultItem[];
  hasMore: boolean;
  nextCursor: string | null;
  relaxed: boolean;
}

interface Ranked {
  item: SearchResultItem;
  createdAt: number;
  views: number;
}

async function runQuery(
  db: SearchDb,
  types: SearchEntityType[],
  query: SearchQuery,
  match: string | null,
  limit: number,
  offset: number,
  now: number,
): Promise<{ items: Ranked[]; hasMore: boolean }> {
  const single = types.length === 1;
  // A single type pages in SQL; several types are merged in memory from offset 0.
  const statements = types.map(type => buildTypeStatement(
    db, type, query, match,
    single ? limit + 1 : offset + limit + 1,
    single ? offset : 0,
    now,
  ));
  const batches = (await db.batch(statements)) as Array<{ results?: IndexRow[] }>;
  const ranked: Ranked[] = [];
  batches.forEach((batch, index) => {
    for (const row of batch.results ?? []) {
      const item = toResultItem(types[index], row);
      if (item) ranked.push({ item, createdAt: row.created_at ?? 0, views: row.views ?? 0 });
    }
  });

  if (single) {
    return { items: ranked.slice(0, limit), hasMore: ranked.length > limit };
  }
  const sort = query.sort ?? 'relevance';
  ranked.sort((a, b) => {
    if (sort === 'date' || (sort === 'relevance' && !match)) return b.createdAt - a.createdAt;
    if (sort === 'popular') return b.views - a.views;
    return b.item.score - a.item.score;
  });
  return { items: ranked.slice(offset, offset + limit), hasMore: ranked.length > offset + limit };
}

/**
 * Search the index. Without `q`, returns the newest (or most popular) items
 * matching the filters, which Explore uses for "new channels".
 */
export async function searchIndex(
  db: SearchDb,
  query: SearchQuery,
  options: { now?: number } = {},
): Promise<IndexSearchResult> {
  const now = options.now ?? Date.now();
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 20), 1), SEARCH_MAX_LIMIT);
  const offset = decodeCursor(query.cursor);
  const types = searchTypesFor(query);
  if (types.length === 0) return { results: [], hasMore: false, nextCursor: null, relaxed: false };

  const hasText = !!query.q && tokenizeSearchText(query.q).length > 0;
  const strict = hasText ? buildFtsQuery(query.q, { mode: 'all' }) : null;
  let { items, hasMore } = await runQuery(db, types, query, strict, limit, offset, now);
  let relaxed = false;

  // No result contains every word: fall back to results containing any word.
  if (hasText && items.length === 0 && offset === 0 && tokenizeSearchText(query.q).length > 1) {
    const loose = buildFtsQuery(query.q, { mode: 'any' });
    ({ items, hasMore } = await runQuery(db, types, query, loose, limit, offset, now));
    relaxed = items.length > 0;
  }

  return {
    results: items.map(r => r.item),
    hasMore,
    nextCursor: hasMore && offset + limit <= SEARCH_MAX_OFFSET ? encodeCursor(offset + limit) : null,
    relaxed,
  };
}

export interface IndexSuggestion {
  text: string;
  type: SuggestionType;
  id?: string;
  thumbnailUrl?: string;
  subtitle?: string;
  handle?: string;
  verified?: boolean;
  count?: number;
  metadata?: Record<string, unknown>;
}

export interface SuggestOptions {
  /** Which kinds to return (default: channels, videos, categories) */
  types?: SuggestionType[];
  /** Only videos and playlists of this channel (in-channel search) */
  channelId?: string;
  now?: number;
}

function pickLocalized(base: string, localized: Record<string, string> | undefined, lang: string | undefined): string {
  if (lang && localized?.[lang]) return localized[lang];
  return base;
}

/** The localized form that matches what was typed best, else the one in the query's script. */
function bestText(base: string, localized: Record<string, string> | undefined, q: string, lang: string | undefined): string {
  const candidates = [base, ...Object.values(localized ?? {})];
  let best = pickLocalized(base, localized, lang);
  let bestScore = scoreSuggestionMatch(best, q);
  for (const text of candidates) {
    const score = scoreSuggestionMatch(text, q);
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return best;
}

type RankedSuggestion = IndexSuggestion & { alt?: string[] };

function channelSuggestion(row: IndexRow, q: string, lang: string | undefined): RankedSuggestion[] {
  const channel = parseJson<SearchChannelPayload>(row.payload);
  if (!channel?.id) return [];
  const handle = channel.handle?.replace(/^@+/, '') || undefined;
  return [{
    text: q ? bestText(channel.name, channel.nameLocalized, q, lang) : channel.name,
    type: 'channel' as const,
    id: channel.id,
    thumbnailUrl: channel.avatarUrl,
    subtitle: handle ? `@${handle}` : undefined,
    handle,
    verified: channel.isVerified === true,
    count: channel.subscribersCount,
    metadata: { channelId: channel.id, avatarUrl: channel.avatarUrl },
    alt: handle ? [handle] : [],
  }];
}

function videoSuggestion(row: IndexRow, q: string, lang: string | undefined): RankedSuggestion[] {
  const video = parseJson<SearchVideoPayload>(row.payload);
  if (!video?.id) return [];
  const channel = channelInfo(row.channel_payload);
  return [{
    text: q ? bestText(video.title, video.titleLocalized, q, lang) : video.title,
    type: 'video' as const,
    id: video.id,
    thumbnailUrl: video.thumbnailUrl,
    subtitle: channel?.name ?? video.channelName,
    verified: channel?.isVerified === true,
    metadata: { videoId: video.id, channelId: video.channelId, isShort: video.isShort === true, duration: video.duration },
  }];
}

/** With a query: the playlist's name in whichever language matches it best (English, Arabic or the base). */
function playlistSuggestion(row: IndexRow, q = '', lang?: string): RankedSuggestion[] {
  const playlist = parseJson<SearchPlaylistPayload>(row.payload);
  if (!playlist?.id) return [];
  const channel = channelInfo(row.channel_payload);
  return [{
    text: q ? bestText(playlist.name, playlist.titleLocalized, q, lang) : pickLocalized(playlist.name, playlist.titleLocalized, lang),
    type: 'playlist' as const,
    id: playlist.id,
    thumbnailUrl: playlist.thumbnailUrl ?? playlist.cover?.thumbnailUrl,
    subtitle: channel?.name,
    count: playlist.videosCount,
    metadata: { playlistId: playlist.id, channelId: playlist.channelId },
  }];
}

/** Most of each kind in one response; videos fill whatever is left of `limit`. */
const GROUP_CAPS: Record<SuggestionType, number> = { channel: 3, playlist: 3, category: 2, query: 0, video: SEARCH_MAX_LIMIT };

/**
 * Typeahead suggestions from the search index: channel names (and @handles),
 * video titles and playlist names whose words start with the input, plus
 * matching categories. Only visible rows of visible channels are read, so
 * private, unlisted-by-channel, hidden and deleted items are never suggested.
 * Each group is ordered by match quality (exact > prefix > word prefix >
 * substring), then by the index's relevance.
 */
export async function suggestFromIndex(db: SearchDb, q: string, limit: number, options: SuggestOptions = {}): Promise<IndexSuggestion[]> {
  const types = options.types?.length ? options.types : DEFAULT_SUGGESTION_TYPES;
  const want = new Set(types.filter(t => !(options.channelId && (t === 'channel' || t === 'category'))));
  const match = buildFtsQuery(q, { mode: 'all', column: 'title' });
  if (!match) return [];
  const lang = detectTextLanguage(q);
  const now = options.now ?? Date.now();
  const scope: SearchQuery = options.channelId ? { channelId: options.channelId } : {};
  // Over-fetch a little so re-ranking by match quality has candidates to choose from
  const take = Math.min(limit * 2, SEARCH_MAX_LIMIT);

  const indexed = (['channel', 'video', 'playlist'] as const).filter(t => want.has(t));
  const batches = indexed.length
    ? (await db.batch(indexed.map(t => buildTypeStatement(db, t, scope, match, take, 0, now)))) as Array<{ results?: IndexRow[] }>
    : [];
  const rowsOf = (type: SuggestionType) => batches[indexed.indexOf(type as typeof indexed[number])]?.results ?? [];

  const groups = new Map<SuggestionType, IndexSuggestion[]>();
  const rank = (type: SuggestionType, items: Array<IndexSuggestion & { alt?: string[] }>) => {
    groups.set(type, rankSuggestions(items, q, s => s.text, { alternates: s => s.alt ?? [], keepUnmatched: true })
      .map(({ alt: _alt, ...s }) => s));
  };

  if (want.has('channel')) rank('channel', rowsOf('channel').flatMap(row => channelSuggestion(row, q, lang)));
  if (want.has('video')) rank('video', rowsOf('video').flatMap(row => videoSuggestion(row, q, lang)));
  if (want.has('playlist')) rank('playlist', rowsOf('playlist').flatMap(row => playlistSuggestion(row, q, lang)));
  if (want.has('category')) {
    const items = VIDEO_CATEGORIES.map(category => ({
      text: lang === 'ar' ? category.label.ar : category.label.en,
      type: 'category' as const,
      metadata: { category: category.value },
      alt: [category.label.ar, category.label.en],
    }));
    groups.set('category', rankSuggestions(items, q, s => s.text, { alternates: s => s.alt }).map(({ alt: _alt, ...s }) => s));
  }

  // De-duplicate across groups by normalised text + type, cap each group, then fill with videos.
  const seen = new Set<string>();
  const capped = new Map<SuggestionType, IndexSuggestion[]>();
  for (const type of SUGGESTION_GROUP_ORDER) {
    const list = (groups.get(type) ?? []).filter(s => {
      const key = `${s.type}:${s.id ?? normalizeSearchText(s.text)}`;
      if (!normalizeSearchText(s.text) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    capped.set(type, list.slice(0, type === 'video' ? limit : Math.min(GROUP_CAPS[type], limit)));
  }
  let total = [...capped.values()].reduce((n, list) => n + list.length, 0);
  // Over the limit: trim videos first, then the other groups from the end of the display order.
  for (const type of ['video', ...[...SUGGESTION_GROUP_ORDER].reverse().filter(t => t !== 'video')] as SuggestionType[]) {
    const list = capped.get(type) ?? [];
    while (total > limit && list.length > (type === 'video' ? Math.min(1, list.length) : 0)) {
      list.pop();
      total -= 1;
    }
  }
  return SUGGESTION_GROUP_ORDER.flatMap(type => capped.get(type) ?? []).slice(0, limit);
}

export interface InitialSuggestOptions {
  /** One kind for a picker; several are listed one after another */
  types?: SuggestionType[];
  /** Only this channel's videos and playlists (newest first) */
  channelId?: string;
  /** Rows to skip (the picker's next page) */
  offset?: number;
  now?: number;
}

/**
 * What a picker shows before anything is typed (owner rule 2026-11-11:
 * pickers open with content). Read from the search index, visible items of
 * visible channels only, each kind on an index and limited, never a scan:
 *   channel: most viewed channels (idx_search_channels_popular)
 *   video / playlist with channelId: that channel's newest (idx_search_*_channel_created)
 *   video without channelId: newest public videos (idx_search_videos_created)
 *   category: every category, in display order
 * Page with `offset`; a page shorter than `limit` is the last one.
 */
export async function initialSuggestionsFromIndex(db: SearchDb, limit: number, options: InitialSuggestOptions = {}): Promise<IndexSuggestion[]> {
  const types = (options.types?.length ? options.types : DEFAULT_SUGGESTION_TYPES)
    .filter(t => !(options.channelId && (t === 'channel' || t === 'category')));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const now = options.now ?? Date.now();
  const indexed = (['channel', 'video', 'playlist'] as const).filter(t => types.includes(t) && !(t === 'playlist' && !options.channelId));
  const statements = indexed.map(t => buildTypeStatement(db, t, {
    ...(options.channelId ? { channelId: options.channelId } : {}),
    sort: t === 'channel' ? 'popular' : 'date',
  }, null, limit, offset, now));
  const batches = statements.length ? (await db.batch(statements)) as Array<{ results?: IndexRow[] }> : [];
  const out: IndexSuggestion[] = [];
  for (const type of SUGGESTION_GROUP_ORDER) {
    const rows = batches[indexed.indexOf(type as typeof indexed[number])]?.results ?? [];
    if (type === 'channel' && indexed.includes('channel')) out.push(...rows.flatMap(row => channelSuggestion(row, '', undefined)));
    if (type === 'video' && indexed.includes('video')) out.push(...rows.flatMap(row => videoSuggestion(row, '', undefined)));
    if (type === 'playlist' && indexed.includes('playlist')) out.push(...rows.flatMap(row => playlistSuggestion(row)));
    if (type === 'category' && types.includes('category')) {
      out.push(...VIDEO_CATEGORIES.slice(offset, offset + limit).map(category => ({ text: category.label.en, type: 'category' as const, metadata: { category: category.value } })));
    }
  }
  return out.map(({ alt: _alt, ...s }: RankedSuggestion) => s);
}

/** Number of public videos per category (optionally in one language). */
export async function categoryCounts(db: SearchDb, language?: string): Promise<Map<string, number>> {
  const binds: unknown[] = [];
  let sql = `SELECT d.category AS category, COUNT(*) AS n FROM search_videos d
    LEFT JOIN search_channels c ON c.id = d.channel_id
    WHERE d.visible = 1 AND (c.id IS NULL OR c.visible = 1) AND d.category IS NOT NULL`;
  if (language) {
    sql += ' AND d.language = ?';
    binds.push(language);
  }
  sql += ' GROUP BY d.category';
  const statement = db.prepare(sql);
  const { results } = await (binds.length ? statement.bind(...binds) : statement).all<{ category: string; n: number }>();
  return new Map((results ?? []).map(r => [r.category, Number(r.n) || 0]));
}
