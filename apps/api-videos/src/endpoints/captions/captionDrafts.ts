/**
 * Caption drafts (AUN-CAPTIONS §3.1, §3.3): the creator's editable machine captions.
 *
 *   GET    /api/videos/:videoId/captions/drafts                      every draft (summary)
 *   GET    /api/videos/:videoId/captions/drafts/:language            one draft with its cues
 *   PUT    /api/videos/:videoId/captions/drafts/:language            save edited cues over baseVersion
 *   DELETE /api/videos/:videoId/captions/drafts/:language            delete the draft (the live track stays)
 *   POST   /api/videos/:videoId/captions/drafts/:language/publish    publish baseVersion as the track
 *   GET    /api/videos/:videoId/captions/drafts/:language/download   the draft as a file (WebVTT or SubRip), Quran filled
 *   POST   /api/videos/:videoId/review/transcript/claim               the review transcript → a draft (queued)
 *   POST   /api/videos/:videoId/captions/drafts/:language/transcript  an on-device transcript (desktop Studio, D10) → a draft (queued)
 *
 * Owner or a channel role with `video.edit`. Drafts are never shown to viewers.
 */
import { Enumeration, Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { captionMarkerRanges, hasCaptionQuranMarkers, onDeviceTranscriptKey, renderCaptionVtt, validateCaptionCues, validateOnDeviceTranscript, type VideoObject } from '@al-ummah/shared-types';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { canOnVideo } from '../../lib/channelAccess';
import R2Repository from '../../lib/r2Repo';
import { patchVideo } from '../../lib/videoWrites';
import { SubtitleService } from '../../lib/subtitles';
import Queue, { MessageType } from '../../lib/queue';
import { logger } from '../../lib/logger';
import { deleteDraft, fillServedTrack, listDrafts, publishDraft, readDraft, readTracks, saveDraftCues, summariseDraft } from '../../lib/captions/drafts';
import { subtitleDownload, type SubtitleDownloadFormat } from '../../lib/captions/download';
import { editionFor } from '../../lib/quran/translations';
import { listClaims, queueClaim, reviewTranscriptKey, transcriptAvailable } from '../../lib/captions/claim';
import { revokeKidsVideoOnEdit } from '../../lib/kids/revoke-on-edit';

const Segment = z.union([
	z.object({ type: z.literal('speech'), text: z.string() }),
	z.object({
		type: z.literal('quran'),
		range: z.string().describe('surah:ayah:word-surah:ayah:word'),
		status: z.enum(['confirmed', 'context', 'basmala', 'review', 'accepted']),
		alternatives: z.array(z.string()).optional(),
		heard: z.string().optional().describe('What speech-to-text heard; never shown, kept for "Not Quran"'),
	}),
]);
const Cue = z.object({ id: z.string(), startMs: z.number().int(), endMs: z.number().int(), segments: z.array(Segment) });
const Summary = z.object({
	language: z.string(),
	version: z.number(),
	kind: z.enum(['source', 'translation']),
	origin: z.enum(['review_transcript', 'transcription', 'translation', 'on_device']),
	edited: z.boolean(),
	cues: z.number(),
	pendingQuran: z.number().describe('Quran suggestions not yet accepted'),
	updatedAt: z.string(),
	sourceLanguage: z.string().optional().describe('A machine translation: the draft it was translated from'),
	sourceVersion: z.number().optional().describe('A machine translation: the source draft version translated'),
	sourceTrack: z.literal('published').optional().describe('A machine translation of the source language\'s published track, which had no draft (TA-20); no sourceVersion then'),
	publishedVersion: z.number().optional(),
	publishedAt: z.string().optional(),
	track: z.enum(['none', 'machine', 'upload']).describe('The live track of this language, if any'),
});
const Draft = Summary.extend({
	cues: z.array(Cue),
	cueCount: z.number(),
	/** A translated draft with Quran spans: the Quran Foundation translation its viewers see there (the channel's, else the site's) */
	quranEdition: z.object({ name: z.string() }).nullable().optional(),
});
const Err = { 'application/json': { schema: z.object({ success: z.literal(false), error: z.string() }) } };
const params = z.object({ videoId: Str({ description: 'Video ID' }), language: Str({ description: 'ISO 639-1 code' }) });

type Access = { video: VideoObject } | { response: Response };

export async function editableVideo(c: AppContext, videoId: string, userId: string): Promise<Access> {
	const video = await new R2Repository<VideoObject>(c.env.videos).getObject(videoId);
	if (!video) return { response: c.json({ success: false, error: 'video_not_found' }, 404) };
	if (!(await canOnVideo(c.env as never, video, userId, 'video.edit'))) return { response: c.json({ success: false, error: 'forbidden' }, 403) };
	return { video };
}

const validLanguage = (language: string) => new SubtitleService().validateLanguage(language);

export class CaptionDraftsList extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'List caption drafts of a video',
			request: { params: z.object({ videoId: Str({ description: 'Video ID' }) }) },
			responses: {
				'200': {
					description: 'Drafts, claims of the review transcript in progress or failed, and whether a review transcript can be claimed',
					content: {
						'application/json': {
							schema: z.object({
								success: z.literal(true),
								data: z.object({
									drafts: z.array(Summary),
									claims: z.array(z.object({ language: z.string(), status: z.enum(['queued', 'failed']), requestedAt: z.string(), error: z.string().optional() })),
									transcriptAvailable: z.boolean(),
								}),
							}),
						},
					},
				},
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Video not found', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const access = await editableVideo(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		const [drafts, tracks, claims, transcript] = await Promise.all([
			listDrafts(c.env.subtitles, params.videoId),
			readTracks(c.env.subtitles, params.videoId),
			listClaims(c.env.subtitles, params.videoId),
			transcriptAvailable(c.env.MEDIA_PRIVATE, reviewTranscriptKey(access.video as never)),
		]);
		return c.json({
			success: true,
			data: {
				drafts: drafts.map((d) => summariseDraft(d, tracks.find((t) => t.language === d.language))),
				claims: claims.map(({ language, status, requestedAt, error }) => ({ language, status, requestedAt, ...(error ? { error } : {}) })),
				transcriptAvailable: transcript,
			},
		});
	}
}

