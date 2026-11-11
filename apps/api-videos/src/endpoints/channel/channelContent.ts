import { Num, Str } from "chanfana";
import { z } from "zod";
import { can, channelRoleOf, STUDIO_VIDEO_STATUSES, studioFailureKind, studioVideoStatus, type StudioVideoStatus } from "@al-ummah/shared-types";
import { AuthenticatedRoute, AppContext } from "../../base";
import { Channel as BusinessChannel, ResponseError, Video as BusinessVideo } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { logger } from "../../lib/logger";
import { transformVideoToView } from "../../lib/transformations";
import { channelContentCounts, channelContentIds, healChannelContentRows, scheduleOwnershipHeal, waitUntilOf } from "../../lib/search/ownership";

const MAX_PAGE = 100;

const errors = {
	"401": { description: "Sign in required", content: { "application/json": { schema: ResponseError } } },
	"403": { description: "No access to this channel", content: { "application/json": { schema: ResponseError } } },
	"404": { description: "Channel not found", content: { "application/json": { schema: ResponseError } } },
	"503": { description: "The index cannot be read right now; try again shortly (an incomplete index is served with indexComplete: false)", content: { "application/json": { schema: ResponseError } } },
};

/**
 * Checks the caller may see this channel's private content. Until channel roles
 * ship (PR #462) only the owner can; a site role never grants it.
 */
export async function requireContentAccess(c: AppContext, channelId: string, userId: string): Promise<Response | null> {
	type ChannelType = z.infer<typeof BusinessChannel>;
	const channel = await new R2Repository<ChannelType>(c.env.channels).getObject(channelId);
	if (!channel || channel.isDeleted) return c.json({ success: false, error: "Channel not found" }, 404);
	// The owner or a channel member who may see private videos (shared channel roles); a site role never grants it
	if (!can(channelRoleOf(channel, userId), "video.view_private")) return c.json({ success: false, error: "Forbidden" }, 403);
	return null;
}

export function healRows(c: AppContext, channelId: string): Promise<boolean> {
	type VideoType = z.infer<typeof BusinessVideo>;
	const repository = new R2Repository<VideoType>(c.env.videos);
	return healChannelContentRows(c.env as never, channelId, (id) => repository.getObject(id));
}

/**
 * Server-Timing for the Studio lists (seen in the browser's Network panel; Timing-Allow-Origin
 * lets the page read it). Workers' clock moves across I/O, so each span is that I/O's wait.
 */
export function serverTimer() {
	const spans: string[] = [];
	let last = Date.now();
	return {
		mark(name: string, desc?: string) {
			const now = Date.now();
			spans.push(`${name};dur=${now - last}${desc ? `;desc="${desc}"` : ""}`);
			last = now;
		},
		apply(c: AppContext) {
			c.header("Server-Timing", spans.join(", "));
			c.header("Timing-Allow-Origin", "*");
		},
	};
}

/**
 * The index answered but is not complete (rows marked for re-sync, a rebuild
 * in progress, rows not yet given their Studio columns): the list is served
 * as it is, flagged indexComplete: false, and the heal is advanced after the
 * response. Before #859 these answered 503 index_rebuilding for every channel
 * until a full pass finished, which under steady writes it never did.
 */
export function healLater(c: AppContext): void {
	scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), "video");
}

/** D1 could not be read at all: the one case still answered with 503. */
export function rebuilding(c: AppContext): Response {
	scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), "video");
	return c.json({ success: false, error: "index_rebuilding" }, 503);
}

/** GET /api/channels/:id/content: one page of a channel's videos in one status. */
export class ChannelContentList extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "List a channel's videos for Studio",
		request: {
			params: z.object({ id: Str({ description: "Channel id" }) }),
			query: z.object({
				status: z.enum(STUDIO_VIDEO_STATUSES as [StudioVideoStatus, ...StudioVideoStatus[]]).optional().default("published"),
				q: z.string().trim().max(200).optional(),
				visibility: z.enum(["all", "public", "private"]).optional().default("all"),
				type: z.enum(["all", "videos", "shorts"]).optional().default("all"),
				duration: z.enum(["all", "short", "medium", "long"]).optional().default("all"),
				category: z.string().max(64).optional(),
				language: z.string().max(16).optional(),
				sort: z.enum(["newest", "oldest", "views", "title"]).optional().default("newest"),
				limit: Num({ required: false, default: 30 }),
				cursor: z.string().regex(/^\d+$/).optional(),
			}),
		},
		responses: {
			"200": {
				description: "Videos and the cursor of the next page",
				content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ items: z.array(z.record(z.unknown())), cursor: z.string().nullable() }) }) } },
			},
			...errors,
		},
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const timer = serverTimer();
		const denied = await requireContentAccess(c, params.id, this.getUserId(c) as string);
		timer.mark("access", "channel record (R2)");
		if (denied) return denied;

		const rowsReady = await healRows(c, params.id);
		timer.mark("heal", "rows missing Studio columns (D1)");

		const limit = Math.min(Math.max(1, query.limit ?? 30), MAX_PAGE);
		const offset = Number(query.cursor ?? 0);
		// One extra row tells whether there's a next page
		const read = await channelContentIds(c.env as never, { ...query, status: query.status ?? "published", channelId: params.id, limit: limit + 1, offset });
		timer.mark("index", "page of ids (D1)");
		if (!read) return rebuilding(c);
		const ids = read.value;
		const indexComplete = rowsReady && read.complete;
		if (!indexComplete) healLater(c);

		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(c.env.videos);
		const page = ids.slice(0, limit);
		const loaded = await Promise.all(page.map((id) => repository.getObject(id)));
		timer.mark("r2", `${page.length} video records, in parallel`);
		const items = loaded
			.filter((video): video is VideoType => !!video && !video.isDeleted)
			.map((video) => ({ ...transformVideoToView(video), isDraft: video.isDraft === true, uploadStatus: video.uploadStatus, studioStatus: studioVideoStatus(video), failureKind: studioFailureKind(video) }));

		logger.info("[ChannelContent] Listed", { channelId: params.id, status: query.status, count: items.length });
		timer.apply(c);
		return c.json({ success: true, result: { items, cursor: ids.length > limit ? String(offset + limit) : null, indexComplete } });
	}
}

/** GET /api/channels/:id/content/summary: how many videos are in each status. */
export class ChannelContentSummary extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Count a channel's videos per Studio status",
		request: { params: z.object({ id: Str({ description: "Channel id" }) }) },
		responses: {
			"200": {
				description: "Videos per status",
				content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ counts: z.record(z.number()) }) }) } },
			},
			...errors,
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const timer = serverTimer();
		const denied = await requireContentAccess(c, params.id, this.getUserId(c) as string);
		timer.mark("access", "channel record (R2)");
		if (denied) return denied;
		const rowsReady = await healRows(c, params.id);
		timer.mark("heal", "rows missing Studio columns (D1)");
		const read = await channelContentCounts(c.env as never, params.id);
		timer.mark("index", "counts per status (D1)");
		if (!read) return rebuilding(c);
		const indexComplete = rowsReady && read.complete;
		if (!indexComplete) healLater(c);
		timer.apply(c);
		return c.json({ success: true, result: { counts: read.value, indexComplete } });
	}
}
