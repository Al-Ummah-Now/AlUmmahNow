/**
 * People a channel blocked from commenting (docs/specs/CREATOR-STUDIO.md §4.7,
 * decision 8; lib/channelComments/blocks.ts):
 *
 *   GET    /api/channels/:id/blocks
 *   POST   /api/channels/:id/blocks          { userId }
 *   DELETE /api/channels/:id/blocks/:userId
 *
 * Need `comment.moderate` on the channel. Blocking is silent and per channel:
 * the person's new comments on the channel's videos and posts are held with
 * `heldBy: 'channel_block'`, seen only by them. The owner and the channel's
 * members cannot be blocked.
 */
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { channelRoleOf, type SearchDb } from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import { ResponseError } from '../../lib/types';
import { logger } from '../../lib/logger';
import { loadChannelRecord } from '../../lib/channelAccess';
import { resolveCommentAuthors } from '../../lib/commentAuthors';
import { addBlock, listBlocks, removeBlock } from '../../lib/channelComments/blocks';
import { errorResponses, requireCommentModeration } from './channelComments';

const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

function searchDb(c: AppContext): SearchDb | null {
	return (c.env.SEARCH_DB as unknown as SearchDb | undefined) ?? null;
}

const BlockSchema = z.object({ userId: z.string(), displayName: z.string(), avatarUrl: z.string().optional(), blockedAt: z.string() });

export class ChannelBlocksList extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'List the people a channel blocked from commenting',
		request: { params: z.object({ id: Str({ description: 'Channel id' }) }) },
		responses: {
			'200': { description: 'Blocked people, most recent first', content: { 'application/json': { schema: z.object({ success: z.boolean(), items: z.array(BlockSchema) }) } } },
			...errorResponses,
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const denied = await requireCommentModeration(c, params.id, this.getUserId(c));
		if (denied) return denied;
		const db = searchDb(c);
		if (!db) return c.json({ success: false, error: 'index_unavailable' }, 503);
		const blocks = await listBlocks(db, params.id);
		// Their own name and avatar (a block is of a person, not of a channel)
		const authorOf = await resolveCommentAuthors(c.env as never, blocks.map((b) => ({ userId: b.userId, channelId: null })));
		const items = blocks.map((b) => {
			const author = authorOf({ userId: b.userId, channelId: null });
			return { userId: b.userId, displayName: author.displayName, ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}), blockedAt: b.blockedAt };
		});
		return c.json({ success: true, items });
	}
}

export class ChannelBlockAdd extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'Block a person from commenting on the channel',
		description: "Silent: the person isn't told. Their new comments and replies on the channel's videos and posts stay visible only to them. 400 `cannot_block_member` for the owner or a channel member, 404 `user_not_found` for an unknown account.",
		request: {
			params: z.object({ id: Str({ description: 'Channel id' }) }),
			body: { content: { 'application/json': { schema: z.object({ userId: z.string().regex(USER_ID) }) } } },
		},
		responses: {
			'200': { description: 'Blocked (blocking again changes nothing)', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
			'400': { description: 'The owner or a member of the channel', content: { 'application/json': { schema: ResponseError } } },
			...errorResponses,
		},
	};

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const actor = this.getUserId(c);
		const denied = await requireCommentModeration(c, params.id, actor);
		if (denied) return denied;
		const db = searchDb(c);
		if (!db) return c.json({ success: false, error: 'index_unavailable' }, 503);
		const channel = await loadChannelRecord(c.env as never, params.id);
		if (channelRoleOf(channel, body.userId)) {
			return c.json({ success: false, error: 'cannot_block_member', message: 'The owner and members of the channel cannot be blocked' }, 400);
		}
		if (!(await c.env.profiles.head(body.userId))) return c.json({ success: false, error: 'user_not_found' }, 404);
		await addBlock(db, params.id, body.userId, actor);
		logger.info('[ChannelBlocks] Blocked', { channelId: params.id, userId: body.userId, actorUserId: actor });
		return c.json({ success: true });
	}
}

export class ChannelBlockRemove extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: 'Unblock a person on the channel',
		request: { params: z.object({ id: Str({ description: 'Channel id' }), userId: Str({ description: 'The blocked person' }) }) },
		responses: {
			'200': { description: 'Unblocked (or was not blocked)', content: { 'application/json': { schema: z.object({ success: z.boolean(), removed: z.boolean() }) } } },
			...errorResponses,
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const actor = this.getUserId(c);
		const denied = await requireCommentModeration(c, params.id, actor);
		if (denied) return denied;
		const db = searchDb(c);
		if (!db) return c.json({ success: false, error: 'index_unavailable' }, 503);
		const removed = await removeBlock(db, params.id, params.userId);
		logger.info('[ChannelBlocks] Unblocked', { channelId: params.id, userId: params.userId, actorUserId: actor, removed });
		return c.json({ success: true, removed });
	}
}