export class CaptionDraftGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'Get a caption draft with its cues',
			request: { params },
			responses: {
				'200': { description: 'The draft', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: Draft }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such video or draft', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const access = await editableVideo(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		const draft = validLanguage(params.language) ? await readDraft(c.env.subtitles, params.videoId, params.language) : null;
		if (!draft) return c.json({ success: false, error: 'draft_not_found' }, 404);
		const tracks = await readTracks(c.env.subtitles, params.videoId);
		const summary = summariseDraft(draft, tracks.find((t) => t.language === draft.language));
		const hasQuran = draft.cues.some((cue) => cue.segments.some((s) => s.type === 'quran'));
		const edition = draft.kind === 'translation' && hasQuran ? await editionFor(c.env as never, access.video.channelId, draft.language) : null;
		return c.json({ success: true, data: { ...summary, cueCount: summary.cues, cues: draft.cues, quranEdition: edition ? { name: edition.name } : null } });
	}
}

export class CaptionDraftSave extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'Save edited cues of a caption draft',
			description: 'Saves over `baseVersion`, the version the editor loaded. 409 `draft_conflict` with the current version when it changed meanwhile.',
			request: {
				params,
				body: { content: { 'application/json': { schema: z.object({ baseVersion: z.number().int().min(1), cues: z.array(z.any()) }) } } },
			},
			responses: {
				'200': { description: 'Saved', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: Summary }) } } },
				'400': { description: 'Invalid cues', content: Err },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such video or draft', content: Err },
				'409': { description: 'The draft changed since it was loaded', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const access = await editableVideo(c, params.videoId, userId);
		if ('response' in access) return access.response;
		if (!validLanguage(params.language)) return c.json({ success: false, error: 'draft_not_found' }, 404);
		const checked = validateCaptionCues(body.cues);
		if (!checked.ok) {
			const failed = checked as Extract<typeof checked, { ok: false }>;
			return c.json({ success: false, error: failed.error, ...(failed.cue !== undefined ? { cue: failed.cue } : {}) }, 400);
		}
		const outcome = await saveDraftCues(c.env.subtitles, params.videoId, params.language, body.baseVersion, (checked as Extract<typeof checked, { ok: true }>).cues, userId);
		if (outcome.status === 'missing') return c.json({ success: false, error: 'draft_not_found' }, 404);
		if (outcome.status === 'conflict') return c.json({ success: false, error: 'draft_conflict', version: (outcome as Extract<typeof outcome, { status: 'conflict' }>).version }, 409);
		const draft = (outcome as Extract<typeof outcome, { status: 'ok' }>).draft;
		const tracks = await readTracks(c.env.subtitles, params.videoId);
		return c.json({ success: true, data: summariseDraft(draft, tracks.find((t) => t.language === draft.language)) });
	}
}

