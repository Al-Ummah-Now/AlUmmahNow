/**
 * The backfill run loop. Everything is a message on the processing-check queue (its retries and
 * DLQ; kind `media-backfill`):
 *
 *   estimate  one page of the scope → items with their estimate; the last page sets the run `estimated`
 *   tick      while running: polls the items in transcode, checks the budget, starts new items within
 *             concurrency and spacing, ends the run when nothing is left, then queues the next tick
 *   copy      a few 64 MiB ranges of one video's original (copy.ts), then the next, then the transcode
 *   verify    the checks (verify.ts) → verified (media_r2_verified) or failed
 *
 * A cron safety net (every minute) re-queues the tick of a running run whose loop went quiet. A step
 * that fails is retried with backoff; on its last delivery (or a failure a retry cannot fix) the item
 * fails, the admin Errors page gets an item with Retry, and the message goes to the DLQ.
 */
import {
	DEFAULT_BACKFILL_SETTINGS,
	reportNeedsAction,
	resolveNeedsAction,
	underHold,
	originalPrefix,
	withinBudget,
	type BackfillRun,
	type BackfillScope,
	type BackfillSettings,
	type VideoR2State,
} from '@al-ummah/shared-types';
import { logger } from '../../logger';
import R2Repository from '../../r2Repo';
import { enqueueTranscode } from '../r2-delivery';
import { BackfillFatal, copyStep, digestStreamMd5, uploadIdFor, type Md5Hasher } from './copy';
import { insertPlanned, measuredBasis, planItem, scopePage } from './estimate';
import {
	getItem,
	getRunRow,
	itemsInStates,
	readRun,
	setRunStatus,
	spentOf,
	summariseEstimate,
	transition,
	updateItem,
	updateRun,
	type ItemRow,
	type RunRow,
} from './store';
import { verifyItem } from './verify';
import { BACKFILL_KIND, BACKFILL_MAX_DELIVERIES, type BackfillEnv, type BackfillMessage, type Ctx } from './types';
import { effectiveTranscodes } from '../transcode-limit';

export const TICK_SECONDS = 20;
/** A copy or verify step that has not moved in this long is sent again by the tick */
const STALE_STEP_MS = 30 * 60 * 1000;
/** The cron restarts a running run whose last tick is older than this */
export const QUIET_LOOP_MS = 5 * 60 * 1000;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const needsKey = (videoId: string) => `media-backfill:${videoId}`;
const runKey = (runId: string) => `media-backfill-run:${runId}`;

async function send(env: BackfillEnv, body: Omit<BackfillMessage, 'kind'>, delaySeconds?: number): Promise<void> {
	if (!env.PROCESSING_CHECK_QUEUE) throw new Error('PROCESSING_CHECK_QUEUE is not bound');
	await env.PROCESSING_CHECK_QUEUE.send({ kind: BACKFILL_KIND, ...body } satisfies BackfillMessage, delaySeconds ? { delaySeconds } : undefined);
}

function db(env: BackfillEnv): D1Database {
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	return env.SEARCH_DB;
}

const parseSettings = (row: RunRow): BackfillSettings => {
	try {
		return { ...DEFAULT_BACKFILL_SETTINGS, ...(JSON.parse(row.settings) as BackfillSettings) };
	} catch {
		return DEFAULT_BACKFILL_SETTINGS;
	}
};

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

export async function createRun(env: BackfillEnv, scope: BackfillScope, actorId: string, now = new Date()): Promise<BackfillRun> {
	const id = `bf-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8)}`;
	const at = now.toISOString();
	await db(env)
		.prepare(`INSERT INTO media_backfill_runs (id, status, scope, settings, created_by, created_at, updated_at) VALUES (?1, 'estimating', ?2, ?3, ?4, ?5, ?5)`)
		.bind(id, JSON.stringify(scope), JSON.stringify(DEFAULT_BACKFILL_SETTINGS), actorId, at)
		.run();
	await send(env, { op: 'estimate', runId: id });
	logger.info('[Backfill] Run created', { runId: id, scope: scope.kind, actorId });
	return (await readRun(db(env), id))!;
}

