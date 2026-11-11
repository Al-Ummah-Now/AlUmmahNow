import { Num, Str } from "chanfana";
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from "../../base";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { AnalyticsVideo, daysInRange, loadRollups, parseRange, type MonthlyRollup } from "../../lib/analytics";
import R2Repository from "../../lib/r2Repo";
import { channelContentIds } from "../../lib/search/ownership";
import { healLater, rebuilding, requireContentAccess, healRows } from "./channelContent";

const MAX_PAGE = 50;

/** The range's views and watch time for one video. Rollup documents are whole months. */
function rangeStats(rollups: MonthlyRollup[], days: Set<string>) {
	let views = 0;
	let watchTime = 0;
	for (const rollup of rollups) {
		for (const [day, entry] of Object.entries(rollup?.days || {})) {
			if (!days.has(day)) continue;
			views += entry.views || 0;
			watchTime += entry.watchTime || 0;
		}
	}
	return { views, watchTime: Math.round(watchTime), avgViewDuration: views ? Math.round(watchTime / views) : 0 };
}

/**
 * GET /api/channels/:id/analytics/top-content: the channel's published videos,
 * most viewed first, with stats for the range. Per-video rollups are only read
 * for one page, so a range stays within a Worker's subrequest limit.
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
				limit: Num({ required: false, default: 20 }),
				cursor: z.string().regex(/^\d+$/).optional(),
			}),
		},
		responses: {
			"200": {
				description: "Videos and the cursor of the next page",
				content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ items: z.array(z.record(z.unknown())), cursor: z.string().nullable() }) }) } },
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
		const read = await channelContentIds(c.env as never, { channelId: params.id, status: "published", sort: "views", limit: limit + 1, offset });
		if (!read) return rebuilding(c);
		const ids = read.value;
		const indexComplete = rowsReady && read.complete;
		if (!indexComplete) healLater(c);

		const range = parseRange(query.dateFrom, query.dateTo);
		const days = new Set(daysInRange(range));
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(c.env.videos);
		const page = ids.slice(0, limit);
		const items = (await Promise.all(page.map(async (id) => {
			const video = await repository.getObject(id);
			if (!video) return null;
			const rollups = await loadRollups(c.env, "video", [id], range);
			return {
				videoId: video.id,
				title: video.title,
				thumbnailUrl: (video as AnalyticsVideo).thumbnailUrl,
				isPublic: video.isPublic !== false,
				...rangeStats(rollups, days),
			};
		}))).filter(Boolean);

		return { success: true, result: { items, cursor: ids.length > limit ? String(offset + limit) : null, indexComplete } };
	}
}
