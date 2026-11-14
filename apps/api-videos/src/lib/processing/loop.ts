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

import { bunnyRef, videoProviderRecords } from '../media/providers';
import type { VideoMediaProviders } from '@al-ummah/shared-types';
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { bunnyApi, bunnyLibraries, bunnyLibraryForVideo, type BunnyLibrariesEnv, type BunnyLibrary, type LibraryHints } from '../bunny/libraries';
import { isOwnershipComplete } from '../search/ownership';
import { bunnyFileToken, tokenExpiry } from '../bunny-signing';
import { placeVideoInCollection } from '../channelCollection';
import { announceAndRecordProcessingResult, pendingProcessingResult, ProcessingResult } from '../notification-events';
import { classifyVideoFormat, publishAdminLive, type AdminLiveEnv, type VideoFormatInput } from '@al-ummah/shared-types';
import {
	applyPlan,
	bunnyPhase,
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

export interface ProcessingEnv extends AdminLiveEnv {
	videos: R2Bucket;
	channels: R2Bucket;
	/** User collections (lib/channelCollection.ts) */
	profiles?: R2Bucket;
	global_settings?: R2Bucket;
	queue?: Queue;
	PROCESSING_CHECK_QUEUE?: Queue;
	'bunny-stream-key': SecretBinding | string;
	bunny_stream_library_id: SecretBinding | string;
	bunny_hostname?: string;
	/** CDN token auth (lib/bunny-signing.ts): the thumbnail check signs its URL */
	BUNNY_SIGN_URLS?: string;
	BUNNY_TOKEN_KEY?: SecretBinding | string;
	/** Legacy library (lib/bunny/libraries.ts) */
	BUNNY_LEGACY_LIBRARY_ID?: string;
	BUNNY_LEGACY_HOSTNAME?: string;
	BUNNY_LEGACY_STREAM_KEY?: SecretBinding | string;
	BUNNY_LEGACY_TOKEN_KEY?: SecretBinding | string;
	SEARCH_DB?: D1Database;
	NOTIFICATIONS_DB?: D1Database;
}

type LoopVideo = SyncableVideo & {
	userId?: string;
	channelId?: string;
	title?: string;
	isPublic?: boolean;
	dateModified?: string;
	processingAnnounced?: ProcessingResult;
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
		restarts?: number;
	};
};

/** A loop whose next check is this late is considered dead (lost message). */
const STALE_LOOP_MS = 15 * 60 * 1000;
/** Sweep restarts of a dead loop before the video is flagged for an admin. */
export const MAX_SWEEP_RESTARTS = 3;

const BUNNY_API = 'https://video.bunnycdn.com';

/** The record's library hints: `hints` when the caller has the record, else the stored record (null when there is none). */
async function recordHints(env: ProcessingEnv, videoId: string, hints?: LibraryHints | null): Promise<LibraryHints | null> {
	if (hints !== undefined) return hints;
	if (!env.videos) return null;
	return (await new R2Repository<LoopVideo>(env.videos).getObject(videoId).catch(() => null)) ?? null;
}

/** The library a video lives in (lib/bunny/libraries.ts) */
async function libraryOf(env: ProcessingEnv, videoId: string, hints?: LibraryHints | null): Promise<BunnyLibrary> {
	return bunnyLibraryForVideo(env as BunnyLibrariesEnv, await recordHints(env, videoId, hints));
}

