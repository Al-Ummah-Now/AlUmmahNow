/**
 * Internal audio-track endpoints (X-API-Key = INTERNAL_API_KEY; the `/internal/*` guard in index.ts).
 *
 *   POST /internal/audio-tracks/:videoId/:trackId/prepared   AudioTrackReport from apps/media
 *   POST /internal/audio-tracks/:videoId/package             AudioPackageReport from apps/media
 *   POST /internal/audio-tracks/:videoId/detected            AudioProbeReport from apps/media
 *   POST /internal/audio-tracks/retry                        { videoId, trackId? } the admin Errors page's Retry
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { RecordId } from '../../validation/identifiers';
import { ObjectKey } from '../../validation/legacy-request';
import { isAudioTrackId, isMediaRev } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';
import { onPackageReport, onProbeReport, onTrackPrepared, retryAudio, type AudioTracksEnv } from '../../lib/audio-tracks/service';

type Ctx = { waitUntil(promise: Promise<unknown>): void } | undefined;
const ctxOf = (c: { executionCtx: Ctx }): Ctx => {
	try {
		return c.executionCtx;
	} catch {
		return undefined;
	}
};
const VideoId = RecordId.max(80);
const TrackId = z.string().refine(isAudioTrackId);
const Retry = z.object({ videoId: VideoId, trackId: TrackId.optional() });
const Callback = { jobId: RecordId };
const Failure = { ok: z.literal(false), error: z.string().max(300).default('failed') };
const PackageTarget = { ...Callback, rev: z.string().refine(isMediaRev), access: z.enum(['pub', 'priv']) };
const Package = z.discriminatedUnion('ok', [
	z.object({ ...PackageTarget, ok: z.literal(true), master: z.string().regex(/^master_a[0-9]{1,12}\.m3u8$/), trackIds: z.array(TrackId.or(z.literal('orig'))).max(32) }),
	z.object({ ...PackageTarget, ...Failure, retryable: z.boolean().default(false) }),
]);
const Probe = z.discriminatedUnion('ok', [
	z.object({ ...Callback, ok: z.literal(true), streams: z.array(z.object({
		index: z.number().int().min(0).max(63), language: z.string().max(32).optional(),
		title: z.string().max(1000).optional(), channels: z.number().int().min(0).max(64).optional(), codec: z.string().max(64).optional(),
	})).max(64) }),
	z.object({ ...Callback, ...Failure }),
]);
const Track = z.discriminatedUnion('ok', [
	z.object({ ...Callback, ok: z.literal(true), durationSeconds: z.number().nonnegative(), reviewManifestKey: ObjectKey.optional() }),
	z.object({ ...Callback, ...Failure, retryable: z.boolean().default(false) }),
]);

export function createAudioTracksInternalRouter() {
	const app = new Hono<{ Bindings: AudioTracksEnv }>();

	app.onError((error, c) => {
		logger.error('[AudioTracks] Internal call failed', { path: c.req.path, error: error.message });
		return c.json({ success: false, error: 'internal_error' }, 500);
	});

	app.post('/retry', async (c) => {
		const parsed = Retry.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ success: false, error: 'videoId (and an optional trackId) are required' }, 400);
		const { videoId, trackId } = parsed.data;
		const out = await retryAudio(c.env, ctxOf(c as never), videoId, trackId);
		// Nothing left to retry: the Errors page dismisses the item on 404
		if (out.retried === 'nothing') return c.json({ success: false, error: 'nothing_to_retry' }, 404);
		return c.json({ success: true, result: out });
	});

	app.post('/:videoId/package', async (c) => {
		const parsed = Package.safeParse(await c.req.json().catch(() => null));
		const videoId = c.req.param('videoId');
		if (!parsed.success || !VideoId.safeParse(videoId).success) return c.json({ success: false, error: 'invalid_report' }, 400);
		const report = parsed.data;
		const out = await onPackageReport(c.env, ctxOf(c as never), videoId, report);
		// Stale or refused reports are answered 200 too: resending them would change nothing
		return c.json({ success: true, result: out });
	});

	app.post('/:videoId/detected', async (c) => {
		const parsed = Probe.safeParse(await c.req.json().catch(() => null));
		const videoId = c.req.param('videoId');
		if (!parsed.success || !VideoId.safeParse(videoId).success) return c.json({ success: false, error: 'invalid_report' }, 400);
		const report = parsed.data;
		const out = await onProbeReport(c.env, videoId, report);
		return c.json({ success: true, result: out });
	});

	app.post('/:videoId/:trackId/prepared', async (c) => {
		const parsed = Track.safeParse(await c.req.json().catch(() => null));
		const videoId = c.req.param('videoId');
		if (!parsed.success || !VideoId.safeParse(videoId).success) return c.json({ success: false, error: 'invalid_report' }, 400);
		const report = parsed.data;
		const trackId = c.req.param('trackId');
		if (!isAudioTrackId(trackId)) return c.json({ success: false, error: 'invalid_track' }, 400);
		if ('reviewManifestKey' in report && report.reviewManifestKey !== undefined &&
			report.reviewManifestKey !== ['review', videoId, 'audio-' + trackId + '-' + report.jobId.slice(0, 8), 'manifest.json'].join('/')) {
			return c.json({ success: false, error: 'invalid_report' }, 400);
		}
		const out = await onTrackPrepared(c.env, ctxOf(c as never), videoId, trackId, report);
		// Stale or already applied: nothing to do, the media worker stops resending
		return c.json({ success: true, result: out });
	});

	return app;
}
