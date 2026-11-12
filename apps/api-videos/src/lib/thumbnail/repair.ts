/**
 * Thumbnail aspect repair (2026-11-10: "single video upload, thumbs dont
 * match aspect").
 *
 * Until the fix, the upload page drew every auto-generated frame into a fixed
 * 1280x720 canvas, so a vertical, square or 4:3 video picked from those frames
 * got a squashed 16:9 thumbnail stored for good. This admin job finds
 * thumbnails whose shape does not match the video's (Bunny's width/height) and:
 *
 *   - auto frame from our image storage (thumbnailType 'auto', not on the
 *     Bunny Stream host): replaced by Bunny's own thumbnail of the video,
 *     which Bunny renders at the video's real aspect (checked first);
 *   - custom image the owner uploaded, an imported (legacy) thumbnail with
 *     no type, or Bunny's own thumbnail: never changed, flagged for an admin
 *     (owner, 2026-11-10: "I will edit them"). Cards letterbox them
 *     meanwhile, so nothing shows distorted;
 *   - old 4:3 YouTube art with bars on a landscape video counts as matching.
 *
 * Imported addresses without a scheme ("images.alummahnow.net/x.jpg") are
 * read as https.
 *
 * Runs only as an admin job (lib/admin/jobs.ts, kind 'videos.repair-thumbnails'),
 * started from the admin Processing page (dry run first) and daily from the
 * api-videos cron (startDailyThumbnailCheck), whose flagged videos the admin
 * Errors page lists until their thumbnail changes. Each delivery checks
 * VIDEOS_PER_STEP videos and queues the next step with its cursor (resumable).
 * A step that fails is retried with backoff; after the retries the job is
 * marked failed (admin sees it with Retry, which resumes at the cursor) and
 * the message dead-letters. A single video that keeps failing does not stop
 * the job: it is listed as 'error' in the job result and on the record.
 *
 * Idempotent: re-checking a video re-reads both images and only writes when
 * something changes; a replaced thumbnail matches on the next run.
 */

import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { fetchBunnyVideo, type ProcessingEnv } from '../processing/loop';
import { signBunnyUrlsInText } from '../bunny-signing';
import { bunnyHosts, bunnyLibraries, bunnyLibraryForVideo, type BunnyLibrariesEnv, type LibraryHints } from '../bunny/libraries';
import Queue from '../queue';
import { MessageType } from '@al-ummah/shared-types';
import { absoluteImageUrl, aspectMismatch, checkThumbnailShape, imageSize, isBunnyFrameOf, isLetterboxedArt, isOnHost, isOwnImageHost, resolveVideoSize, type Size } from './shape';
import { createJob, listJobs, type JobEnv } from '../admin/jobs';
import type { AdminJob } from '@al-ummah/shared-types';

export { ASPECT_TOLERANCE, aspectMismatch, imageSize, type Size } from './shape';

/** Admin job kind and the fixed target id its runs are listed under. */
export const THUMBNAIL_REPAIR_JOB = 'videos.repair-thumbnails' as const;
export const THUMBNAIL_REPAIR_TARGET = 'thumbnail-repair';

/** Bytes read from an image to find its size (JPEG SOF can sit after a large EXIF block). */
const HEADER_BYTES = 256 * 1024;
/** Videos checked per job delivery (each is a few subrequests: record, Bunny, one or two images). */
export const VIDEOS_PER_STEP = 25;
/** Videos listed in a job result for an admin to look at. */
export const MAX_RESULT_ITEMS = 200;

export type RepairOutcome = 'ok' | 'replaced' | 'would_replace' | 'flagged' | 'skipped' | 'error';

export interface ThumbnailCheck {
	runId: string;
	at: string;
	dryRun: boolean;
	outcome: RepairOutcome;
	reason?: string;
	thumbnail?: Size;
	video?: Size;
	/** The URL that was replaced (outcome 'replaced'), for an admin to undo */
	previousThumbnailUrl?: string;
}

