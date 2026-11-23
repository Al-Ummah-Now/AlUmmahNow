import { Num, Str } from "../../lib/chanfana-params";
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from "../../base";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { AnalyticsVideo, daysInRange, loadRollups, parseRange, type DateRange, type MonthlyRollup } from "../../lib/analytics";
import R2Repository from "../../lib/r2Repo";
import { channelContentIds } from "../../lib/search/ownership";
import { healLater, rebuilding, requireContentAccess, healRows } from "./channelContent";

const MAX_PAGE = 50;
/** Max published videos of a single channel ranked per request (bounded indexed read). */
const MAX_RANKED_VIDEOS = 5000;
/** D1 allows 100 bound parameters per statement (90 video ids + 2 range dates = 92). */
const STATS_CHUNK_SIZE = 90;

type TopContentSort = "views" | "watchTime" | "avgViewDuration";

interface VideoRangeTotals {
	views: number;
	watchTime: number;
}

/** The range's views and watch time for one video from legacy monthly R2 rollups. */
function rangeStatsFromRollups(rollups: MonthlyRollup[], days: Set<string>): VideoRangeTotals {
	let views = 0;
	let watchTime = 0;
	for (const rollup of rollups) {
		for (const [day, entry] of Object.entries(rollup?.days || {})) {
			if (!days.has(day)) continue;
			views += entry.views || 0;
			watchTime += entry.watchTime || 0;
		}
	}
	return { views, watchTime };
}

/**
 * Sum views and watch_time per video over `range` using primary-key range seeks on
 * analytics_daily (entity_type, entity_id, day, metric, dim). Never scans the table.
 * Falls back to legacy R2 rollups only when NOTIFICATIONS_DB is unbound.
 */
async function loadRangeTotalsByVideo(
	env: { NOTIFICATIONS_DB?: D1Database; analytics_rollups?: R2Bucket },
	videoIds: string[],
	range: DateRange,
): Promise<Map<string, VideoRangeTotals>> {
	const totals = new Map<string, VideoRangeTotals>();
	if (videoIds.length === 0) return totals;

	const days = daysInRange(range);
	const fromDay = days[0];
	const toDay = days[days.length - 1];
	const db = env.NOTIFICATIONS_DB;

	if (db) {
		const chunks: string[][] = [];
		for (let i = 0; i < videoIds.length; i += STATS_CHUNK_SIZE) {
			chunks.push(videoIds.slice(i, i + STATS_CHUNK_SIZE));
		}
		const pages = await Promise.all(chunks.map((chunk) =>
			db
				.prepare(
					`SELECT entity_id, metric, SUM(value) AS total
					 FROM analytics_daily
					 WHERE entity_type = 'video'
					   AND entity_id IN (${chunk.map(() => "?").join(", ")})
					   AND day >= ? AND day <= ?
					   AND metric IN ('views', 'watch_time')
					 GROUP BY entity_id, metric`,
				)
				.bind(...chunk, fromDay, toDay)
				.all<{ entity_id: string; metric: string; total: number }>(),
		));
		for (const page of pages) {
			for (const row of page.results ?? []) {
				const entry = totals.get(row.entity_id) ?? { views: 0, watchTime: 0 };
				const value = Number(row.total) || 0;
				if (row.metric === "views") entry.views += value;
				else if (row.metric === "watch_time") entry.watchTime += value;
				totals.set(row.entity_id, entry);
			}
		}
		return totals;
	}

	if (env.analytics_rollups) {
		const daySet = new Set(days);
		await Promise.all(videoIds.slice(0, MAX_PAGE).map(async (id) => {
			const rollups = await loadRollups(env, "video", [id], range);
			totals.set(id, rangeStatsFromRollups(rollups, daySet));
		}));
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
			"503": { description: "The index cannot be read right now; try again shortly", content: { "application/json": { schema: ResponseError } } },
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
