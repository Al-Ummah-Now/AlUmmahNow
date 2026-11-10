/**
 * Managing a channel playlist's videos in bulk (lib/playlistBulk.ts):
 *
 *   POST /api/playlists/:id/videos/bulk       add many ids (ordered, idempotent, validated)
 *   POST /api/playlists/:id/videos/remove     remove many ids
 *   PUT  /api/playlists/:id/videos/order      reorder (merge rule, never loses a concurrent add)
 *   GET  /api/playlists/:id/items             the entries with their videos, for managers
 *   GET  /api/playlists/:id/jobs/:jobId       a background add's progress
 *   POST /api/playlists/:id/jobs/:jobId/retry retry a failed background add
 *
 * Who may: the playlist's owner, or a role on its channel that grants
 * `playlist.manage` (shared-types channel-roles.ts, the matrix the web reads).
 */
import { Num, Str } from "chanfana";
import { z } from "zod";
import { PLAYLIST_BULK_MAX, uniqueVideoIds } from "@al-ummah/shared-types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { ResponseError } from "../../lib/types";
import type { PlaylistType } from "../../lib/playlists";
import {
	bulkAddVideos,
	canManagePlaylist,
	playlistJobStatus,
	playlistManageItems,
	removeVideos,
	reorderVideos,
	retryPlaylistJob,
	type PlaylistEnv,
} from "../../lib/playlistBulk";
import { logger } from "../../lib/logger";
import { refreshStoredOrder } from "../../lib/playlistOrder";
import { waitUntilOf } from "../../lib/search/ownership";
import { playlistSortOf } from "@al-ummah/shared-types";

const NOT_FOUND = { success: false, error: "Playlist not found" } as const;
const FORBIDDEN = { success: false, error: "You do not have permission to manage this playlist" } as const;

const idsBody = (description: string) => ({
	content: {
		"application/json": {
			schema: z.object({
				videoIds: z.array(Str()).min(1).max(PLAYLIST_BULK_MAX).describe(description),
			}),
		},
	},
});

const errors = {
	"400": { description: "Invalid input", content: { "application/json": { schema: ResponseError } } },
	"403": { description: "Not allowed to manage this playlist", content: { "application/json": { schema: ResponseError } } },
	"404": { description: "Playlist not found", content: { "application/json": { schema: ResponseError } } },
};

/**
 * The playlist when the caller may manage it, otherwise the response to send.
 * Deleted playlists look missing; private ones are not revealed to others.
 */
async function managedPlaylist(c: AppContext, id: string, userId: string): Promise<{ playlist: PlaylistType } | { response: Response }> {
	const playlist = await new R2Repository<PlaylistType>(c.env.playlists).getObject(id);
	if (!playlist || playlist.isDeleted) return { response: c.json(NOT_FOUND, 404) };
	if (!(await canManagePlaylist(c.env as never, playlist, userId))) {
		return { response: playlist.isPublic === false ? c.json(NOT_FOUND, 404) : c.json(FORBIDDEN, 403) };
	}
	return { playlist };
}

async function notify(c: AppContext, playlist: PlaylistType, userId: string, extra: Record<string, unknown>) {
	await new Queue(c.env.queue).send(MessageType.PlaylistEdit, {
		playlistId: playlist.id,
		userId,
		channelId: playlist.channelId,
		timestamp: new Date().toISOString(),
		...extra,
	});
}

export class PlaylistVideosBulkAdd extends AuthenticatedRoute {
	schema = {
		tags: ["Playlists"],
		summary: "Add many videos to a playlist",
		description: "Adds the ids in the given order after the playlist's current videos. Idempotent: ids already in the playlist are skipped. Only videos of the playlist's channel are added (others are counted in `notInChannel`). Up to 200 ids are added inline; the rest (or all of them, when the inline write fails) are added by a background job: the answer is then `queued` with `jobId`.",
		request: {
			params: z.object({ id: Str({ description: "Playlist ID" }) }),
			body: idsBody("Video ids to add, in the order they should appear"),
		},
		responses: {
			"200": {
				description: "Added, or queued for the background",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								status: z.enum(["done", "queued", "failed"]),
								added: z.number(),
								alreadyInPlaylist: z.number(),
								notInChannel: z.number(),
								pending: z.number(),
								videosCount: z.number(),
								jobId: z.string().optional(),
							}),
						}),
					},
				},
			},
			...errors,
		},
	};

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const found = await managedPlaylist(c, params.id, userId);
		if ("response" in found) return found.response;
		const ids = uniqueVideoIds(body.videoIds);
		if (ids.length === 0) return c.json({ success: false, error: "videoIds must name at least one video" }, 400);

		const result = await bulkAddVideos(c.env as unknown as PlaylistEnv, { playlist: found.playlist, ids, actorId: userId });
		logger.info("[PlaylistBulkAdd] Videos added", { playlistId: params.id, requested: ids.length, ...result });
		if (result.added > 0 || result.pending > 0) await notify(c, found.playlist, userId, { added: result.added, pending: result.pending });
		return { success: true, result };
	}
}

export class PlaylistVideosBulkRemove extends AuthenticatedRoute {
	schema = {
		tags: ["Playlists"],
		summary: "Remove many videos from a playlist",
		description: "Idempotent: ids that are not in the playlist are ignored.",
		request: {
			params: z.object({ id: Str({ description: "Playlist ID" }) }),
			body: idsBody("Video ids to remove"),
		},
		responses: {
			"200": {
				description: "Removed",
				content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ removed: z.number(), videosCount: z.number() }) }) } },
			},
			...errors,
		},
	};

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const found = await managedPlaylist(c, params.id, userId);
		if ("response" in found) return found.response;
		const outcome = await removeVideos(c.env as unknown as PlaylistEnv, params.id, uniqueVideoIds(body.videoIds));
		if (outcome.missing) return c.json(NOT_FOUND, 404);
		if (outcome.removed > 0) await notify(c, found.playlist, userId, { removed: outcome.removed });
		return { success: true, result: { removed: outcome.removed, videosCount: outcome.videosCount } };
	}
}

