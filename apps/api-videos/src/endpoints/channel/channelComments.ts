/**
 * Studio Comments page (docs/specs/CREATOR-STUDIO.md §4.7, #771):
 *
 *   GET  /api/channels/:id/comments          one tab (inbox, held, removed) with filters
 *   GET  /api/channels/:id/comments/summary  counts per tab and the latest five published
 *   POST /api/channels/:id/comments/bulk     approve, remove, restore, hold, pin, heart (up to 50)
 *
 * All need `comment.moderate` on the channel through its channel role
 * (owner, admin, moderator); a site role never grants it. Rows come from the
 * channel_comments index (lib/channelComments), the text from R2.
 */
import { Num, Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import {
	can,
	channelRoleOf,
	STUDIO_COMMENT_ACTIONS,
	STUDIO_COMMENT_TABS,
	STUDIO_COMMENTS_BULK_MAX,
	STUDIO_COMMENTS_PAGE_DEFAULT,
	STUDIO_COMMENTS_PAGE_MAX,
	type SearchDb,
	type StudioComment,
	type StudioCommentAction,
	type StudioCommentTab,
} from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import { ResponseError } from '../../lib/types';
import { logger } from '../../lib/logger';
import { loadChannelRecord } from '../../lib/channelAccess';
import { countRows, countTabs, cursorAfter, executionCtxOf, listRows, type ChannelCommentKind, type RowQuery } from '../../lib/channelComments';
import { hydrateRows } from '../../lib/channelComments/hydrate';
import { ensureChannelIndexed } from '../../lib/channelComments/jobs';
import { moderatePostComment, moderateVideoComment, type ModerationOutcome } from '../../lib/channelComments/moderation';

export const StudioCommentSchema = z.object({
	id: z.string(),
	kind: z.enum(['video', 'post']),
	targetId: z.string(),
	targetTitle: z.string(),
	targetTitleLocalized: z.record(z.string(), z.string()).optional(),
	targetUrlPath: z.string(),
	parentId: z.string().nullable(),
	text: z.string(),
	createdAt: z.string(),
	author: z.object({ userId: z.string(), channelId: z.string().nullable(), displayName: z.string(), displayNameLocalized: z.record(z.string(), z.string()).optional(), avatarUrl: z.string().optional() }),
	status: z.enum(['published', 'held', 'removed']),
	heldBy: z.enum(['moderation', 'channel_block']).optional(),
	isPinned: z.boolean(),
	isHearted: z.boolean(),
	repliesCount: z.number(),
	hasChannelReply: z.boolean(),
	removedAt: z.string().optional(),
	removedBy: z.object({ userId: z.string(), displayName: z.string() }).optional(),
});

export const errorResponses = {
	'401': { description: 'Sign in required', content: { 'application/json': { schema: ResponseError } } },
	'403': { description: 'No comment moderation role on this channel', content: { 'application/json': { schema: ResponseError } } },
	'404': { description: 'Channel not found', content: { 'application/json': { schema: ResponseError } } },
	'503': { description: 'The comments index cannot be read right now; try again shortly', content: { 'application/json': { schema: ResponseError } } },
};

/** The caller may moderate this channel's comments (channel role, never a site role); a Response when not. */
export async function requireCommentModeration(c: AppContext, channelId: string, userId: string): Promise<Response | null> {
	const channel = await loadChannelRecord(c.env as never, channelId);
	if (!channel || channel.isDeleted) return c.json({ success: false, error: 'Channel not found' }, 404);
	if (!can(channelRoleOf(channel, userId), 'comment.moderate')) return c.json({ success: false, error: 'Forbidden' }, 403);
	return null;
}

function searchDb(c: AppContext): SearchDb | null {
	return (c.env.SEARCH_DB as unknown as SearchDb | undefined) ?? null;
}

const TARGET = /^(video|post):([A-Za-z0-9_-]{1,128})$/;
/** Rows a search (q) reads per request before it answers with what it found. */
export const SEARCH_SCAN_MAX = 300;

/** GET /api/channels/:id/comments */
export class ChannelCommentsList extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: "List a channel's comments for Studio",
		description:
			"One tab of the channel's comments on its videos and posts, newest first: `inbox` (published), `held` (held for review; platform moderation holds are included and flagged `heldBy: 'moderation'`, channel blocks are never listed), `removed` (removed by the channel in the last 90 days, most recently removed first). Filters: a text search (`q`), one video or post (`target=video:<id>` or `post:<id>`), top-level comments without a channel reply (`noReply=1`), comments with a link (`hasLink=1`). With `q` the index is read in pages of up to 300 comments per request, so a page can hold fewer than `limit` items while `nextCursor` is set, and `total` counts the comments matching the other filters. `indexing: true` while the channel's index is still being built. Needs `comment.moderate` on the channel.",
		request: {
			params: z.object({ id: Str({ description: 'Channel id' }) }),
			query: z.object({
				tab: z.enum(STUDIO_COMMENT_TABS as unknown as [StudioCommentTab, ...StudioCommentTab[]]).optional().default('inbox'),
				q: z.string().trim().max(200).optional(),
				target: z.string().regex(TARGET).optional().describe('video:<id> or post:<id>'),
				noReply: z.enum(['1', 'true', '0', 'false']).optional(),
				hasLink: z.enum(['1', 'true', '0', 'false']).optional(),
				cursor: z.string().max(400).optional(),
				limit: Num({ required: false, default: STUDIO_COMMENTS_PAGE_DEFAULT }),
			}),
		},
		responses: {
			'200': {
				description: 'One page of comments',
				content: {
					'application/json': {
						schema: z.object({ success: z.boolean(), items: z.array(StudioCommentSchema), nextCursor: z.string().nullable(), total: z.number(), indexing: z.boolean().optional() }),
					},
				},
			},
			...errorResponses,
		},
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const denied = await requireCommentModeration(c, params.id, userId);
		if (denied) return denied;
		const db = searchDb(c);
		if (!db) return c.json({ success: false, error: 'index_unavailable' }, 503);

		const tab = (query.tab ?? 'inbox') as StudioCommentTab;
		const limit = Math.min(Math.max(1, Math.floor(Number(query.limit) || STUDIO_COMMENTS_PAGE_DEFAULT)), STUDIO_COMMENTS_PAGE_MAX);
		const match = query.target ? TARGET.exec(query.target) : null;
		const rowQuery: RowQuery = {
			channelId: params.id,
			tab,
			target: match ? { kind: match[1] as ChannelCommentKind, id: match[2] } : null,
			noReply: query.noReply === '1' || query.noReply === 'true',
			hasLink: query.hasLink === '1' || query.hasLink === 'true',
		};

		const { indexing } = await ensureChannelIndexed(c.env as never, executionCtxOf(c as never), params.id);
		let items: StudioComment[];
		let nextCursor: string | null;
		let total: number;
		try {
			total = await countRows(db, rowQuery);
			if (query.q) {
				({ items, nextCursor } = await searchRows(c, db, rowQuery, query.q, query.cursor ?? null, limit, tab));
			} else {
				const page = await listRows(db, { ...rowQuery, cursor: query.cursor ?? null, limit });
				items = await hydrateRows(c.env as never, page.rows, tab);
				nextCursor = page.nextCursor;
			}
		} catch (error) {
			logger.warn('[ChannelComments] Index read failed', { channelId: params.id, tab, error: error instanceof Error ? error.message : String(error) });
			return c.json({ success: false, error: 'index_unavailable' }, 503);
		}

		logger.info('[ChannelComments] Listed', { channelId: params.id, tab, count: items.length, total, indexing, filtered: !!(query.q || match || rowQuery.noReply || rowQuery.hasLink) });
		return c.json({ success: true, items, nextCursor, total, ...(indexing ? { indexing: true } : {}) });
	}
}

