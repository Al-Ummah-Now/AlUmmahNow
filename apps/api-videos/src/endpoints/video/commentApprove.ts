import { Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { AuthenticatedRoute, AppContext } from '../../base';
import { logger } from "../../lib/logger";
import { isVideoRemoved } from "../../lib/visibility";
import { findStoredComment, StoredComment } from "../../lib/comments";
import { toCommentListItems } from "../../lib/commentAuthors";
import { broadcastInBackground } from "../../lib/websocket-notify";

/**
 * POST /api/videos/:id/comments/:cid/approve
 *
 * Publishes a comment that was held for review (video comment settings =
 * held). Only the video owner may approve. Approved comments are broadcast to
 * viewers like a new comment.
 */
export class CommentApprove extends AuthenticatedRoute {
	schema = {
		tags: ["Comments"],
		summary: "Approve a held comment (video owner only)",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
				cid: Str({ description: "Comment or reply id" }),
			}),
		},
		responses: {
			"200": { description: "Comment published", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } },
			"403": { description: "Not the video owner", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Video or comment not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id, cid } = request.params;
		const userId = this.getUserId(c);

		type VideoType = z.infer<typeof Video>;
		const repository = new R2Repository<VideoType>(c.env.videos);
		const video = await repository.getObject(id);
		if (!video || isVideoRemoved(video)) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}
		if (video.userId !== userId) {
			return c.json({ success: false, error: "Forbidden" }, 403);
		}

		const found = findStoredComment(video.comments as unknown as StoredComment[], cid);
		if (!found || found.comment.isDeleted) {
			return c.json({ success: false, error: "Comment not found" }, 404);
		}

		if (found.comment.status === 'held') {
			found.comment.status = 'published';
			await repository.putObject(video.id, video);
			const [item] = await toCommentListItems(c.env, [found.comment], null, undefined, { videoId: id });
			broadcastInBackground(c, `video:${id}`, 'comment_added', {
				videoId: id,
				commentId: cid,
				parentCommentId: found.parent?.id || null,
				comment: item,
			});
		}

		logger.info('[CommentApprove] Comment approved', { videoId: id, commentId: cid });
		return { success: true };
	}
}
