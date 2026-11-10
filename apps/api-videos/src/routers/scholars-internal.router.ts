/**
 * /internal/scholars/* — the CMS's service-to-service calls for scholars (AlUmmahNowCMS
 * docs/SCHOLARS.md §4). Behind the INTERNAL_API_KEY check of every /internal/* path (src/index.ts).
 * Every call names the auth user it acts for; channels must be that user's own.
 *
 *   GET    /internal/scholars/:userId/channels                → { channels: [{ id, name, handle, avatarUrl, isPublic }] }
 *   PUT    /internal/scholars/:userId/articles/:externalId     { channelId, title, excerpt, coverUrl, url, locale, publishedAt }
 *                                                            → { postId, channelId, created }
 *   DELETE /internal/scholars/:userId/articles/:externalId     → { hidden: true } (404 when it was never posted)
 */
import { Hono, type Context } from 'hono';
import type { Channel } from '@al-ummah/shared-types';
import { logger } from '../lib/logger';
import Queue, { MessageType } from '../lib/queue';
import R2Repository, { rethrowBusy } from '../lib/r2Repo';
import { ownedChannelIds } from '../lib/search/ownership';
import { ArticleError, hideArticle, parseArticle, upsertArticle, type ArticleEnv } from '../lib/scholar-articles';

type Env = { Bindings: ArticleEnv & { queue?: unknown } & Record<string, unknown> };
const USER_ID = /^[A-Za-z0-9_:.@-]{1,128}$/;

const app = new Hono<Env>();

function fail(c: Context<Env>, error: unknown) {
	if (error instanceof ArticleError) return c.json({ error: error.code }, error.status);
	rethrowBusy(error);
	logger.error('[ScholarsInternal] failed', { path: c.req.path, error });
	return c.json({ error: 'internal_error' }, 500);
}

app.get('/:userId/channels', async (c) => {
	const userId = c.req.param('userId');
	if (!USER_ID.test(userId)) return c.json({ error: 'bad_request' }, 400);
	// The ownership index: null until its channel pass is complete (the CMS then retries later).
	const ids = await ownedChannelIds(c.env as never, userId);
	if (!ids) return c.json({ error: 'index_incomplete' }, 503);
	const repo = new R2Repository<Channel & { isDeleted?: boolean; isPrivate?: boolean; handle?: string }>(c.env.channels);
	const channels = (await Promise.all(ids.slice(0, 50).map((id) => repo.getObject(id))))
		.filter((ch): ch is NonNullable<typeof ch> => !!ch && ch.userId === userId && !ch.isDeleted)
		.map((ch) => ({ id: ch.id, name: ch.name, handle: ch.handle ?? null, avatarUrl: ch.avatarUrl ?? null, isPublic: !ch.isPrivate && !ch.isSuspended }));
	return c.json({ channels });
});

app.put('/:userId/articles/:externalId', async (c) => {
	const userId = c.req.param('userId');
	if (!USER_ID.test(userId)) return c.json({ error: 'bad_request' }, 400);
	try {
		const input = parseArticle(await c.req.json().catch(() => null));
		const { post, created } = await upsertArticle(c.env, userId, c.req.param('externalId'), input);
		if (created && c.env.queue) {
			// Subscribers hear about it like any new community post.
			await new Queue(c.env.queue as never).send(MessageType.CommunityPostCreated, {
				postId: post.id,
				channelId: post.channelId,
				actor: { userId, channelId: post.channelId },
				timestamp: post.createdAt,
			});
		}
		return c.json({ postId: post.id, channelId: post.channelId, created }, created ? 201 : 200);
	} catch (error) {
		return fail(c, error);
	}
});

app.delete('/:userId/articles/:externalId', async (c) => {
	const userId = c.req.param('userId');
	if (!USER_ID.test(userId)) return c.json({ error: 'bad_request' }, 400);
	try {
		const m = await hideArticle(c.env, userId, c.req.param('externalId'));
		if (!m) return c.json({ error: 'not_found' }, 404);
		return c.json({ hidden: true, postId: m.postId });
	} catch (error) {
		return fail(c, error);
	}
});

export default app;
