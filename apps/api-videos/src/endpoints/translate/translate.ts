/**
 * Machine translation of titles and descriptions (AUN-CAPTIONS §5.8, §5.9; lib/translate/inline.ts).
 *
 *   POST /api/translate                                  { items[], from, to, field, videoId? }  the Translate button
 *   GET  /api/translate/usage                            today's fair-use allowance
 *   GET  /api/videos/:videoId/translated-metadata?lang=  viewer-side title/description (O6; channel opt-out, admin pause)
 *   GET  /api/channels/:channelId/translation-settings   the channel's viewer-title opt-out (channel.edit)
 *   PUT  /api/channels/:channelId/translation-settings   { viewerTitles }
 *
 * Inline translation is free on every tier with a daily fair-use limit (O5); the suggestion fills
 * the field and the creator reviews it before saving. Text inside {…} (a Quran quotation) is
 * never machine-translated.
 */
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { INLINE_TRANSLATE_FIELDS, INLINE_TRANSLATE_LIMITS, can, channelRoleOf, type VideoObject } from '@al-ummah/shared-types';
import { AuthenticatedRoute, PublicRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { loadChannelRecord } from '../../lib/channelAccess';
import { canViewVideo } from '../../lib/playlists';
import R2Repository from '../../lib/r2Repo';
import { readCaptionSettings } from '../../lib/captions/jobs';
import { channelAllowsViewerTitles, readFairUse, setChannelViewerTitles, TranslateHttpError, translateInline, viewerTranslation } from '../../lib/translate/inline';
import { logger } from '../../lib/logger';
import { featureOff } from '../../lib/features/off';
import { inlineTranslateConfigured, viewerTitlesConfigured } from '../../lib/features';
import { editableVideo } from '../captions/captionDrafts';

const Err = { 'application/json': { schema: z.object({ success: z.literal(false), error: z.string() }) } };
const FairUse = z.object({ used: z.number(), limit: z.number().describe('Texts per UTC day; cache hits are not counted'), resetsAt: z.string() });
const QuranRef = z.object({ range: z.string(), label: z.string() });

function failure(c: AppContext, error: unknown) {
	// Switched off since the page loaded: the Translate button is hidden, answered quietly
	if (error instanceof TranslateHttpError && error.code === 'translation_paused') return featureOff(c);
	if (error instanceof TranslateHttpError) return c.json({ success: false, error: error.code, ...error.extra }, error.status as 400);
	logger.error('[Translate] Request failed', { error: error instanceof Error ? error.message : String(error) });
	return c.json({ success: false, error: 'internal_error' }, 500);
}

export class TranslateCreate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Translation'],
			summary: 'Translate titles or descriptions',
			description:
				'A machine-translation suggestion for each text (the Translate button beside a title or description), to review before saving. Free with a daily fair-use limit per user (`429 fair_use_limit` with `limit`, `used` and `resetsAt`); answers served from the cache are not counted. Text inside {…} is a Quran quotation: it stays as written, followed by its reference when it is found in exactly one place. With `videoId` the caller must be able to edit that video. `404 feature_off` while an admin has it switched off, `503 budget_spent` once the day\'s translation budget is spent.',
			request: {
				body: {
					content: {
						'application/json': {
							schema: z.object({
								items: z
									.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/), text: z.string().max(INLINE_TRANSLATE_LIMITS.textChars) }))
									.min(1)
									.max(INLINE_TRANSLATE_LIMITS.texts),
								from: z.string().describe('Language of the texts (ISO 639-1)'),
								to: z.string().describe('Language wanted'),
								field: z.enum(INLINE_TRANSLATE_FIELDS).default('title'),
								videoId: z.string().optional(),
							}),
						},
					},
				},
			},
			responses: {
				'200': {
					description: 'Suggestions, in the order asked',
					content: {
						'application/json': {
							schema: z.object({
								success: z.literal(true),
								data: z.object({
									items: z.array(z.object({ id: z.string(), text: z.string(), quran: z.array(QuranRef).optional(), cached: z.boolean() })),
									provider: z.string(),
									machineTranslation: z.literal(true),
									fairUse: FairUse,
								}),
							}),
						},
					},
				},
				'400': { description: 'Invalid request', content: Err },
				'403': { description: 'Not allowed to edit the video', content: Err },
				'429': { description: 'Daily fair-use limit reached', content: Err },
				'503': { description: 'Paused by an admin, or the day\'s budget is spent', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		if (!inlineTranslateConfigured(c.env as never, await readCaptionSettings(c.env as never))) return featureOff(c, 'inlineTranslate');
		let context: { title?: string } | undefined;
		if (body.videoId) {
			const access = await editableVideo(c, body.videoId, userId);
			if ('response' in access) return access.response;
			if (body.field !== 'title' && access.video.title) context = { title: access.video.title.slice(0, 200) };
		}
		try {
			const result = await translateInline(c.env as never, {
				userId,
				items: body.items as Array<{ id: string; text: string }>,
				from: body.from.toLowerCase(),
				to: body.to.toLowerCase(),
				field: body.field,
				videoId: body.videoId ?? null,
				...(context ? { context } : {}),
			});
			return c.json({ success: true, data: { ...result, machineTranslation: true as const } });
		} catch (error) {
			return failure(c, error);
		}
	}
}

