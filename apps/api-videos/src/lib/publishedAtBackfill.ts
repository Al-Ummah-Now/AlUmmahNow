/**
 * Backfill of `publishedAt` (lib/published.ts) for videos published before it was recorded: a video
 * that is published now and has no publish date gets the time it first became watchable
 * (`playableAt`) when the processing loop recorded it, else its upload time (`dateCreated`).
 *
 * A dry run by default: it counts what it would set and writes nothing. One bucket page per message
 * on the processing-check queue (index.ts queue(), like the video-format backfill); the run's state
 * is in global_settings `ops/published-at/runs/<runId>.json`. Writes are conditional (updateObject)
 * and go through the search-sync wrapper, so ownership and search rows follow.
 *
 * Start a run by sending { kind: 'published-at-backfill', runId, page: 0, cursor: null, dryRun,
 * limit } to the env's processing-check queue (scripts/release/published-at-backfill.ts).
 */
import R2Repository from './r2Repo';
import { logger } from './logger';
import { isPublishedState, type PublishableState } from './published';
import { isInternalRecord } from './visibility';

export const PUBLISHED_AT_BACKFILL_KIND = 'published-at-backfill';
const RUN_PREFIX = 'ops/published-at/runs/';
const PAGE_DELAY_SECONDS = 2;

export interface PublishedAtBackfillMessage {
	kind: typeof PUBLISHED_AT_BACKFILL_KIND;
	runId: string;
	page: number;
	cursor: string | null;
	/** Count only, write nothing (the default when absent) */
	dryRun?: boolean;
	limit?: number;
}

export interface PublishedAtPageCounts {
	scanned: number;
	/** Set (or would be, in a dry run) from playableAt / from dateCreated */
	fromPlayable: number;
	fromCreated: number;
	alreadySet: number;
	notPublished: number;
	/** Published but with no usable date at all (left alone) */
	noDate: number;
}

export interface PublishedAtRun {
	runId: string;
	dryRun: boolean;
	status: 'running' | 'done';
	startedAt: string;
	updatedAt: string;
	finishedAt?: string;
	pages: Record<string, PublishedAtPageCounts>;
	totals: PublishedAtPageCounts;
}

interface Env {
	videos: R2Bucket;
	global_settings?: R2Bucket;
	PROCESSING_CHECK_QUEUE?: Queue;
}

type Video = PublishableState & { id?: string; dateCreated?: string; playableAt?: string };

const EMPTY: PublishedAtPageCounts = { scanned: 0, fromPlayable: 0, fromCreated: 0, alreadySet: 0, notPublished: 0, noDate: 0 };

export function isPublishedAtBackfillMessage(body: unknown): body is PublishedAtBackfillMessage {
	const m = body as Partial<PublishedAtBackfillMessage> | null;
	return !!m && m.kind === PUBLISHED_AT_BACKFILL_KIND && typeof m.runId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(m.runId)
		&& Number.isInteger(m.page) && (m.page as number) >= 0;
}

const validTime = (value: unknown): string | null =>
	typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/**
 * The publish date to record for one video, and where it came from; null when there is nothing to
 * do (already has one, not published) or no usable date.
 */
export function backfillPublishedAt(video: Video): { at: string; source: 'playable' | 'created' } | { skip: keyof PublishedAtPageCounts } {
	if (video.publishedAt) return { skip: 'alreadySet' };
	if (!isPublishedState(video)) return { skip: 'notPublished' };
	const playable = validTime(video.playableAt);
	if (playable) return { at: playable, source: 'playable' };
	const created = validTime(video.dateCreated);
	if (created) return { at: created, source: 'created' };
	return { skip: 'noDate' };
}

