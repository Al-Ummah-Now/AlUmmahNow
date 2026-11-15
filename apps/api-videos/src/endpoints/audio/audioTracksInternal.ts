/**
 * Internal audio-track endpoints (X-API-Key = INTERNAL_API_KEY; the `/internal/*` guard in index.ts).
 *
 *   POST /internal/audio-tracks/:videoId/:trackId/prepared   AudioTrackReport from apps/media
 *   POST /internal/audio-tracks/:videoId/package             AudioPackageReport from apps/media
 *   POST /internal/audio-tracks/:videoId/detected            AudioProbeReport from apps/media
 *   POST /internal/audio-tracks/retry                        { videoId, trackId? } the admin Errors page's Retry
 */
import { Hono } from 'hono';
import { isAudioTrackId, type AudioPackageReport, type AudioProbeReport, type AudioTrackReport } from '@al-ummah/shared-types';
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
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const VIDEO_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function createAudioTracksInternalRouter() {
	const app = new Hono<{ Bindings: AudioTracksEnv }>();

	app.onError((error, c) => {
		logger.error('[AudioTracks] Internal call failed', { path: c.req.path, error: error.message });
		return c.json({ success: false, error: 'internal_error' }, 500);
	});

	app.post('/retry', async (c) => {
		const body = (await c.req.json().catch(() => null)) as { videoId?: unknown; trackId?: unknown } | null;
		const videoId = typeof body?.videoId === 'string' && VIDEO_ID.test(body.videoId) ? body.videoId : '';
		const trackId = body?.trackId === undefined ? undefined : isAudioTrackId(body.trackId) ? body.trackId : null;
		if (!videoId || trackId === null) return c.json({ success: false, error: 'videoId (and an optional trackId) are required' }, 400);
		const out = await retryAudio(c.env, ctxOf(c as never), videoId, trackId);
		// Nothing left to retry: the Errors page dismisses the item on 404
		if (out.retried === 'nothing') return c.json({ success: false, error: 'nothing_to_retry' }, 404);
		return c.json({ success: true, result: out });
	});

	app.post('/:videoId/package', async (c) => {
		const b = (await c.req.json().catch(() => null)) as Partial<AudioPackageReport> | null;
		if (!isObject(b) || typeof b.jobId !== 'string' || typeof b.rev !== 'string' || (b.access !== 'pub' && b.access !== 'priv') || typeof b.ok !== 'boolean') {
			return c.json({ success: false, error: 'invalid_report' }, 400);
		}
		const report: AudioPackageReport = b.ok
			? { jobId: b.jobId, rev: b.rev, access: b.access, ok: true, master: String((b as { master?: unknown }).master ?? ''), trackIds: Array.isArray((b as { trackIds?: unknown }).trackIds) ? ((b as { trackIds: unknown[] }).trackIds.filter((x) => typeof x === 'string') as string[]) : [] }
			: { jobId: b.jobId, rev: b.rev, access: b.access, ok: false, error: String((b as { error?: unknown }).error ?? 'failed').slice(0, 300), retryable: (b as { retryable?: unknown }).retryable === true };
		const out = await onPackageReport(c.env, ctxOf(c as never), c.req.param('videoId'), report);
		// Stale or refused reports are answered 200 too: resending them would change nothing
		return c.json({ success: true, result: out });
	});

	app.post('/:videoId/detected', async (c) => {
		const b = (await c.req.json().catch(() => null)) as Partial<AudioProbeReport> | null;
		if (!isObject(b) || typeof b.jobId !== 'string' || typeof b.ok !== 'boolean') return c.json({ success: false, error: 'invalid_report' }, 400);
		const report: AudioProbeReport = b.ok ? { jobId: b.jobId, ok: true, streams: (b as { streams?: never }).streams ?? [] } : { jobId: b.jobId, ok: false, error: String((b as { error?: unknown }).error ?? 'failed') };
		const out = await onProbeReport(c.env, c.req.param('videoId'), report);
		return c.json({ success: true, result: out });
	});

	app.post('/:videoId/:trackId/prepared', async (c) => {
		const b = (await c.req.json().catch(() => null)) as Partial<AudioTrackReport> | null;
		if (!isObject(b) || typeof b.jobId !== 'string' || typeof b.ok !== 'boolean') return c.json({ success: false, error: 'invalid_report' }, 400);
		const trackId = c.req.param('trackId');
		if (!isAudioTrackId(trackId)) return c.json({ success: false, error: 'invalid_track' }, 400);
		const report: AudioTrackReport = b.ok
			? {
					jobId: b.jobId,
					ok: true,
					durationSeconds: Math.max(0, Number((b as { durationSeconds?: unknown }).durationSeconds) || 0),
					...(typeof (b as { reviewManifestKey?: unknown }).reviewManifestKey === 'string' ? { reviewManifestKey: (b as { reviewManifestKey: string }).reviewManifestKey } : {}),
				}
			: { jobId: b.jobId, ok: false, error: String((b as { error?: unknown }).error ?? 'failed').slice(0, 300), retryable: (b as { retryable?: unknown }).retryable === true };
		const out = await onTrackPrepared(c.env, ctxOf(c as never), c.req.param('videoId'), trackId, report);
		// Stale or already applied: nothing to do, the media worker stops resending
		return c.json({ success: true, result: out });
	});

	return app;
}
