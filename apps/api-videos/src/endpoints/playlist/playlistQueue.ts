/**
 * GET /api/playlists/{listId}/queue: the playback queue for every player
 * (docs/specs/PLAYLIST-PLAYBACK.md section 3).
 *
 * `listId` is a playlist id, or `WL` (Watch later) / `LL` (Liked videos),
 * resolved from the caller's session. A list the caller may not see is 404,
 * the same answer as a missing one. System playlists (Watch later) are only
 * reachable through their alias, so their stored ids never travel in URLs.
 */
import { Str } from "chanfana";
import { z } from "zod";
import { OptionalAuthRoute, AppContext } from "../../base";
import R2Repository from "../../lib/r2Repo";
import { logger } from "../../lib/logger";
import { ResponseError } from "../../lib/types";
import { canViewPlaylist, type PlaylistType } from "../../lib/playlists";
import { canManageChannelPlaylists } from "../../lib/playlistBulk";
import { isSystemPlaylist, listAllLikedIds, watchLaterId } from "../../lib/library";
import { orderedPlaylist } from "../../lib/playlistOrder";
import { LIST_ALIASES, QUEUE_PAGE_MAX, listAliasOf, queueItems, queueWindow, visibleEntries, type QueueKind } from "../../lib/playlistQueue";
import { playlistSortOf } from "@al-ummah/shared-types";
import type { VideoType } from "../../lib/playlists";

const notFound = (c: AppContext) => c.json({ success: false, error: "Playlist not found" }, 404);

/** Whether the caller may play this (non-system) playlist: the rule of GET /api/playlists/{id}. */
export async function canPlayPlaylist(env: unknown, playlist: PlaylistType, userId: string | undefined): Promise<boolean> {
	if (isSystemPlaylist(playlist)) return false;
	if (canViewPlaylist(playlist, userId)) return true;
	return !playlist.isDeleted && !playlist.isHidden && playlist.isPublic === false
		&& await canManageChannelPlaylists(env as never, playlist.channelId, userId);
}

export class PlaylistQueue extends OptionalAuthRoute {
	schema = {
		tags: ["Playlists"],
		summary: "Playback queue of a playlist, Watch later (WL) or Liked videos (LL), in its saved order",
		request: {
			params: z.object({ id: Str({ description: "Playlist id, or WL / LL for the caller's Watch later / Liked videos" }) }),
			query: z.object({
				video: Str({ description: "The playing video: the first page is a window around it" }).optional(),
				index: z.coerce.number().int().min(0).optional().describe("The video's place in the list from the URL (0-based); picks the occurrence and the next item when the video left the list"),
				offset: z.coerce.number().int().min(0).optional().describe("Explicit page start (visible position)"),
				limit: z.coerce.number().int().min(1).max(QUEUE_PAGE_MAX).optional(),
			}),
			headers: z.object({ channelId: Str({ description: "Channel ID" }).optional().nullable() }),
		},
		responses: {
			"200": { description: "The queue page: playlist summary, total, the video's position and items in order" },
			"404": { description: "Not found, or not visible to the caller", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const alias = listAliasOf(params.id);
		const channelRepo = new R2Repository<{ id: string; name?: string; handle?: string }>(c.env.channels);

		let kind: QueueKind = "playlist";
		let ids: string[];
		let known: Map<string, VideoType> | undefined;
		let summary: Record<string, unknown>;

		if (alias) {
			if (!userId) return notFound(c);
			kind = LIST_ALIASES[alias];
			if (alias === "WL") {
				const wl = await new R2Repository<PlaylistType>(c.env.playlists).getObject(watchLaterId(userId));
				ids = wl?.videos || [];
			} else {
				if (!c.env.NOTIFICATIONS_DB) return notFound(c);
				ids = await listAllLikedIds(c.env.NOTIFICATIONS_DB, userId);
			}
			summary = { id: alias, kind, title: "", isPublic: false, sortMode: "manual" };
		} else {
			const playlist = await new R2Repository<PlaylistType>(c.env.playlists).getObject(params.id);
			if (!playlist || !(await canPlayPlaylist(c.env, playlist, userId))) return notFound(c);
			const ordered = await orderedPlaylist(c.env as never, playlist);
			ids = ordered.ids;
			known = ordered.videos;
			let channel: { name?: string; handle?: string } | null = null;
			if (playlist.channelId) {
				channel = await channelRepo.getObject(playlist.channelId).catch(() => null);
			}
			const extra = playlist as PlaylistType & { titleLocalized?: Record<string, string> };
			summary = {
				id: playlist.id,
				kind,
				title: playlist.title || "",
				...(extra.titleLocalized ? { titleLocalized: extra.titleLocalized } : {}),
				channelId: playlist.channelId || null,
				channelName: channel?.name || "",
				channelHandle: channel?.handle || null,
				isPublic: playlist.isPublic !== false,
				...playlistSortOf(playlist),
			};
		}

		const { entries, exact, videos } = await visibleEntries(c.env, ids, userId, known);
		const window = queueWindow(entries, { video: query.video, index: query.index, offset: query.offset, limit: query.limit, exact });
		const items = await queueItems(c.env, window, userId, videos, async (channelIds) => {
			const names = new Map<string, string>();
			await Promise.all(channelIds.map(async (id) => {
				const channel = await channelRepo.getObject(id).catch(() => null);
				if (channel?.name) names.set(id, channel.name);
			}));
			return names;
		});

		logger.debug("[PlaylistQueue] Served", { list: alias ?? params.id, total: window.total, exact, position: window.position, returned: items.length });
		// Per viewer (private items, aliases): never shared by a cache
		return c.json({
			success: true,
			result: {
				playlist: summary,
				total: window.total,
				exact: window.exact,
				position: window.position,
				nextPosition: window.nextPosition,
				offset: window.offset,
				items,
				prevOffset: window.prevOffset,
				nextOffset: window.nextOffset,
			},
		}, 200, { "Cache-Control": "private, no-cache" });
	}
}
