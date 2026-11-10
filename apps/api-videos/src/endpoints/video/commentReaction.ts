import { Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AppContext } from '../../base';
import { logger } from "../../lib/logger";
import { isVideoRemoved } from "../../lib/visibility";
import { ReactorHeaders, reactorId } from "../../lib/reactions";
import { applyCommentReaction, findStoredComment, isCommentVisible, StoredComment } from "../../lib/comments";

export type CommentReactionKind = 'like' | 'dislike';
export type CommentReactionAction = 'add' | 'remove';

const MESSAGE_TYPES: Record<CommentReactionKind, Record<CommentReactionAction, MessageType>> = {
	like: { add: MessageType.CommentLike, remove: MessageType.CommentUnlike },
	dislike: { add: MessageType.CommentDislike, remove: MessageType.CommentUndislike },
};

export function commentReactionSchema(reaction: CommentReactionKind, action: CommentReactionAction) {
	const verb = action === 'add'
		? (reaction === 'like' ? 'Like' : 'Dislike')
		: (reaction === 'like' ? 'Remove like from' : 'Remove dislike from');
	return {
		tags: [reaction === 'like' ? "Likes" : "Dislikes"],
		summary: `${verb} a comment on a video`,
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
				cid: Str({ description: "Comment id" }),
			}),
			headers: ReactorHeaders,
		},
		responses: {
			"200": {
				description: "Reaction applied; returns updated counts",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								commentId: z.string(),
								likesCount: z.number(),
								dislikesCount: z.number(),
								isLiked: z.boolean(),
								isDisliked: z.boolean(),
							}),
						}),
					},
				},
			},
			"404": {
				description: "Video or comment not found",
				content: { "application/json": { schema: ResponseError } },
			},
		},
	};
}

/**
 * Shared implementation for comment like/dislike add/remove.
 */
export async function handleCommentReaction(
	c: AppContext,
	params: { id: string; cid: string; channelId?: string | null; userId: string },
	reaction: CommentReactionKind,
	action: CommentReactionAction,
): Promise<Response> {
	const { id, cid, userId } = params;
	// Members without a channel react as themselves (#292)
	const channelId = reactorId(params.channelId, userId);

	type VideoType = z.infer<typeof Video>;
	const repository = new R2Repository<VideoType>(c.env.videos);

	const entry = {
		id: crypto.randomUUID(),
		userId,
		channelId,
		entityId: `${id}:${cid}`,
		dateCreated: new Date().toISOString(),
	};

	// Conditional write (SCALABILITY-AUDIT AV-2): two people reacting to
	// comments of one video at once both land.
	let changed = false;
	let comment = undefined as StoredComment | undefined;
	const { data: video, rejected } = await repository.updateObjectOrReject<true>(id, (fresh) => {
		changed = false;
		comment = undefined;
		if (isVideoRemoved(fresh) || (fresh.isPublic === false && fresh.userId !== userId)) return { reject: true };
		// Top-level comments and replies can be reacted to; held comments cannot
		const target = findStoredComment(fresh.comments as unknown as StoredComment[], cid)?.comment;
		if (!target || !isCommentVisible(target) || target.status === 'held') return { reject: true };
		comment = target;
		changed = applyCommentReaction(target, reaction, action, entry);
		return changed;
	});

	if (!video || rejected || !comment) {
		return c.json({ success: false, error: "Object not found" }, 404);
	}

	if (changed) {
		const queue = new Queue(c.env.queue);
		await queue.send(MESSAGE_TYPES[reaction][action], {
			[reaction === 'like' ? 'likeId' : 'dislikeId']: entry.id,
			commentId: cid,
			videoId: id,
			userId,
			channelId,
			timestamp: entry.dateCreated,
		});
	}

	logger.info('[CommentReaction] Applied', { videoId: id, commentId: cid, channelId, reaction, action, changed });

	const likes = (comment as StoredComment).likes || [];
	const dislikes = (comment as StoredComment).dislikes || [];
	return c.json({
		success: true,
		result: {
			commentId: cid,
			likesCount: likes.length,
			dislikesCount: dislikes.length,
			isLiked: likes.some((l) => l.channelId === channelId),
			isDisliked: dislikes.some((d) => d.channelId === channelId),
		},
	}, 200);
}
