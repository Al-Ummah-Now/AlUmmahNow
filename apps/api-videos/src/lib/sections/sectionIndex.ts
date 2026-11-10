/**
 * Home sections (popular, recent, trending, by category) from the D1 search
 * index (docs/architecture/SCALABILITY-AUDIT.md, AV-15).
 *
 * `search_videos` holds one row per discoverable video (public, ready, not
 * removed; shared-types isVideoSearchable) with its views, creation time,
 * category, channel and a payload of display counters. A section page is one
 * indexed query for the page's ids plus one R2 get per video on the page, so
 * the cost no longer grows with the catalogue, and there is nothing to
 * rebuild on the request path (the old R2 indexes went stale every 15–30
 * minutes, and every visitor then scanned the bucket and started its own
 * rebuild, beyond the 1000-subrequest limit once the catalogue grew).
 *
 * Returns null when SEARCH_DB is not bound or the query fails; callers then
 * serve their stored R2 index, stale or not, or a single bounded page.
 */
import type { VideoObject } from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { isVideoPubliclyVisible } from '../visibility';
import { calculateTrendingScore, calculateViewVelocity, calculateEngagementVelocity } from '../trendingAlgorithm';
import { logger } from '../logger';

export type SectionSort = 'recent' | 'popular' | 'trending';
export type TrendingAlgorithm = 'velocity' | 'engagement' | 'hybrid';

export interface SectionQuery {
	sort: SectionSort;
	limit: number;
	offset: number;
	category?: string;
	channelId?: string;
	excludeChannels?: string[];
	/** Only videos created at or after this time (epoch ms) */
	since?: number;
	minViews?: number;
	algorithm?: TrendingAlgorithm;
}

export interface TrendingInfo {
	rank: number;
	score: number;
	viewsVelocity: number;
	engagementVelocity: number;
}

export interface SectionPage {
	/** Full video objects of the page, in order, publicly visible */
	videos: VideoObject[];
	/** Matching videos in the index (for trending: among the candidates) */
	total: number;
	/** Offset of the next page, when there is one */
	nextOffset?: number;
	/** Trending rank and score per video id (trending only) */
	trending?: Map<string, TrendingInfo>;
}

/** Candidates scored for trending: the newest and the most viewed videos (each up to this many). */
export const TRENDING_CANDIDATES = 200;
/** Page size bounds (the endpoints document 1–50): each video on a page is one R2 get. */
export const MAX_SECTION_LIMIT = 50;
/** Deepest offset served; beyond it a section is empty. */
export const MAX_SECTION_OFFSET = 10_000;
/** At most this many channels excluded in SQL (the query stays small). */
const MAX_EXCLUDED = 50;

interface Db {
	prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }>; first<T>(): Promise<T | null> } };
}

export function decodeOffset(cursor: string | undefined): number {
	if (!cursor) return 0;
	try {
		const offset = Number(JSON.parse(atob(cursor))?.offset);
		return Number.isInteger(offset) && offset > 0 ? offset : 0;
	} catch {
		return 0;
	}
}

export function encodeOffset(offset: number): string {
	return btoa(JSON.stringify({ offset }));
}

function filters(q: SectionQuery): { where: string; binds: unknown[] } {
	const clauses = ['visible = 1'];
	const binds: unknown[] = [];
	if (q.category) {
		clauses.push('category = ?');
		binds.push(q.category);
	}
	if (q.channelId) {
		clauses.push('channel_id = ?');
		binds.push(q.channelId);
	}
	const excluded = (q.excludeChannels ?? []).filter(Boolean).slice(0, MAX_EXCLUDED);
	if (excluded.length > 0) {
		clauses.push(`(channel_id IS NULL OR channel_id NOT IN (${excluded.map(() => '?').join(', ')}))`);
		binds.push(...excluded);
	}
	if (q.since !== undefined) {
		clauses.push('created_at >= ?');
		binds.push(q.since);
	}
	if (q.minViews && q.minViews > 0) {
		clauses.push('views >= ?');
		binds.push(q.minViews);
	}
	return { where: clauses.join(' AND '), binds };
}

