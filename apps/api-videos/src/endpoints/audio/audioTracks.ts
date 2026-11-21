/**
 * Audio tracks of a video (wiki AUN-MULTI-AUDIO): Studio adds dubs, commentary or audio
 * description, uploads the file in chunks, and edits or deletes tracks.
 *
 *   GET    /api/videos/:videoId/audio-tracks                    tracks, package state, tier limit, detected streams
 *   POST   /api/videos/:videoId/audio-tracks                    add a track (402 upgrade_required over the tier limit)
 *   PUT    /api/videos/:videoId/audio-tracks/:trackId/upload    one chunk (raw body; endpoints/audio/upload.ts)
 *   POST   /api/videos/:videoId/audio-tracks/:trackId/complete  the file is whole: processing starts
 *   POST   /api/videos/:videoId/audio-tracks/:trackId/retry     a failed track: process again
 *   PATCH  /api/videos/:videoId/audio-tracks/:trackId           language, label, kind, default
 *   DELETE /api/videos/:videoId/audio-tracks/:trackId           remove an extra track
 *   POST   /api/videos/:videoId/audio-tracks/detect             look for audio streams in the video file
 *
 * Owner or a channel role with `video.edit`.
 */
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { featureOff } from '../../lib/features/off';
import { FEATURE_OFF_CODE, AUDIO_TRACKS_ENTITLEMENT, AUDIO_TRACK_KINDS, AUDIO_TRACK_LANGUAGES, AUDIO_TRACK_STATES, type AudioTrack } from '@al-ummah/shared-types';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import { editableVideo } from '../captions/captionDrafts';
import { AudioTrackError, addTrack, completeUpload, deleteTrack, requestProbe, retryTrack, studioTrack, studioView, updateTrack } from '../../lib/audio-tracks/service';

const languages = AUDIO_TRACK_LANGUAGES.map((l) => l.code) as [string, ...string[]];
const Track = z.object({
	id: z.string(),
	language: z.enum(languages),
	label: z.string(),
	kind: z.enum(AUDIO_TRACK_KINDS),
	isDefault: z.boolean(),
	state: z.enum(AUDIO_TRACK_STATES).describe('uploading, processing, checking (review), in_review (a person decides), rejected, ready, failed'),
	source: z.enum(['original', 'upload', 'source_stream']),
	fileName: z.string().optional(),
	bytes: z.number().optional(),
	uploadedBytes: z.number().optional().describe('While uploading: bytes stored, where to resume'),
	durationSeconds: z.number().optional(),
	reasonCode: z.string().optional().describe('Rejected: the reviewer’s reason'),
	error: z.string().optional().describe('Failed: processing_failed or unreadable_file'),
	createdAt: z.string(),
});
const Detected = z.object({ index: z.number(), language: z.string().optional(), title: z.string().optional(), channels: z.number().optional(), codec: z.string().optional() });
const View = z.object({
	tracks: z.array(Track),
	package: z.object({ status: z.enum(['none', 'building', 'ready', 'failed']), playing: z.boolean().describe('Viewers hear the tracks now') }),
	limit: z.object({ allowed: z.number().describe('Extra tracks the tier allows on one video'), used: z.number(), unlimited: z.boolean() }),
	detected: z.array(Detected).nullable().describe('Audio streams found in the video file; null when it was never checked'),
	detecting: z.boolean(),
	ready: z.boolean().describe('The video finished processing: tracks can be added'),
});
const Err = { 'application/json': { schema: z.object({ success: z.literal(false), error: z.string(), message: z.string().optional() }) } };
const videoParams = z.object({ videoId: Str({ description: 'Video ID' }) });
const trackParams = z.object({ videoId: Str({ description: 'Video ID' }), trackId: Str({ description: 'Track ID' }) });
const TrackFields = {
	language: z.enum(languages),
	label: z.string().max(60).optional().describe('Defaults to the language’s own name'),
	kind: z.enum(AUDIO_TRACK_KINDS),
	isDefault: z.boolean().optional(),
};

type RolesAuth = { payload?: { roles?: string[] } } | undefined;
const rolesOf = (c: AppContext) => (c.get('auth' as never) as RolesAuth)?.payload?.roles;
const ctxOf = (c: AppContext) => {
	try {
		return c.executionCtx;
	} catch {
		return undefined;
	}
};

function failure(c: AppContext, error: unknown) {
	if (error instanceof AudioTrackError) return c.json({ success: false, error: error.code, message: error.message, ...error.extra }, error.status);
	logger.error('[AudioTracks] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
	return c.json({ success: false, error: 'internal_error' }, 500);
}

export class AudioTracksList extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Audio tracks'],
			summary: 'List the audio tracks of a video',
			request: { params: videoParams },
			responses: {
				'200': { description: 'Tracks and limits', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: View }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Video not found', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const access = await editableVideo(c, params.videoId, userId);
		if ('response' in access) return access.response;
		try {
			return c.json({ success: true, data: await studioView(c.env as never, access.video as never, userId, rolesOf(c)) });
		} catch (error) {
			return failure(c, error);
		}
	}
}

