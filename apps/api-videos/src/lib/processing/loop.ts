/**
 * Per-video processing-check loop (2026-11-10 incident).
 *
 * queue → check Bunny → (not finished) queue again with a delay → … → done.
 *
 * Started when an upload completes (TUS proxy / upload-complete), by the
 * admin "Retry processing" action and by the safety-net sweep for any video
 * still processing without an active loop. The consumer (`handleProcessingCheckBatch`)
 * checks Bunny, applies the shared sync (sync.ts) through R2 writes that keep
 * the search index and ownership rows in step (withSearchSync), announces the
 * terminal transition (uploader notification + subscriber fan-out) exactly
 * like the uploader's status poll does, and stops on ready / failed /
 * needs-reupload / stalled.
 *
 * Idempotent: the record holds the active loop id (`processingCheck.loopId`);
 * a message from an older or superseded loop is acknowledged and dropped, and
 * a record that is already in the target state is not written again.
 */

import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { requireSecret } from '../env-helpers';
import { announceProcessingResult } from '../notification-events';
import {
	applyPlan,
	BunnyVideoState,
	MAX_CHECK_ATTEMPTS,
	nextCheckDelaySeconds,
	planSync,
	SyncPlan,
	SyncableVideo,
} from './sync';

export const PROCESSING_CHECK_KIND = 'processing-check';

export interface ProcessingCheckMessage {
	kind: typeof PROCESSING_CHECK_KIND;
	videoId: string;
	loopId: string;
	attempt: number;
	startedAt: string;
	reason?: string;
}

interface SecretBinding {
	text?(): Promise<string>;
	get?(): Promise<string>;
}

export interface ProcessingEnv {
	videos: R2Bucket;
	channels: R2Bucket;
	global_settings?: R2Bucket;
	queue?: Queue;
	PROCESSING_CHECK_QUEUE?: Queue;
	'bunny-stream-key': SecretBinding | string;
	bunny_stream_library_id: SecretBinding | string;
	bunny_hostname?: string;
	SEARCH_DB?: D1Database;
	NOTIFICATIONS_DB?: D1Database;
}

type LoopVideo = SyncableVideo & {
	userId?: string;
	channelId?: string;
	title?: string;
	isPublic?: boolean;
	dateModified?: string;
	processingCheck?: {
		loopId: string;
		startedAt: string;
		attempt: number;
		lastCheckedAt?: string;
		nextCheckAt?: string;
		finishedAt?: string;
		outcome?: string;
		bunnyStatus?: number;
		bunnyProgress?: number;
	};
};

/** A loop whose next check is this late is considered dead (lost message). */
const STALE_LOOP_MS = 15 * 60 * 1000;

const BUNNY_API = 'https://video.bunnycdn.com';