export class CaptionDraftDelete extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'Delete a caption draft',
			description: 'The published track of the language, if any, stays (delete it with DELETE /subtitles/:language).',
			request: { params },
			responses: {
				'200': { description: 'Deleted', content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such video or draft', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const access = await editableVideo(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		if (!validLanguage(params.language) || !(await readDraft(c.env.subtitles, params.videoId, params.language))) return c.json({ success: false, error: 'draft_not_found' }, 404);
		await deleteDraft(c.env.subtitles, params.videoId, params.language);
		return c.json({ success: true });
	}
}

export class CaptionDraftPublish extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'Publish a caption draft as the video\'s track',
			description:
				'Publishes `baseVersion` (409 `draft_conflict` if the draft changed). Quran the creator accepted shows the official text from Quran Foundation when served; unconfirmed suggestions show a reference with a quran.com link. 409 `replaces_upload` when a track the creator uploaded exists in that language and `replaceUpload` is not set.',
			request: {
				params,
				body: { content: { 'application/json': { schema: z.object({ baseVersion: z.number().int().min(1), replaceUpload: z.boolean().optional() }) } } },
			},
			responses: {
				'200': { description: 'Published', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ draft: Summary, track: z.any() }) }) } } },
				'400': { description: 'Nothing to publish', content: Err },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such video or draft', content: Err },
				'409': { description: 'Draft changed, or would replace an uploaded track', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const access = await editableVideo(c, params.videoId, userId);
		if ('response' in access) return access.response;
		if (!validLanguage(params.language)) return c.json({ success: false, error: 'draft_not_found' }, 404);
		await revokeKidsVideoOnEdit(c.env, {
			videoId: params.videoId,
			actorId: userId,
			reason: 'caption_publish',
			force: true,
		});
		const outcome = await publishDraft(c.env.subtitles, {
			videoId: params.videoId,
			language: params.language,
			baseVersion: body.baseVersion,
			userId,
			replaceUpload: body.replaceUpload === true,
			apiBaseUrl: c.env.Audience || new URL(c.req.url).origin,
		});
		switch (outcome.status) {
			case 'missing':
				return c.json({ success: false, error: 'draft_not_found' }, 404);
			case 'conflict':
				return c.json({ success: false, error: 'draft_conflict', version: (outcome as Extract<typeof outcome, { status: 'conflict' }>).version }, 409);
			case 'replaces_upload':
				return c.json({ success: false, error: 'replaces_upload' }, 409);
			case 'empty':
				return c.json({ success: false, error: 'draft_empty' }, 400);
		}
		const ok = outcome as Extract<typeof outcome, { status: 'ok' }>;
		const saved = await patchVideo(new R2Repository<VideoObject>(c.env.videos), params.videoId, {
			subtitles: ok.tracks,
			hasSubtitles: ok.tracks.length > 0,
			subtitleLanguages: ok.tracks.map((t) => t.language),
			dateModified: new Date().toISOString(),
		}, { ownerId: access.video.userId });
		if (saved.status !== 'ok') logger.warn('[Captions] Track published but the video record was not updated', { videoId: params.videoId, status: saved.status });
		await new Queue(c.env.queue).send(MessageType.VideoEdit, {
			videoId: params.videoId,
			userId,
			channelId: access.video.channelId,
			timestamp: new Date().toISOString(),
			action: 'caption_publish',
			language: params.language,
		});
		return c.json({ success: true, data: { draft: summariseDraft(ok.draft, ok.track), track: ok.track } });
	}
}

