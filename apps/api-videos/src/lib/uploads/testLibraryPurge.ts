/**
 * Test-library purge (QA / stage only; 2026-11-10 incident).
 *
 * Until the owner delete queued a Bunny delete (lib/uploads/bunnyDelete.ts),
 * every deleted upload stayed in the Bunny library. QA and stage share one
 * library, which reached ~25,800 videos for ~290 records; its encoding queue
 * was full of our own deleted test uploads. The upload reaper never removes
 * those (it keeps ready or encoding orphans and needs the upload marker), so
 * this job removes every Bunny video of this environment that has no record.
 *
 * A queued, resumable loop on the processing-check queue (kind
 * `test-library-purge`, sharing that queue's retries and DLQ):
 *
 *   admin Start (dry run or live) → state running, message { runId, page 1 }
 *   message → list one page of the library → per video: keep or delete →
 *   next message (same page when something was deleted: the rest moved up)
 *   → finished when a page is empty or the last page deleted nothing.
 *
 * Kept: another environment's video (name prefix rule), younger than
 * MIN_AGE_MS (an upload in flight writes its record seconds after creating
 * the Bunny video), a video with a record, a video a live stream refers to.
 * Idempotent: deleting a video already gone (404) is fine; a stopped or
 * superseded run's message is dropped; every message re-reads the state.
 * A failing page retries with backoff; after the last delivery the run is
 * flagged failed (admin Start resumes from its page) and the queue
 * dead-letters the message.
 *
 * Never runs in production: the worker must have BUNNY_TEST_LIBRARY="true"
 * (wrangler.qa.jsonc and the stage env only) and ENVIRONMENT must not be
 * "production".
 */

import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { belongsToEnv, deleteBunnyVideo, listBunnyVideos, type BunnyView, type ReaperEnv } from './reaper';

export const PURGE_KIND = 'test-library-purge';
export const PURGE_STATE_KEY = 'ops/test-library-purge/state.json';
/** Videos per library page (each needs an R2 head and maybe a Bunny delete). */
export const PURGE_PAGE_SIZE = 50;
/** A Bunny video younger than this may be an upload whose record is about to land. */
export const PURGE_MIN_AGE_MS = 60 * 60 * 1000;
export const PURGE_MAX_DELIVERIES = 6;
/** Videos of one page checked and deleted at once (Bunny API calls in flight). */
export const PURGE_CONCURRENCY = 10;
const RECENT_LIMIT = 50;

export type PurgeStatus = 'running' | 'stopped' | 'finished' | 'failed';

export interface PurgeState {
	runId: string;
	status: PurgeStatus;
	dryRun: boolean;
	page: number;
	startedAt: string;
	startedBy: string;
	updatedAt: string;
	finishedAt?: string;
	stoppedBy?: string;
	/** Library size at the last page listed */
	bunnyTotal?: number;
	scanned: number;
	deleted: number;
	/** Dry run: what a live run would delete */
	wouldDelete: number;
	kept: Record<string, number>;
	recent: { videoId: string; title?: string; status?: number; at: string }[];
	lastError?: string;
	attempts?: number;
}

export interface PurgeMessage {
	kind: typeof PURGE_KIND;
	runId: string;
	page: number;
}

export type PurgeEnv = ReaperEnv & { BUNNY_TEST_LIBRARY?: string; ENVIRONMENT?: string };

export function isPurgeMessage(body: unknown): body is PurgeMessage {
	return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === PURGE_KIND;
}

/** Only a QA / stage worker that declares its library a test library. */
export function purgeAllowed(env: Pick<PurgeEnv, 'BUNNY_TEST_LIBRARY' | 'ENVIRONMENT'>): boolean {
	return env.BUNNY_TEST_LIBRARY === 'true' && (env.ENVIRONMENT ?? '').toLowerCase() !== 'production';
}

export type PurgeDecision = { action: 'delete'; reason: string } | { action: 'keep'; reason: 'other-env' | 'young' | 'has-record' | 'live-stream' | 'no-id' };

/** Pure: what to do with one Bunny video. */
export function decidePurge(input: { video: BunnyView; prefix: string; now: number; hasRecord: boolean; liveStreamRef: boolean }): PurgeDecision {
	const { video } = input;
	if (!video.guid) return { action: 'keep', reason: 'no-id' };
	if (!belongsToEnv(video.title, input.prefix)) return { action: 'keep', reason: 'other-env' };
	const created = Date.parse(video.dateUploaded || '');
	// Unknown age counts as young: never delete what may be in flight
	if (!Number.isFinite(created) || input.now - created < PURGE_MIN_AGE_MS) return { action: 'keep', reason: 'young' };
	if (input.hasRecord) return { action: 'keep', reason: 'has-record' };
	if (input.liveStreamRef) return { action: 'keep', reason: 'live-stream' };
	return { action: 'delete', reason: `No record; Bunny status ${video.status}` };
}

