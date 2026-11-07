/**
 * Liked videos and saved posts (Story 29.6), read from per-user D1 indexes.
 *
 * GET    /api/library/liked                     liked videos, newest like first
 * GET    /api/library/saved-posts               saved community posts
 * GET    /api/library/saved-posts/:postId       { saved }
 * POST   /api/library/saved-posts               { postId, channelId } (idempotent)
 * DELETE /api/library/saved-posts/:postId       (idempotent)
 */

import { Str } from "chanfana";
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from "../../base";
import R2Repository from "../../lib/r2Repo";
import { logger } from "../../lib/logger";
import { canViewVideo, VideoType } from "../../lib/playlists";
import { isPostSaved, listLikedIds, listSavedPostIds, pruneLikes, savePost, toLibraryVideoViews, unsavePost } from "../../lib/library";
import { ResponseError } from "../../lib/types";

const OptionalChannelHeader = z.object({ channelId: Str({ description: "Active channel ID" }).optional().nullable() });
const PageQuery = z.object({
	limit: z.coerce.number().int().min(1).max(50).optional().default(20),
	cursor: Str({ description: "Cursor from the previous page" }).optional(),
});
const unavailable = { "503": { description: "Library index not configured", content: { "application/json": { schema: ResponseError } } } };

function indexUnavailable(c: AppContext) {
	logger.warn("[Library] NOTIFICATIONS_DB not bound");
	return c.json({ success: false, error: "library_unavailable" }, 503);
}

export class LikedVideosList extends AuthenticatedRoute {
	schema = {
		tags: ["Library"],
		summary: "List liked videos (per-user index)",
		request: { query: PageQuery, headers: OptionalChannelHeader },
		responses: { "200": { description: "Liked videos" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return indexUnavailable(c);
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);

		const page = await listLikedIds(db, userId, query);
		const videoRepo = new R2Repository<VideoType>(c.env.videos);
		const videos = await Promise.all(page.items.map((i) => videoRepo.getObject(i.videoId)));

		const missing: string[] = [];
		const visible: VideoType[] = [];
		const likedAt = new Map<string, number>();
		for (let i = 0; i < page.items.length; i++) {
			const video = videos[i];
			if (!video || video.isDeleted) {
				missing.push(page.items[i].videoId);
				continue;
			}
			if (!canViewVideo(video, userId)) continue;
			visible.push(video);
			likedAt.set(video.id, page.items[i].likedAt);
		}
		const items = (await toLibraryVideoViews(c.env.channels, visible)).map((v) => ({
			...v,
			likedAt: new Date(likedAt.get(v.id) || 0).toISOString(),
		}));
		if (missing.length > 0) await pruneLikes(db, userId, missing);

		logger.info("[Library] Liked videos listed", { userId, returned: items.length, pruned: missing.length });
		return { success: true, result: { items, nextCursor: page.nextCursor, total: Math.max(0, page.total - missing.length) } };
	}
}

interface StoredPost {
	id: string;
	channelId: string;
	status?: string;
	[key: string]: unknown;
}

export class SavedPostsList extends AuthenticatedRoute {
	schema = {
		tags: ["Library"],
		summary: "List saved community posts",
		request: { query: PageQuery, headers: OptionalChannelHeader },
		responses: { "200": { description: "Saved posts" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return indexUnavailable(c);
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const page = await listSavedPostIds(db, userId, query);

		const posts = await Promise.all(
			page.items.map(async (item) => {
				if (!item.channelId) return null;
				const obj = await c.env.community_posts.get(`posts/${item.channelId}/${item.postId}.json`);
				return obj ? ((await obj.json()) as StoredPost) : null;
			}),
		);
		const items = posts
			.map((post, i) => (post && post.status !== "deleted" ? { ...post, savedAt: new Date(page.items[i].savedAt).toISOString() } : null))
			.filter(Boolean);

		return { success: true, result: { items, nextCursor: page.nextCursor, total: page.total } };
	}
}

export class SavedPostStatus extends AuthenticatedRoute {
	schema = {
		tags: ["Library"],
		summary: "Whether a post is saved",
		request: { params: z.object({ postId: Str() }), headers: OptionalChannelHeader },
		responses: { "200": { description: "{ saved }" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return indexUnavailable(c);
		const { params } = await this.getValidatedData<typeof this.schema>();
		return { success: true, result: { postId: params.postId, saved: await isPostSaved(db, this.getUserId(c), params.postId) } };
	}
}

export class SavedPostAdd extends AuthenticatedRoute {
	schema = {
		tags: ["Library"],
		summary: "Save a community post (idempotent)",
		request: {
			body: { content: { "application/json": { schema: z.object({ postId: Str(), channelId: Str({ description: "Channel that owns the post" }) }) } } },
			headers: OptionalChannelHeader,
		},
		responses: {
			"200": { description: "Saved" },
			"404": { description: "Post not found", content: { "application/json": { schema: ResponseError } } },
			...unavailable,
		},
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return indexUnavailable(c);
		const { body } = await this.getValidatedData<typeof this.schema>();
		const obj = await c.env.community_posts.get(`posts/${body.channelId}/${body.postId}.json`);
		const post = obj ? ((await obj.json()) as StoredPost) : null;
		if (!post || post.status === "deleted") {
			return c.json({ success: false, error: "Post not found" }, 404);
		}
		const added = await savePost(db, this.getUserId(c), body.postId, body.channelId);
		return { success: true, result: { postId: body.postId, saved: true, added } };
	}
}

export class SavedPostRemove extends AuthenticatedRoute {
	schema = {
		tags: ["Library"],
		summary: "Unsave a community post (idempotent)",
		request: { params: z.object({ postId: Str() }), headers: OptionalChannelHeader },
		responses: { "200": { description: "Removed" }, ...unavailable },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return indexUnavailable(c);
		const { params } = await this.getValidatedData<typeof this.schema>();
		const removed = await unsavePost(db, this.getUserId(c), params.postId);
		return { success: true, result: { postId: params.postId, saved: false, removed } };
	}
}