async function getBunnyVideo(library: BunnyLibrary, videoId: string): Promise<BunnyVideoState | null> {
	const { libraryId, apiKey } = bunnyApi(library);
	const response = await fetch(`${BUNNY_API}/library/${encodeURIComponent(String(libraryId))}/videos/${encodeURIComponent(videoId)}`, {
		headers: { AccessKey: apiKey, accept: 'application/json' },
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Bunny getVideo ${videoId} failed: HTTP ${response.status}`);
	return (await response.json()) as BunnyVideoState;
}

/**
 * Bunny's view of one video, in its own library; null when Bunny has no such
 * video (404). Without a record (an orphan) every library is asked, primary first.
 */
export async function fetchBunnyVideo(env: ProcessingEnv, videoId: string, hints?: LibraryHints | null): Promise<BunnyVideoState | null> {
	const record = await recordHints(env, videoId, hints);
	if (record) return getBunnyVideo(await bunnyLibraryForVideo(env as BunnyLibrariesEnv, record), videoId);
	for (const library of await bunnyLibraries(env as BunnyLibrariesEnv)) {
		if (!library.apiKey && !library.primary) continue;
		const found = await getBunnyVideo(library, videoId);
		if (found) return found;
	}
	return null;
}

/**
 * Does Bunny's auto thumbnail exist yet? HEAD on the video's library CDN,
 * signed with that library's token key when token authentication is on
 * (query-form file token, like API responses).
 * true / false (404 or 403), or undefined when the CDN could not be asked.
 */
export async function bunnyThumbnailExists(
	env: ProcessingEnv,
	videoId: string,
	fileName = 'thumbnail.jpg',
	hints?: LibraryHints | null,
): Promise<boolean | undefined> {
	try {
		const library = await libraryOf(env, videoId, hints);
		const host = library.host;
		if (!host) return undefined;
		const path = `/${videoId}/${fileName}`;
		let url = `https://${host}${path}`;
		if (library.tokenKey) {
			const expires = tokenExpiry();
			url += `?token=${await bunnyFileToken(library.tokenKey, path, expires)}&expires=${expires}`;
		}
		const response = await fetch(url, { method: 'HEAD' });
		if (response.ok) return true;
		if (response.status === 404 || response.status === 403) return false;
		return undefined;
	} catch (error) {
		logger.warn('[ProcessingSync] Thumbnail check failed', { videoId, error: error instanceof Error ? error.message : String(error) });
		return undefined;
	}
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

/** Bunny's copy state on a new-style record (media.providers.bunny), from the sync's phase. */
function syncBunnyRefStatus(video: { media?: VideoMediaProviders }, plan: SyncPlan, now: Date): boolean {
	const ref = video.media?.providers.bunny;
	if (!ref) return false;
	const status = plan.phase === 'ready' || plan.phase === 'playable' ? 'ready' : plan.phase === 'failed' || plan.phase === 'missing' || (plan.outcome === 'failed' || plan.outcome === 'needs_reupload') ? 'failed' : plan.phase === 'encoding' ? 'processing' : 'pending';
	if (ref.status === status) return false;
	ref.status = status;
	if (status === 'ready') ref.readyAt ??= now.toISOString();
	if (status === 'failed' && plan.reason) ref.error = plan.reason.slice(0, 300);
	return true;
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
	// The video's own library: a legacy-library video keeps its host
	const library = await bunnyLibraryForVideo(env as BunnyLibrariesEnv, video);
	const host = library.host;
	if (!host) return { videoId, found: true, dryRun: !!opts.dryRun, changed: false, error: 'bunny_hostname is not configured' };
	// Bunny's id of the video (new videos: the stored ref); none: Bunny holds no copy to sync from
	const bunnyId = bunnyRef(video as never);
	if (!bunnyId) return { videoId, found: true, dryRun: !!opts.dryRun, changed: false, error: 'Bunny holds no copy of this video' };

	const bunny = opts.bunny !== undefined ? opts.bunny : await fetchBunnyVideo(env, bunnyId, video);
	const now = opts.now ?? new Date();
	// The thumbnail is checked once the video plays (Bunny makes it from
	// thumbnailTime after the first resolution); custom thumbnails are ours
	const phase = bunnyPhase(bunny);
	const thumbnailExists =
		(phase === 'ready' || phase === 'playable') && video.thumbnailType !== 'custom'
			? await bunnyThumbnailExists(env, bunnyId, bunny?.thumbnailFileName || 'thumbnail.jpg', video)
			: undefined;
	// Another provider still coming or ready: a Bunny failure fails only Bunny's copy
	const otherCopy = videoProviderRecords(video as never).some((r) => r.provider !== 'bunny' && r.status !== 'failed');
	const syncOpts = { host, now, loopStartedAt: opts.loopStartedAt, thumbnailExists, bunnyId, otherCopy };
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
		const statusChanged = syncBunnyRefStatus(fresh as never, freshPlan, now);
		if (!applyPlan(fresh, freshPlan) && !statusChanged) return false;
		fresh.dateModified = now.toISOString();
		return true;
	});
	logger.debug('[ProcessingSync] Record synced from Bunny', {
		videoId,
		outcome: plan.outcome,
		bunnyStatus: bunny?.status,
		transition,
	});
	// Bunny's copy failed while another provider's was ready: that copy makes the video ready now
	if (saved && otherCopy && (saved as { media?: VideoMediaProviders }).media?.providers.bunny?.status === 'failed') {
		const { promoteR2Copy } = await import('../media/r2-delivery');
		await promoteR2Copy(env as never, videoId);
	}
	if (saved && transition) {
		// Same downstream path as the uploader's status poll: uploader
		// notification, subscriber fan-out (processor de-duplicates per video).
		await announceAndRecordProcessingResult(env as never, { ...saved, id: videoId }, transition);
		// R2 beside Bunny (epic #687): the transcode reads Bunny's encoded MP4, which exists now
		if (transition === 'ready') {
			const { requeueAfterBunnyReady } = await import('../media/r2-delivery');
			await requeueAfterBunnyReady(env as never, videoId);
		}
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
	opts: { reason: string; force?: boolean; now?: Date; initialDelaySeconds?: number; restarts?: number },
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
		// Checks Bunny's encode: a video Bunny holds no copy of is made ready by its R2 transcode
		if (!bunnyRef(fresh as never)) {
			why = 'Bunny holds no copy';
			return false;
		}
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
			...(opts.restarts ? { restarts: opts.restarts } : {}),
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
	logger.debug('[ProcessingLoop] Loop started', { videoId, loopId, reason: opts.reason, delay });
	await publishAdminLive(env, 'uploads', uploadLiveEvent(videoId, { uploadStatus: saved.uploadStatus, checking: true }));
	return { started: true, loopId };
}

/**
 * Encoded but still not classifiable as Short or video (Bunny gave no length
 * or size, no uploader choice): flag it for an admin (video-format-ops.ts).
 * Clears the flag once the video is classifiable.
 */
async function flagUnclassifiable(repo: R2Repository<LoopVideo>, videoId: string, now: Date): Promise<void> {
	await repo.updateObject(videoId, (fresh) => {
		const decision = classifyVideoFormat(fresh as VideoFormatInput);
		const record = fresh as { formatIssue?: unknown };
		if (decision.source !== 'unknown') {
			// Classifiable now (Bunny reported the size): an earlier flag is resolved
			if (!record.formatIssue) return false;
			delete record.formatIssue;
			return true;
		}
		if (record.formatIssue) return false;
		const missing = decision.missing ?? [];
		record.formatIssue = {
			reason: `Bunny reports no ${missing.join(' and ')} for this video; choose Short or video`,
			missing,
			at: now.toISOString(),
		};
		logger.warn('[ProcessingLoop] Encoded video cannot be classified as Short or video; flagged', { videoId, missing });
		return true;
	});
}

export type CheckDecision =
	| { kind: 'done'; outcome: string }
	| { kind: 'again'; delaySeconds: number; attempt: number }
	| { kind: 'drop'; why: string };

/** Pure: what the loop does after a check, given the sync outcome. */
export function decideNext(outcome: string, attempt: number): CheckDecision {
	// pending: not playable yet; playable: watchable, keep checking until Finished
	if (outcome !== 'pending' && outcome !== 'playable') return { kind: 'done', outcome };
	const next = attempt + 1;
	// Out of checks while it already plays: done (ready), nothing for an admin
	if (next >= MAX_CHECK_ATTEMPTS) return { kind: 'done', outcome: outcome === 'playable' ? 'ready' : 'attempts_exhausted' };
	return { kind: 'again', delaySeconds: nextCheckDelaySeconds(next), attempt: next };
}

/** One check of one loop message. Throws on transient errors (the queue retries). */
export async function runProcessingCheck(env: ProcessingEnv, message: ProcessingCheckMessage, now = new Date()): Promise<CheckDecision> {
	const repo = new R2Repository<LoopVideo>(env.videos);
	const video = await repo.getObject(message.videoId);
	if (!video) return { kind: 'drop', why: 'video deleted' };
	if (video.processingCheck?.loopId !== message.loopId) return { kind: 'drop', why: 'superseded loop' };
	if (video.processingCheck?.finishedAt) return { kind: 'drop', why: 'loop already finished' };

	// A terminal status reached earlier (by this loop or the uploader's status
	// poll) whose announcement did not land: announce it now. A failure throws,
	// so the queue retries and finally dead-letters (admins are alerted).
	const unannounced = pendingProcessingResult(video);
	if (unannounced) await announceAndRecordProcessingResult(env as never, video, unannounced);

	// Bunny's id of the video (new videos: the stored GUID); syncVideoFromBunny ends the loop when Bunny holds no copy
	const loopBunnyId = bunnyRef(video as never);
	const bunny = loopBunnyId ? await fetchBunnyVideo(env, loopBunnyId, video) : null;
	// A video Bunny still has at the library root goes into its channel's (or
	// owner's) collection: the upload's collection step failed or was skipped
	if (bunny && !bunny.collectionId && env.channels) await placeVideoInCollection(env as never, video, bunny.collectionId);
	const result = await syncVideoFromBunny(env, message.videoId, { now, loopStartedAt: message.startedAt, bunny });
	const outcome = result.plan?.outcome ?? 'pending';
	if (outcome === 'ready') await flagUnclassifiable(repo, message.videoId, now);
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
	await publishAdminLive(env, 'uploads', uploadLiveEvent(message.videoId, {
		uploadStatus: result.ours?.uploadStatus,
		encodeProgress: bunny?.encodeProgress,
		outcome: decision.kind === 'done' ? decision.outcome : outcome,
		issue: (result.ours?.processingIssue as { kind?: string } | undefined)?.kind ?? (decision.kind === 'done' && decision.outcome === 'stalled' ? 'stalled' : undefined),
		checking: decision.kind === 'again',
	}));
	return decision;
}

/** The admin:uploads live event of a processing step (docs/admin/LIVE_OPS.md): a hint, pages refetch. */
export function uploadLiveEvent(
	videoId: string,
	s: { uploadStatus?: string; encodeProgress?: number; outcome?: string; issue?: string; checking?: boolean },
) {
	return {
		kind: 'upload',
		key: `upload:${videoId}`,
		videoId,
		...(s.uploadStatus ? { status: s.uploadStatus } : {}),
		...(typeof s.encodeProgress === 'number' ? { encodeProgress: s.encodeProgress } : {}),
		...(s.outcome ? { outcome: s.outcome } : {}),
		...(s.issue ? { issue: s.issue } : {}),
		...(s.checking !== undefined ? { checking: s.checking } : {}),
	};
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
	/** Where the candidates came from: the ownership index or a full R2 scan */
	source?: 'index' | 'scan';
}

/**
 * Safety net (cron): start a loop for every video still uploading/processing
 * that has none (e.g. uploads from before the loop existed, or a lost
 * message). Capped per run; records the run for the admin health view.
 */
const NOT_FINISHED = ['initiated', 'uploading', 'processing', 'failed'];

/**
 * Records the sweep has to look at: from the ownership index (one D1 query
 * for videos not ready yet) when it is complete; otherwise every video object
 * in R2, read in parallel batches. The R2-only sweep read objects one by one
 * (210 s for 400 videos on prod, 2026-11-10), so stuck uploads waited minutes
 * for their loop.
 */
async function sweepCandidates(env: ProcessingEnv): Promise<{ videos: LoopVideo[]; scanned: number; source: 'index' | 'scan' }> {
	const load = async (keys: string[]) => {
		const out: LoopVideo[] = [];
		for (let i = 0; i < keys.length; i += 25) {
			const batch = await Promise.all(
				keys.slice(i, i + 25).map(async (key) => {
					try {
						return (await (await env.videos.get(key))?.json<LoopVideo>()) ?? null;
					} catch {
						return null;
					}
				}),
			);
			for (const v of batch) if (v?.id) out.push(v);
		}
		return out;
	};
	const db = env.SEARCH_DB;
	if (db) {
		try {
			if (await isOwnershipComplete(db as never, 'video')) {
				const placeholders = NOT_FINISHED.map(() => '?').join(', ');
				const { results } = await db
					.prepare(`SELECT id FROM content_ownership WHERE kind = 'video' AND upload_status IN (${placeholders})`)
					.bind(...NOT_FINISHED)
					.all<{ id: string }>();
				const ids = (results ?? []).map((r) => r.id);
				return { videos: await load(ids), scanned: ids.length, source: 'index' };
			}
		} catch (error) {
			logger.warn('[ProcessingSweep] Index query failed; scanning R2', { error: error instanceof Error ? error.message : String(error) });
		}
	}
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await env.videos.list({ cursor, limit: 1000 });
		cursor = page.truncated ? page.cursor : undefined;
		for (const object of page.objects) if (!object.key.includes('/') && !object.key.includes(':')) keys.push(object.key);
	} while (cursor);
	return { videos: await load(keys), scanned: keys.length, source: 'scan' };
}

