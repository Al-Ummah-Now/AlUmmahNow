/**
 * Listen mode audio streaming endpoint (Epic 14, E14-S3b & E14-D5):
 *
 * `GET /api/v1/videos/:id/audio[?trackId=<id>]`
 * - Requires authentication (E14-D3).
 * - Gated by `listenMode` (`404 feature_off` when off via `FEATURE_ROUTES`).
 * - Applies the exact same `videoReadAccess` visibility check as normal playback
 *   (`404 not_found` for missing, deleted, hidden, or unreadable private videos).
 * - Reuses existing streaming HLS assets ONLY (zero new R2 objects, no `audio.m4a`,
 *   no `audio_extract` job per E14-D5):
 *   1. Multi-audio videos with a ready R2 package: returns `a/<trackId>/index.m3u8`
 *      (public or short-lived signed `priv/` URL).
 *   2. Single-track or Bunny-only videos: returns the existing HLS `master.m3u8` stream
 *      from `choosePlayback` (clients deselect video tracks / render audio-first UI).
 */
import { z } from 'zod';
import {
	AUDIO_TRACK_KINDS,
	isAudioTrackId,
	mediaPlayUrl,
	packagedAudioTracks,
	type AudioPackageState,
	type AudioTrack,
	type VideoR2State,
} from '@al-ummah/shared-types';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { Str } from '../../lib/chanfana-params';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { apiError } from '../../lib/api-error';
import { loadVideoRecord, videoReadAccess } from '../../lib/videoReadAccess';
import { choosePlayback, logDecision } from '../../lib/media/playback';
import { getSecret } from '../../lib/env-helpers';
import type { VisibilityFields } from '../../lib/visibility';

interface AudioStreamVideo extends VisibilityFields {
	id: string;
	userId?: string;
	channelId?: string;
	r2?: VideoR2State;
	audioTracks?: AudioTrack[];
	audioPackage?: AudioPackageState;
	playUrl?: string;
	videoUrl?: string;
	media?: unknown;
}

const AudioTrackItemSchema = z.object({
	id: z.string(),
	language: z.string(),
	label: z.string(),
	kind: z.enum(AUDIO_TRACK_KINDS),
	isDefault: z.boolean(),
});

const VideoAudioResponse = z.object({
	videoId: z.string(),
	format: z.literal('hls'),
	url: z.string(),
	contentType: z.literal('application/vnd.apple.mpegurl'),
	trackId: z.string().optional(),
	tracks: z.array(AudioTrackItemSchema),
});

export class VideoAudio extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Videos'],
			summary: 'Get audio-first HLS playback URL for Listen mode',
			description:
				'🔒 Requires authentication (gated by `listenMode`). Reuses existing HLS streaming assets ' +
				'(demuxed `a/<trackId>/index.m3u8` for multi-audio videos, or the existing HLS `master.m3u8` stream). ' +
				'For private or unlisted videos the caller can view, returns a short-lived signed URL that must never be persisted.',
			request: {
				params: z.object({ id: Str({ description: 'Video ID' }) }),
				query: z.object({
					trackId: z.string().max(32).optional().describe('Optional multi-audio track ID (e.g. `orig` or `t...`)'),
				}),
			},
			responses: {
				'200': {
					description: 'Audio-first HLS playback info',
					content: { 'application/json': { schema: VideoAudioResponse } },
				},
				'400': { description: 'Invalid trackId parameter' },
				'401': { description: 'Authentication required' },
				'404': { description: 'Video or audio track not found, or feature off' },
				'409': { description: 'No playable HLS stream ready yet' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params, query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const { id } = params;
		const requestedTrackId = query.trackId?.trim() || undefined;

		if (requestedTrackId && !isAudioTrackId(requestedTrackId)) {
			return apiError(c, 400, 'invalid_request');
		}

		const video = await loadVideoRecord<AudioStreamVideo>(c.env, id);
		const access = await videoReadAccess(c.env, video, userId);
		if (!access || !video) {
			return apiError(c, 404, 'not_found');
		}

		c.header('Cache-Control', 'private, no-store');
		c.header('Vary', 'Authorization');

		// 1. Prefer existing demuxed audio-only HLS rendition when a ready multi-audio package exists on R2
		const host = (c.env as unknown as { MEDIA_PUBLIC_HOST?: string }).MEDIA_PUBLIC_HOST;
		const tracks = packagedAudioTracks(video);
		if (tracks.length > 0 && video.r2?.status === 'ready' && video.r2.rev && host) {
			const selected = requestedTrackId
				? tracks.find((t) => t.id === requestedTrackId)
				: tracks.find((t) => t.isDefault) ?? tracks[0];
			if (!selected) {
				return apiError(c, 404, 'not_found');
			}
			const r2Access = video.r2.access;
			const sign =
				r2Access === 'priv'
					? { key: await getSecret(c.env.MEDIA_SIGN_KEY, 'MEDIA_SIGN_KEY') }
					: undefined;
			const url = await mediaPlayUrl(host, r2Access, video.id, video.r2.rev, `a/${selected.id}/index.m3u8`, sign);
			return c.json({
				videoId: video.id,
				format: 'hls' as const,
				url,
				contentType: 'application/vnd.apple.mpegurl' as const,
				trackId: selected.id,
				tracks,
			});
		}

		if (requestedTrackId) {
			return apiError(c, 404, 'not_found');
		}

		// 2. Single-track or Bunny-only video: reuse existing HLS master.m3u8 stream (never creates R2 objects)
		const choice = await choosePlayback(c.env as never, video as never, { context: 'listen_audio' });
		logDecision(choice.decision);
		const first = choice.sources[0];
		if (!first?.playUrl) {
			return apiError(c, 409, 'rendition_not_ready');
		}
		return c.json({
			videoId: video.id,
			format: 'hls' as const,
			url: first.playUrl,
			contentType: 'application/vnd.apple.mpegurl' as const,
			tracks: [],
		});
	}
}
