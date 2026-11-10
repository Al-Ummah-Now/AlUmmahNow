/**
 * Internal processing-health endpoints (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). The admin API proxies these behind its
 * `videos:processing` permission and writes the audit row (apps/admin-api,
 * endpoints/processing). Not part of the public contract.
 *
 *   GET  /internal/processing/videos?status=stuck|processing|failed|all&bunny=1&limit=
 *   GET  /internal/processing/errors       failed/flagged videos + dead-lettered checks
 *   POST /internal/processing/sync         { ids: string[], dryRun?: boolean } (apply = queue the check now)
 *   POST /internal/processing/retry        { ids: string[] }
 *   POST /internal/processing/mark-failed  { ids: string[], reason?: string }
 */

import { Hono } from 'hono';
import { readErasureDeadLetters, type ErasureDeadLetter } from '../../lib/privacy/erasure-dead-letters';
import { logger } from '../../lib/logger';
import R2Repository from '../../lib/r2Repo';
import {
	fetchBunnyVideo,
	ProcessingEnv,
	readSweepStats,
	startProcessingLoop,
	syncVideoFromBunny,
} from '../../lib/processing/loop';
import { announceAndRecordProcessingResult, pendingProcessingResult } from '../../lib/notification-events';

const MAX_IDS = 100;

interface HealthVideo {
	id: string;
	title?: string;
	channelId?: string;
	userId?: string;
	dateCreated?: string;
	dateModified?: string;
	uploadStatus?: string;
	isPublic?: boolean;
	availableResolutions?: string[];
	thumbnailUrl?: string;
	playUrl?: string;
	processingIssue?: { kind: string; reason?: string; at: string };
	processingCheck?: Record<string, unknown>;
	processingAnnounced?: 'ready' | 'failed';
	/** Removed by the upload reaper (Stale uploads view) */
	abandoned?: unknown;
}

function parseIds(body: unknown): string[] | null {
	const ids = (body as { ids?: unknown })?.ids;
	if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
	const clean = ids.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id));
	return clean.length === ids.length ? [...new Set(clean)] : null;
}

function matches(video: HealthVideo, status: string): boolean {
	if (video.abandoned && status !== 'all') return false;
	const notReady = video.uploadStatus && video.uploadStatus !== 'ready';
	switch (status) {
		case 'all':
			return true;
		case 'processing':
			return video.uploadStatus === 'processing' || video.uploadStatus === 'uploading' || video.uploadStatus === 'initiated';
		case 'failed':
			return video.uploadStatus === 'failed';
		case 'stalled':
			return video.processingIssue?.kind === 'stalled';
		case 'needs_reupload':
			return video.processingIssue?.kind === 'needs_reupload';
		default:
			// stuck: anything not ready, or flagged
			return !!notReady || !!video.processingIssue;
	}
}

