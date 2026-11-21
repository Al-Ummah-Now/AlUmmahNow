/**
 * GET /api/discovery/home — the home page's rails in one call (wiki E07 "Discovery ranking").
 *
 * The rails and their order come from the videos admin (discovery_home_rails; default:
 * featured, trending, new, popular, categories). Each rail is its ranked list's first
 * page. The home page never repeats itself: a video already shown in an earlier rail is
 * skipped, a rail whose heading an earlier rail already uses is left out (with no viewer
 * signal Trending and New can both read "New this week"; Popular and Featured can both
 * read "Featured"), and a rail with fewer than MIN_HOME_ITEMS videos is left out.
 */
import { z } from 'zod';
import { DISCOVERY_HOME_RAILS, type DiscoveryHomeRail } from '@al-ummah/shared-types';
import { PublicRoute, type AppContext } from '../../base';
import { Num, Str } from '../../lib/chanfana-params';
import { logger } from '../../lib/logger';
import { edgeCacheUrl, readEdgeCache, writeEdgeCache } from '../../lib/edge-cache';
import { waitUntilOf } from '../../lib/search/ownership';
import { FeedVideoFields, RailInfoSchema, feedItem } from '../../lib/ranking/sectionResponse';
import { railLabelFields, railPage, railScope, type RailPage } from '../../lib/ranking/serve';
import type { RailId } from '../../lib/ranking/job';

export const HOME_RAIL_KEYS = DISCOVERY_HOME_RAILS;
export type HomeRailKey = DiscoveryHomeRail;
export const DEFAULT_HOME_RAILS: readonly HomeRailKey[] = HOME_RAIL_KEYS;

const HOME_RAIL_ID: Record<Exclude<HomeRailKey, 'categories'>, RailId> = {
	featured: 'featured',
	trending: 'trending:week',
	new: 'new',
	popular: 'popular',
};

/** A rail with fewer videos than this stays off the home page. */
export const MIN_HOME_ITEMS = 4;
/** Category rails shown at most (the admin's category order). */
export const MAX_CATEGORY_RAILS = 4;
const HOME_TTL = 120;

const HomeRailSchema = z.object({
	key: z.enum(HOME_RAIL_KEYS).describe('The home rail (admin order)'),
	rail: z.string().describe('The ranked list behind it, for "See all": /api/videos/sections/* or /api/trending'),
	category: z.string().optional(),
	categoryLabel: z.object({ en: z.string(), ar: z.string() }).optional().describe("A category rail's heading per language"),
	info: RailInfoSchema,
	data: z.array(z.object(FeedVideoFields)),
	cursor: z.string().optional(),
});

interface Db {
	prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> }; all<T>(): Promise<{ results?: T[] }> };
}

/** The admin's order and on/off, or the default. */
export async function homeRailOrder(db: Db | undefined): Promise<HomeRailKey[]> {
	if (!db) return [...DEFAULT_HOME_RAILS];
	try {
		const { results = [] } = await db.prepare('SELECT rail, enabled FROM discovery_home_rails ORDER BY position, rail').all<{ rail: string; enabled: number }>();
		if (results.length === 0) return [...DEFAULT_HOME_RAILS];
		const known = results.filter((r) => (HOME_RAIL_KEYS as readonly string[]).includes(r.rail));
		return known.filter((r) => Number(r.enabled) === 1).map((r) => r.rail as HomeRailKey);
	} catch {
		return [...DEFAULT_HOME_RAILS];
	}
}

interface CategoryRow {
	value: string;
	label_en: string;
	label_ar: string;
}

async function categoryOrder(db: Db | undefined): Promise<CategoryRow[]> {
	if (!db) return [];
	try {
		const { results = [] } = await db.prepare('SELECT value, label_en, label_ar FROM video_categories WHERE retired = 0 ORDER BY position, value').all<CategoryRow>();
		return results;
	} catch {
		return [];
	}
}

export interface HomeRailOut {
	key: HomeRailKey;
	rail: RailId;
	category?: string;
	page: RailPage;
}

