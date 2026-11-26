import { Num, Str } from "../../lib/chanfana-params";
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from "../../base";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { AnalyticsVideo, daysInRange, parseRange, type RollupSources, type DateRange, type MonthlyRollup } from "../../lib/analytics";
import { apiError } from "../../lib/api-error";
import R2Repository from "../../lib/r2Repo";
import { channelContentIds } from "../../lib/search/ownership";
import { healLater, rebuilding, requireContentAccess, healRows } from "./channelContent";

const MAX_PAGE = 50;
/** Max published videos of a single channel ranked per request (bounded indexed read). */
const MAX_RANKED_VIDEOS = 5000;
/** D1 allows 100 bound parameters per statement (90 video ids + 2 range dates = 92). */
const STATS_CHUNK_SIZE = 90;
// Legacy objects are drained by the processor. Keep the scan and matching reads
// bounded, with room for ownership healing and video reads for the returned page.
const LEGACY_VIDEO_PREFIX = "analytics/rollups/video/";
const MAX_LEGACY_LIST_PAGES = 4;
const MAX_LEGACY_READS = 400;
const LEGACY_READ_CONCURRENCY = 20;

type TopContentSort = "views" | "watchTime" | "avgViewDuration";

interface VideoRangeTotals {
	views: number;
	watchTime: number;
}

/** Find the candidate videos' existing monthly documents without probing missing keys. */
async function legacyRollupKeys(bucket: R2Bucket, videoIds: string[], days: string[]): Promise<Map<string, string> | null> {
	const months = new Set(days.map((day) => day.slice(0, 7)));
	const candidates = new Set(videoIds);
	const keys = new Map<string, string>();
	let cursor: string | undefined;
	for (let i = 0; i < MAX_LEGACY_LIST_PAGES; i++) {
		const page = await bucket.list({ prefix: LEGACY_VIDEO_PREFIX, limit: 1000, cursor });
		for (const { key } of page.objects) {
			const suffix = key.slice(LEGACY_VIDEO_PREFIX.length);
			const slash = suffix.lastIndexOf("/");
			if (slash < 0 || !suffix.endsWith(".json")) continue;
			const videoId = suffix.slice(0, slash);
			const month = suffix.slice(slash + 1, -5);
			if (!candidates.has(videoId) || !months.has(month)) continue;
			keys.set(key, videoId);
			if (keys.size > MAX_LEGACY_READS) return null;
		}
		if (!page.truncated) return keys;
		cursor = page.cursor;
	}
	return null;
}

/** Sum range metrics using D1 and any legacy documents the importer has yet to commit. */
async function loadRangeTotalsByVideo(
	env: RollupSources,
	videoIds: string[],
	range: DateRange,
): Promise<Map<string, VideoRangeTotals> | null> {
	const totals = new Map<string, VideoRangeTotals>();
	if (videoIds.length === 0) return totals;

	const days = daysInRange(range);
	const daySet = new Set(days);
	const bucket = env.analytics_rollups;
	const legacy = new Map<string, { videoId: string; views: number; watchTime: number }>();
	if (bucket) {
		const matching = await legacyRollupKeys(bucket, videoIds, days);
		if (!matching) return null;
		const keys = [...matching];
		for (let i = 0; i < keys.length; i += LEGACY_READ_CONCURRENCY) {
			await Promise.all(keys.slice(i, i + LEGACY_READ_CONCURRENCY).map(async ([key, videoId]) => {
				const object = await bucket.get(key);
				if (!object) return; // The importer may have moved it into D1 since the list.
				const rollup = await object.json<MonthlyRollup>();
				let views = 0;
				let watchTime = 0;
				for (const [day, entry] of Object.entries(rollup?.days || {})) {
					if (!daySet.has(day)) continue;
					views += entry.views || 0;
					watchTime += entry.watchTime || 0;
				}
				legacy.set(key, { videoId, views, watchTime });
			}));
		}
	}

	const db = env.NOTIFICATIONS_DB;
	const imported = new Set<string>();
	if (db) {
		const counters: D1PreparedStatement[] = [];
		const markers: D1PreparedStatement[] = [];
		for (let i = 0; i < videoIds.length; i += STATS_CHUNK_SIZE) {
			const chunk = videoIds.slice(i, i + STATS_CHUNK_SIZE);
			counters.push(db.prepare(
				`SELECT entity_id, metric, SUM(value) AS total
				 FROM analytics_daily
				 WHERE entity_type = 'video'
				   AND entity_id IN (${chunk.map(() => "?").join(", ")})
				   AND day BETWEEN ? AND ?
				   AND metric IN ('views', 'watch_time')
				 GROUP BY entity_id, metric`,
			).bind(...chunk, days[0], days[days.length - 1]));
		}
		const keys = [...legacy.keys()];
		for (let i = 0; i < keys.length; i += STATS_CHUNK_SIZE) {
			const chunk = keys.slice(i, i + STATS_CHUNK_SIZE);
			markers.push(db.prepare(
				`SELECT r2_key FROM analytics_rollup_imports WHERE r2_key IN (${chunk.map(() => "?").join(", ")})`,
			).bind(...chunk));
		}
		// Read both from one D1 snapshot after reading R2. The importer commits
		// the marker and counters together, then deletes the legacy object.
		type Counter = { entity_id: string; metric: "views" | "watch_time"; total: number };
		type ImportMarker = { r2_key: string };
		const pages = await db.batch<Counter | ImportMarker>([...counters, ...markers]);
		for (const { results } of pages) {
			for (const row of results) {
				if ("r2_key" in row) {
					imported.add(row.r2_key);
					continue;
				}
				const entry = totals.get(row.entity_id) ?? { views: 0, watchTime: 0 };
				if (row.metric === "views") entry.views += row.total;
				else entry.watchTime += row.total;
				totals.set(row.entity_id, entry);
			}
		}
	}

	for (const [key, { videoId, views, watchTime }] of legacy) {
		if (imported.has(key)) continue;
		const entry = totals.get(videoId) ?? { views: 0, watchTime: 0 };
		entry.views += views;
		entry.watchTime += watchTime;
		totals.set(videoId, entry);
	}
	return totals;
}

