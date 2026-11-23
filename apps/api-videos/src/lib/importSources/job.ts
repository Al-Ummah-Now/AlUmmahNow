/**
 * The admin job 'import.source-sync' (wiki TOOLS-ADMIN TA-9): one sync of one source, queued by "Sync
 * now" (admin-api), by the hourly cron for due sources, and by the Telegram webhook when a post comes.
 * Retried with backoff, then the DLQ; a failure shows on the source, on the Jobs page and on the Errors
 * page with Retry (admin-api lib/errors-actions.ts).
 *
 *   fetch   read the source's new items (lib/importSources/fetchers.ts) and record each once (source +
 *           item id). Items our own auto-post sent to that network are never imported back.
 *   post    IMPORT_POSTS_PER_STEP pending items per step, oldest first, each a post (and a video) on the
 *           channel (lib/importSources/post.ts); a video's transfer continues over further steps.
 *
 * Idempotent and resumable: the phase is in the job's params, every item remembers what it produced.
 */
import { featureGate, IMPORT_POSTS_PER_STEP, reportNeedsAction, resolveNeedsAction, type AdminJob, type ErrorReporterEnv } from '@al-ummah/shared-types';
import { createJob, getJob, type JobEnv, type JobOutcome } from '../admin/jobs';
import { revokeSource, stillAuthorized } from './authorize';
import { fetchSource, itemKind } from './fetchers';
import { postItem, skipItem, type PostItemEnv } from './post';
import {
	dueSources,
	insertItems,
	markSyncFailed,
	markSyncFinished,
	markSyncStarted,
	ourRemoteIds,
	pendingItems,
	readSource,
	saveCursor,
	sourceDb,
	SourceError,
	type SourceRow,
} from './store';
import { logger } from '../logger';

export const SOURCE_SYNC_JOB_KIND = 'import.source-sync' as const;
/** Due sources queued per cron tick. */
const DUE_PER_TICK = 100;
/** A tick's syncs start spread over this many seconds, so they never all reach the networks at once. */
const DUE_SPREAD_SECONDS = 45 * 60;

export type SourceSyncEnv = JobEnv & PostItemEnv;

interface SyncParams {
	sourceId: string;
	phase: 'fetch' | 'post';
	fetched: number;
	posted: number;
	skipped: number;
	/** Seconds to wait before the first step (the cron spreads a tick's syncs over the hour) */
	waitSeconds?: number;
}

export const sourceSyncNeedsActionKey = (sourceId: string) => `import-source:${sourceId}`;

/**
 * Queues a sync of the source, or returns the one already waiting or running (one sync per source at a
 * time). `actorId` is the admin the posts and uploads are recorded under.
 */
export async function startSourceSync(
	env: SourceSyncEnv,
	source: Pick<SourceRow, 'id' | 'channel_id' | 'last_job_id'>,
	actorId: string,
	phase: 'fetch' | 'post' = 'fetch',
	waitSeconds = 0,
): Promise<AdminJob> {
	if (source.last_job_id) {
		const running = await getJob(env, source.last_job_id);
		if (running && ['queued', 'running', 'retrying'].includes(running.status)) return running;
	}
	const params: SyncParams = { sourceId: source.id, phase, fetched: 0, posted: 0, skipped: 0, ...(waitSeconds > 0 ? { waitSeconds } : {}) };
	const job = await createJob(env, { kind: SOURCE_SYNC_JOB_KIND, targetKind: 'channel', targetId: source.channel_id, params: params as unknown as Record<string, unknown>, actorId });
	await markSyncStarted(env, source.id, job.id);
	return job;
}

/** waitUntil for work started by the post writer and the upload route, settled before the step ends. */
function stepContext(): { ctx: ExecutionContext; settle(): Promise<unknown> } {
	const pending: Promise<unknown>[] = [];
	const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
	return { ctx, settle: () => Promise.allSettled(pending) };
}

async function fetchPhase(env: SourceSyncEnv, source: SourceRow, params: SyncParams, f: typeof fetch): Promise<number> {
	const { items, cursor } = await fetchSource(source.network, source.address, source.cursor, f);
	const ours = await ourRemoteIds(env, source.network, items.map((i) => i.itemId));
	const added = await insertItems(
		env,
		source.id,
		items.map((item) => {
			const note = ours.has(item.itemId) ? 'posted_by_us' : (item.skip ?? item.awaiting ?? null);
			const state = ours.has(item.itemId) || item.skip ? 'skipped' : item.awaiting ? 'awaiting_file' : 'pending';
			return { itemId: item.itemId, kind: itemKind(item), state, payload: item, originalUrl: item.url, originalAt: item.postedAt, note };
		}),
	);
	await saveCursor(env, source.id, cursor);
	logger.debug('[ImportSources] Fetched', { sourceId: source.id, network: source.network, read: items.length, added });
	params.fetched += added;
	return added;
}