/**
 * A draft as a file for its editors (owner or `video.edit`), before or after it is published: rendered
 * as publishing would render it (Quran as markers), then filled exactly as a served track is — accepted
 * spans with the official text from our Quran Foundation copy (a translation draft with the channel's
 * edition), unconfirmed suggestions as references — unaltered, the attribution and edition inside the
 * file. One video, one language; built per request and never stored (QF 2026-11-22).
 */
export class CaptionDraftDownload extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'Download a caption draft as a file',
			description:
				'The draft as it would be published, as an attachment (WebVTT or SubRip). Quran verse text the creator accepted is filled at download time from the Quran Foundation copy, unaltered, with the attribution and edition inside the file; unconfirmed suggestions are references. Owner or a channel role with `video.edit`. Never cached or stored. 400 `draft_empty` when no cue has text.',
			request: {
				params,
				query: z.object({ format: Enumeration({ description: 'File format', values: ['vtt', 'srt'], default: 'vtt' }) }),
			},
			responses: {
				'200': { description: 'The draft file (attachment)', content: { 'text/vtt': { schema: z.string() }, 'application/x-subrip': { schema: z.string() } } },
				'400': { description: 'Nothing in the draft yet', content: Err },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such video or draft', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const access = await editableVideo(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		const draft = validLanguage(params.language) ? await readDraft(c.env.subtitles, params.videoId, params.language) : null;
		if (!draft) return c.json({ success: false, error: 'draft_not_found' }, 404);
		const format = ((query.format as string) || 'vtt') as SubtitleDownloadFormat;
		const vtt = renderCaptionVtt(draft);
		if (!vtt.includes(' --> ')) return c.json({ success: false, error: 'draft_empty' }, 400);

		const quran = hasCaptionQuranMarkers(vtt);
		const translated = quran && draft.kind === 'translation';
		const edition = translated ? await editionFor(c.env as never, access.video.channelId, draft.language) : null;
		const filled = quran
			? await fillServedTrack(vtt, draft.language, c.env.MEDIA_PRIVATE, translated && captionMarkerRanges(vtt).translation.length ? { env: c.env as never, edition } : undefined)
			: vtt;
		const body = subtitleDownload(filled, format, quran ? { edition: translated ? edition : null } : null);
		const safe = (s: string) => s.replace(/[^\w.-]/g, '_');
		return new Response(body, {
			status: 200,
			headers: {
				'Content-Type': format === 'srt' ? 'application/x-subrip; charset=utf-8' : 'text/vtt; charset=utf-8',
				'Content-Disposition': `attachment; filename="${safe(params.videoId)}-${safe(draft.language)}-draft-v${draft.version}.${format}"`,
				// Filled per request from a copy that must stay within 7 days of QF: never kept anywhere
				'Cache-Control': 'no-store',
			},
		});
	}
}