/** Ids of the page, in order, and the number of matches. */
async function pageIds(db: Db, q: SectionQuery): Promise<{ ids: string[]; total: number; trending?: Map<string, TrendingInfo> }> {
	const { where, binds } = filters(q);
	if (q.sort !== 'trending') {
		const order = q.sort === 'popular' ? 'views DESC, created_at DESC, id' : 'created_at DESC, id';
		const [rows, count] = await Promise.all([
			db.prepare(`SELECT id FROM search_videos WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, q.limit, q.offset).all<{ id: string }>(),
			db.prepare(`SELECT COUNT(*) AS n FROM search_videos WHERE ${where}`).bind(...binds).first<{ n: number }>(),
		]);
		return { ids: (rows.results ?? []).map((r) => r.id), total: Number(count?.n ?? 0) };
	}

	// Trending: score the newest and the most viewed candidates with the same formula as before
	const { results } = await db
		.prepare(
			`SELECT id, payload FROM (SELECT id, payload FROM search_videos WHERE ${where} ORDER BY created_at DESC LIMIT ?)
			 UNION
			 SELECT id, payload FROM (SELECT id, payload FROM search_videos WHERE ${where} ORDER BY views DESC LIMIT ?)`,
		)
		.bind(...binds, TRENDING_CANDIDATES, ...binds, TRENDING_CANDIDATES)
		.all<{ id: string; payload: string }>();
	const algorithm = q.algorithm ?? 'hybrid';
	const scored = (results ?? [])
		.map((row) => {
			let video: VideoObject;
			try {
				video = { ...(JSON.parse(row.payload) as VideoObject), id: row.id };
			} catch {
				return null;
			}
			return {
				id: row.id,
				score: calculateTrendingScore(video, algorithm),
				viewsVelocity: calculateViewVelocity(video),
				engagementVelocity: calculateEngagementVelocity(video),
			};
		})
		.filter((v): v is NonNullable<typeof v> => v !== null && v.score > 0)
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	const trending = new Map<string, TrendingInfo>();
	const page = scored.slice(q.offset, q.offset + q.limit);
	page.forEach((v, i) => trending.set(v.id, { rank: q.offset + i + 1, score: v.score, viewsVelocity: v.viewsVelocity, engagementVelocity: v.engagementVelocity }));
	return { ids: page.map((v) => v.id), total: scored.length, trending };
}

/**
 * A section page from the D1 search index, or null when it cannot be served
 * from there (SEARCH_DB not bound, query failed).
 */
export async function sectionFromIndex(env: { SEARCH_DB?: unknown; videos: R2Bucket }, q: SectionQuery): Promise<SectionPage | null> {
	const db = env.SEARCH_DB as Db | undefined;
	if (!db) return null;
	q = {
		...q,
		limit: Math.min(MAX_SECTION_LIMIT, Math.max(1, Math.trunc(q.limit) || 12)),
		offset: Math.min(MAX_SECTION_OFFSET, Math.max(0, Math.trunc(q.offset) || 0)),
	};
	let found: Awaited<ReturnType<typeof pageIds>>;
	try {
		found = await pageIds(db, q);
	} catch (error) {
		logger.warn('[Sections] Search index query failed; serving the stored index', { sort: q.sort, error: error instanceof Error ? error.message : String(error) });
		return null;
	}
	// The objects themselves come from R2 (the source of truth; the index row may lag a write)
	const repo = new R2Repository<VideoObject>(env.videos);
	const objects = await Promise.all(found.ids.map((id) => repo.getObject(id).catch(() => null)));
	const videos = objects.filter((v): v is VideoObject => isVideoPubliclyVisible(v) && (!q.category || v!.category === q.category));
	const end = q.offset + found.ids.length;
	return {
		videos,
		total: found.total,
		nextOffset: found.ids.length === q.limit && end < found.total ? end : undefined,
		trending: found.trending,
	};
}
