import { Str } from "chanfana";
import { z } from "zod";
import type { Video } from "./types";
import R2Repository from "./r2Repo";

/**
 * Likes and dislikes belong to the member, not to a channel (#292).
 *
 * A member with a channel reacts as that channel (the `channelId` header,
 * already verified by channelIdMiddleware). A member without one reacts as
 * themselves: the web sends their user id as `channelId`, and a client may
 * leave the header out. Either way the stored reaction's `channelId` is the
 * identity the web compares against to show the button as pressed.
 */
export const ReactorHeaders = z.object({
	// chanfana hands an absent header to zod as null, not undefined
	channelId: Str({
		description: "Reacting channel. Members without a channel send their user id or leave it out.",
	// chanfana hands an absent header to zod as null, not undefined
	}).optional().nullable(),
});

/**
 * Public video payloads keep `dislikesCount` so older clients still decode
 * them, but it is always 0: dislikes are hidden (owner decision 2026-11-11)
 * and the ones stored before that are neither shown nor counted publicly.
 */
export const PUBLIC_DISLIKES_COUNT = 0;

export function reactorId(channelId: string | null | undefined, userId: string): string {
	return channelId || userId;
}

/**
 * Routes on which a member may act as themselves: channelIdMiddleware lets
 * the caller's own user id through as `channelId` here, and still requires a
 * real, owned channel everywhere else (uploads, posts, playlists, comments).
 */
const USER_SCOPED_ROUTE = /^\/api\/videos\/[^/]+\/(?:comments\/[^/]+\/)?(?:likes|dislikes)\/?$/;

export function isUserScopedRoute(path: string): boolean {
	return USER_SCOPED_ROUTE.test(path);
}

type VideoType = z.infer<typeof Video>;
type Reaction = NonNullable<VideoType["likes"]>[number];

/**
 * Idempotently add or remove the reactor's like/dislike on a video (#305).
 *
 * Resolves to the stored video and the reaction that this call added or
 * removed, or `changed: null` when there was nothing to do (already
 * reacted / nothing to remove), so callers only queue events for real
 * changes. Resolves to null when the video does not exist.
 *
 * Dislikes are no longer accepted (owner decision 2026-11-11, see
 * videoDislikeCreate.ts), so "dislikes" is only ever removed. Adding a like
 * also removes the reactor's dislike from before that date in the same write
 * (`clearedDislike`): the web no longer shows dislikes, and liking is how a
 * member takes theirs back.
 */
export async function applyVideoReaction(
	repository: R2Repository<VideoType>,
	videoId: string,
	kind: "likes" | "dislikes",
	action: "add" | "remove",
	reactor: { userId: string; channelId: string },
): Promise<{ video: VideoType; changed: Reaction | null; clearedDislike: Reaction | null } | null> {
	const mine = (r: Reaction) => r.channelId === reactor.channelId && r.entityId === videoId;
	let changed: Reaction | null = null;
	let clearedDislike: Reaction | null = null;

	// Conditional write: a concurrent reaction on this video is re-read, not overwritten.
	// `changed` is reset on every attempt so it reflects the write that landed.
	const video = await repository.updateObject(videoId, (fresh) => {
		changed = null;
		clearedDislike = null;
		if (kind === "likes" && action === "add") {
			const dislikes: Reaction[] = fresh.dislikes || [];
			clearedDislike = dislikes.find(mine) ?? null;
			if (clearedDislike) fresh.dislikes = dislikes.filter((r) => !mine(r));
		}
		const list: Reaction[] = fresh[kind] || [];
		fresh[kind] = list;
		const existing = list.find(mine);
		if (action === "add") {
			if (existing) return !!clearedDislike;
			changed = {
				id: crypto.randomUUID(),
				userId: reactor.userId,
				channelId: reactor.channelId,
				entityId: videoId,
				dateCreated: new Date().toISOString(),
			} as Reaction;
			list.push(changed);
			return true;
		}
		if (!existing) return false;
		changed = existing;
		fresh[kind] = list.filter((r) => !mine(r));
		return true;
	});

	if (!video) return null;
	video.likes = video.likes || [];
	video.dislikes = video.dislikes || [];
	return { video, changed, clearedDislike };
}