export class ReviewTranscriptClaim extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'Use the automatic review transcript as a caption draft',
			description:
				'Opt-in (VR11). Queues a job that turns the video review\'s transcript into a caption draft of `language`, with Quran shown only as references to the official text. 202 when queued; 404 `transcript_not_found` when the review media no longer hold one; 409 `draft_exists` (pass `replace`) or `claim_pending`.',
			request: {
				params: z.object({ videoId: Str({ description: 'Video ID' }) }),
				body: { content: { 'application/json': { schema: z.object({ language: z.string().describe('The language spoken in the video'), replace: z.boolean().optional() }) } } },
			},
			responses: {
				'202': { description: 'Queued', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ status: z.literal('queued') }) }) } } },
				'400': { description: 'Unsupported language', content: Err },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such video or no transcript', content: Err },
				'409': { description: 'A draft exists, or a claim is in progress', content: Err },
				'503': { description: 'Could not queue the job', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const access = await editableVideo(c, params.videoId, userId);
		if ('response' in access) return access.response;
		if (!validLanguage(body.language)) return c.json({ success: false, error: 'unsupported_language' }, 400);
		const transcriptKey = reviewTranscriptKey(access.video as never);
		if (!(await transcriptAvailable(c.env.MEDIA_PRIVATE, transcriptKey))) return c.json({ success: false, error: 'transcript_not_found' }, 404);
		const exists = !!(await readDraft(c.env.subtitles, params.videoId, body.language));
		let outcome;
		try {
			outcome = await queueClaim(
				{ subtitles: c.env.subtitles, queue: c.env.queue },
				{ videoId: params.videoId, language: body.language, transcriptKey: transcriptKey!, requestedBy: userId, ...(body.replace ? { replace: true } : {}) },
				exists,
			);
		} catch (error) {
			logger.error('[Captions] Claim could not be queued', { videoId: params.videoId, error: error instanceof Error ? error.message : String(error) });
			return c.json({ success: false, error: 'queue_unavailable' }, 503);
		}
		if (outcome.status === 'draft_exists') return c.json({ success: false, error: 'draft_exists' }, 409);
		if (outcome.status === 'pending') return c.json({ success: false, error: 'claim_pending' }, 409);
		return c.json({ success: true, data: { status: 'queued' as const } }, 202);
	}
}

const ENGINE_PROVIDER = /^[a-z0-9][a-z0-9.+-]{0,39}$/;
const ENGINE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/;

/** A timed piece of speech, or a Quran span the device matched: its reference only, never its words */
export const OnDeviceSegmentSchema = z.object({
	startMs: z.number(),
	endMs: z.number(),
	text: z.string().optional(),
	quran: z
		.object({
			range: z.string().describe('surah:ayah:word-surah:ayah:word'),
			status: z.enum(['confirmed', 'context', 'basmala', 'review']).optional(),
			alternatives: z.array(z.string()).optional(),
		})
		.optional()
		.describe('A Quran span matched on the device (no text with it)'),
});

export type OnDeviceSubmitOutcome =
	| { ok: true; segments: number }
	| { ok: false; status: 400 | 409 | 503; error: 'invalid_transcript' | 'draft_exists' | 'claim_pending' | 'queue_unavailable'; reason?: string; segment?: number };

/**
 * Checks an on-device transcript, stores it and queues the claim job that drafts it. Shared by
 * desktop Studio (the creator) and the admin importer (wiki TOOLS-ADMIN TA-7, `requestedBy` the admin).
 */