export async function sweepProcessingVideos(env: ProcessingEnv, opts: { now?: Date; maxStarts?: number; minAgeMs?: number } = {}): Promise<SweepStats> {
	const started = Date.now();
	const now = opts.now ?? new Date();
	const maxStarts = opts.maxStarts ?? 50;
	// Upload complete starts a loop itself; the sweep only catches gaps (uploads
	// finished before a deploy, lost messages), so it need not wait long
	const minAge = opts.minAgeMs ?? 2 * 60 * 1000;
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
	const candidates = await sweepCandidates(env);
	stats.scanned = candidates.scanned;
	stats.source = candidates.source;
	{
		for (const video of candidates.videos) {
			// Abandoned by the upload reaper (lib/uploads/reaper.ts): gone, not stuck
			if ((video as { abandoned?: unknown }).abandoned) continue;
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
				// A loop that died (its messages dead-lettered) is restarted a few
				// times; then the video is flagged for an admin instead.
				const check = video.processingCheck;
				const died = check && !check.finishedAt && now.getTime() - (Date.parse(check.nextCheckAt || '') || 0) > STALE_LOOP_MS;
				if (died && (check.restarts ?? 0) >= MAX_SWEEP_RESTARTS) {
					await new R2Repository<LoopVideo>(env.videos).updateObject(video.id, (fresh) => {
						if (fresh.processingIssue || fresh.uploadStatus === 'ready') return false;
						fresh.processingIssue = { kind: 'stalled', reason: `The processing check failed ${MAX_SWEEP_RESTARTS + 1} times (see dead letters)`, at: now.toISOString() };
						return true;
					});
					stats.flagged.stalled++;
					continue;
				}
				const result = await startProcessingLoop(env, video.id, { reason: 'sweep', now, initialDelaySeconds: 0, restarts: died ? (check.restarts ?? 0) + 1 : 0 });
				if (result.started) stats.loopsStarted++;
				else stats.alreadyActive++;
			} catch (error) {
				stats.errors++;
				logger.error('[ProcessingSweep] Could not start loop', { videoId: video.id, error: error instanceof Error ? error.message : String(error) });
			}
		}
	}
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
