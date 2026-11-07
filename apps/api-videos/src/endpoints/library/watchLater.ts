/**
 * Watch later (Story 29.6): per-user system playlist.
 *
 * GET    /api/library/watch-later              ordered videos (offset cursor)
 * GET    /api/library/watch-later/:videoId     { saved }
 * POST   /api/library/watch-later              { videoId } add (idempotent)
 * DELETE /api/library/watch-later/:videoId     remove (idempotent)
 * PUT    /api/library/watch-later/order        { videoIds } reorder (same set)
 */

import { Str } from "chanfana";
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from "../../base";
import R2Repository from "../../lib/r2Repo";
import { logger } from "../../lib/logger";
import { canViewVideo, isSameVideoSet, VideoType } from "../../lib/playlists";
import {
	addToWatchLater,
	newWatchLater,
	pageIds,
	removeFromWatchLater,
	toLibraryVideoViews,
	watchLaterId,
	WatchLaterPlaylist,
	WATCH_LATER_MAX_ITEMS,
} from "../../lib/library";
import { ResponseError } from "../../lib/types";

const OptionalChannelHeader = z.object({ channelId: Str({ description: "Active channel ID" }).optional().nullable() });

const errorResponses = {
	"401": { description: "Authentication required", content: { "application/json": { schema: ResponseError } } },
	"404": { description: "Video not found", content: { "application/json": { schema: ResponseError } } },
};

function repo(c: AppContext) {
	return new R2Repository<WatchLaterPlaylist>(c.env.playlists);
}

async function loadWatchLater(c: AppContext, userId: string): Promise<WatchLaterPlaylist | null> {
	return repo(c).getObject(watchLaterId(userId));
}

export class WatchLaterList extends AuthenticatedRoute {
	schema = {
		tags: ["Library"],
		summary: "List the Watch later playlist",
		request: {
			query: z.object({
				limit: z.coerce.number().int().min(1).max(50).optional().default(20),
				cursor: Str({ description: "Offset cursor from the previous page" }).optional(),
			}),
			headers: OptionalChannelHeader,
		},
		responses: { "200": { description: "Watch later videos in playlist order" }, ...errorResponses },
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const playlist = await loadWatchLater(c, userId);
		const ids = playlist?.videos || [];
		const page = pageIds(ids, query.limit, query.cursor);

		const videoRepo = new R2Repository<VideoType>(c.env.videos);
		const videos = await Promise.all(page.ids.map((id) => videoRepo.getObject(id)));
		const items = await toLibraryVideoViews(
			c.env.channels,
			videos.filter((v): v is VideoType => !!v && canViewVideo(v, userId)),
		);

		logger.info("[WatchLater] Listed", { userId, total: ids.length, returned: items.length });
		return {
			success: true,
			result: {
				playlistId: watchLaterId(userId),
				total: ids.length,
				videoIds: ids,
				items,
				nextCursor: page.nextCursor,
			},
		};
	}
}

export class WatchLaterStatus extends AuthenticatedRoute {
	schema = {
		tags: ["Library"],
		summary: "Whether a video is in Watch later",
		request: { params: z.object({ videoId: Str() }), headers: OptionalChannelHeader },
		responses: { "200": { description: "{ saved }" }, ...errorResponses },
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const playlist = await loadWatchLater(c, this.getUserId(c));
		return { success: true, result: { videoId: params.videoId, saved: !!playlist?.videos?.includes(params.videoId) } };
	}
}

export class WatchLaterAdd extends AuthenticatedRoute {
	schema = {
		tags: ["Library"],
		summary: "Add a video to Watch later (idempotent)",
		request: {
			body: { content: { "application/json": { schema: z.object({ videoId: Str() }) } } },
			headers: OptionalChannelHeader,
		},
		responses: {
			"200": { description: "Video saved (or already saved)" },
			"409": { description: "Watch later is full", content: { "application/json": { schema: ResponseError } } },
			...errorResponses,
		},
	};

	async handle(c: AppContext) {
		const { body, headers } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const video = await new R2Repository<VideoType>(c.env.videos).getObject(body.videoId);
		if (!video || !canViewVideo(video, userId)) {
			return c.json({ success: false, error: "Video not found" }, 404);
		}

		const playlist = (await loadWatchLater(c, userId)) || newWatchLater(userId, headers.channelId || undefined);
		const { added, full } = addToWatchLater(playlist, body.videoId);
		if (full) {
			return c.json({ success: false, error: "watch_later_full", limit: WATCH_LATER_MAX_ITEMS }, 409);
		}
		if (added) await repo(c).putObject(playlist.id, playlist);

		logger.info("[WatchLater] Add", { userId, videoId: body.videoId, added });
		return { success: true, result: { videoId: body.videoId, saved: true, added, total: playlist.videos.length } };
	}
}

export class WatchLaterRemove extends AuthenticatedRoute {
	schema = {
		tags: ["Library"],
		summary: "Remove a video from Watch later (idempotent)",
		request: { params: z.object({ videoId: Str() }), headers: OptionalChannelHeader },
		responses: { "200": { description: "Video removed (or was not saved)" }, ...errorResponses },
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const playlist = await loadWatchLater(c, userId);
		const removed = playlist ? removeFromWatchLater(playlist, params.videoId) : false;
		if (playlist && removed) await repo(c).putObject(playlist.id, playlist);

		logger.info("[WatchLater] Remove", { userId, videoId: params.videoId, removed });
		return { success: true, result: { videoId: params.videoId, saved: false, removed, total: playlist?.videos?.length || 0 } };
	}
}

export class WatchLaterReorder extends AuthenticatedRoute {
	schema = {
		tags: ["Library"],
		summary: "Reorder Watch later",
		request: {
			body: { content: { "application/json": { schema: z.object({ videoIds: z.array(Str()) }) } } },
			headers: OptionalChannelHeader,
		},
		responses: {
			"200": { description: "New order saved" },
			"400": { description: "Order must contain exactly the saved videos", content: { "application/json": { schema: ResponseError } } },
			...errorResponses,
		},
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const playlist = await loadWatchLater(c, userId);
		const current = playlist?.videos || [];
		if (!isSameVideoSet(current, body.videoIds)) {
			return c.json({ success: false, error: "videoIds must contain exactly the videos in Watch later" }, 400);
		}
		if (playlist) {
			playlist.videos = [...body.videoIds];
			playlist.dateModified = new Date().toISOString();
			await repo(c).putObject(playlist.id, playlist);
		}
		logger.info("[WatchLater] Reordered", { userId, count: body.videoIds.length });
		return { success: true, result: { videoIds: body.videoIds } };
	}
}