/** One bucket page: counts, and (not a dry run) the conditional writes. */
export async function runPublishedAtPage(env: Env, message: Pick<PublishedAtBackfillMessage, 'cursor' | 'limit' | 'dryRun'>): Promise<{ counts: PublishedAtPageCounts; nextCursor: string | null }> {
	const dryRun = message.dryRun !== false;
	const limit = Math.min(Math.max(Math.floor(message.limit ?? 50), 1), 200);
	const listing = await env.videos.list({ limit, ...(message.cursor ? { cursor: message.cursor } : {}) });
	const repo = new R2Repository<Video>(env.videos);
	const counts = { ...EMPTY };
	for (const object of listing.objects) {
		const video = await repo.getObject(object.key);
		// Section indexes and live streams share the bucket: not videos
		if (!video || typeof video !== 'object' || isInternalRecord(video as never)) continue;
		counts.scanned++;
		const plan = backfillPublishedAt(video);
		if ('skip' in plan) {
			counts[plan.skip]++;
			continue;
		}
		counts[plan.source === 'playable' ? 'fromPlayable' : 'fromCreated']++;
		if (dryRun) continue;
		// On the fresh copy: a publish recorded meanwhile is never overwritten
		await repo.updateObject(object.key, (fresh) => {
			const now = backfillPublishedAt(fresh);
			if ('skip' in now) return false;
			fresh.publishedAt = now.at;
			return true;
		});
	}
	return { counts, nextCursor: listing.truncated ? listing.cursor ?? null : null };
}

const runKey = (runId: string) => `${RUN_PREFIX}${runId}.json`;

async function readRun(env: Env, runId: string): Promise<PublishedAtRun | null> {
	const object = await env.global_settings?.get(runKey(runId));
	return object ? ((await object.json()) as PublishedAtRun) : null;
}

function sum(pages: Record<string, PublishedAtPageCounts>): PublishedAtPageCounts {
	const total = { ...EMPTY };
	for (const page of Object.values(pages)) for (const key of Object.keys(total) as Array<keyof PublishedAtPageCounts>) total[key] += page[key] ?? 0;
	return total;
}

interface QueueMessageLike {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** Consumer for one backfill message (index.ts queue()). */
export async function handlePublishedAtBackfillMessage(env: Env, msg: QueueMessageLike, now = new Date()): Promise<void> {
	const body = msg.body as PublishedAtBackfillMessage;
	try {
		if (!env.global_settings) throw new Error('global_settings bucket is not bound');
		const run: PublishedAtRun = (await readRun(env, body.runId)) ?? {
			runId: body.runId,
			dryRun: body.dryRun !== false,
			status: 'running',
			startedAt: now.toISOString(),
			updatedAt: now.toISOString(),
			pages: {},
			totals: { ...EMPTY },
		};
		if (run.status === 'done' || run.pages[String(body.page)]) {
			msg.ack();
			return;
		}
		const result = await runPublishedAtPage(env, { ...body, dryRun: run.dryRun });
		if (result.nextCursor) {
			await env.PROCESSING_CHECK_QUEUE!.send({ ...body, dryRun: run.dryRun, page: body.page + 1, cursor: result.nextCursor } satisfies PublishedAtBackfillMessage, { delaySeconds: PAGE_DELAY_SECONDS });
		}
		run.pages[String(body.page)] = result.counts;
		run.totals = sum(run.pages);
		run.updatedAt = now.toISOString();
		if (!result.nextCursor) {
			run.status = 'done';
			run.finishedAt = now.toISOString();
		}
		await env.global_settings.put(runKey(run.runId), JSON.stringify(run), { httpMetadata: { contentType: 'application/json' } });
		logger.info('[PublishedAtBackfill] Page done', { runId: run.runId, page: body.page, dryRun: run.dryRun, counts: result.counts, done: run.status === 'done' });
		msg.ack();
	} catch (error) {
		logger.warn('[PublishedAtBackfill] Page failed; retrying', { runId: body.runId, page: body.page, attempts: msg.attempts, error: error instanceof Error ? error.message : String(error) });
		msg.retry({ delaySeconds: Math.min(300, 30 * 2 ** Math.max(0, msg.attempts - 1)) });
	}
}
