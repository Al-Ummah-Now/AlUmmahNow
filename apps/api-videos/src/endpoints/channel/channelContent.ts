import { Num, Str } from "chanfana";
import { z } from "zod";
import { STUDIO_VIDEO_STATUSES, studioVideoStatus, type StudioVideoStatus } from "@al-ummah/shared-types";
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
	"503": { description: "The index is being rebuilt; try again shortly", content: { "application/json": { schema: ResponseError } } },
};

/**
 * Checks the caller may see this channel's private content. Until channel roles
 * ship (PR #462) only the owner can; a site role never grants it.
 */
async function requireContentAccess(c: AppContext, channelId: string, userId: string): Promise<Response | null> {
	type ChannelType = z.infer<typeof BusinessChannel>;
	const channel = await new R2Repository<ChannelType>(c.env.channels).getObject(channelId);
	if (!channel || channel.isDeleted) return c.json({ success: false, error: "Channel not found" }, 404);
	if (channel.userId !== userId) return c.json({ success: false, error: "Forbidden" }, 403);
	return null;
}

function healRows(c: AppContext, channelId: string): Promise<boolean> {
	type VideoType = z.infer<typeof BusinessVideo>;
	const repository = new R2Repository<VideoType>(c.env.videos);
	return healChannelContentRows(c.env as never, channelId, (id) => repository.getObject(id));
}

function rebuilding(c: AppContext): Response {
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
		const denied = await requireContentAccess(c, params.id, this.getUserId(c) as string);
		if (denied) return denied;

		if (!(await healRows(c, params.id))) return rebuilding(c);

		const limit = Math.min(Math.max(1, query.limit ?? 30), MAX_PAGE);
		const offset = Number(query.cursor ?? 0);
		// One extra row tells whether there's a next page
		const ids = await channelContentIds(c.env as never, { ...query, status: query.status ?? "published", channelId: params.id, limit: limit + 1, offset });
		if (!ids) return rebuilding(c);

		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(c.env.videos);
		const page = ids.slice(0, limit);
		const loaded = await Promise.all(page.map((id) => repository.getObject(id)));
		const items = loaded
			.filter((video): video is VideoType => !!video && !video.isDeleted)
			.map((video) => ({ ...transformVideoToView(video), isDraft: video.isDraft === true, uploadStatus: video.uploadStatus, studioStatus: studioVideoStatus(video) }));

		logger.info("[ChannelContent] Listed", { channelId: params.id, status: query.status, count: items.length });
		return { success: true, result: { items, cursor: ids.length > limit ? String(offset + limit) : null } };
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
		const denied = await requireContentAccess(c, params.id, this.getUserId(c) as string);
		if (denied) return denied;
		if (!(await healRows(c, params.id))) return rebuilding(c);
		const counts = await channelContentCounts(c.env as never, params.id);
		if (!counts) return rebuilding(c);
		return { success: true, result: { counts } };
	}
}
