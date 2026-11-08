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
  SearchChannelInfo,
  SearchDb,
  SearchEntityType,
  SearchQuery,
  SearchResultItem,
  SearchStatement,
  VIDEO_CATEGORIES,
  buildFtsQuery,
  detectTextLanguage,
  normalizeSearchText,
  stripArabicArticle,
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
  category: ['video', 'channel'],
  channelId: ['video', 'playlist', 'post'],
} as const satisfies Record<string, ReadonlyArray<SearchEntityType>>;

export function searchTypesFor(query: SearchQuery): SearchEntityType[] {
  let types: SearchEntityType[] = query.type ? [query.type] : [...SEARCH_ENTITY_TYPES];
  if (query.duration) types = types.filter(t => (FILTER_TYPES.duration as ReadonlyArray<string>).includes(t));
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
  type: 'query' | 'channel' | 'category' | 'video';
  count?: number;
  metadata?: Record<string, unknown>;
}

function pickLocalized(base: string, localized: Record<string, string> | undefined, lang: string | undefined): string {
  if (lang && localized?.[lang]) return localized[lang];
  return base;
}

/**
 * Typeahead suggestions: channel names, video titles (in the query's script
 * when a localized title exists) and categories whose label starts with the input.
 */
export async function suggestFromIndex(db: SearchDb, q: string, limit: number): Promise<IndexSuggestion[]> {
  const match = buildFtsQuery(q, { mode: 'all', column: 'title' });
  if (!match) return [];
  const lang = detectTextLanguage(q);
  const empty: SearchQuery = {};
  const [videoRows, channelRows] = (await db.batch([
    buildTypeStatement(db, 'video', empty, match, limit, 0, Date.now()),
    buildTypeStatement(db, 'channel', empty, match, Math.min(limit, 3), 0, Date.now()),
  ])) as Array<{ results?: IndexRow[] }>;

  const suggestions: IndexSuggestion[] = [];
  const seen = new Set<string>();
  const add = (s: IndexSuggestion) => {
    const key = normalizeSearchText(s.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    suggestions.push(s);
  };

  for (const row of channelRows.results ?? []) {
    const channel = parseJson<{ id: string; name: string; nameLocalized?: Record<string, string>; avatarUrl?: string; subscribersCount?: number }>(row.payload);
    if (channel) {
      add({
        text: pickLocalized(channel.name, channel.nameLocalized, lang),
        type: 'channel',
        count: channel.subscribersCount,
        metadata: { channelId: channel.id, avatarUrl: channel.avatarUrl },
      });
    }
  }
  for (const row of videoRows.results ?? []) {
    const video = parseJson<{ id: string; title: string; titleLocalized?: Record<string, string>; channelId?: string }>(row.payload);
    if (video) {
      add({
        text: pickLocalized(video.title, video.titleLocalized, lang),
        type: 'video',
        metadata: { videoId: video.id, channelId: video.channelId },
      });
    }
  }
  const nq = normalizeSearchText(q);
  for (const category of VIDEO_CATEGORIES) {
    const label = lang === 'ar' ? category.label.ar : category.label.en;
    const words = tokenizeSearchText(label);
    if (normalizeSearchText(label).startsWith(nq) || words.some(w => w.startsWith(nq) || stripArabicArticle(w).startsWith(nq))) {
      add({ text: label, type: 'category', metadata: { category: category.value } });
    }
  }
  return suggestions.slice(0, limit);
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