export class BackfillStateError extends Error {
	constructor(message: string, readonly code: string) {
		super(message);
		this.name = 'BackfillStateError';
	}
}

export async function changeSettings(env: BackfillEnv, runId: string, settings: BackfillSettings): Promise<BackfillRun> {
	const row = await getRunRow(db(env), runId);
	if (!row) throw new BackfillStateError('No such run', 'not_found');
	if (!['estimated', 'running', 'paused', 'stopped_budget'].includes(row.status)) throw new BackfillStateError(`The run is ${row.status}`, 'bad_state');
	// Never more than the admin's concurrent transcodes max (Video providers → Cloudflare R2 settings)
	const maxTranscodes = (await effectiveTranscodes(env)).max;
	const capped = { ...settings, concurrency: Math.min(settings.concurrency, maxTranscodes) };
	await updateRun(db(env), runId, { settings: JSON.stringify(capped) });
	return (await readRun(db(env), runId))!;
}

/** Start (from estimated), resume (from paused or stopped by the budget). Needs a budget cap. */
export async function startRun(env: BackfillEnv, ctx: Ctx, runId: string, now = new Date()): Promise<BackfillRun> {
	const row = await getRunRow(db(env), runId);
	if (!row) throw new BackfillStateError('No such run', 'not_found');
	const settings = parseSettings(row);
	if (!(settings.budgetUsd > 0)) throw new BackfillStateError('Set a budget cap first', 'no_budget');
	if (row.status === 'stopped_budget') {
		// Resuming with the same cap would stop again at once: the cap must cover the spend and the next video
		const spent = await spentOf(db(env), runId);
		const [next] = await itemsInStates(db(env), runId, ['pending'], 1);
		if (spent.totalUsd >= settings.budgetUsd || (next && !withinBudget(settings.budgetUsd, spent.totalUsd, 0, next.est_usd))) {
			throw new BackfillStateError('Raise the budget cap to cover what is spent and the next video first', 'budget');
		}
	}
	const ok = await setRunStatus(db(env), runId, ['estimated', 'paused', 'stopped_budget'], 'running', { started_at: row.started_at ?? now.toISOString(), stop_reason: null, tick_at: now.toISOString() }, now);
	if (!ok) throw new BackfillStateError(`The run is ${row.status}`, 'bad_state');
	resolveNeedsAction(env, ctx, runKey(runId));
	await send(env, { op: 'tick', runId });
	logger.info('[Backfill] Run started', { runId, from: row.status, settings });
	return (await readRun(db(env), runId))!;
}

export async function pauseRun(env: BackfillEnv, runId: string): Promise<BackfillRun> {
	if (!(await setRunStatus(db(env), runId, ['running'], 'paused'))) throw new BackfillStateError('The run is not running', 'bad_state');
	return (await readRun(db(env), runId))!;
}

/** No new videos start; pending ones are cancelled; a copy in progress stops at its next range. */
export async function cancelRun(env: BackfillEnv, runId: string, now = new Date()): Promise<BackfillRun> {
	const ok = await setRunStatus(db(env), runId, ['estimating', 'estimated', 'running', 'paused', 'stopped_budget'], 'cancelled', { finished_at: now.toISOString() }, now);
	if (!ok) throw new BackfillStateError('The run has already ended', 'bad_state');
	await db(env).prepare("UPDATE media_backfill_items SET state = 'cancelled', updated_at = ?2 WHERE run_id = ?1 AND state IN ('pending', 'copying')").bind(runId, now.toISOString()).run();
	return (await readRun(db(env), runId))!;
}