export class PlaylistVideosReorder extends AuthenticatedRoute {
	schema = {
		tags: ["Playlists"],
		summary: "Reorder a playlist's videos",
		description: "Manual order only (409 `PLAYLIST_SORT_AUTOMATIC` for an automatic one). Ids keep the given order. Videos added meanwhile (not in the list) follow in their current order, ids removed meanwhile are dropped, so a reorder never loses a concurrent add.",
		request: {
			params: z.object({ id: Str({ description: "Playlist ID" }) }),
			body: idsBody("The playlist's video ids in the new order"),
		},
		responses: {
			"200": {
				description: "The stored order",
				content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ videos: z.array(z.string()) }) }) } },
			},
			...errors,
			"409": { description: "The playlist is sorted automatically", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const found = await managedPlaylist(c, params.id, userId);
		if ("response" in found) return found.response;
		const outcome = await reorderVideos(c.env as unknown as PlaylistEnv, params.id, uniqueVideoIds(body.videoIds));
		if (outcome.missing) return c.json(NOT_FOUND, 404);
		if (outcome.automatic) return c.json({ success: false, code: "PLAYLIST_SORT_AUTOMATIC", error: "This playlist is sorted automatically: switch it to manual order to reorder it by hand" }, 409);
		await notify(c, found.playlist, userId, { reordered: true });
		return { success: true, result: { videos: outcome.videos } };
	}
}

export class PlaylistManageItems extends AuthenticatedRoute {
	schema = {
		tags: ["Playlists"],
		summary: "A playlist's entries for its managers",
		description: "Every stored id in the playlist's order (automatic orders are applied before the page is cut), with its video (private and processing videos included) or null when the video is gone or hidden, so managers can remove it.",
		request: {
			params: z.object({ id: Str({ description: "Playlist ID" }) }),
			query: z.object({
				offset: Num({ description: "First position", default: 0 }).optional(),
				limit: Num({ description: "Entries (1-100)", default: 50 }).optional(),
			}),
		},
		responses: {
			"200": {
				description: "One page of entries",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								playlist: z.object({ id: z.string(), title: z.string(), description: z.string().optional(), isPublic: z.boolean(), thumbnailUrl: z.string().optional(), channelId: z.string(), videosCount: z.number(), sortMode: z.enum(["manual", "auto"]), sortField: z.string(), sortDirection: z.enum(["asc", "desc"]) }),
								items: z.array(z.object({ id: z.string(), position: z.number(), video: z.object({ id: z.string(), title: z.string() }).passthrough().nullable() })),
								nextOffset: z.number().nullable(),
							}),
						}),
					},
				},
			},
			...errors,
		},
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const found = await managedPlaylist(c, params.id, userId);
		if ("response" in found) return found.response;
		const { playlist } = found;
		const offset = Math.max(0, Math.floor(Number(query?.offset) || 0));
		const limit = Math.min(Math.max(Math.floor(Number(query?.limit) || 50), 1), 100);
		const { items, order, known } = await playlistManageItems(c.env as unknown as PlaylistEnv, playlist, offset, limit);
		refreshStoredOrder(c.env as never, playlist, order, known, waitUntilOf(c as never));
		const total = order.length;
		return {
			success: true,
			result: {
				playlist: {
					id: playlist.id,
					title: playlist.title,
					...(playlist.description ? { description: playlist.description } : {}),
					isPublic: playlist.isPublic !== false,
					...(playlist.thumbnailUrl ? { thumbnailUrl: playlist.thumbnailUrl } : {}),
					channelId: playlist.channelId,
					videosCount: total,
					...playlistSortOf(playlist),
				},
				items,
				nextOffset: offset + items.length < total ? offset + items.length : null,
			},
		};
	}
}

const jobParams = z.object({ id: Str({ description: "Playlist ID" }), jobId: Str({ description: "Background add job ID" }) });
const jobResponse = {
	"200": {
		description: "The background add",
		content: {
			"application/json": {
				schema: z.object({
					success: z.boolean(),
					result: z.object({ id: z.string(), playlistId: z.string(), status: z.string(), total: z.number(), processed: z.number(), added: z.number(), notInChannel: z.number(), updatedAt: z.string() }),
				}),
			},
		},
	},
	...errors,
};

export class PlaylistJobFetch extends AuthenticatedRoute {
	schema = {
		tags: ["Playlists"],
		summary: "Progress of a background add",
		request: { params: jobParams },
		responses: jobResponse,
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const found = await managedPlaylist(c, params.id, userId);
		if ("response" in found) return found.response;
		const status = await playlistJobStatus(c.env as never, params.jobId, params.id);
		if (!status) return c.json({ success: false, error: "Job not found" }, 404);
		return { success: true, result: status };
	}
}

export class PlaylistJobRetry extends AuthenticatedRoute {
	schema = {
		tags: ["Playlists"],
		summary: "Retry a failed background add",
		description: "Queues the add again with a fresh retry budget. A job that has not failed is returned unchanged.",
		request: { params: jobParams },
		responses: jobResponse,
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const found = await managedPlaylist(c, params.id, userId);
		if ("response" in found) return found.response;
		const status = await retryPlaylistJob(c.env as never, params.jobId, params.id);
		if (!status) return c.json({ success: false, error: "Job not found" }, 404);
		logger.info("[PlaylistJobRetry] Background add retried", { playlistId: params.id, jobId: params.jobId, status: status.status });
		return { success: true, result: status };
	}
}
