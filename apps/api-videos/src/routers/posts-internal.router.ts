/**
 * /internal/posts/* — reads of community posts for the CMS (wiki AUN-SCHOLAR-SITES §6.3): www's post
 * page for a scholar post reads the community post through the CMS. Behind the INTERNAL_API_KEY
 * check of every /internal/* path (src/index.ts). Unlike the public GET, a read here never counts a
 * view (the page is cached; www reports nothing per visit here).
 *
 *   GET /internal/posts/:channelId/:postId → { post } with live like/comment counts
 *        404 when missing, deleted, not public or the channel is deleted or suspended
 */
import { Hono } from 'hono';
import { PostStatus, PostVisibility, type CommunityPost } from '@al-ummah/shared-types';
import { logger } from '../lib/logger';
import { rethrowBusy } from '../lib/r2Repo';
import { withPostCounts } from '../lib/post-counters';

type Env = { Bindings: { community_posts: R2Bucket; channels: R2Bucket; NOTIFICATIONS_DB?: D1Database } & Record<string, unknown> };
const ID = /^[A-Za-z0-9_-]{1,128}$/;

const app = new Hono<Env>();

app.get('/:channelId/:postId', async (c) => {
	const { channelId, postId } = c.req.param();
	if (!ID.test(channelId) || !ID.test(postId)) return c.json({ error: 'bad_request' }, 400);
	try {
		const obj = await c.env.community_posts.get(`posts/${channelId}/${postId}.json`);
		if (!obj) return c.json({ error: 'not_found' }, 404);
		const post = (await obj.json()) as CommunityPost & { isDeleted?: boolean };
		if (post.status === PostStatus.DELETED || post.status === PostStatus.DRAFT || post.isDeleted || (post.visibility ?? PostVisibility.PUBLIC) !== PostVisibility.PUBLIC) {
			return c.json({ error: 'not_found' }, 404);
		}
		const ch = await c.env.channels.get(channelId);
		const channel = ch ? ((await ch.json()) as { isDeleted?: boolean; isSuspended?: boolean }) : null;
		if (!channel || channel.isDeleted || channel.isSuspended) return c.json({ error: 'not_found' }, 404);
		await withPostCounts(c.env.NOTIFICATIONS_DB as never, [post]);
		// Viewer state is never part of this answer (it is cached and shared).
		delete post.viewerHasLiked;
		delete post.viewerPollVote;
		return c.json({ post });
	} catch (error) {
		rethrowBusy(error);
		logger.error('[PostsInternal] read failed', { channelId, postId, error });
		return c.json({ error: 'internal_error' }, 500);
	}
});

export default app;
