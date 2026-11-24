/**
 * PUT /api/videos/:videoId/audio-tracks/:trackId/upload?offset=N — one chunk (≤ 10 MB, raw body,
 * Content-Length required) of an audio track's file (wiki AUN-MULTI-AUDIO). Chunks go in order; a
 * chunk at an offset past the stored bytes gets 409 with the offset to resume from. Authenticated by
 * authMiddleware (index.ts); owner or `video.edit`.
 */
import { Hono } from 'hono';
import type { VideoObject } from '@al-ummah/shared-types';
import R2Repository from '../../lib/r2Repo';
import { canOnVideo } from '../../lib/channelAccess';
import { logger } from '../../lib/logger';
import { AudioTrackError, writeChunk } from '../../lib/audio-tracks/service';
import { revokeKidsVideoOnEdit } from '../../lib/kids/revoke-on-edit';

type Env = { Bindings: { videos: R2Bucket; MEDIA_ORIGINALS?: R2Bucket; SEARCH_DB?: unknown; APP_CONFIG?: KVNamespace; ENVIRONMENT?: string }; Variables: { auth?: { userId?: string } } };

export function createAudioUploadRouter() {
	const app = new Hono<Env>();
	app.put('/:videoId/audio-tracks/:trackId/upload', async (c) => {
		const userId = c.get('auth')?.userId;
		if (!userId) return c.json({ success: false, error: 'unauthorized' }, 401);
		const videoId = c.req.param('videoId');
		const trackId = c.req.param('trackId');
		const offset = Number(c.req.query('offset'));
		const length = Number(c.req.header('content-length'));
		const body = c.req.raw.body;
		if (!body) return c.json({ success: false, error: 'empty_chunk' }, 400);
		const video = await new R2Repository<VideoObject>(c.env.videos).getObject(videoId);
		if (!video) return c.json({ success: false, error: 'video_not_found' }, 404);
		if (!(await canOnVideo(c.env as never, video, userId, 'video.edit'))) return c.json({ success: false, error: 'forbidden' }, 403);
		try {
			await revokeKidsVideoOnEdit(c.env, { videoId, actorId: userId, reason: 'audio_track_upload', force: true });
			const stored = await writeChunk(c.env as never, video as never, trackId, offset, length, body);
			c.header('Upload-Offset', String(stored));
			return c.json({ success: true, data: { offset: stored } });
		} catch (error) {
			if (error instanceof AudioTrackError) {
				if (typeof error.extra.offset === 'number') c.header('Upload-Offset', String(error.extra.offset));
				return c.json({ success: false, error: error.code, message: error.message, ...error.extra }, error.status);
			}
			logger.error('[AudioTracks] Chunk upload failed', { videoId, trackId, offset, error: error instanceof Error ? error.message : String(error) });
			return c.json({ success: false, error: 'internal_error' }, 500);
		}
	});
	return app;
}