/** Bunny's view of one video; null when Bunny has no such video (404). */
export async function fetchBunnyVideo(env: ProcessingEnv, videoId: string): Promise<BunnyVideoState | null> {
	const key = await requireSecret(env['bunny-stream-key'], 'bunny-stream-key');
	const libraryId = await requireSecret(env.bunny_stream_library_id, 'bunny_stream_library_id');
	const response = await fetch(`${BUNNY_API}/library/${encodeURIComponent(libraryId)}/videos/${encodeURIComponent(videoId)}`, {
		headers: { AccessKey: key, accept: 'application/json' },
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Bunny getVideo ${videoId} failed: HTTP ${response.status}`);
	return (await response.json()) as BunnyVideoState;
}

export interface SyncResult {
	videoId: string;
	found: boolean;
	dryRun: boolean;
	plan?: SyncPlan;
	bunny?: { status?: number; encodeProgress?: number; availableResolutions?: string | null; length?: number } | null;
	ours?: { uploadStatus?: string; availableResolutions?: string[]; playUrl?: string; thumbnailUrl?: string; processingIssue?: unknown };
	changed: boolean;
	error?: string;
}

function summary(video: LoopVideo) {
	return {
		uploadStatus: video.uploadStatus,
		availableResolutions: video.availableResolutions,
		playUrl: video.playUrl,
		thumbnailUrl: video.thumbnailUrl,
		processingIssue: video.processingIssue,
	};
}

/**
 * Re-read Bunny for one video and fix its record (the admin "Sync from Bunny"
 * action, the loop's check and the sweep all come here). `dryRun` returns the
 * plan without writing.
 */
export async function syncVideoFromBunny(
	env: ProcessingEnv,
	videoId: string,
	opts: { dryRun?: boolean; now?: Date; loopStartedAt?: string; bunny?: BunnyVideoState | null } = {},
): Promise<SyncResult> {
	const repo = new R2Repository<LoopVideo>(env.videos);
	const video = await repo.getObject(videoId);
	if (!video) return { videoId, found: false, dryRun: !!opts.dryRun, changed: false, error: 'Video not found' };
	const host = env.bunny_hostname;
	if (!host) return { videoId, found: true, dryRun: !!opts.dryRun, changed: false, error: 'bunny_hostname is not configured' };

	const bunny = opts.bunny !== undefined ? opts.bunny : await fetchBunnyVideo(env, videoId);
	const now = opts.now ?? new Date();
	const syncOpts = { host, now, loopStartedAt: opts.loopStartedAt };
	const plan = planSync(video, bunny, syncOpts);
	const bunnyView = bunny
		? { status: bunny.status, encodeProgress: bunny.encodeProgress, availableResolutions: bunny.availableResolutions, length: bunny.length }
		: null;
	const nothingToDo = Object.keys(plan.patch).length === 0 && plan.unset.length === 0;
	if (opts.dryRun || nothingToDo) {
		return { videoId, found: true, dryRun: !!opts.dryRun, plan, bunny: bunnyView, ours: summary(video), changed: false };
	}

	// Conditional write on the fresh record: re-plan against it so a concurrent
	// edit (title, visibility, views) is never overwritten.
	let transition: 'ready' | 'failed' | null = null;
	const saved = await repo.updateObject(videoId, (fresh) => {
		const freshPlan = planSync(fresh, bunny, syncOpts);
		transition = freshPlan.terminalTransition;
		if (!applyPlan(fresh, freshPlan)) return false;
		fresh.dateModified = now.toISOString();
		return true;
	});
	logger.info('[ProcessingSync] Record synced from Bunny', {
		videoId,
		outcome: plan.outcome,
		bunnyStatus: bunny?.status,
		transition,
	});
	if (saved && transition) {
		// Same downstream path as the uploader's status poll: uploader
		// notification, subscriber fan-out (processor de-duplicates per video).
		await announceProcessingResult(env as never, { ...saved, id: videoId }, transition);
	}
	return { videoId, found: true, dryRun: false, plan, bunny: bunnyView, ours: summary(saved ?? video), changed: !!saved };
}

function queueOf(env: ProcessingEnv): Queue | undefined {
	return env.PROCESSING_CHECK_QUEUE;
}

/**
 * Start (or restart, with `force`) the check loop for a video. Without
 * `force` a loop that is alive (its next check is not overdue) is left alone,
 * so repeated upload-complete calls and sweeps start one loop per video.
 */
export async function startProcessingLoop(
	env: ProcessingEnv,
	videoId: string,
	opts: { reason: string; force?: boolean; now?: Date; initialDelaySeconds?: number },
): Promise<{ started: boolean; loopId?: string; why?: string }> {
	const queue = queueOf(env);
	if (!queue) {
		logger.warn('[ProcessingLoop] PROCESSING_CHECK_QUEUE is not bound; loop not started', { videoId });
		return { started: false, why: 'queue not bound' };
	}
	const now = opts.now ?? new Date();
	const loopId = crypto.randomUUID();
	const delay = opts.initialDelaySeconds ?? nextCheckDelaySeconds(0);
	let why: string | undefined;
	const repo = new R2Repository<LoopVideo>(env.videos);
	const saved = await repo.updateObject(videoId, (fresh) => {
		why = undefined;
		const check = fresh.processingCheck;
		const nextAt = Date.parse(check?.nextCheckAt || '');
		const alive = check && !check.finishedAt && Number.isFinite(nextAt) && nextAt + STALE_LOOP_MS > now.getTime();
		if (alive && !opts.force) {
			why = 'loop already active';
			return false;
		}
		fresh.processingCheck = {
			loopId,
			startedAt: now.toISOString(),
			attempt: 0,
			nextCheckAt: new Date(now.getTime() + delay * 1000).toISOString(),
		};
		return true;
	});
	if (!saved) return { started: false, why: 'video not found' };
	if (why) return { started: false, why };
	const message: ProcessingCheckMessage = {
		kind: PROCESSING_CHECK_KIND,
		videoId,
		loopId,
		attempt: 0,
		startedAt: now.toISOString(),
		reason: opts.reason,
	};
	await queue.send(message, { delaySeconds: delay });
	logger.info('[ProcessingLoop] Loop started', { videoId, loopId, reason: opts.reason, delay });
	return { started: true, loopId };
}

export type CheckDecision =
	| { kind: 'done'; outcome: string }
	| { kind: 'again'; delaySeconds: number; attempt: number }
	| { kind: 'drop'; why: string };

/** Pure: what the loop does after a check, given the sync outcome. */
export function decideNext(outcome: string, attempt: number): CheckDecision {
	if (outcome !== 'pending') return { kind: 'done', outcome };
	const next = attempt + 1;
	if (next >= MAX_CHECK_ATTEMPTS) return { kind: 'done', outcome: 'attempts_exhausted' };
	return { kind: 'again', delaySeconds: nextCheckDelaySeconds(next), attempt: next };
}

/** One check of one loop message. Throws on transient errors (the queue retries). */
export async function runProcessingCheck(env: ProcessingEnv, message: ProcessingCheckMessage, now = new Date()): Promise<CheckDecision> {
	const repo = new R2Repository<LoopVideo>(env.videos);
	const video = await repo.getObject(message.videoId);
	if (!video) return { kind: 'drop', why: 'video deleted' };
	if (video.processingCheck?.loopId !== message.loopId) return { kind: 'drop', why: 'superseded loop' };
	if (video.processingCheck?.finishedAt) return { kind: 'drop', why: 'loop already finished' };

	const bunny = await fetchBunnyVideo(env, message.videoId);
	const result = await syncVideoFromBunny(env, message.videoId, { now, loopStartedAt: message.startedAt, bunny });
	const outcome = result.plan?.outcome ?? 'pending';
	let decision = decideNext(outcome, message.attempt);
	if (decision.kind === 'done' && decision.outcome === 'attempts_exhausted') {
		// Out of attempts while Bunny still is not done: flag it for admins.
		await repo.updateObject(message.videoId, (fresh) => {
			if (fresh.uploadStatus === 'ready' || fresh.processingIssue) return false;
			fresh.processingIssue = { kind: 'stalled', reason: `No result from Bunny after ${message.attempt + 1} checks`, at: now.toISOString() };
			return true;
		});
		decision = { kind: 'done', outcome: 'stalled' };
	}

	await repo.updateObject(message.videoId, (fresh) => {
		if (fresh.processingCheck?.loopId !== message.loopId) return false;
		fresh.processingCheck = {
			...fresh.processingCheck,
			attempt: message.attempt + 1,
			lastCheckedAt: now.toISOString(),
			bunnyStatus: bunny?.status,
			bunnyProgress: bunny?.encodeProgress,
			nextCheckAt: decision.kind === 'again' ? new Date(now.getTime() + decision.delaySeconds * 1000).toISOString() : undefined,
			finishedAt: decision.kind === 'done' ? now.toISOString() : undefined,
			outcome: decision.kind === 'done' ? decision.outcome : undefined,
		};
		return true;
	});
	return decision;
}

interface QueueMessageLike<T> {
	body: T;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** Queue consumer for PROCESSING_CHECK_QUEUE. */
export async function handleProcessingCheckBatch(
	batch: { messages: readonly QueueMessageLike<unknown>[] },
	env: ProcessingEnv,
): Promise<void> {
	for (const msg of batch.messages) {
		const body = msg.body as ProcessingCheckMessage;
		if (!body || body.kind !== PROCESSING_CHECK_KIND || !body.videoId || !body.loopId) {
			logger.error('[ProcessingLoop] Malformed message dropped', { body });
			msg.ack();
			continue;
		}
		try {
			const decision = await runProcessingCheck(env, body);
			if (decision.kind === 'again') {
				await queueOf(env)!.send({ ...body, attempt: decision.attempt } satisfies ProcessingCheckMessage, {
					delaySeconds: decision.delaySeconds,
				});
			}
			logger.info('[ProcessingLoop] Check done', { videoId: body.videoId, attempt: body.attempt, decision });
			msg.ack();
		} catch (error) {
			// Transient (Bunny / R2 hiccup): the queue retries with backoff, then dead-letters.
			const delaySeconds = Math.min(300, 30 * 2 ** Math.max(0, msg.attempts - 1));
			logger.warn('[ProcessingLoop] Check failed; retrying', {
				videoId: body.videoId,
				attempts: msg.attempts,
				delaySeconds,
				error: error instanceof Error ? error.message : String(error),
			});
			msg.retry({ delaySeconds });
		}
	}
}

export const SWEEP_STATE_KEY = 'ops/processing-reconciler.json';

export interface SweepStats {
	lastRunAt: string;
	scanned: number;
	notReady: number;
	loopsStarted: number;
	alreadyActive: number;
	flagged: { needsReupload: number; stalled: number; failed: number };
	errors: number;
	durationMs: number;
}

/**
 * Safety net (cron): start a loop for every video still uploading/processing
 * that has none (e.g. uploads from before the loop existed, or a lost
 * message). Capped per run; records the run for the admin health view.
 */
export async function sweepProcessingVideos(env: ProcessingEnv, opts: { now?: Date; maxStarts?: number; minAgeMs?: number } = {}): Promise<SweepStats> {
	const started = Date.now();
	const now = opts.now ?? new Date();
	const maxStarts = opts.maxStarts ?? 50;
	const minAge = opts.minAgeMs ?? 10 * 60 * 1000;
	const stats: SweepStats = {
		lastRunAt: now.toISOString(),
		scanned: 0,
		notReady: 0,
		loopsStarted: 0,
		alreadyActive: 0,
		flagged: { needsReupload: 0, stalled: 0, failed: 0 },
		errors: 0,
		durationMs: 0,
	};
	let cursor: string | undefined;
	do {
		const page = await env.videos.list({ cursor, limit: 500 });
		cursor = page.truncated ? page.cursor : undefined;
		for (const object of page.objects) {
			if (object.key.includes('/') || object.key.includes(':')) continue;
			stats.scanned++;
			let video: LoopVideo | null = null;
			try {
				video = (await (await env.videos.get(object.key))?.json<LoopVideo>()) ?? null;
			} catch {
				continue;
			}
			if (!video?.id) continue;
			if (video.processingIssue?.kind === 'needs_reupload') stats.flagged.needsReupload++;
			else if (video.processingIssue?.kind === 'stalled') stats.flagged.stalled++;
			else if (video.uploadStatus === 'failed') stats.flagged.failed++;
			const status = video.uploadStatus;
			if (status !== 'processing' && status !== 'uploading' && status !== 'initiated') continue;
			stats.notReady++;
			if (video.processingIssue) continue; // flagged: an admin decides
			if (now.getTime() - (Date.parse(video.dateCreated || '') || 0) < minAge) continue;
			if (stats.loopsStarted >= maxStarts) continue;
			try {
				const result = await startProcessingLoop(env, video.id, { reason: 'sweep', now, initialDelaySeconds: 0 });
				if (result.started) stats.loopsStarted++;
				else stats.alreadyActive++;
			} catch (error) {
				stats.errors++;
				logger.error('[ProcessingSweep] Could not start loop', { videoId: video.id, error: error instanceof Error ? error.message : String(error) });
			}
		}
	} while (cursor);
	stats.durationMs = Date.now() - started;
	if (env.global_settings) {
		try {
			await env.global_settings.put(SWEEP_STATE_KEY, JSON.stringify(stats), { httpMetadata: { contentType: 'application/json' } });
		} catch (error) {
			logger.warn('[ProcessingSweep] Could not store run stats', { error: error instanceof Error ? error.message : String(error) });
		}
	}
	logger.info('[ProcessingSweep] Run finished', { ...stats });
	return stats;
}

export async function readSweepStats(env: ProcessingEnv): Promise<SweepStats | null> {
	try {
		return ((await (await env.global_settings?.get(SWEEP_STATE_KEY))?.json<SweepStats>()) ?? null);
	} catch {
		return null;
	}
}