export interface ThumbnailRepairEnv extends ProcessingEnv {
	BUNNY_TOKEN_KEY?: unknown;
	BUNNY_SIGN_URLS?: string;
}

interface RepairVideo {
	id: string;
	thumbnailUrl?: string;
	thumbnailType?: 'auto' | 'custom';
	thumbnailSizes?: Record<string, string>;
	width?: number;
	height?: number;
	isDeleted?: boolean;
	userId?: string;
	channelId?: string;
	dateModified?: string;
	thumbnailCheck?: ThumbnailCheck;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const BUNNY_STREAM_HOST = /^https:\/\/vz-[a-z0-9-]+\.b-cdn\.net\//i;

export function isBunnyStreamUrl(url: string | undefined): boolean {
	return !!url && BUNNY_STREAM_HOST.test(url);
}

export type RepairPlan =
	| { action: 'none'; reason: string }
	| { action: 'skip'; reason: string }
	| { action: 'flag'; reason: string }
	| { action: 'use_bunny'; reason: string };

/** Pure: what to do with one video's thumbnail. */
export function planThumbnailRepair(input: {
	thumbnailUrl?: string;
	thumbnailType?: 'auto' | 'custom';
	video: Size | null;
	thumbnail: Size | null;
}): RepairPlan {
	if (!input.thumbnailUrl) return { action: 'skip', reason: 'no thumbnail' };
	if (!input.video) return { action: 'skip', reason: 'video size unknown (not encoded yet)' };
	if (!input.thumbnail) return { action: 'flag', reason: 'thumbnail could not be read' };
	if (!aspectMismatch(input.thumbnail, input.video)) return { action: 'none', reason: 'shape matches the video' };
	if (isLetterboxedArt(input.thumbnail, input.video)) return { action: 'none', reason: '4:3 art with bars on a landscape video, shown whole' };
	const shapes = `thumbnail ${input.thumbnail.width}x${input.thumbnail.height}, video ${input.video.width}x${input.video.height}`;
	if (input.thumbnailType === 'custom') return { action: 'flag', reason: `custom thumbnail differs from the video's shape (${shapes}); the owner chose it` };
	if (isBunnyStreamUrl(input.thumbnailUrl)) return { action: 'flag', reason: `Bunny's thumbnail differs from the video's shape (${shapes}); set a new thumbnail` };
	// Imported (legacy) thumbnails carry no type: the owner picks a new one by hand, never replaced
	if (input.thumbnailType !== 'auto') return { action: 'flag', reason: `imported thumbnail differs from the video's shape (${shapes}); set a new thumbnail` };
	return { action: 'use_bunny', reason: `auto frame captured at the wrong shape (${shapes})` };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** Sign a Bunny Stream image URL of `videoId` when the library needs tokens. */
async function fetchableUrl(env: ThumbnailRepairEnv, videoId: string, url: string): Promise<string> {
	if (env.BUNNY_SIGN_URLS !== 'true' || url.includes('token=')) return url;
	// Only a configured library's own host is signed, with that library's key
	// (exact hostname, never a look-alike URL; lib/bunny/libraries.ts)
	const library = (await bunnyLibraries(env as BunnyLibrariesEnv)).find((l) => l.host && isOnHost(url, l.host));
	if (!library?.host || !library.tokenKey) return url;
	const signed = await signBunnyUrlsInText(JSON.stringify({ id: videoId, thumbnailUrl: url }), library.host, library.tokenKey);
	return (JSON.parse(signed) as { thumbnailUrl: string }).thumbnailUrl;
}

/** Size of the image at `url`; null when it is not an image we can read. Throws on network/5xx (retried). */
export async function fetchImageSize(env: ThumbnailRepairEnv, videoId: string, url: string): Promise<Size | null> {
	const absolute = absoluteImageUrl(url);
	if (!absolute) return null;
	// No redirects: a redirect is treated as unreadable, never followed to another address
	const response = await fetch(await fetchableUrl(env, videoId, absolute), { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` }, redirect: 'manual' });
	if (response.status >= 500) throw new Error(`GET thumbnail failed: HTTP ${response.status}`);
	if (!response.ok) return null;
	const reader = response.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (total < HEADER_BYTES) {
		const { done, value } = await reader.read();
		if (done || !value) break;
		chunks.push(value);
		total += value.byteLength;
	}
	await reader.cancel().catch(() => undefined);
	const bytes = new Uint8Array(Math.min(total, HEADER_BYTES));
	let offset = 0;
	for (const chunk of chunks) {
		const take = Math.min(chunk.byteLength, bytes.length - offset);
		bytes.set(chunk.subarray(0, take), offset);
		offset += take;
		if (offset >= bytes.length) break;
	}
	return imageSize(bytes);
}

export interface RepairResult {
	videoId: string;
	outcome: RepairOutcome | 'missing';
	reason?: string;
	changed: boolean;
	previousThumbnailUrl?: string;
}

/** Check and (unless dry run) repair one video's thumbnail. Throws on transient errors. */
export async function repairVideoThumbnail(
	env: ThumbnailRepairEnv,
	videoId: string,
	opts: { runId: string; dryRun: boolean; now?: Date },
): Promise<RepairResult> {
	const repo = new R2Repository<RepairVideo>(env.videos);
	const video = await repo.getObject(videoId);
	if (!video || video.isDeleted) return { videoId, outcome: 'missing', changed: false };
	const now = opts.now ?? new Date();

	let videoSize: Size | null = video.width && video.height ? { width: video.width, height: video.height } : null;
	let bunny: Awaited<ReturnType<typeof fetchBunnyVideo>> = null;
	const needsBunny = () => !videoSize || !isBunnyStreamUrl(video.thumbnailUrl);
	if (needsBunny()) {
		bunny = await fetchBunnyVideo(env, videoId, video as LibraryHints);
		if (!videoSize && bunny?.width && bunny?.height) videoSize = { width: bunny.width, height: bunny.height };
	}
	const thumbnail = video.thumbnailUrl ? await fetchImageSize(env, videoId, video.thumbnailUrl) : null;
	const plan = planThumbnailRepair({ thumbnailUrl: video.thumbnailUrl, thumbnailType: video.thumbnailType, video: videoSize, thumbnail });

	let outcome: RepairOutcome;
	let reason = plan.reason;
	let replacement: string | undefined;
	switch (plan.action) {
		case 'none':
			outcome = 'ok';
			break;
		case 'skip':
			outcome = 'skipped';
			break;
		case 'flag':
			outcome = 'flagged';
			break;
		case 'use_bunny': {
			// The video's own library host
			const host = (await bunnyLibraryForVideo(env as BunnyLibrariesEnv, video as LibraryHints)).host;
			const candidate = host ? `https://${host}/${videoId}/${bunny?.thumbnailFileName || 'thumbnail.jpg'}` : undefined;
			const candidateSize = candidate ? await fetchImageSize(env, videoId, candidate) : null;
			if (!candidate || !candidateSize || aspectMismatch(candidateSize, videoSize!)) {
				outcome = 'flagged';
				reason = `${plan.reason}; Bunny's thumbnail ${candidateSize ? `is ${candidateSize.width}x${candidateSize.height}` : 'could not be read'}, so nothing was replaced`;
			} else {
				outcome = opts.dryRun ? 'would_replace' : 'replaced';
				replacement = candidate;
			}
			break;
		}
	}

	const check: ThumbnailCheck = {
		runId: opts.runId,
		at: now.toISOString(),
		dryRun: opts.dryRun,
		outcome,
		reason,
		...(thumbnail ? { thumbnail } : {}),
		...(videoSize ? { video: videoSize } : {}),
	};

	let replaced = false;
	await repo.updateObject(videoId, (fresh) => {
		replaced = false;
		if (fresh.isDeleted) return false;
		const before = JSON.stringify([fresh.width, fresh.height, fresh.thumbnailUrl, sameCheck(fresh.thumbnailCheck)]);
		// Store Bunny's size when the record lacks it (shorts rule, card letterboxing)
		if (videoSize && (!fresh.width || !fresh.height)) {
			fresh.width = videoSize.width;
			fresh.height = videoSize.height;
		}
		// Only replace what was checked: an owner who set a new thumbnail meanwhile keeps it
		if (replacement && !opts.dryRun && fresh.thumbnailUrl === video.thumbnailUrl && fresh.thumbnailType !== 'custom') {
			check.previousThumbnailUrl = fresh.thumbnailUrl;
			fresh.thumbnailUrl = replacement;
			fresh.thumbnailType = 'auto';
			delete fresh.thumbnailSizes;
			fresh.dateModified = now.toISOString();
			replaced = true;
		} else if (outcome === 'replaced') {
			check.outcome = 'skipped';
			check.reason = 'thumbnail changed while the job ran';
		}
		// A daily re-check that finds the same thing writes nothing (no search re-projection)
		if (!replaced && JSON.stringify([fresh.width, fresh.height, fresh.thumbnailUrl, sameCheck(check)]) === before) return false;
		fresh.thumbnailCheck = check;
		return true;
	});

	if (replaced && env.queue) {
		// Same downstream path as an owner's thumbnail change (caches, shelves)
		await new Queue(env.queue).send(MessageType.VideoEdit, {
			videoId,
			userId: video.userId,
			channelId: video.channelId,
			timestamp: now.toISOString(),
			action: 'thumbnail_repair',
		});
	}
	logger.info('[ThumbnailRepair] Video checked', { videoId, runId: opts.runId, outcome: check.outcome, reason: check.reason });
	return { videoId, outcome: check.outcome, reason: check.reason, changed: replaced, ...(check.previousThumbnailUrl ? { previousThumbnailUrl: check.previousThumbnailUrl } : {}) };
}

/** What a check found, without when or by which run (to skip identical re-writes). */
function sameCheck(check: ThumbnailCheck | undefined): unknown {
	if (!check) return null;
	return [check.dryRun, check.outcome, check.reason, check.thumbnail?.width, check.thumbnail?.height, check.video?.width, check.video?.height];
}

/** Record a video that kept failing, so the record shows it too. */
async function markError(env: ThumbnailRepairEnv, videoId: string, jobId: string, dryRun: boolean, error: string): Promise<void> {
	await new R2Repository<RepairVideo>(env.videos).updateObject(videoId, (fresh) => {
		fresh.thumbnailCheck = { runId: jobId, at: new Date().toISOString(), dryRun, outcome: 'error', reason: error.slice(0, 300) };
		return true;
	});
}

// ---------------------------------------------------------------------------
// The admin job
// ---------------------------------------------------------------------------

export interface RepairJobParams {
	dryRun: boolean;
	/** Only these videos (else every video record) */
	ids?: string[];
	/** Every-video runs: R2 list cursor of the next step */
	cursor?: string;
	/** ids runs: index of the next video */
	offset?: number;
}

export interface RepairJobResult {
	dryRun: boolean;
	checked: number;
	counts: Partial<Record<RepairOutcome, number>>;
	/** What an admin should look at: replaced (to undo), would replace, flagged, error */
	items: Array<{ videoId: string; outcome: RepairOutcome; reason?: string; previousThumbnailUrl?: string }>;
}

type JobLike = { id: string; params: Record<string, unknown>; result: Record<string, unknown> | null };
export type StepOutcome = { done: true; result: RepairJobResult } | { done: false; params: RepairJobParams; result: RepairJobResult };

/** Video record keys only (not index/side records). */
function isVideoKey(key: string): boolean {
	return !key.includes('/') && !key.includes(':');
}

function readParams(raw: Record<string, unknown>): RepairJobParams {
	return {
		dryRun: raw.dryRun !== false,
		...(Array.isArray(raw.ids) ? { ids: raw.ids.filter((id): id is string => typeof id === 'string') } : {}),
		...(typeof raw.cursor === 'string' ? { cursor: raw.cursor } : {}),
		...(typeof raw.offset === 'number' ? { offset: raw.offset } : {}),
	};
}

function readResult(raw: Record<string, unknown> | null, dryRun: boolean): RepairJobResult {
	const r = (raw ?? {}) as Partial<RepairJobResult>;
	return { dryRun, checked: Number(r.checked) || 0, counts: { ...(r.counts ?? {}) }, items: Array.isArray(r.items) ? [...r.items] : [] };
}

const LISTED: ReadonlySet<RepairOutcome> = new Set(['replaced', 'would_replace', 'flagged', 'error']);

/**
 * One step of the job: check the next VIDEOS_PER_STEP videos and return the
 * next step's params, or done. Throws only when the step itself cannot run
 * (listing the records), so the job framework retries it.
 */
export async function runThumbnailRepairStep(env: ThumbnailRepairEnv, job: JobLike): Promise<StepOutcome> {
	const params = readParams(job.params);
	const result = readResult(job.result, params.dryRun);

	let batch: string[];
	let next: RepairJobParams | null;
	if (params.ids) {
		const offset = params.offset ?? 0;
		batch = params.ids.slice(offset, offset + VIDEOS_PER_STEP);
		next = offset + VIDEOS_PER_STEP < params.ids.length ? { ...params, offset: offset + VIDEOS_PER_STEP } : null;
	} else {
		const page = await env.videos.list({ cursor: params.cursor, limit: VIDEOS_PER_STEP });
		batch = page.objects.map((o) => o.key).filter(isVideoKey);
		next = page.truncated && page.cursor ? { ...params, cursor: page.cursor } : null;
	}

	for (const videoId of batch) {
		let outcome: RepairOutcome | 'missing';
		let reason: string | undefined;
		let previousThumbnailUrl: string | undefined;
		try {
			let checked: RepairResult;
			try {
				checked = await repairVideoThumbnail(env, videoId, { runId: job.id, dryRun: params.dryRun });
			} catch {
				// One more try for a CDN/Bunny hiccup before the video is listed as an error
				checked = await repairVideoThumbnail(env, videoId, { runId: job.id, dryRun: params.dryRun });
			}
			outcome = checked.outcome;
			reason = checked.reason;
			previousThumbnailUrl = checked.previousThumbnailUrl;
		} catch (error) {
			outcome = 'error';
			reason = error instanceof Error ? error.message : String(error);
			logger.warn('[ThumbnailRepair] Video check failed', { jobId: job.id, videoId, error: reason });
			await markError(env, videoId, job.id, params.dryRun, reason).catch(() => undefined);
		}
		if (outcome === 'missing') continue;
		result.checked++;
		result.counts[outcome] = (result.counts[outcome] ?? 0) + 1;
		if (LISTED.has(outcome) && result.items.length < MAX_RESULT_ITEMS) {
			result.items.push({ videoId, outcome, ...(reason ? { reason } : {}), ...(previousThumbnailUrl ? { previousThumbnailUrl } : {}) });
		}
	}

	logger.info('[ThumbnailRepair] Step done', { jobId: job.id, dryRun: params.dryRun, checked: result.checked, more: !!next });
	return next ? { done: false, params: next, result } : { done: true, result };
}

// ---------------------------------------------------------------------------
// Daily check and the admin's flagged list
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set(['queued', 'running', 'retrying']);
/** Actor of the cron-started runs (shown in the jobs list). */
export const DAILY_CHECK_ACTOR = 'system:daily-thumbnail-check';

/**
 * Daily (api-videos cron): one every-video run, so a wrong-shape thumbnail that
 * slips in (an import writing R2 directly, a Bunny thumbnail of the wrong
 * shape) is flagged for an admin within a day. It replaces only auto frames on
 * our image storage (with Bunny's frame, shape checked first); imported and
 * custom thumbnails are flagged, never replaced. Skipped while a run is active.
 * The run is an admin job: retried with backoff, then failed + DLQ, shown on
 * the Errors page with Retry.
 */
export async function startDailyThumbnailCheck(env: JobEnv): Promise<{ started: boolean; why?: string; jobId?: string }> {
	const runs = await listJobs(env, { targetKind: 'video', targetId: THUMBNAIL_REPAIR_TARGET, limit: 10 });
	const active = runs.find((run) => ACTIVE_STATUSES.has(run.status));
	if (active) return { started: false, why: `run ${active.id} is ${active.status}` };
	const job = await createJob(env, { kind: THUMBNAIL_REPAIR_JOB, targetKind: 'video', targetId: THUMBNAIL_REPAIR_TARGET, params: { dryRun: false, scheduled: 'daily' }, actorId: DAILY_CHECK_ACTOR });
	return job.status === 'failed' ? { started: false, why: job.lastError ?? 'could not queue', jobId: job.id } : { started: true, jobId: job.id };
}

export interface FlaggedThumbnails {
	runId: string;
	checkedAt: string;
	items: Array<{ videoId: string; reason?: string }>;
}

/**
 * Videos whose thumbnail does not match their shape, from the latest finished
 * every-video run (daily or an admin's Check). Pure: the caller drops the
 * ones fixed since (see isStillFlagged).
 */
export function latestFlagged(runs: readonly AdminJob[]): FlaggedThumbnails | null {
	const run = runs.find((r) => r.status === 'succeeded' && !Array.isArray(r.params?.ids));
	if (!run) return null;
	const items = ((run.result as Partial<RepairJobResult> | null)?.items ?? []).filter((item) => item.outcome === 'flagged');
	return { runId: run.id, checkedAt: run.finishedAt ?? run.updatedAt, items: items.map((i) => ({ videoId: i.videoId, ...(i.reason ? { reason: i.reason } : {}) })) };
}

/** A flagged video stays listed until its thumbnail changes (every thumbnail write clears thumbnailCheck) or a later check passes it. */
export function isStillFlagged(record: { isDeleted?: boolean; thumbnailCheck?: { outcome?: string } } | null): boolean {
	return !!record && !record.isDeleted && record.thumbnailCheck?.outcome === 'flagged';
}

// ---------------------------------------------------------------------------
// Setting a thumbnail by URL (studio editor, any API client)
// ---------------------------------------------------------------------------

export interface ThumbnailUrlVerdict {
	ok: boolean;
	/** When accepted: auto for the video's own Bunny frames */
	type?: 'auto' | 'custom';
	/** When refused */
	code?: 'thumbnail_shape' | 'thumbnail_unreadable' | 'thumbnail_host';
	error?: string;
	expected?: Size;
	actual?: Size;
}

/**
 * May `url` become the thumbnail of `video`? One of the video's own Bunny
 * frames always may (Bunny renders them at the video's shape); any other image
 * must be on one of our image hosts (never fetched otherwise), readable, and
 * have the video's shape. An empty value clears the thumbnail.
 */
export async function verifyThumbnailUrl(
	env: ThumbnailRepairEnv,
	video: { id: string; width?: number; height?: number } & LibraryHints,
	url: string,
): Promise<ThumbnailUrlVerdict> {
	if (!url.trim()) return { ok: true };
	const own = await bunnyLibraryForVideo(env as BunnyLibrariesEnv, video);
	if (isBunnyFrameOf(url, video.id, own.host)) return { ok: true, type: 'auto' };
	if (!isOwnImageHost(url, await bunnyHosts(env as BunnyLibrariesEnv))) {
		return { ok: false, code: 'thumbnail_host', error: 'The thumbnail must be one of the video\'s frames or an uploaded image. Upload it instead.' };
	}
	const image = await fetchImageSize(env, video.id, url).catch(() => null);
	if (!image) return { ok: false, code: 'thumbnail_unreadable', error: 'The thumbnail image could not be read. Upload it instead.' };
	const videoSize = await resolveVideoSize(video, () => fetchBunnyVideo(env, video.id, video));
	const shape = checkThumbnailShape(image, videoSize);
	return shape.ok ? { ok: true, type: 'custom' } : shape;
}