export class AudioTrackCreate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Audio tracks'],
			summary: 'Add an audio track',
			description:
				'An uploaded file (`source.type = upload`: then PUT its chunks to `/upload?offset=` and POST `/complete`) or an audio stream of the video file ' +
				'(`source.type = source_stream`, from `detected`). The track is checked like an upload before viewers hear it. ' +
				'402 `upgrade_required` with entitlement `audio.tracksPerVideo` once the per-video limit is reached; 404 `feature_off` when the tier allows no extra tracks; 409 `duplicate_track` for a second track of the same language and kind.',
			request: {
				params: videoParams,
				body: {
					content: {
						'application/json': {
							schema: z.object({
								...TrackFields,
								originalLanguage: z.enum(languages).optional().describe('The language of the video’s own audio, when its row is created'),
								source: z.union([
									z.object({ type: z.literal('upload'), bytes: z.number().int().positive(), fileName: z.string().max(200).optional(), contentType: z.string().max(100).optional() }),
									z.object({ type: z.literal('source_stream'), streamIndex: z.number().int().min(0) }),
								]),
							}),
						},
					},
				},
			},
			responses: {
				'201': { description: 'Added', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ track: Track, uploadUrl: z.string().optional() }) }) } } },
				'400': { description: 'Invalid track', content: Err },
				'402': {
					description: 'Over the tier limit',
					content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.literal('upgrade_required'), entitlement: z.literal(AUDIO_TRACKS_ENTITLEMENT), limit: z.number(), used: z.number() }) } },
				},
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Video not found', content: Err },
				'409': { description: '`video_not_ready` or `duplicate_track`', content: Err },
				'413': { description: 'File over 2 GB', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const access = await editableVideo(c, params.videoId, userId);
		if ('response' in access) return access.response;
		try {
			const { track } = await addTrack(c.env as never, ctxOf(c), { video: access.video as never, userId, roles: rolesOf(c), body: body as never });
			const uploadUrl = track.source.type === 'upload' ? `/api/videos/${encodeURIComponent(params.videoId)}/audio-tracks/${track.id}/upload` : undefined;
			return c.json({ success: true, data: { track: studioTrack(track, track.source.type === 'upload' ? 0 : undefined), ...(uploadUrl ? { uploadUrl } : {}) } }, 201);
		} catch (error) {
			if (error instanceof AudioTrackError && error.code === FEATURE_OFF_CODE) return featureOff(c);
			if (error instanceof AudioTrackError && error.status === 402) {
				return c.json({ success: false, error: 'upgrade_required', entitlement: AUDIO_TRACKS_ENTITLEMENT, ...error.extra }, 402);
			}
			return failure(c, error);
		}
	}
}

export class AudioTrackComplete extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Audio tracks'],
			summary: 'Finish an audio track upload',
			request: { params: trackParams },
			responses: {
				'202': { description: 'Processing', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ track: Track }) }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Not found', content: Err },
				'409': { description: '`upload_incomplete` (with `offset`) or `not_uploading`', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const access = await editableVideo(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		try {
			const track = await completeUpload(c.env as never, ctxOf(c), access.video as never, params.trackId);
			return c.json({ success: true, data: { track: studioTrack(track) } }, 202);
		} catch (error) {
			return failure(c, error);
		}
	}
}

export class AudioTrackRetry extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Audio tracks'],
			summary: 'Process a failed audio track again',
			request: { params: trackParams },
			responses: {
				'202': { description: 'Processing', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ track: Track }) }) } } },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Not found', content: Err },
				'409': { description: '`not_failed` or `upload_incomplete`', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const access = await editableVideo(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		try {
			const track = await retryTrack(c.env as never, ctxOf(c), access.video as never, params.trackId);
			return c.json({ success: true, data: { track: studioTrack(track) } }, 202);
		} catch (error) {
			return failure(c, error);
		}
	}
}

export class AudioTrackUpdate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Audio tracks'],
			summary: 'Edit an audio track',
			description: 'Language, label, kind and default. Making a track the default takes effect once viewers can hear it.',
			request: {
				params: trackParams,
				body: { content: { 'application/json': { schema: z.object({ language: TrackFields.language.optional(), label: TrackFields.label, kind: TrackFields.kind.optional(), isDefault: z.literal(true).optional() }) } } },
			},
			responses: {
				'200': { description: 'Saved', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ track: Track }) }) } } },
				'400': { description: 'Invalid', content: Err },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Not found', content: Err },
				'409': { description: '`duplicate_track`', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, body } = await this.getValidatedData<typeof this.schema>();
		const access = await editableVideo(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		try {
			const track: AudioTrack = await updateTrack(c.env as never, ctxOf(c), access.video as never, params.trackId, body);
			return c.json({ success: true, data: { track: studioTrack(track) } });
		} catch (error) {
			return failure(c, error);
		}
	}
}

export class AudioTrackDelete extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Audio tracks'],
			summary: 'Delete an audio track',
			request: { params: trackParams },
			responses: {
				'200': { description: 'Deleted', content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } } },
				'400': { description: '`cannot_delete_original`', content: Err },
				'403': { description: 'Not allowed', content: Err },
				'404': { description: 'Not found', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const access = await editableVideo(c, params.videoId, this.getUserId(c));
		if ('response' in access) return access.response;
		try {
			await deleteTrack(c.env as never, ctxOf(c), access.video as never, params.trackId);
			return c.json({ success: true });
		} catch (error) {
			return failure(c, error);
		}
	}
}

export class AudioTracksDetect extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Audio tracks'],
			summary: 'Look for audio tracks in the video file',
			description: 'Queues a check of the video file’s audio streams; `GET` shows them in `detected` when it ends.',
			request: { params: videoParams },
			responses: {
				'202': { description: 'Queued', content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } } },
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
		try {
			await requestProbe(c.env as never, access.video as never);
			return c.json({ success: true }, 202);
		} catch (error) {
			return failure(c, error);
		}
	}
}