/**
 * A text search: the text lives in R2, so rows are read in pages and matched
 * after hydration, at most SEARCH_SCAN_MAX rows per request. The cursor
 * resumes right after the last row read.
 */
async function searchRows(c: AppContext, db: SearchDb, rowQuery: RowQuery, q: string, cursor: string | null, limit: number, tab: StudioCommentTab): Promise<{ items: StudioComment[]; nextCursor: string | null }> {
	const needle = q.toLocaleLowerCase();
	const items: StudioComment[] = [];
	let scanned = 0;
	let next: string | null = cursor;
	while (items.length < limit && scanned < SEARCH_SCAN_MAX) {
		const page = await listRows(db, { ...rowQuery, cursor: next, limit: Math.min(100, SEARCH_SCAN_MAX - scanned) });
		if (!page.rows.length) return { items, nextCursor: null };
		const hydrated = new Map((await hydrateRows(c.env as never, page.rows, tab)).map((item) => [item.id, item]));
		for (const row of page.rows) {
			scanned++;
			next = cursorAfter(row, tab);
			const item = hydrated.get(row.commentId);
			if (item && (item.text.toLocaleLowerCase().includes(needle) || item.author.displayName.toLocaleLowerCase().includes(needle))) items.push(item);
			if (items.length >= limit) return { items, nextCursor: next };
		}
		if (!page.nextCursor) return { items, nextCursor: null };
	}
	return { items, nextCursor: next };
}