/** The job: the fetch, then posting in steps. */
export async function runSourceSync(env: SourceSyncEnv, job: AdminJob, f: typeof fetch = fetch): Promise<JobOutcome> {
	const params = { fetched: 0, posted: 0, skipped: 0, phase: 'fetch', ...(job.params as unknown as Partial<SyncParams>) } as SyncParams;
	if (!params.sourceId) throw new Error('import.source-sync: missing sourceId');
	const source = await readSource(env, params.sourceId);
	const result = () => ({ sourceId: params.sourceId, fetched: params.fetched, posted: params.posted, skipped: params.skipped });
	if (!source) return { done: true, result: { ...result(), skipped: 'source_deleted' } };
	// A cron sync's place in the tick's spread: the first step only waits
	if (params.waitSeconds && params.waitSeconds > 0) {
		const delaySeconds = params.waitSeconds;
		delete params.waitSeconds;
		return { done: false, params: params as unknown as Record<string, unknown>, result: result(), delaySeconds };
	}
	// A connected source stops when the owner's connection is gone (the source shows why; nothing is posted)
	if (!(await stillAuthorized(env, source))) {
		await revokeSource(env, source.id);
		logger.info('[ImportSources] Source turned off: the connection is gone', { sourceId: source.id, network: source.network });
		return { done: true, result: { ...result(), skipped: 'not_connected' } };
	}

	if (params.phase === 'fetch') {
		await fetchPhase(env, source, params, f);
		params.phase = 'post';
	}

	const { ctx, settle } = stepContext();
	try {
		const rows = await pendingItems(env, source.id, IMPORT_POSTS_PER_STEP);
		for (const row of rows) {
			let outcome;
			try {
				outcome = await postItem(env, ctx, source, row, job.actorId, f);
			} catch (error) {
				// The channel is gone or suspended: the whole sync fails (shown on the source and the Errors page)
				if (error instanceof SourceError && error.code === 'channel_unavailable') throw error;
				// The upload or post was refused for good (a 4xx): the item is skipped, the rest go on
				if (error instanceof SourceError) {
					logger.warn('[ImportSources] Item refused', { sourceId: source.id, itemId: row.item_id, code: error.code });
					await skipItem(env, source, row, 'post_refused');
					params.skipped++;
					continue;
				}
				throw error;
			}
			if (outcome.status === 'continue') {
				// A video still copying: the next step continues it
				return { done: false, params: params as unknown as Record<string, unknown>, result: result(), delaySeconds: 0 };
			}
			if (outcome.status === 'skipped') {
				await skipItem(env, source, row, outcome.note);
				params.skipped++;
			} else params.posted++;
		}
		if (rows.length === IMPORT_POSTS_PER_STEP) return { done: false, params: params as unknown as Record<string, unknown>, result: result(), delaySeconds: 0 };
	} finally {
		await settle();
	}

	await markSyncFinished(env, source, null);
	resolveNeedsAction(env as unknown as ErrorReporterEnv, undefined, sourceSyncNeedsActionKey(source.id));
	logger.info('[ImportSources] Sync finished', { jobId: job.id, ...result() });
	return { done: true, result: result() };
}

/** The job failed for good: shown on the source, and an Errors page item with Retry. */
export async function onSourceSyncFailed(env: SourceSyncEnv, job: AdminJob, error: string): Promise<void> {
	const sourceId = String((job.params as { sourceId?: string })?.sourceId ?? '');
	const source = sourceId ? await readSource(env, sourceId).catch(() => null) : null;
	if (source) await markSyncFailed(env, source, error);
	reportNeedsAction('api-videos', env as unknown as ErrorReporterEnv, undefined, {
		key: sourceSyncNeedsActionKey(sourceId || job.id),
		source: 'queue',
		title: 'Social import: a sync failed',
		message: error.slice(0, 500),
		itemType: 'channel',
		itemId: job.targetId,
		retry: { kind: 'service', service: 'api-videos', path: '/internal/admin/import/sources/retry', body: { jobId: job.id } },
		retryLabel: 'Try again',
		extra: { jobId: job.id, sourceId, network: source?.network ?? null },
	});
}

/** The upload switch (Features page): a sync makes new posts and videos, so it needs uploads on. */
export async function uploadsOn(env: SourceSyncEnv): Promise<boolean> {
	return (await featureGate(env as never, 'upload').catch(() => ({ on: true as const }))).on;
}

/**
 * The hourly cron: a sync for every enabled source whose time has come. Its next sync time is cleared
 * once queued (the sync sets it when it ends), so a slow queue never queues the same source twice.
 */
export async function queueDueSources(env: SourceSyncEnv, now = Date.now()): Promise<number> {
	if (!env.SEARCH_DB) return 0;
	// A sync makes new posts and videos: while uploads are off (Features page) nothing is queued, and the
	// due sources stay due for the first tick after they are back on
	if (!(await uploadsOn(env))) {
		logger.info('[ImportSources] Uploads are off: no scheduled syncs this tick');
		return 0;
	}
	const due = await dueSources(env, now, DUE_PER_TICK);
	let queued = 0;
	for (const [i, source] of due.entries()) {
		try {
			// Spread over the hour: never a burst on one network's API (feeds, Bluesky, a Mastodon server)
			await startSourceSync(env, source, source.created_by, 'fetch', due.length > 1 ? Math.floor((i * DUE_SPREAD_SECONDS) / due.length) : 0);
			// Unless the sync already finished and set the next time itself
			await sourceDb(env).prepare('UPDATE import_sources SET next_sync_at = NULL, updated_at = ? WHERE id = ? AND next_sync_at = ?').bind(now, source.id, source.next_sync_at).run();
			queued++;
		} catch (error) {
			logger.error('[ImportSources] Could not queue a due sync', { sourceId: source.id, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return queued;
}
