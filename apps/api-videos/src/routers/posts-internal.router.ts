/**
 * /internal/posts/* — reads of community posts for the CMS (wiki AUN-SCHOLAR-SITES §6.3): www's post
 * page for a scholar post reads the community post through the CMS. Behind the INTERNAL_API_KEY
 * check of every /internal/* path (src/index.ts). Unlike the public GET, a read here never counts a
 * view (the page is cached; www reports nothing per visit here).
 *
 *   GET /internal/posts/:channelId/:postId → { post } with live like/comment counts
 *        404 when missing, deleted, not public or the channel is deleted or suspended
 *   GET /internal/posts/:channelId?limit=200 → { posts: [{ id, live, updatedAt }], complete }
 *        the channel's newest posts (index order) and whether each may have a www reference (published,
 *        public, not deleted or hidden, channel live): the CMS's nightly reference check (#1217).
 *        `complete` = the whole index fitted in `limit`. 404 when the channel is gone.
 */
import { Hono } from 'hono';
import { PostStatus, PostVisibility, type CommunityPost } from '@al-ummah/shared-types';
import { logger } from '../lib/logger';
import { rethrowBusy } from '../lib/r2Repo';
import { withPostCounts } from '../lib/post-counters';

type Env = { Bindings: { community_posts: R2Bucket; channels: R2Bucket; NOTIFICATIONS_DB?: D1Database } & Record<string, unknown> };
const ID = /^[A-Za-z0-9_-]{1,128}$/;

const app = new Hono<Env>();

/** Posts read per digest call at most (newest first); the nightly check repairs the newest. */
export const DIGEST_MAX = 200;
const DIGEST_CHUNK = 25;

app.get('/:channelId', async (c) => {
	const channelId = c.req.param('channelId');
	if (!ID.test(channelId)) return c.json({ error: 'bad_request' }, 400);
	const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') ?? '', 10) || DIGEST_MAX, 1), DIGEST_MAX);
	try {
		const ch = await c.env.channels.get(channelId);
		if (!ch) return c.json({ error: 'not_found' }, 404);
		const channel = (await ch.json()) as { isDeleted?: boolean; isSuspended?: boolean };
		const channelLive = !channel.isDeleted && !channel.isSuspended;
		const idx = await c.env.community_posts.get(`posts/${channelId}/index.json`);
		const ids = idx ? (((await idx.json()) as { postIds?: string[] }).postIds ?? []).filter((id) => ID.test(id)) : [];
		const page = ids.slice(0, limit);
		const posts: { id: string; live: boolean; updatedAt: string | null }[] = [];
		for (let i = 0; i < page.length; i += DIGEST_CHUNK) {
			const chunk = await Promise.all(
				page.slice(i, i + DIGEST_CHUNK).map(async (id) => {
					const obj = await c.env.community_posts.get(`posts/${channelId}/${id}.json`);
					if (!obj) return { id, live: false, updatedAt: null };
					const p = (await obj.json()) as CommunityPost & { isDeleted?: boolean; isHidden?: boolean };
					const live = channelLive && p.status === PostStatus.PUBLISHED && !p.isDeleted && !p.isHidden && (p.visibility ?? PostVisibility.PUBLIC) === PostVisibility.PUBLIC;
					return { id, live, updatedAt: p.updatedAt ?? p.createdAt ?? null };
				}),
			);
			posts.push(...chunk);
		}
		return c.json({ posts, complete: ids.length <= limit });
	} catch (error) {
		rethrowBusy(error);
		logger.error('[PostsInternal] digest failed', { channelId, error });
		return c.json({ error: 'internal_error' }, 500);
	}
});

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