export async function submitOnDeviceTranscript(
	env: { subtitles: R2Bucket; queue: { send(m: unknown): Promise<unknown> } },
	d: { videoId: string; language: string; segments: unknown; engine: { provider: string; model?: string }; replace?: boolean; requestedBy: string },
): Promise<OnDeviceSubmitOutcome> {
	if (!ENGINE_PROVIDER.test(d.engine.provider) || (d.engine.model !== undefined && !ENGINE_MODEL.test(d.engine.model))) {
		return { ok: false, status: 400, error: 'invalid_transcript', reason: 'engine' };
	}
	const checked = validateOnDeviceTranscript(d.segments);
	if (!checked.ok) {
		const failed = checked as Extract<typeof checked, { ok: false }>;
		return { ok: false, status: 400, error: 'invalid_transcript', reason: failed.error, ...(failed.segment !== undefined ? { segment: failed.segment } : {}) };
	}
	const segments = (checked as Extract<typeof checked, { ok: true }>).segments;
	const exists = !!(await readDraft(env.subtitles, d.videoId, d.language));
	if (exists && !d.replace) return { ok: false, status: 409, error: 'draft_exists' };
	const transcriptKey = onDeviceTranscriptKey(d.videoId, d.language);
	const engine = { provider: d.engine.provider, ...(d.engine.model ? { model: d.engine.model } : {}) };
	let outcome;
	try {
		await env.subtitles.put(transcriptKey, JSON.stringify({ videoId: d.videoId, segments }), { httpMetadata: { contentType: 'application/json' } });
		outcome = await queueClaim(
			{ subtitles: env.subtitles, queue: env.queue },
			{ videoId: d.videoId, language: d.language, transcriptKey, source: 'on_device', engine, requestedBy: d.requestedBy, ...(d.replace ? { replace: true } : {}) },
			exists,
		);
	} catch (error) {
		logger.error('[Captions] On-device transcript could not be queued', { videoId: d.videoId, error: error instanceof Error ? error.message : String(error) });
		return { ok: false, status: 503, error: 'queue_unavailable' };
	}
	if (outcome.status === 'draft_exists') return { ok: false, status: 409, error: 'draft_exists' };
	if (outcome.status === 'pending') return { ok: false, status: 409, error: 'claim_pending' };
	logger.info('[Captions] On-device transcript queued', { videoId: d.videoId, language: d.language, segments: segments.length, engine: engine.provider });
	return { ok: true, segments: segments.length };
}

export class OnDeviceTranscriptSubmit extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Captions'],
			summary: 'Turn a transcript made on the creator\'s computer into a caption draft',
			description:
				'D10: desktop Studio can transcribe on the creator\'s computer (free, Core\'s whisper.cpp). It sends the timed segments here; a queued job runs the same Quran matcher as server transcription and writes the draft of `language` (origin `on_device`), with Quran shown only as references to the official text. Uses no caption minutes. 202 when queued; 400 `invalid_transcript` (with `reason` and `segment`); 409 `draft_exists` (pass `replace`) or `claim_pending`.',
			request: {
				params,
				body: {
					content: {
						'application/json': {
							schema: z.object({
								segments: z.array(OnDeviceSegmentSchema).describe('Timed speech, in order'),
								engine: z.object({ provider: z.string().describe('e.g. whisper.cpp'), model: z.string().optional().describe('e.g. large-v3-turbo-q5_0') }),
								replace: z.boolean().optional(),
							}),
						},
					},
				},
			},
			responses: {
				'202': { description: 'Queued', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ status: z.literal('queued'), segments: z.number() }) }) } } },
				'400': { description: 'Unsupported language or invalid transcript', content: Err },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'No such video', content: Err },
				'409': { description: 'A draft exists, or a claim is in progress', content: Err },
				'503': { description: 'Could not queue the job', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const access = await editableVideo(c, params.videoId, userId);
		if ('response' in access) return access.response;
		if (!validLanguage(params.language)) return c.json({ success: false, error: 'unsupported_language' }, 400);
		const out = await submitOnDeviceTranscript(c.env as never, { videoId: params.videoId, language: params.language, segments: body.segments, engine: body.engine, replace: body.replace, requestedBy: userId });
		if (out.ok === false) {
			const { ok: _ok, status, ...error } = out;
			return c.json({ success: false, ...error }, status);
		}
		return c.json({ success: true, data: { status: 'queued' as const, segments: out.segments } }, 202);
	}
}
