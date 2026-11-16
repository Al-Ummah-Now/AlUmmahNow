/**
 * Move from YouTube (wiki AUN-YT-IMPORT, docs/features/youtube-import.md): the
 * Studio wizard's API. Bearer auth; the rules live in lib/youtube-import/service.ts.
 *
 * Off or not configured (admin → Platform settings → YouTube import): every route answers 404 feature_off.
 *
 * GET  /api/youtube-import/available?channelId=        200 when on and the caller may import here (Studio shows the tab), else 404
 * GET  /api/youtube-import/status?channelId=           the latest import
 * POST /api/youtube-import/oauth/start                 { channelId, captions, locale } → { url } (Google consent)
 * GET  /api/youtube-import/oauth/callback              Google's redirect (plain route, index.ts): keeps the code → 302 to the wizard ?connect=<token>
 * POST /api/youtube-import/oauth/finish                { state: <connect token> } → { import } (only the user who started the consent)
 * GET  /api/youtube-import/:importId                   { import, items, playlists }
 * PUT  /api/youtube-import/:importId/selection         { itemIds, playlistIds, visibilityMode }
 * PUT  /api/youtube-import/:importId/matches           { matches: [{ itemId, match | null }] } (≤ 500)
 * POST /api/youtube-import/:importId/start             status → importing
 * POST /api/youtube-import/:importId/items/:itemId/retry
 * POST /api/youtube-import/:importId/cancel
 * GET  /api/youtube-import/:importId/link-back.csv     ?locale=en|ar
 *
 * Each video's file is uploaded through POST /api/videos/upload/initiate with
 * `youtubeImport: { importId, itemId }` and the normal resumable upload.
 */
import { z } from 'zod';
import type { YtFileMatch } from '@al-ummah/shared-types';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { ResponseError } from '../../lib/types';
import { logger } from '../../lib/logger';
import {
	MAX_MATCHES,
	MAX_SELECTION,
	YtHttpError,
	cancelImport,
	finishOAuth,
	importStatus,
	importAvailable,
	requireYtEnabled,
	linkBack,
	readImport,
	retryItem,
	saveMatches,
	saveSelection,
	startImport,
	startOAuth,
	type YtCaller,
	type YtEnv,
} from '../../lib/youtube-import/service';

const errors = {
	'400': { description: 'Invalid request', content: { 'application/json': { schema: ResponseError } } },
	'401': { description: 'Sign in first', content: { 'application/json': { schema: ResponseError } } },
	'403': { description: 'Not allowed to upload to this channel, or no creator tier (code uploads_by_invitation)', content: { 'application/json': { schema: ResponseError } } },
	'404': { description: 'No such import (code youtube_import_not_found) or channel; code feature_off on every route while the feature is off or not configured', content: { 'application/json': { schema: ResponseError } } },
	'409': { description: 'Not possible in this state (codes not_pickable, nothing_selected, not_failed, …)', content: { 'application/json': { schema: ResponseError } } },
	'503': { description: 'The import store or queue is not configured', content: { 'application/json': { schema: ResponseError } } },
};

const ImportParams = z.object({ importId: z.string().min(1).max(64) });
const MatchSchema = z
	.object({
		zipName: z.string().max(500),
		entryName: z.string().min(1).max(2000),
		fileName: z.string().min(1).max(500),
		size: z.number().int().nonnegative(),
		by: z.enum(['id', 'title', 'manual']),
	})
	.strict();

abstract class YtRoute extends AuthenticatedRoute {
	protected caller(c: AppContext): YtCaller {
		const auth = this.getAuth(c);
		return { userId: auth.userId, roles: (auth.payload as { roles?: string[] } | undefined)?.roles ?? null };
	}

	protected env(c: AppContext): YtEnv {
		return c.env as unknown as YtEnv;
	}

	/** Runs the action; a YtHttpError is the answer, anything else a 500 (logged). */
	protected async answer(c: AppContext, action: () => Promise<Record<string, unknown>>) {
		try {
			// Off or not configured: a quiet 404 on every route (Studio hides the feature)
			await requireYtEnabled(this.env(c));
			return c.json({ success: true, ...(await action()) });
		} catch (error) {
			if (error instanceof YtHttpError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
			throw error;
		}
	}
}

export class YoutubeImportAvailable extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: may this caller use it on this channel',
		description: 'For Studio\'s navigation: 200 when the feature is on and configured and the caller may import into the channel (role and creator tier); otherwise 404 (code feature_off).',
		request: { query: z.object({ channelId: z.string().min(1).max(64) }) },
		responses: { '200': { description: '{ available: true }' }, ...errors },
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		return this.answer(c, () => importAvailable(this.env(c), this.caller(c), query.channelId));
	}
}

export class YoutubeImportStatus extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: is it available, and the latest import',
		request: { query: z.object({ channelId: z.string().min(1).max(64) }) },
		responses: { '200': { description: '{ ready, captionsAvailable, import }' }, ...errors },
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		return this.answer(c, () => importStatus(this.env(c), this.caller(c), query.channelId));
	}
}