/**
 * GET /api/channels/:id/analytics/top-content: the channel's published videos,
 * ranked by their metrics within the selected date range (views by default, or
 * watchTime / avgViewDuration), with lifetime views as tie-breaker (#849).
 * R2 video objects are only read for the single returned page.
 */
export class ChannelTopContent extends AuthenticatedRoute {
	schema = {
		tags: ["Analytics"],
		summary: "A channel's top content",
		request: {
			params: z.object({ id: Str({ description: "Channel id" }) }),
			query: z.object({
				dateFrom: z.string().optional(),
				dateTo: z.string().optional(),
				tz: z.string().max(64).optional().describe("The viewer's IANA time zone; the default end date follows it"),
				sort: z.enum(["views", "watchTime", "avgViewDuration"]).optional(),
				limit: Num({ required: false, default: 20 }),
				cursor: z.string().regex(/^\d+$/).optional(),
			}),
		},
		responses: {
			"200": {
				description: "Videos and the cursor of the next page",
				content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ items: z.array(z.record(z.string(), z.unknown())), cursor: z.string().nullable() }) }) } },
			},
			"403": { description: "No access", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Channel not found", content: { "application/json": { schema: ResponseError } } },
			"503": { description: "The index is unavailable or the legacy analytics read budget was exceeded", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const denied = await requireContentAccess(c, params.id, this.getUserId(c) as string);
		if (denied) return denied;
		const rowsReady = await healRows(c, params.id);

		const limit = Math.min(Math.max(1, query.limit ?? 20), MAX_PAGE);
		const offset = Number(query.cursor ?? 0);
		const sort: TopContentSort = query.sort ?? "views";
		const read = await channelContentIds(c.env as never, {
			channelId: params.id,
			status: "published",
			sort: "views",
			limit: MAX_RANKED_VIDEOS,
			offset: 0,
		});
		if (!read) return rebuilding(c);
		const allIds = read.value;
		const indexComplete = rowsReady && read.complete;
		if (!indexComplete) healLater(c);

		const range = parseRange(query.dateFrom, query.dateTo, undefined, query.tz);
		const statsByVideo = await loadRangeTotalsByVideo(c.env, allIds, range);
		if (!statsByVideo) return apiError(c, 503, "analytics_rollup_budget_exceeded", { error: "analytics_rollup_budget_exceeded" });

		const ranked = allIds.map((id, lifetimeRank) => {
			const raw = statsByVideo.get(id) ?? { views: 0, watchTime: 0 };
			const views = raw.views;
			const watchTime = Math.round(raw.watchTime);
			const avgViewDuration = views > 0 ? Math.round(raw.watchTime / views) : 0;
			return { id, lifetimeRank, views, watchTime, avgViewDuration };
		});
		ranked.sort((a, b) => {
			if (sort === "watchTime") return b.watchTime - a.watchTime || b.views - a.views || a.lifetimeRank - b.lifetimeRank;
			if (sort === "avgViewDuration") return b.avgViewDuration - a.avgViewDuration || b.views - a.views || a.lifetimeRank - b.lifetimeRank;
			return b.views - a.views || b.watchTime - a.watchTime || a.lifetimeRank - b.lifetimeRank;
		});

		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(c.env.videos);
		const page = ranked.slice(offset, offset + limit);
		const items = (await Promise.all(page.map(async (entry) => {
			const video = await repository.getObject(entry.id);
			if (!video) return null;
			return {
				videoId: video.id,
				title: video.title,
				// The page shows the title in the UI language (AUDIT r6)
				...((video as { titleLocalized?: Record<string, string> }).titleLocalized ? { titleLocalized: (video as { titleLocalized?: Record<string, string> }).titleLocalized } : {}),
				thumbnailUrl: (video as AnalyticsVideo).thumbnailUrl,
				isPublic: video.isPublic !== false,
				views: entry.views,
				watchTime: entry.watchTime,
				avgViewDuration: entry.avgViewDuration,
			};
		}))).filter(Boolean);

		return {
			success: true,
			result: {
				items,
				cursor: offset + limit < ranked.length ? String(offset + limit) : null,
				indexComplete,
			},
		};
	}
}