/** Next page after one page: the same one when deletes moved the rest up. */
export function nextPurgePage(input: { page: number; listed: number; deleted: number; total: number; dryRun: boolean }): number | null {
	if (input.listed === 0) return null;
	if (!input.dryRun && input.deleted > 0) return input.page;
	if (input.page * PURGE_PAGE_SIZE >= input.total) return null;
	return input.page + 1;
}

const JSON_META = { httpMetadata: { contentType: 'application/json' } };

function repo(env: PurgeEnv): R2Repository<PurgeState> {
	return new R2Repository<PurgeState>(env.global_settings);
}

export async function readPurgeState(env: Pick<PurgeEnv, 'global_settings'>): Promise<PurgeState | null> {
	try {
		return (await (await env.global_settings.get(PURGE_STATE_KEY))?.json<PurgeState>()) ?? null;
	} catch {
		return null;
	}
}

/** Admin Start: a new run, or resume a stopped / failed one at its page. */
export async function startPurge(env: PurgeEnv, opts: { actor: string; dryRun: boolean; resume?: boolean; now?: Date }): Promise<PurgeState> {
	if (!purgeAllowed(env)) throw new Error('The test-library purge runs only on a QA / stage worker (BUNNY_TEST_LIBRARY)');
	if (!env.PROCESSING_CHECK_QUEUE) throw new Error('PROCESSING_CHECK_QUEUE is not bound');
	const now = (opts.now ?? new Date()).toISOString();
	const previous = await readPurgeState(env);
	if (previous?.status === 'running') throw new Error('A purge is already running; stop it first');
	const resume = !!opts.resume && !!previous && previous.dryRun === opts.dryRun && previous.status !== 'finished';
	const state: PurgeState = resume
		? { ...previous!, runId: crypto.randomUUID(), status: 'running', updatedAt: now, lastError: undefined, attempts: undefined, finishedAt: undefined }
		: {
				runId: crypto.randomUUID(),
				status: 'running',
				dryRun: opts.dryRun,
				page: 1,
				startedAt: now,
				startedBy: opts.actor,
				updatedAt: now,
				scanned: 0,
				deleted: 0,
				wouldDelete: 0,
				kept: {},
				recent: [],
			};
	await env.global_settings.put(PURGE_STATE_KEY, JSON.stringify(state), JSON_META);
	await env.PROCESSING_CHECK_QUEUE.send({ kind: PURGE_KIND, runId: state.runId, page: state.page } satisfies PurgeMessage);
	logger.info('[TestLibraryPurge] Started', { runId: state.runId, dryRun: state.dryRun, page: state.page, actor: opts.actor, resume });
	return state;
}

/** Admin Stop: the run's next message is dropped. */
export async function stopPurge(env: PurgeEnv, actor: string, now = new Date()): Promise<PurgeState | null> {
	let out: PurgeState | null = null;
	await repo(env).updateObject(PURGE_STATE_KEY, (fresh) => {
		if (fresh.status !== 'running') return false;
		fresh.status = 'stopped';
		fresh.stoppedBy = actor;
		fresh.updatedAt = now.toISOString();
		return true;
	});
	out = await readPurgeState(env);
	logger.info('[TestLibraryPurge] Stopped', { actor, runId: out?.runId });
	return out;
}

