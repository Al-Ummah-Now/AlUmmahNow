/**
 * Studio's Recently deleted (creator soft deletes; lib/creatorDeletions.ts):
 * list a channel's deleted videos, restore them, or queue them for
 * permanent deletion. The hourly cleanup erases what is due.
 */
import { Str } from "chanfana";
import { z } from "zod";
import { can, channelRoleOf } from "@al-ummah/shared-types";
import { AuthenticatedRoute, AppContext } from "../../base";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { channelDeletedVideos, purgeForCreator, restoreForCreator, summarize } from "../../lib/creatorDeletions";

const videoIds = z.array(Str()).min(1).max(50);

const Results = z.object({
	success: z.boolean(),
	results: z.array(z.object({ videoId: z.string(), success: z.boolean(), error: z.string().optional() })),
	summary: z.object({ total: z.number(), succeeded: z.number(), failed: z.number() }),
});

const errors = {
	"400": { description: "Invalid input", content: { "application/json": { schema: ResponseError } } },
	"401": { description: "Sign in required", content: { "application/json": { schema: ResponseError } } },
};

/** POST /api/videos/bulk-restore: brings soft-deleted videos back. */
export class VideoBulkRestore extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Restore deleted videos (within 30 days, before permanent deletion starts)",
		request: { body: { content: { "application/json": { schema: z.object({ videoIds }) } } } },
		responses: { "200": { description: "Result per video", content: { "application/json": { schema: Results } } }, ...errors },
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c) as string;
		const ids = Array.from(new Set(body.videoIds));
		return summarize(await Promise.all(ids.map((id) => restoreForCreator(c.env as never, id, userId))));
	}
}

/** POST /api/videos/bulk-purge: "Delete permanently", queued for the next cleanup run. */
export class VideoBulkPurge extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Queue deleted videos for permanent deletion",
		request: { body: { content: { "application/json": { schema: z.object({ videoIds }) } } } },
		responses: { "200": { description: "Result per video", content: { "application/json": { schema: Results } } }, ...errors },
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c) as string;
		const ids = Array.from(new Set(body.videoIds));
		return summarize(await Promise.all(ids.map((id) => purgeForCreator(c.env as never, id, userId))));
	}
}

const DeletedVideo = z.object({
	id: z.string(),
	title: z.string(),
	deletedAt: z.string(),
	deletedBy: z.string(),
	purgeAfter: z.string(),
	status: z.enum(["deleted", "queued", "purging", "purged"]),
});

/** GET /api/channels/:id/content/deleted: the channel's soft-deleted videos, newest first. */
export class ChannelDeletedVideos extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "List a channel's recently deleted videos",
		request: {
			params: z.object({ id: Str({ description: "Channel id" }) }),
			query: z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }),
		},
		responses: {
			"200": {
				description: "Deleted videos and the cursor of the next page",
				content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ items: z.array(DeletedVideo), cursor: z.string().nullable() }) }) } },
			},
			"403": { description: "No access to this channel", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Channel not found", content: { "application/json": { schema: ResponseError } } },
			...errors,
		},
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c) as string;
		type ChannelType = z.infer<typeof BusinessChannel>;
		const channel = await new R2Repository<ChannelType>(c.env.channels).getObject(params.id);
		if (!channel || channel.isDeleted) return c.json({ success: false, error: "Channel not found" }, 404);
		if (!can(channelRoleOf(channel, userId), "video.delete")) return c.json({ success: false, error: "Forbidden" }, 403);
		const page = await channelDeletedVideos(c.env as never, params.id, query.cursor, query.limit ?? 30);
		return {
			success: true,
			result: {
				items: page.items.map((d) => ({ id: d.id, title: d.title, deletedAt: d.deletedAt, deletedBy: d.deletedBy, purgeAfter: d.purgeAfter, status: d.status })),
				cursor: page.nextCursor,
			},
		};
	}
}
