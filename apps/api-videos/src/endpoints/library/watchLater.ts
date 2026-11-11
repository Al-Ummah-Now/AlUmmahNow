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
	clearWatchLaterChannel,
	newWatchLater,
	pageIds,
	removeFromWatchLater,
	toLibraryVideoViews,
	watchLaterId,
	WatchLaterPlaylist,
	WATCH_LATER_MAX_ITEMS,
} from "../../lib/library";
import { ResponseError } from "../../lib/types";

// Accepted for older clients and ignored: Watch later belongs to the user, not the active channel
const OptionalChannelHeader = z.object({ channelId: Str({ description: "Ignored (Watch later is per user, the same for every channel)" }).optional().nullable() });

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

		logger.debug("[WatchLater] Listed", { userId, total: ids.length, returned: items.length });
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
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const video = await new R2Repository<VideoType>(c.env.videos).getObject(body.videoId);
		if (!video || !canViewVideo(video, userId)) {
			return c.json({ success: false, error: "Video not found" }, 404);
		}

		// Conditional write on the fresh list (SCALABILITY-AUDIT AV-19): saving
		// several videos at once keeps all of them; the list is created once.
		let added = false;
		const { data: playlist, rejected } = await repo(c).updateObjectOrReject<"full">(watchLaterId(userId), (fresh) => {
			// Per user, never per channel: the active channel is not recorded,
			// and a list made before that fix loses its channel on this write
			const cleared = clearWatchLaterChannel(fresh);
			const outcome = addToWatchLater(fresh, body.videoId);
			added = outcome.added;
			if (outcome.full) return { reject: "full" };
			return outcome.added || cleared;
		}, { initial: () => newWatchLater(userId) });
		if (rejected === "full") {
			return c.json({ success: false, error: "watch_later_full", limit: WATCH_LATER_MAX_ITEMS }, 409);
		}

		logger.debug("[WatchLater] Add", { userId, videoId: body.videoId, added });
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
		// Conditional write on the fresh list (SCALABILITY-AUDIT AV-19)
		let removed = false;
		const playlist = await repo(c).updateObject(watchLaterId(userId), (fresh) => {
			const cleared = clearWatchLaterChannel(fresh);
			removed = removeFromWatchLater(fresh, params.videoId);
			return removed || cleared;
		});

		logger.debug("[WatchLater] Remove", { userId, videoId: params.videoId, removed });
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
		// Checked and written on the fresh list (SCALABILITY-AUDIT AV-19), so a
		// video saved meanwhile is not dropped by an order that lacks it
		const { data: playlist, rejected } = await repo(c).updateObjectOrReject<true>(watchLaterId(userId), (fresh) => {
			if (!isSameVideoSet(fresh.videos || [], body.videoIds)) return { reject: true };
			clearWatchLaterChannel(fresh);
			fresh.videos = [...body.videoIds];
			fresh.dateModified = new Date().toISOString();
			return true;
		});
		if (rejected || (!playlist && body.videoIds.length > 0)) {
			return c.json({ success: false, error: "videoIds must contain exactly the videos in Watch later" }, 400);
		}
		logger.debug("[WatchLater] Reordered", { userId, count: body.videoIds.length });
		return { success: true, result: { videoIds: body.videoIds } };
	}
}
