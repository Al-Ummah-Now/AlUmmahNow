/**
 * Names for the admin queues, from the search index (SEARCH_DB, owned by
 * api-videos): profiles, channels and videos in content_ownership (admin
 * columns), video comments in admin_comments, community posts in
 * search_posts. The queues store ids only (no content copies, so erasure and
 * edits apply at once); a page's names come from one batch per page, never one
 * call per row, and the queue search turns a typed name into ids the same way.
 *
 * Without SEARCH_DB (or if it fails) the maps are empty and rows fall back to
 * what the queue itself stores (an email), so a queue never fails over names.
 */
import type { D1Database } from '../types';
import { logger } from '../logger';
import { clip, likePattern } from './common';

export interface NameRefs {
  profiles?: Iterable<string | null | undefined>;
  channels?: Iterable<string | null | undefined>;
  videos?: Iterable<string | null | undefined>;
  comments?: Iterable<string | null | undefined>;
  posts?: Iterable<string | null | undefined>;
}

export type NameKind = keyof NameRefs;
export type NameMaps = Record<NameKind, Map<string, string>>;

const KINDS: NameKind[] = ['profiles', 'channels', 'videos', 'comments', 'posts'];

/** Ids (or matches) per kind, at most this many (bounded json_each lists). */
export const MAX_IDS = 200;

const SQL: Record<NameKind, string> = {
  profiles: `SELECT id, COALESCE(NULLIF(admin_title, ''), NULLIF(handle, ''), email) AS name FROM content_ownership WHERE kind = 'profile' AND id IN (SELECT value FROM json_each(?))`,
  channels: `SELECT id, COALESCE(NULLIF(admin_title, ''), handle) AS name FROM content_ownership WHERE kind = 'channel' AND id IN (SELECT value FROM json_each(?))`,
  videos: `SELECT id, admin_title AS name FROM content_ownership WHERE kind = 'video' AND id IN (SELECT value FROM json_each(?))`,
  comments: `SELECT comment_id AS id, text AS name FROM admin_comments WHERE comment_id IN (SELECT value FROM json_each(?))`,
  posts: `SELECT id, json_extract(payload, '$.content') AS name FROM search_posts WHERE id IN (SELECT value FROM json_each(?))`,
};

const emptyMaps = (): NameMaps => ({ profiles: new Map(), channels: new Map(), videos: new Map(), comments: new Map(), posts: new Map() });

const unique = (ids: Iterable<string | null | undefined> | undefined) => [...new Set([...(ids ?? [])].filter((x): x is string => !!x))].slice(0, MAX_IDS);

/** Display names (or the clipped text, for comments and posts) of the given ids, one D1 batch. */
export async function resolveNames(search: D1Database | undefined, refs: NameRefs): Promise<NameMaps> {
  const maps = emptyMaps();
  if (!search) return maps;
  const wanted = KINDS.map((kind) => ({ kind, ids: unique(refs[kind]) })).filter((k) => k.ids.length > 0);
  if (wanted.length === 0) return maps;
  try {
    const results = await search.batch(wanted.map(({ kind, ids }) => search.prepare(SQL[kind]).bind(JSON.stringify(ids))));
    wanted.forEach(({ kind }, i) => {
      for (const row of ((results[i] as { results?: { id: string; name: string | null }[] }).results ?? [])) {
        const name = clip(row.name);
        if (name) maps[kind].set(row.id, name);
      }
    });
  } catch (error) {
    logger.warn('[Queues] Names unavailable from the search index', { kinds: wanted.map((w) => w.kind), error: error instanceof Error ? error.message : String(error) });
  }
  return maps;
}

export type IdMatches = Record<NameKind, string[]>;

const MATCH_SQL: Record<NameKind, string> = {
  profiles: `SELECT id FROM content_ownership WHERE kind = 'profile' AND (lower(admin_title) LIKE ?1 ESCAPE '\\' OR lower(handle) LIKE ?1 ESCAPE '\\' OR lower(email) LIKE ?1 ESCAPE '\\') LIMIT ?2`,
  channels: `SELECT id FROM content_ownership WHERE kind = 'channel' AND (lower(admin_title) LIKE ?1 ESCAPE '\\' OR lower(handle) LIKE ?1 ESCAPE '\\') LIMIT ?2`,
  videos: `SELECT id FROM content_ownership WHERE kind = 'video' AND lower(admin_title) LIKE ?1 ESCAPE '\\' LIMIT ?2`,
  comments: `SELECT comment_id AS id FROM admin_comments WHERE lower(text) LIKE ?1 ESCAPE '\\' LIMIT ?2`,
  posts: `SELECT id FROM search_posts WHERE lower(json_extract(payload, '$.content')) LIKE ?1 ESCAPE '\\' LIMIT ?2`,
};

/**
 * Ids whose name or text matches `q` (up to MAX_IDS per kind), one D1 batch:
 * the queue search then matches its own rows by these ids.
 */
export async function matchIds(search: D1Database | undefined, q: string, kinds: NameKind[] = KINDS): Promise<IdMatches> {
  const out: IdMatches = { profiles: [], channels: [], videos: [], comments: [], posts: [] };
  const term = q.trim();
  if (!search || !term || kinds.length === 0) return out;
  const pattern = likePattern(term);
  try {
    const results = await search.batch(kinds.map((kind) => search.prepare(MATCH_SQL[kind]).bind(pattern, MAX_IDS)));
    kinds.forEach((kind, i) => {
      out[kind] = ((results[i] as { results?: { id: string }[] }).results ?? []).map((r) => r.id);
    });
  } catch (error) {
    logger.warn('[Queues] Name search unavailable on the search index', { kinds, error: error instanceof Error ? error.message : String(error) });
  }
  return out;
}