export class TranslateUsageGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Translation'],
			summary: "Today's translation allowance",
			responses: {
				'200': { description: 'Allowance', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ enabled: z.boolean(), fairUse: FairUse }) }) } } },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		try {
			const settings = await readCaptionSettings(c.env as never);
			return c.json({ success: true, data: { enabled: inlineTranslateConfigured(c.env as never, settings), fairUse: await readFairUse(c.env as never, this.getUserId(c), settings) } });
		} catch (error) {
			return failure(c, error);
		}
	}
}

export class VideoTranslatedMetadataGet extends PublicRoute {
	schema = {
		tags: ['Translation'],
		summary: "A public video's title and description translated for the viewer",
		description:
			'A machine translation of the title and description for a viewer of `lang`, shown labelled with "Show original". `translation` is null while an admin has paused it, when the channel opted out, when the creator wrote a title in that language, or when it is being made (`pending`). Never written into the creator\'s own text.',
		request: { params: z.object({ videoId: Str({ description: 'Video ID' }) }), query: z.object({ lang: z.string() }) },
		responses: {
			'200': {
				description: 'The translation, or null',
				content: {
					'application/json': {
						schema: z.object({
							success: z.literal(true),
							data: z.object({
								translation: z.object({ lang: z.string(), from: z.string(), title: z.string(), description: z.string().nullable(), provider: z.string() }).nullable(),
								pending: z.boolean(),
							}),
						}),
					},
				},
			},
			'404': { description: 'Video not found or not public', content: Err },
		},
	};

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const video = await new R2Repository<VideoObject>(c.env.videos).getObject(params.videoId);
		// Public videos only: a private or unlisted one is never sent to a model
		if (!video || !canViewVideo(video as never, null) || (video as { visibility?: string }).visibility === 'unlisted') return c.json({ success: false, error: 'video_not_found' }, 404);
		try {
			const result = await viewerTranslation(c.env as never, video, query.lang.toLowerCase());
			return c.json({ success: true, data: result }, 200, { 'Cache-Control': result.translation ? 'public, max-age=300' : 'no-store' });
		} catch (error) {
			return failure(c, error);
		}
	}
}

const channelParams = z.object({ channelId: Str({ description: 'Channel ID' }) });
const Settings = z.object({ viewerTitles: z.boolean().describe('Viewers of other languages may see a machine translation of titles and descriptions (when the platform has it on)'), platformEnabled: z.boolean() });

async function channelEditor(c: AppContext, channelId: string, userId: string): Promise<Response | null> {
	const channel = await loadChannelRecord(c.env as never, channelId);
	if (!channel || channel.isDeleted) return c.json({ success: false, error: 'channel_not_found' }, 404);
	if (!can(channelRoleOf(channel, userId), 'channel.edit')) return c.json({ success: false, error: 'forbidden' }, 403);
	return null;
}

export class ChannelTranslationSettingsGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Translation'],
			summary: "A channel's translation settings",
			request: { params: channelParams },
			responses: {
				'200': { description: 'Settings', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: Settings }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Channel not found', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const denied = await channelEditor(c, params.channelId, this.getUserId(c));
		if (denied) return denied;
		const settings = await readCaptionSettings(c.env as never);
		return c.json({ success: true, data: { viewerTitles: await channelAllowsViewerTitles(c.env as never, params.channelId), platformEnabled: viewerTitlesConfigured(c.env as never, settings) } });
	}
}

export class ChannelTranslationSettingsSet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Translation'],
			summary: "Change a channel's translation settings",
			request: { params: channelParams, body: { content: { 'application/json': { schema: z.object({ viewerTitles: z.boolean() }) } } } },
			responses: {
				'200': { description: 'Saved', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: Settings }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Channel not found', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const denied = await channelEditor(c, params.channelId, userId);
		if (denied) return denied;
		if (!viewerTitlesConfigured(c.env as never, await readCaptionSettings(c.env as never))) return featureOff(c, 'viewerTranslatedTitles');
		await setChannelViewerTitles(c.env as never, params.channelId, body.viewerTitles, userId);
		const settings = await readCaptionSettings(c.env as never);
		return c.json({ success: true, data: { viewerTitles: body.viewerTitles, platformEnabled: viewerTitlesConfigured(c.env as never, settings) } });
	}
}