/** Retry a failed item (the page, or the Errors page's Retry): back to pending; an ended run runs again. */
export async function retryItem(env: BackfillEnv, ctx: Ctx, runId: string, videoId: string, now = new Date()): Promise<{ retried: boolean; why?: string }> {
	const row = await getRunRow(db(env), runId);
	if (!row) return { retried: false, why: 'no such run' };
	if (row.status === 'cancelled') return { retried: false, why: 'the run was canceled' };
	const moved = await transition(db(env), runId, videoId, ['failed'], 'pending', { error: null, error_step: null, attempts: 0 }, now);
	if (!moved) return { retried: false, why: 'the item has not failed' };
	resolveNeedsAction(env, ctx, needsKey(videoId));
	if (row.status === 'done' || row.status === 'failed') {
		await setRunStatus(db(env), runId, ['done', 'failed'], 'running', { finished_at: null, tick_at: now.toISOString() }, now);
		await send(env, { op: 'tick', runId });
	}
	return { retried: true };
}

// ---------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------

export async function estimateStep(env: BackfillEnv, runId: string, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<void> {
	const row = await getRunRow(db(env), runId);
	if (!row || row.status !== 'estimating') return;
	const scope = JSON.parse(row.scope) as BackfillScope;
	const basis = await measuredBasis(db(env));
	const { rows, next } = await scopePage(db(env), scope, row.cursor);
	const planned = [];
	for (const r of rows) planned.push(await planItem(env, r, scope, basis, fetchImpl));
	await insertPlanned(db(env), runId, planned, now);
	if (next) {
		await updateRun(db(env), runId, { cursor: next }, now);
		await send(env, { op: 'estimate', runId });
		return;
	}
	const estimate = await summariseEstimate(db(env), runId, basis, now);
	// The cap starts at the estimate (rounded up to the cent): exceeding the estimate stops the run
	const settings = { ...parseSettings(row), budgetUsd: Math.ceil(estimate.totalUsd * 100) / 100 };
	await setRunStatus(db(env), runId, ['estimating'], 'estimated', { estimate: JSON.stringify(estimate), settings: JSON.stringify(settings), cursor: null }, now);
	logger.info('[Backfill] Estimate ready', { runId, videos: estimate.videos, totalUsd: estimate.totalUsd });
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function failItem(env: BackfillEnv, ctx: Ctx, item: Pick<ItemRow, 'run_id' | 'video_id' | 'title'>, step: string, error: string, now = new Date()): Promise<void> {
	const text = error.slice(0, 500);
	const moved = await transition(db(env), item.run_id, item.video_id, ['pending', 'copying', 'transcoding', 'verifying'], 'failed', { error: text, error_step: step }, now);
	if (!moved) return;
	logger.warn('[Backfill] Item failed', { runId: item.run_id, videoId: item.video_id, step, error: text });
	reportNeedsAction('api-videos', env, ctx, {
		key: needsKey(item.video_id),
		source: 'queue',
		title: 'R2 backfill failed for a video',
		message: `${step}: ${text}`,
		itemType: 'media-backfill',
		itemId: item.video_id,
		itemUrl: `/backfill?run=${encodeURIComponent(item.run_id)}`,
		retry: { kind: 'service', service: 'api-videos', path: '/internal/media/backfill/items/retry', body: { runId: item.run_id, videoId: item.video_id } },
		retryLabel: 'Retry backfill',
		extra: { runId: item.run_id, videoId: item.video_id, step },
	});
}

/**
 * A hold (CSAM containment, a suspension) can land at any time, so every stage checks it before it acts:
 * the item is left out as skipped/held and nothing more is copied, transcoded or verified. A copy still in
 * progress loses the parts this run wrote (the Bunny copy, never touched, stays the preserved one).
 */
async function skipIfHeld(env: BackfillEnv, item: Pick<ItemRow, 'run_id' | 'video_id' | 'upload_id'>, now: Date, opts: { partialCopy?: boolean } = {}): Promise<boolean> {
	const current = await new R2Repository<{ suspensionHolds?: unknown }>(env.videos).getObject(item.video_id);
	if (!underHold(current)) return false;
	await transition(db(env), item.run_id, item.video_id, ['pending', 'copying', 'transcoding', 'verifying'], 'skipped', { skip_reason: 'held' }, now);
	if (opts.partialCopy && env.MEDIA_ORIGINALS) {
		// Only this run's own upload id: an upload's kept original is never touched
		const prefix = `${originalPrefix(item.video_id)}${item.upload_id ?? uploadIdFor(item.run_id)}/`;
		let cursor: string | undefined;
		do {
			const page = await env.MEDIA_ORIGINALS.list({ prefix, cursor });
			if (page.objects.length) await env.MEDIA_ORIGINALS.delete(page.objects.map((o) => o.key));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
	}
	logger.warn('[Backfill] Video under a hold, left out', { runId: item.run_id, videoId: item.video_id });
	return true;
}

interface StageVideo {
	id: string;
	isDeleted?: boolean;
	r2?: VideoR2State;
}

/** After the copy (or with an original already kept): transcode, or verify a rendition that is ready. */
export async function toTranscode(env: BackfillEnv, ctx: Ctx, item: ItemRow, now = new Date()): Promise<void> {
	if (await skipIfHeld(env, item, now)) return;
	const video = await new R2Repository<StageVideo>(env.videos).getObject(item.video_id);
	if (!video || video.isDeleted) return failItem(env, ctx, item, 'transcode', 'The video was deleted', now);
	const status = video.r2?.status;
	// A ready rendition is verified as it is (a rendition made from Bunny's MP4 before we kept originals included)
	if (status === 'ready' && video.r2?.result) {
		if (await transition(db(env), item.run_id, item.video_id, ['pending', 'copying'], 'verifying', {}, now)) await send(env, { op: 'verify', runId: item.run_id, videoId: item.video_id });
		return;
	}
	// One already queued or running (an upload's own job): follow it
	const queued = status === 'queued' || status === 'transcoding' ? { queued: false, jobId: video.r2!.jobId } : await enqueueTranscode(env, item.video_id, 'backfill', { force: status === 'failed', now });
	const fresh = await new R2Repository<StageVideo>(env.videos).getObject(item.video_id);
	const jobId = queued.jobId ?? fresh?.r2?.jobId ?? null;
	if (!queued.queued && !(fresh?.r2 && ['queued', 'transcoding'].includes(fresh.r2.status))) return failItem(env, ctx, item, 'transcode', `Could not queue the transcode (${(queued as { why?: string }).why ?? 'unknown'})`, now);
	await transition(db(env), item.run_id, item.video_id, ['pending', 'copying'], 'transcoding', { job_id: jobId }, now);
}

async function startItem(env: BackfillEnv, ctx: Ctx, item: ItemRow, now: Date): Promise<void> {
	// Held since the estimate (CSAM containment, a suspension): left out, nothing copied or transcoded
	if (await skipIfHeld(env, item, now)) return;
	if (!item.has_original) {
		if (await transition(db(env), item.run_id, item.video_id, ['pending'], 'copying', { started_at: now.toISOString() }, now)) await send(env, { op: 'copy', runId: item.run_id, videoId: item.video_id, offset: item.copied_bytes || 0 });
		return;
	}
	await updateItem(db(env), item.run_id, item.video_id, { started_at: now.toISOString() }, now);
	await toTranscode(env, ctx, { ...item, started_at: now.toISOString() }, now);
}

/** A video in transcode: ready → verify; failed for good → the item fails. */
async function pollTranscode(env: BackfillEnv, ctx: Ctx, item: ItemRow, now: Date): Promise<void> {
	if (await skipIfHeld(env, item, now)) return;
	const video = await new R2Repository<StageVideo>(env.videos).getObject(item.video_id);
	const r2 = video?.r2;
	if (!video || video.isDeleted) return failItem(env, ctx, item, 'transcode', 'The video was deleted', now);
	if (r2?.status === 'ready' && r2.result) {
		const fields: Partial<ItemRow> = {
			container_seconds: r2.containerSeconds ?? 0,
			stored_bytes: (item.has_original ? item.source_bytes ?? 0 : item.copied_bytes) + (r2.result.bytes ?? 0),
			class_a_ops: item.class_a_ops + (r2.result.objects ?? 0),
		};
		await updateItem(db(env), item.run_id, item.video_id, fields, now);
		if (await transition(db(env), item.run_id, item.video_id, ['transcoding'], 'verifying', {}, now)) await send(env, { op: 'verify', runId: item.run_id, videoId: item.video_id });
		return;
	}
	if (r2?.status === 'failed') {
		await updateItem(db(env), item.run_id, item.video_id, { container_seconds: r2.containerSeconds ?? 0 }, now);
		return failItem(env, ctx, item, 'transcode', r2.error ?? 'The transcode failed', now);
	}
}

export async function verifyStep(env: BackfillEnv, ctx: Ctx, runId: string, videoId: string, now = new Date()): Promise<void> {
	const item = await getItem(db(env), runId, videoId);
	if (!item || item.state !== 'verifying') return;
	if (await skipIfHeld(env, item, now)) return;
	const result = await verifyItem(env, item);
	if (!result.ok) {
		await updateItem(db(env), runId, videoId, { checks: JSON.stringify(result.checks) }, now);
		return failItem(env, ctx, item, 'verify', result.error ?? 'Verification failed', now);
	}
	const at = now.toISOString();
	await db(env)
		.prepare(
			`INSERT INTO media_r2_verified (video_id, run_id, rev, library_id, channel_id, verified_at, checks) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
			 ON CONFLICT (video_id) DO UPDATE SET run_id = excluded.run_id, rev = excluded.rev, library_id = COALESCE(excluded.library_id, media_r2_verified.library_id),
			   channel_id = excluded.channel_id, verified_at = excluded.verified_at, checks = excluded.checks`,
		)
		.bind(videoId, runId, result.rev, item.library_id, item.channel_id, at, JSON.stringify(result.checks))
		.run();
	await transition(db(env), runId, videoId, ['verifying'], 'verified', { checks: JSON.stringify(result.checks), verified_at: at, error: null, error_step: null }, now);
	resolveNeedsAction(env, ctx, needsKey(videoId));
	logger.info('[Backfill] Video verified', { runId, videoId, rev: result.rev });
}

export async function copyMessage(
	env: BackfillEnv,
	ctx: Ctx,
	runId: string,
	videoId: string,
	offset: number,
	fetchImpl: typeof fetch = fetch,
	now = new Date(),
	md5: () => Md5Hasher = digestStreamMd5,
): Promise<void> {
	const run = await getRunRow(db(env), runId);
	const item = await getItem(db(env), runId, videoId);
	if (!item || item.state !== 'copying') return;
	if (!run || run.status === 'cancelled') {
		await transition(db(env), runId, videoId, ['copying'], 'cancelled', {}, now);
		return;
	}
	if (await skipIfHeld(env, item, now, { partialCopy: true })) return;
	const step = await copyStep(env, item, offset, fetchImpl, now, md5);
	if (!step.done) {
		await send(env, { op: 'copy', runId, videoId, offset: step.next });
		return;
	}
	const fresh = await getItem(db(env), runId, videoId);
	if (fresh) await toTranscode(env, ctx, fresh, now);
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export async function tick(env: BackfillEnv, ctx: Ctx, runId: string, now = new Date()): Promise<{ next: boolean }> {
	const row = await getRunRow(db(env), runId);
	if (!row || row.status !== 'running') return { next: false };
	await updateRun(db(env), runId, { tick_at: now.toISOString() }, now);
	const settings = parseSettings(row);

	// In progress: poll transcodes, re-send steps that went quiet
	const active = await itemsInStates(db(env), runId, ['copying', 'transcoding', 'verifying'], 200);
	for (const item of active) {
		try {
			if (item.state === 'transcoding') await pollTranscode(env, ctx, item, now);
			else if (now.getTime() - Date.parse(item.updated_at) > STALE_STEP_MS) {
				if (item.state === 'copying') await send(env, { op: 'copy', runId, videoId: item.video_id, offset: item.copied_bytes || 0 });
				else await send(env, { op: 'verify', runId, videoId: item.video_id });
				await updateItem(db(env), runId, item.video_id, {}, now);
			}
		} catch (error) {
			logger.warn('[Backfill] Could not check an item', { runId, videoId: item.video_id, error: msg(error) });
		}
	}
	const inFlight = await itemsInStates(db(env), runId, ['copying', 'transcoding', 'verifying'], 200);
	const pendingCount = await db(env).prepare("SELECT COUNT(*) AS n FROM media_backfill_items WHERE run_id = ?1 AND state = 'pending'").bind(runId).first<{ n: number }>();
	if (!inFlight.length && !(Number(pendingCount?.n) > 0)) {
		await setRunStatus(db(env), runId, ['running'], 'done', { finished_at: now.toISOString() }, now);
		logger.info('[Backfill] Run done', { runId });
		return { next: false };
	}

	// Budget: spent + what the videos in progress may still cost + the next video's estimate
	const spent = await spentOf(db(env), runId);
	const inFlightRemaining = inFlight.reduce((sum, i) => sum + Math.max(0, i.est_usd - i.spent_usd), 0);
	if (spent.totalUsd > settings.budgetUsd) {
		await stopForBudget(env, ctx, runId, spent.totalUsd, settings.budgetUsd, now);
		return { next: false };
	}

	// Start new videos within concurrency and spacing
	const concurrency = Math.min(settings.concurrency, (await effectiveTranscodes(env, now.getTime())).max);
	let free = concurrency - inFlight.length;
	const lastStart = row.last_start_at ? Date.parse(row.last_start_at) : 0;
	const spacingMs = settings.spacingSeconds * 1000;
	if (free > 0 && now.getTime() - lastStart >= spacingMs) {
		const wanted = settings.spacingSeconds > 0 ? 1 : free;
		const next = await itemsInStates(db(env), runId, ['pending'], wanted);
		let started = 0;
		let committed = inFlightRemaining;
		for (const item of next) {
			if (!withinBudget(settings.budgetUsd, spent.totalUsd, committed, item.est_usd)) {
				if (!inFlight.length && !started) {
					await stopForBudget(env, ctx, runId, spent.totalUsd + committed + item.est_usd, settings.budgetUsd, now);
					return { next: false };
				}
				break;
			}
			try {
				await startItem(env, ctx, item, now);
				committed += item.est_usd;
				started++;
				free--;
			} catch (error) {
				await failItem(env, ctx, item, 'start', msg(error), now);
			}
		}
		if (started) await updateRun(db(env), runId, { last_start_at: now.toISOString() }, now);
	}
	return { next: true };
}

async function stopForBudget(env: BackfillEnv, ctx: Ctx, runId: string, wouldSpend: number, budget: number, now: Date): Promise<void> {
	if (!(await setRunStatus(db(env), runId, ['running'], 'stopped_budget', { stop_reason: `Budget cap $${budget.toFixed(2)} reached (would spend $${wouldSpend.toFixed(2)})` }, now))) return;
	logger.warn('[Backfill] Run stopped by its budget cap', { runId, budget, wouldSpend });
	reportNeedsAction('api-videos', env, ctx, {
		key: runKey(runId),
		source: 'queue',
		title: 'R2 backfill stopped: budget cap reached',
		message: `The run would pass its cap of $${budget.toFixed(2)}. Raise the cap on the Backfill page and resume, or cancel the run.`,
		itemType: 'media-backfill-run',
		itemId: runId,
		itemUrl: `/backfill?run=${encodeURIComponent(runId)}`,
	});
}

/** Cron safety net: running runs whose loop went quiet get a new tick. */
export async function restartQuietRuns(env: BackfillEnv, now = new Date()): Promise<number> {
	if (!env.SEARCH_DB || !env.PROCESSING_CHECK_QUEUE) return 0;
	const cutoff = new Date(now.getTime() - QUIET_LOOP_MS).toISOString();
	const { results } = await env.SEARCH_DB.prepare("SELECT id FROM media_backfill_runs WHERE status IN ('running', 'estimating') AND (tick_at IS NULL OR tick_at < ?1) LIMIT 10").bind(cutoff).all<{ id: string; status: string }>();
	let n = 0;
	for (const r of results ?? []) {
		const row = await getRunRow(env.SEARCH_DB, r.id);
		if (!row) continue;
		await updateRun(env.SEARCH_DB, r.id, { tick_at: now.toISOString() }, now);
		await send(env, { op: row.status === 'estimating' ? 'estimate' : 'tick', runId: r.id });
		n++;
	}
	if (n) logger.warn('[Backfill] Restarted quiet run loops', { count: n });
	return n;
}

// ---------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------

interface QueueMessageLike {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

export function backfillRetryDelay(attempts: number): number {
	return Math.min(600, 15 * 2 ** Math.max(0, attempts - 1));
}

export async function handleBackfillMessage(env: BackfillEnv, ctx: Ctx, m: QueueMessageLike, deps: { fetch?: typeof fetch; md5?: () => Md5Hasher; removal?: (env: BackfillEnv, ctx: Ctx, videoId: string, last: boolean) => Promise<void> } = {}): Promise<void> {
	const body = m.body as BackfillMessage;
	const last = m.attempts >= BACKFILL_MAX_DELIVERIES;
	const fetchImpl = deps.fetch ?? fetch;
	try {
		if (body.op === 'estimate' && body.runId) await estimateStep(env, body.runId, fetchImpl);
		else if (body.op === 'tick' && body.runId) {
			const { next } = await tick(env, ctx, body.runId);
			if (next) await send(env, { op: 'tick', runId: body.runId }, TICK_SECONDS);
		} else if (body.op === 'copy' && body.runId && body.videoId) await copyMessage(env, ctx, body.runId, body.videoId, body.offset ?? 0, fetchImpl, new Date(), deps.md5);
		else if (body.op === 'verify' && body.runId && body.videoId) await verifyStep(env, ctx, body.runId, body.videoId);
		else if (body.op === 'removal' && body.videoId && deps.removal) await deps.removal(env, ctx, body.videoId, last);
		m.ack();
	} catch (error) {
		const text = msg(error);
		const fatal = error instanceof BackfillFatal;
		if ((fatal || last) && body.runId && body.videoId && (body.op === 'copy' || body.op === 'verify')) {
			const item = await getItem(db(env), body.runId, body.videoId).catch(() => null);
			if (item) await updateItem(db(env), body.runId, body.videoId, { attempts: m.attempts }).catch(() => undefined);
			await failItem(env, ctx, { run_id: body.runId, video_id: body.videoId, title: item?.title ?? null }, fatal ? (error as BackfillFatal).step : body.op, text).catch(() => undefined);
		}
		if ((fatal || last) && body.op === 'estimate' && body.runId) {
			await setRunStatus(db(env), body.runId, ['estimating'], 'failed', { stop_reason: `Estimate failed: ${text.slice(0, 300)}` }).catch(() => undefined);
			reportNeedsAction('api-videos', env, ctx, { key: runKey(body.runId), source: 'queue', title: 'R2 backfill estimate failed', message: text.slice(0, 500), itemType: 'media-backfill-run', itemId: body.runId, itemUrl: `/backfill?run=${encodeURIComponent(body.runId)}` });
		}
		if (fatal) {
			m.ack();
			return;
		}
		logger[last ? 'error' : 'warn']('[Backfill] Step failed; retrying', { op: body.op, runId: body.runId, videoId: body.videoId, attempts: m.attempts, last, error: text });
		// After the last delivery the queue dead-letters it (processor DLQ consumer → dead_letters, Errors page)
		m.retry({ delaySeconds: backfillRetryDelay(m.attempts) });
	}
}
