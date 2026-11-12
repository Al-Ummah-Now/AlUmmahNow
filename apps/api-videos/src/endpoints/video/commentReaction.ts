import { Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AppContext } from '../../base';
import { logger } from "../../lib/logger";
import { isVideoRemoved } from "../../lib/visibility";
import { PUBLIC_DISLIKES_COUNT, ReactorHeaders, reactorId } from "../../lib/reactions";
import { applyCommentReaction, findStoredComment, isCommentVisible, StoredComment } from "../../lib/comments";

export type CommentReactionKind = 'like' | 'dislike';
export type CommentReactionAction = 'add' | 'remove';

const MESSAGE_TYPES: Record<CommentReactionKind, Record<CommentReactionAction, MessageType>> = {
	like: { add: MessageType.CommentLike, remove: MessageType.CommentUnlike },
	dislike: { add: MessageType.CommentDislike, remove: MessageType.CommentUndislike },
};

/**
 * Schema for comment like / unlike / remove-dislike. Adding a dislike is
 * turned off (commentDislikeCreate.ts answers 410).
 */
export function commentReactionSchema(reaction: CommentReactionKind, action: CommentReactionAction) {
	const verb = action === 'add'
		? 'Like'
		: (reaction === 'like' ? 'Remove like from' : 'Remove dislike from');
	return {
		tags: [reaction === 'like' ? "Likes" : "Dislikes"],
		summary: `${verb} a comment on a video`,
		...(reaction === 'like' && action === 'add'
			? { description: "Also clears the reactor's dislike on the comment from before comment dislikes were turned off (2026-11-12)." }
			: reaction === 'dislike'
				? { description: "Clears a dislike stored before comment dislikes were turned off (2026-11-12). Idempotent." }
				: {}),
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
								dislikesCount: z.number().describe("Always 0: comment dislikes are hidden since 2026-11-12"),
								isLiked: z.boolean(),
								isDisliked: z.boolean().describe("Always false: comment dislikes are hidden since 2026-11-12"),
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
 * Shared implementation for comment like / unlike / remove-dislike. Liking
 * also clears the reactor's old dislike (applyCommentReaction), which queues
 * CommentUndislike. Comment dislikes are hidden: responses never show them.
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
	let ownChanged = false;
	let clearedDislike: { id?: string } | null = null;
	let comment = undefined as StoredComment | undefined;
	const { data: video, rejected } = await repository.updateObjectOrReject<true>(id, (fresh) => {
		changed = false;
		ownChanged = false;
		clearedDislike = null;
		comment = undefined;
		if (isVideoRemoved(fresh) || (fresh.isPublic === false && fresh.userId !== userId)) return { reject: true };
		// Top-level comments and replies can be reacted to; held comments cannot
		const target = findStoredComment(fresh.comments as unknown as StoredComment[], cid)?.comment;
		if (!target || !isCommentVisible(target) || target.status === 'held') return { reject: true };
		comment = target;
		if (reaction === 'like' && action === 'add') {
			clearedDislike = (target.dislikes || []).find((d) => d.channelId === channelId) ?? null;
		}
		const ownBefore = ((reaction === 'like' ? target.likes : target.dislikes) || []).length;
		changed = applyCommentReaction(target, reaction, action, entry);
		ownChanged = ((reaction === 'like' ? target.likes : target.dislikes) || []).length !== ownBefore;
		return changed;
	});

	if (!video || rejected || !comment) {
		return c.json({ success: false, error: "Object not found" }, 404);
	}

	if (changed && clearedDislike) {
		await new Queue(c.env.queue).send(MessageType.CommentUndislike, {
			dislikeId: (clearedDislike as { id?: string }).id,
			commentId: cid,
			videoId: id,
			userId,
			channelId,
			timestamp: entry.dateCreated,
		});
	}

	// Liking a comment already liked may only have cleared the old dislike: no second like event
	if (ownChanged) {
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

	logger.debug('[CommentReaction] Applied', { videoId: id, commentId: cid, channelId, reaction, action, changed });

	const likes = (comment as StoredComment).likes || [];
	return c.json({
		success: true,
		result: {
			commentId: cid,
			likesCount: likes.length,
			dislikesCount: PUBLIC_DISLIKES_COUNT,
			isLiked: likes.some((l) => l.channelId === channelId),
			isDisliked: false,
		},
	}, 200);
}