/** GET /api/channels/:id/comments/summary */
export class ChannelCommentsSummary extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: "Count a channel's comments per Studio tab",
		description: 'Inbox, Held and Removed totals and the five latest published comments (Dashboard and the Comments page). Needs `comment.moderate` on the channel.',
		request: { params: z.object({ id: Str({ description: 'Channel id' }) }) },
		responses: {
			'200': {
				description: 'Counts per tab and the latest comments',
				content: {
					'application/json': {
						schema: z.object({ success: z.boolean(), inbox: z.number(), held: z.number(), removed: z.number(), recent: z.array(StudioCommentSchema), indexing: z.boolean().optional() }),
					},
				},
			},
			...errorResponses,
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const denied = await requireCommentModeration(c, params.id, this.getUserId(c));
		if (denied) return denied;
		const db = searchDb(c);
		if (!db) return c.json({ success: false, error: 'index_unavailable' }, 503);
		const { indexing } = await ensureChannelIndexed(c.env as never, executionCtxOf(c as never), params.id);
		try {
			const [counts, page] = await Promise.all([countTabs(db, params.id), listRows(db, { channelId: params.id, tab: 'inbox', limit: 5 })]);
			const recent = await hydrateRows(c.env as never, page.rows, 'inbox');
			logger.info('[ChannelComments] Summary', { channelId: params.id, ...counts, indexing });
			return c.json({ success: true, ...counts, recent, ...(indexing ? { indexing: true } : {}) });
		} catch (error) {
			logger.warn('[ChannelComments] Index read failed', { channelId: params.id, error: error instanceof Error ? error.message : String(error) });
			return c.json({ success: false, error: 'index_unavailable' }, 503);
		}
	}
}

const BulkItem = z.object({
	kind: z.enum(['video', 'post']),
	targetId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
	commentId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});

/** POST /api/channels/:id/comments/bulk */
export class ChannelCommentsBulk extends AuthenticatedRoute {
	schema = {
		tags: ['Channels'],
		summary: "Act on up to 50 of a channel's comments",
		description:
			"Approve, remove, restore, hold, pin, unpin, heart or unheart comments on the channel's videos and posts. Each item must be on this channel (`not_in_channel` otherwise) and gets its own result: approving a comment held by platform moderation answers `held_by_moderation`; pinning replaces the video's or post's pinned comment; removing another person's comment is a soft removal (restorable for 90 days), removing your own deletes it. Needs `comment.moderate` on the channel.",
		request: {
			params: z.object({ id: Str({ description: 'Channel id' }) }),
			body: {
				content: {
					'application/json': {
						schema: z.object({
							action: z.enum(STUDIO_COMMENT_ACTIONS as unknown as [StudioCommentAction, ...StudioCommentAction[]]),
							items: z.array(BulkItem).min(1).max(STUDIO_COMMENTS_BULK_MAX),
						}),
					},
				},
			},
		},
		responses: {
			'200': {
				description: 'One result per item, in order',
				content: { 'application/json': { schema: z.object({ success: z.boolean(), results: z.array(z.object({ commentId: z.string(), ok: z.boolean(), error: z.string().optional() })) }) } },
			},
			'400': { description: 'Invalid action or items (1 to 50)', content: { 'application/json': { schema: ResponseError } } },
			...errorResponses,
		},
	};

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const denied = await requireCommentModeration(c, params.id, userId);
		if (denied) return denied;

		const videoChannels = new Map<string, string | null>();
		const results: Array<{ commentId: string; ok: boolean; error?: string }> = [];
		// One at a time: items on the same video would otherwise race for its record
		for (const item of body.items) {
			let outcome: ModerationOutcome;
			try {
				if (item.kind === 'video') {
					if (!videoChannels.has(item.targetId)) {
						const object = await c.env.videos.get(item.targetId);
						videoChannels.set(item.targetId, object ? (((await object.json()) as { channelId?: string | null }).channelId ?? null) : null);
					}
					outcome = videoChannels.get(item.targetId) === params.id
						? await moderateVideoComment(c as never, item.targetId, item.commentId, body.action, userId)
						: { ok: false, error: 'not_in_channel' };
				} else {
					// The post must be under this channel: it is read from posts/<channel>/<post>.json
					outcome = await moderatePostComment(c as never, params.id, item.targetId, item.commentId, body.action, userId);
					if (outcome.ok === false && outcome.error === 'not_found') {
						const elsewhere = !(await c.env.community_posts.head(`posts/${params.id}/${item.targetId}.json`));
						if (elsewhere) outcome = { ok: false, error: 'not_in_channel' };
					}
				}
			} catch (error) {
				logger.error('[ChannelComments] Bulk item failed', { channelId: params.id, action: body.action, commentId: item.commentId, error: error instanceof Error ? error.message : String(error) });
				outcome = { ok: false, error: 'failed' };
			}
			results.push(outcome.ok === false ? { commentId: item.commentId, ok: false, error: outcome.error } : { commentId: item.commentId, ok: true });
		}

		const succeeded = results.filter((r) => r.ok).length;
		// The audit line: who did what to which comments, when (each comment also stores `moderation`)
		logger.info('[ChannelComments] Bulk action', {
			channelId: params.id,
			actorUserId: userId,
			action: body.action,
			count: results.length,
			succeeded,
			failed: results.length - succeeded,
			commentIds: body.items.map((i) => i.commentId),
			at: new Date().toISOString(),
		});
		return c.json({ success: true, results });
	}
}