export function createProcessingInternalRouter() {
	const app = new Hono<{ Bindings: ProcessingEnv }>();

	app.get('/videos', async (c) => {
		const status = c.req.query('status') || 'stuck';
		const withBunny = c.req.query('bunny') === '1';
		const channelId = c.req.query('channelId');
		const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);
		const items: HealthVideo[] = [];
		let scanned = 0;
		let cursor: string | undefined;
		do {
			const page = await c.env.videos.list({ cursor, limit: 500 });
			cursor = page.truncated ? page.cursor : undefined;
			for (const object of page.objects) {
				if (object.key.includes('/') || object.key.includes(':')) continue;
				scanned++;
				const video = (await (await c.env.videos.get(object.key))?.json<HealthVideo>().catch(() => null)) ?? null;
				if (!video?.id || !matches(video, status)) continue;
				if (channelId && video.channelId !== channelId) continue;
				items.push(video);
			}
		} while (cursor && items.length < limit);
		items.sort((a, b) => (b.dateCreated || '').localeCompare(a.dateCreated || ''));
		const page = items.slice(0, limit);
		const rows = await Promise.all(
			page.map(async (video) => {
				let bunny: unknown = undefined;
				if (withBunny) {
					try {
						const b = await fetchBunnyVideo(c.env, video.id);
						bunny = b
							? { status: b.status, encodeProgress: b.encodeProgress, availableResolutions: b.availableResolutions, length: b.length, storageSize: b.storageSize, width: b.width, height: b.height }
							: null;
					} catch (error) {
						bunny = { error: error instanceof Error ? error.message : String(error) };
					}
				}
				return {
					id: video.id,
					title: video.title,
					channelId: video.channelId,
					userId: video.userId,
					dateCreated: video.dateCreated,
					dateModified: video.dateModified,
					uploadStatus: video.uploadStatus,
					isPublic: video.isPublic,
					availableResolutions: video.availableResolutions ?? [],
					thumbnailUrl: video.thumbnailUrl,
					processingIssue: video.processingIssue ?? null,
					processingCheck: video.processingCheck ?? null,
					...(withBunny ? { bunny } : {}),
				};
			}),
		);
		return c.json({ success: true, result: { items: rows, scanned, reconciler: await readSweepStats(c.env) } });
	});

	// Dry run (default): Bunny is read and the plan returned, nothing written.
	// Apply: each video's check loop is (re)started through the queue, which
	// syncs it now and keeps checking until Bunny finishes (retry, backoff, DLQ).
	app.post('/sync', async (c) => {
		const body = await c.req.json().catch(() => null);
		const ids = parseIds(body);
		if (!ids) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids` }, 400);
		const dryRun = (body as { dryRun?: unknown }).dryRun !== false;
		const results = [];
		for (const id of ids) {
			try {
				if (dryRun) results.push(await syncVideoFromBunny(c.env, id, { dryRun: true }));
				else results.push({ videoId: id, ...(await startProcessingLoop(c.env, id, { reason: 'admin-sync', force: true, initialDelaySeconds: 0 })) });
			} catch (error) {
				results.push({ videoId: id, error: error instanceof Error ? error.message : String(error) });
			}
		}
		logger.debug('[ProcessingAdmin] Sync from Bunny', { count: ids.length, dryRun });
		return c.json({ success: true, result: { dryRun, results } });
	});

	// Failures that need an admin: flagged / failed videos and dead-lettered
	// processing checks (stored by the processor's DLQ consumer in NOTIFICATIONS_DB).
	app.get('/errors', async (c) => {
		const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);
		const videos: HealthVideo[] = [];
		let cursor: string | undefined;
		do {
			const page = await c.env.videos.list({ cursor, limit: 500 });
			cursor = page.truncated ? page.cursor : undefined;
			for (const object of page.objects) {
				if (object.key.includes('/') || object.key.includes(':')) continue;
				const video = (await (await c.env.videos.get(object.key))?.json<HealthVideo>().catch(() => null)) ?? null;
				if (video?.id && (video.uploadStatus === 'failed' || video.processingIssue)) videos.push(video);
			}
		} while (cursor && videos.length < limit);
		videos.sort((a, b) => (b.processingIssue?.at || b.dateModified || '').localeCompare(a.processingIssue?.at || a.dateModified || ''));
		let deadLetters: unknown[] = [];
		const db = (c.env as { NOTIFICATIONS_DB?: D1Database }).NOTIFICATIONS_DB;
		if (db) {
			try {
				const { results } = await db
					.prepare(
						`SELECT id, type_name, dlq, attempts, failure_reason, body_json, received_at FROM dead_letters
						 WHERE replayed_at IS NULL AND body_json LIKE '%"kind":"processing-check"%' ORDER BY received_at DESC LIMIT ?`,
					)
					.bind(limit)
					.all<{ id: string; dlq: string; attempts: number; failure_reason: string | null; body_json: string; received_at: string | number }>();
				deadLetters = (results ?? []).map((row) => {
					let videoId: string | undefined;
					try {
						videoId = (JSON.parse(row.body_json) as { videoId?: string }).videoId;
					} catch {
						videoId = undefined;
					}
					return { id: row.id, dlq: row.dlq, attempts: row.attempts, failureReason: row.failure_reason, receivedAt: row.received_at, videoId };
				});
			} catch (error) {
				logger.warn('[ProcessingAdmin] Dead letters unavailable', { error: error instanceof Error ? error.message : String(error) });
			}
		}
		// Account erasure steps that failed for good (#616): the Errors page lists them too
		let erasureDeadLetters: ErasureDeadLetter[] = [];
		if (db) {
			try {
				erasureDeadLetters = await readErasureDeadLetters(db, limit);
			} catch (error) {
				logger.warn('[ProcessingAdmin] Erasure dead letters unavailable', { error: error instanceof Error ? error.message : String(error) });
			}
		}
		return c.json({
			success: true,
			result: {
				videos: videos.slice(0, limit).map((v) => ({
					id: v.id,
					title: v.title,
					channelId: v.channelId,
					userId: v.userId,
					uploadStatus: v.uploadStatus,
					processingIssue: v.processingIssue ?? null,
					dateCreated: v.dateCreated,
					dateModified: v.dateModified,
				})),
				deadLetters,
				erasureDeadLetters,
				reconciler: await readSweepStats(c.env),
			},
		});
	});

	app.post('/retry', async (c) => {
		const ids = parseIds(await c.req.json().catch(() => null));
		if (!ids) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids` }, 400);
		const results = [];
		for (const id of ids) {
			try {
				// Clear a stalled/failed flag so the loop decides again from Bunny's state
				await new R2Repository<HealthVideo>(c.env.videos).updateObject(id, (fresh) => {
					if (!fresh.processingIssue && fresh.uploadStatus !== 'failed') return false;
					delete fresh.processingIssue;
					if (fresh.uploadStatus === 'failed') {
						fresh.uploadStatus = 'processing';
						// The retried attempt gets its own "ready" / "failed" announcement
						delete fresh.processingAnnounced;
					}
					return true;
				});
				results.push({ videoId: id, ...(await startProcessingLoop(c.env, id, { reason: 'admin-retry', force: true, initialDelaySeconds: 0 })) });
			} catch (error) {
				results.push({ videoId: id, started: false, why: error instanceof Error ? error.message : String(error) });
			}
		}
		return c.json({ success: true, result: { results } });
	});

	app.post('/mark-failed', async (c) => {
		const body = await c.req.json().catch(() => null);
		const ids = parseIds(body);
		if (!ids) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids` }, 400);
		const reasonRaw = (body as { reason?: unknown }).reason;
		const reason = typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim().slice(0, 300) : 'Marked by an admin: upload again';
		const now = new Date().toISOString();
		const repo = new R2Repository<HealthVideo>(c.env.videos);
		const results = [];
		for (const id of ids) {
			let transitioned = false;
			const saved = await repo.updateObject(id, (fresh) => {
				transitioned = fresh.uploadStatus !== 'failed';
				if (!transitioned && fresh.processingIssue?.kind === 'needs_reupload') return false;
				fresh.uploadStatus = 'failed';
				fresh.processingIssue = { kind: 'needs_reupload', reason, at: now };
				if (fresh.processingCheck && !fresh.processingCheck.finishedAt) {
					fresh.processingCheck = { ...fresh.processingCheck, finishedAt: now, outcome: 'marked_failed', nextCheckAt: undefined };
				}
				fresh.dateModified = now;
				return true;
			});
			// Tell the uploader. Also repeats an earlier announcement that never
			// landed, so re-running mark-failed recovers a lost notification.
			let announced = true;
			if (saved && pendingProcessingResult(saved) === 'failed') {
				try {
					await announceAndRecordProcessingResult(c.env as never, { ...saved, id }, 'failed');
				} catch (error) {
					announced = false;
					logger.error('[ProcessingAdmin] Failed notification not queued; run mark-failed again', {
						videoId: id,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
			results.push({ videoId: id, found: !!saved, changed: !!saved && transitioned, announced });
		}
		return c.json({ success: true, result: { results } });
	});

	return app;
}
