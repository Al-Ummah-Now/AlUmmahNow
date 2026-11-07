/**
 * Resolve comment authors (channel name/avatar, falling back to the profile)
 * for a page of comments, loading each distinct channel/profile once.
 */

import { z } from 'zod';
import { Channel, Profile } from './types';
import R2Repository from './r2Repo';
import { logger } from './logger';
import { CommentAuthor, CommentListItem, CommentViewer, StoredComment, resolveCommentAuthor, toCommentListItem } from './comments';

type ChannelType = z.infer<typeof Channel>;
type ProfileType = z.infer<typeof Profile>;

interface AuthorEnv {
	channels: R2Bucket;
	profiles: R2Bucket;
}

export async function resolveCommentAuthors(
	env: AuthorEnv,
	comments: Array<Pick<StoredComment, 'userId' | 'channelId'>>,
	context: Record<string, unknown> = {},
): Promise<(comment: Pick<StoredComment, 'userId' | 'channelId'>) => CommentAuthor> {
	const channelRepo = new R2Repository<ChannelType>(env.channels);
	const profileRepo = new R2Repository<ProfileType>(env.profiles);

	const channelIds = [...new Set(comments.map((cm) => cm.channelId).filter(Boolean))];
	const channels = new Map<string, ChannelType | null>();
	await Promise.all(channelIds.map(async (cid) => {
		try {
			channels.set(cid, await channelRepo.getObject(cid));
		} catch (error) {
			logger.warn('[CommentAuthors] Failed to load comment channel', { ...context, channelId: cid, error: error instanceof Error ? error.message : String(error) });
			channels.set(cid, null);
		}
	}));

	const userIds = [...new Set(comments
		.filter((cm) => !channels.get(cm.channelId)?.name)
		.map((cm) => cm.userId)
		.filter(Boolean))];
	const profiles = new Map<string, ProfileType | null>();
	await Promise.all(userIds.map(async (uid) => {
		try {
			profiles.set(uid, await profileRepo.getObject(uid));
		} catch (error) {
			logger.warn('[CommentAuthors] Failed to load comment profile', { ...context, userId: uid, error: error instanceof Error ? error.message : String(error) });
			profiles.set(uid, null);
		}
	}));

	return (comment) => resolveCommentAuthor(comment, channels.get(comment.channelId), profiles.get(comment.userId));
}

/** Map stored comments to API items with resolved authors. */
export async function toCommentListItems(
	env: AuthorEnv,
	comments: StoredComment[],
	viewerChannelId: string | null | undefined,
	viewer: CommentViewer | undefined,
	context: Record<string, unknown> = {},
): Promise<CommentListItem[]> {
	const authorOf = await resolveCommentAuthors(env, comments, context);
	return comments.map((cm) => toCommentListItem(cm, authorOf(cm), viewerChannelId, viewer));
}
