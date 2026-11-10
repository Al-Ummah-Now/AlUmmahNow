/**
 * Internal processing-health endpoints (X-API-Key = INTERNAL_API_KEY; the
 * `/internal/*` guard in index.ts). The admin API proxies these behind its
 * `videos:processing` permission and writes the audit row (apps/admin-api,
 * endpoints/processing). Not part of the public contract.
 *
 *   GET  /internal/processing/videos?status=stuck|processing|failed|all&bunny=1&limit=
 *   POST /internal/processing/sync         { ids: string[], dryRun?: boolean }
 *   POST /internal/processing/retry        { ids: string[] }
 *   POST /internal/processing/mark-failed  { ids: string[], reason?: string }
 */

import { Hono } from 'hono';
import { logger } from '../../lib/logger';
import R2Repository from '../../lib/r2Repo';
import {
	fetchBunnyVideo,
	ProcessingEnv,
	readSweepStats,
	startProcessingLoop,
	syncVideoFromBunny,
} from '../../lib/processing/loop';
import { announceProcessingResult } from '../../lib/notification-events';

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
}

function parseIds(body: unknown): string[] | null {
	const ids = (body as { ids?: unknown })?.ids;
	if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
	const clean = ids.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id));
	return clean.length === ids.length ? [...new Set(clean)] : null;
}

function matches(video: HealthVideo, status: string): boolean {
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
							? { status: b.status, encodeProgress: b.encodeProgress, availableResolutions: b.availableResolutions, length: b.length, storageSize: b.storageSize }
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

	app.post('/sync', async (c) => {
		const body = await c.req.json().catch(() => null);
		const ids = parseIds(body);
		if (!ids) return c.json({ success: false, error: `ids must be 1-${MAX_IDS} video ids` }, 400);
		const dryRun = (body as { dryRun?: unknown }).dryRun !== false;
		const results = [];
		for (const id of ids) {
			try {
				results.push(await syncVideoFromBunny(c.env, id, { dryRun }));
			} catch (error) {
				results.push({ videoId: id, found: true, dryRun, changed: false, error: error instanceof Error ? error.message : String(error) });
			}
		}
		logger.info('[ProcessingAdmin] Sync from Bunny', { count: ids.length, dryRun, changed: results.filter((r) => r.changed).length });
		return c.json({ success: true, result: { dryRun, results } });
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
					if (fresh.uploadStatus === 'failed') fresh.uploadStatus = 'processing';
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
			if (saved && transitioned) await announceProcessingResult(c.env as never, { ...saved, id }, 'failed');
			results.push({ videoId: id, found: !!saved, changed: !!saved && transitioned });
		}
		return c.json({ success: true, result: { results } });
	});

	return app;
}