/** Text of every live stream record, read once per page. */
async function liveStreamTexts(env: Pick<PurgeEnv, 'videos'>): Promise<string[]> {
	const texts: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await env.videos.list({ prefix: 'livestream:', cursor, limit: 500 });
		for (const object of page.objects) {
			const text = await (await env.videos.get(object.key))?.text();
			if (text) texts.push(text);
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return texts;
}

/** One page of a run. Throws on transient trouble (the queue retries). */
export async function runPurgePage(env: PurgeEnv, message: PurgeMessage, now = new Date()): Promise<{ next: number | null; deleted: number } | null> {
	const state = await readPurgeState(env);
	if (!state || state.runId !== message.runId || state.status !== 'running') return null;
	if (!purgeAllowed(env)) {
		await repo(env).updateObject(PURGE_STATE_KEY, (fresh) => {
			if (fresh.runId !== message.runId) return false;
			fresh.status = 'failed';
			fresh.lastError = 'Not a test library (BUNNY_TEST_LIBRARY)';
			fresh.updatedAt = now.toISOString();
			return true;
		});
		return null;
	}
	const prefix = env.BUNNY_NAME_PREFIX ?? '';
	const listed = await listBunnyVideos(env, message.page, PURGE_PAGE_SIZE);
	const lives = listed.items.length ? await liveStreamTexts(env) : [];
	const kept: Record<string, number> = {};
	const removed: PurgeState['recent'] = [];
	let candidates = 0;
	// Videos of a page are independent: up to PURGE_CONCURRENCY at once. One at a
	// time, each Bunny DELETE (~2 s) made a page of 50 take ~1 min (QA, 2026-11-10:
	// ~17 h for the 25k leaked videos). A failure rejects the page; the queue
	// retries it, and videos already deleted answer 404 (done).
	const one = async (video: BunnyView): Promise<void> => {
		const id = video.guid ?? '';
		const hasRecord = id ? !!(await env.videos.head(id)) : false;
		const decision = decidePurge({ video, prefix, now: now.getTime(), hasRecord, liveStreamRef: !!id && lives.some((t) => t.includes(id)) });
		if (decision.action === 'keep') {
			kept[decision.reason] = (kept[decision.reason] ?? 0) + 1;
			return;
		}
		if (state.dryRun) {
			candidates++;
			return;
		}
		// Re-check right before the delete: a record may have landed since the head
		if (await env.videos.head(id)) {
			kept['has-record'] = (kept['has-record'] ?? 0) + 1;
			return;
		}
		candidates++;
		await deleteBunnyVideo(env, id);
		removed.push({ videoId: id, title: video.title, status: video.status, at: now.toISOString() });
	};
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(PURGE_CONCURRENCY, listed.items.length) }, async () => {
			while (cursor < listed.items.length) await one(listed.items[cursor++]);
		}),
	);
	const deleted = state.dryRun ? 0 : removed.length;
	const next = nextPurgePage({ page: message.page, listed: listed.items.length, deleted, total: listed.totalItems, dryRun: state.dryRun });

	let current = true;
	await repo(env).updateObject(PURGE_STATE_KEY, (fresh) => {
		if (fresh.runId !== message.runId) {
			current = false;
			return false;
		}
		fresh.scanned += listed.items.length;
		fresh.deleted += deleted;
		if (state.dryRun) fresh.wouldDelete += candidates;
		for (const [reason, n] of Object.entries(kept)) fresh.kept[reason] = (fresh.kept[reason] ?? 0) + n;
		fresh.recent = [...removed, ...fresh.recent].slice(0, RECENT_LIMIT);
		fresh.bunnyTotal = listed.totalItems;
		fresh.page = next ?? message.page;
		fresh.updatedAt = now.toISOString();
		fresh.attempts = undefined;
		fresh.lastError = undefined;
		if (next === null && fresh.status === 'running') {
			fresh.status = 'finished';
			fresh.finishedAt = fresh.updatedAt;
		}
		return true;
	});
	logger.info('[TestLibraryPurge] Page done', {
		runId: message.runId,
		page: message.page,
		listed: listed.items.length,
		total: listed.totalItems,
		deleted,
		candidates,
		kept,
		next,
		deletedIds: removed.map((r) => r.videoId),
	});
	// Stopped meanwhile: the next message drops itself
	if (current && next !== null) await env.PROCESSING_CHECK_QUEUE!.send({ kind: PURGE_KIND, runId: message.runId, page: next } satisfies PurgeMessage);
	return { next, deleted };
}

interface QueueMessageLike<T> {
	body: T;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

export function purgeRetryDelaySeconds(attempts: number): number {
	return Math.min(3600, 60 * 4 ** Math.max(0, attempts - 1));
}

export async function handlePurgeBatch(batch: { messages: readonly QueueMessageLike<unknown>[] }, env: PurgeEnv): Promise<void> {
	for (const msg of batch.messages) {
		const body = msg.body as PurgeMessage;
		if (!isPurgeMessage(body) || typeof body.runId !== 'string' || !Number.isInteger(body.page) || body.page < 1) {
			logger.error('[TestLibraryPurge] Malformed message dropped', { body });
			msg.ack();
			continue;
		}
		try {
			await runPurgePage(env, body);
			msg.ack();
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			const last = msg.attempts >= PURGE_MAX_DELIVERIES;
			logger[last ? 'error' : 'warn']('[TestLibraryPurge] Page failed', { runId: body.runId, page: body.page, attempts: msg.attempts, last, error: text });
			try {
				await repo(env).updateObject(PURGE_STATE_KEY, (fresh) => {
					if (fresh.runId !== body.runId) return false;
					fresh.attempts = msg.attempts;
					fresh.lastError = text.slice(0, 500);
					fresh.updatedAt = new Date().toISOString();
					// Flagged for an admin (Start resumes at this page); the queue dead-letters the message
					if (last && fresh.status === 'running') fresh.status = 'failed';
					return true;
				});
			} catch {
				// The retry below still happens
			}
			msg.retry({ delaySeconds: purgeRetryDelaySeconds(msg.attempts) });
		}
	}
}