/** Pure: drop repeats (videos and headings) and thin rails, in order. */
export function dedupeHome(rails: HomeRailOut[], limit: number): Array<HomeRailOut & { videos: RailPage['entries'] }> {
	const seenVideos = new Set<string>();
	const seenLabels = new Set<string>();
	const out: Array<HomeRailOut & { videos: RailPage['entries'] }> = [];
	for (const r of rails) {
		// Category rails share the 'top' label: their heading is the category name
		const heading = r.key === 'categories' ? `cat:${r.category}` : r.page.meta.label;
		if (seenLabels.has(heading)) continue;
		const videos = r.page.entries.filter((e) => !seenVideos.has(e.video.id)).slice(0, limit);
		if (videos.length < MIN_HOME_ITEMS) continue;
		seenLabels.add(heading);
		for (const v of videos) seenVideos.add(v.video.id);
		out.push({ ...r, videos });
	}
	return out;
}

export class DiscoveryHome extends PublicRoute {
	schema = {
		tags: ['Video Sections'],
		summary: 'Home rails',
		description:
			'🔓 Public. The home page rails in the order set in the videos admin, each the first page of its ranked list (wiki E07 Discovery ranking). Rails never repeat a video or a heading, and thin rails are left out. `info.label` is the heading to show (with no viewer signal Trending reads new_this_week, Popular reads featured).',
		request: {
			query: z.object({
				language: z.enum(['ar', 'en']).optional().describe("Viewer's language: its videos rank higher (others stay)"),
				limit: Num({ description: 'Videos per rail (4-24)', default: 12 }).optional(),
				lang: Str({ description: 'Alias of language' }).optional(),
			}),
		},
		responses: {
			'200': {
				description: 'Home rails',
				content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ rails: z.array(HomeRailSchema) }) }) } },
			},
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const language = query.language ?? (query.lang === 'ar' || query.lang === 'en' ? query.lang : undefined);
		const limit = Math.min(24, Math.max(MIN_HOME_ITEMS, Math.trunc(Number(query.limit)) || 12));
		const cacheUrl = edgeCacheUrl(c.req.url, `discovery-home/${language ?? ''}/${limit}`);
		const cached = await readEdgeCache<unknown>(cacheUrl);
		if (cached) {
			c.header('Cache-Control', `public, max-age=${HOME_TTL}`);
			return c.json(cached as never);
		}
		const db = c.env.SEARCH_DB as unknown as Db | undefined;
		const order = await homeRailOrder(db);
		const scope = railScope({ language });
		// Read a little more than a rail shows: earlier rails may take some of its videos
		const read = limit + 8;
		const wanted: Array<{ key: HomeRailKey; rail: RailId; category?: string; scope: string }> = [];
		const categoryLabels = new Map<string, { en: string; ar: string }>();
		for (const key of order) {
			if (key !== 'categories') {
				wanted.push({ key, rail: HOME_RAIL_ID[key], scope });
			} else {
				for (const row of (await categoryOrder(db)).slice(0, MAX_CATEGORY_RAILS * 3)) {
					categoryLabels.set(row.value, { en: row.label_en, ar: row.label_ar });
					wanted.push({ key, rail: 'top', category: row.value, scope: railScope({ category: row.value }) });
				}
			}
		}
		const pages = await Promise.all(wanted.map((w) => railPage(c.env as never, { rail: w.rail, scope: w.scope, limit: read }).catch(() => null)));
		const found: HomeRailOut[] = [];
		wanted.forEach((w, i) => {
			const page = pages[i];
			if (page) found.push({ key: w.key, rail: w.rail, category: w.category, page });
		});
		let categories = 0;
		const rails = dedupeHome(found, limit)
			.filter((r) => r.key !== 'categories' || ++categories <= MAX_CATEGORY_RAILS)
			.map((r) => ({
				key: r.key,
				rail: r.rail,
				...(r.category ? { category: r.category, categoryLabel: categoryLabels.get(r.category) } : {}),
				info: railLabelFields(r.page.meta),
				data: r.videos.map((e) => feedItem(e.video as never)),
				...(r.page.nextCursor ? { cursor: r.page.nextCursor } : {}),
			}));
		const body = { success: true, data: { rails } };
		if (rails.length) writeEdgeCache(cacheUrl, body, HOME_TTL, waitUntilOf(c as never));
		else logger.debug('[Discovery] Home has no rails yet (no ranking run)');
		c.header('Cache-Control', `public, max-age=${HOME_TTL}`);
		return c.json(body);
	}
}