export class YoutubeImportOAuthStart extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: the Google consent URL',
		description: 'The browser goes to `url`; Google sends it back to /api/youtube-import/oauth/callback, which redirects to the wizard. `captions` also asks for the scope captions need.',
		request: {
			body: {
				content: {
					'application/json': { schema: z.object({ channelId: z.string().min(1).max(64), captions: z.boolean().default(false), locale: z.enum(['en', 'ar']).default('en') }) },
				},
			},
		},
		responses: { '200': { description: '{ url }' }, ...errors },
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		return this.answer(c, () => startOAuth(this.env(c), this.caller(c), body as { channelId: string; captions: boolean; locale: 'en' | 'ar' }));
	}
}

export class YoutubeImportOAuthFinish extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: finish the Google connection',
		description:
			'`state` is the `connect` token the callback put in the wizard URL (only the browser that completed the consent has it; the OAuth state is not accepted). Only the user who started the consent may finish it (403 otherwise, and the consent is used up); the code is exchanged here, and the import is created or connected. 404 youtube_connect_expired: unknown, used or older than 5 minutes.',
		request: { body: { content: { 'application/json': { schema: z.object({ state: z.string().min(1).max(128) }) } } } },
		responses: { '200': { description: '{ import }' }, ...errors, '502': { description: 'Google gave no lasting access (code failed)', content: { 'application/json': { schema: ResponseError } } } },
	};

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		return this.answer(c, () => finishOAuth(this.env(c), this.caller(c), (body as { state: string }).state));
	}
}

export class YoutubeImportGet extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: an import with its videos and playlists',
		request: { params: ImportParams },
		responses: { '200': { description: '{ import, items (newest first), playlists }' }, ...errors },
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		return this.answer(c, () => readImport(this.env(c), this.caller(c), params.importId));
	}
}

export class YoutubeImportSelection extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: the picked videos and playlists',
		description: 'The full picked sets. Videos an earlier import already brought are refused silently; a video whose upload started stays picked.',
		request: {
			params: ImportParams,
			body: {
				content: {
					'application/json': {
						schema: z.object({
							itemIds: z.array(z.string().max(64)).max(MAX_SELECTION),
							playlistIds: z.array(z.string().max(64)).max(MAX_SELECTION).default([]),
							visibilityMode: z.enum(['keep', 'private']).default('keep'),
						}),
					},
				},
			},
		},
		responses: { '200': { description: '{ import }' }, ...errors },
	};

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		return this.answer(c, async () => ({ import: await saveSelection(this.env(c), this.caller(c), params.importId, body as { itemIds: string[]; playlistIds: string[]; visibilityMode: 'keep' | 'private' }) }));
	}
}

export class YoutubeImportMatches extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: which Takeout file is which video',
		request: {
			params: ImportParams,
			body: {
				content: {
					'application/json': {
						schema: z.object({ matches: z.array(z.object({ itemId: z.string().max(64), match: MatchSchema.nullable() })).max(MAX_MATCHES) }),
					},
				},
			},
		},
		responses: { '200': { description: '{ updated }' }, ...errors },
	};

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		return this.answer(c, () => saveMatches(this.env(c), this.caller(c), params.importId, body.matches as { itemId: string; match: YtFileMatch | null }[]));
	}
}

export class YoutubeImportStart extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: start importing the picked videos',
		request: { params: ImportParams },
		responses: { '200': { description: '{ import }' }, ...errors },
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		return this.answer(c, async () => ({ import: await startImport(this.env(c), this.caller(c), params.importId) }));
	}
}

export class YoutubeImportRetryItem extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: try a failed video again',
		request: { params: ImportParams.extend({ itemId: z.string().min(1).max(64) }) },
		responses: { '200': { description: '{ item }' }, ...errors },
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		return this.answer(c, async () => ({ item: await retryItem(this.env(c), this.caller(c), params.importId, params.itemId) }));
	}
}

export class YoutubeImportCancel extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: stop the import (videos already here stay)',
		request: { params: ImportParams },
		responses: { '200': { description: '{ import }' }, ...errors },
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		return this.answer(c, async () => ({ import: await cancelImport(this.env(c), this.caller(c), params.importId) }));
	}
}

export class YoutubeImportLinkBack extends YtRoute {
	schema = {
		tags: ['YouTube import'],
		summary: 'Move from YouTube: CSV of YouTube links and their new pages',
		description: 'youtube_video_id,youtube_url,al_ummah_now_url,title for every imported video that is ready; the creator adds the links on YouTube themselves.',
		request: { params: ImportParams, query: z.object({ locale: z.enum(['en', 'ar']).default('en') }) },
		responses: { '200': { description: 'text/csv', content: { 'text/csv': { schema: z.string() } } }, ...errors },
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		try {
			await requireYtEnabled(this.env(c));
			const csv = await linkBack(this.env(c), this.caller(c), params.importId, query.locale);
			return new Response(csv, {
				headers: {
					'Content-Type': 'text/csv; charset=utf-8',
					'Content-Disposition': `attachment; filename="youtube-links-${params.importId.slice(0, 8)}.csv"`,
					'Cache-Control': 'no-store',
				},
			});
		} catch (error) {
			if (error instanceof YtHttpError) return c.json({ success: false, code: error.code, error: error.message }, error.status as 400);
			logger.error('[YouTubeImport] Link-back file failed', { importId: params.importId, error: error instanceof Error ? error.message : String(error) });
			throw error;
		}
	}
}
