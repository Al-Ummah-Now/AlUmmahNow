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
 *   - custom image the owner uploaded, or Bunny's own thumbnail: never
 *     changed, flagged for an admin. Cards letterbox them meanwhile, so
 *     nothing shows distorted.
 *
 * Runs only as an admin job (lib/admin/jobs.ts, kind 'videos.repair-thumbnails'),
 * started from the admin Processing page, dry run first: each delivery checks
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
import { getSecret } from '../env-helpers';
import Queue from '../queue';
import { MessageType } from '@al-ummah/shared-types';

/** Admin job kind and the fixed target id its runs are listed under. */
export const THUMBNAIL_REPAIR_JOB = 'videos.repair-thumbnails' as const;
export const THUMBNAIL_REPAIR_TARGET = 'thumbnail-repair';

/** Shapes further apart than 5% are a mismatch (rounding of odd encodes stays well inside). */
export const ASPECT_TOLERANCE = 0.05;
/** Bytes read from an image to find its size (JPEG SOF can sit after a large EXIF block). */
const HEADER_BYTES = 256 * 1024;
/** Videos checked per job delivery (each is a few subrequests: record, Bunny, one or two images). */
export const VIDEOS_PER_STEP = 25;
/** Videos listed in a job result for an admin to look at. */
export const MAX_RESULT_ITEMS = 200;

export interface Size {
	width: number;
	height: number;
}

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
	BUNNY_SIGN_HOSTNAME?: string;
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

function u16be(b: Uint8Array, i: number): number {
	return (b[i] << 8) | b[i + 1];
}
function u32be(b: Uint8Array, i: number): number {
	return ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
}
function u24le(b: Uint8Array, i: number): number {
	return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

/**
 * Pixel size of a JPEG, PNG or WebP from its first bytes, or null. JPEG walks
 * the marker segments (so an EXIF preview inside APP1 is skipped) to the
 * first start-of-frame.
 */
export function imageSize(bytes: Uint8Array): Size | null {
	const b = bytes;
	// PNG: signature, then IHDR width/height
	if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
		const width = u32be(b, 16);
		const height = u32be(b, 20);
		return width && height ? { width, height } : null;
	}
	// WebP: RIFF....WEBP + VP8 / VP8L / VP8X chunk
	if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
		const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
		if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
		if (chunk === 'VP8L') {
			const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
			return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
		}
		if (chunk === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
		return null;
	}
	// JPEG
	if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
		let i = 2;
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) return null;
			const marker = b[i + 1];
			if (marker === 0xff) {
				i++; // fill byte
				continue;
			}
			if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
				i += 2; // standalone markers
				continue;
			}
			const length = u16be(b, i + 2);
			// SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				const height = u16be(b, i + 5);
				const width = u16be(b, i + 7);
				return width && height ? { width, height } : null;
			}
			if (marker === 0xda || length < 2) return null; // start of scan: no frame header found
			i += 2 + length;
		}
	}
	return null;
}

function u16le(b: Uint8Array, i: number): number {
	return b[i] | (b[i + 1] << 8);
}

/** True when the two shapes differ by more than `tolerance` (5%). */
export function aspectMismatch(a: Size, b: Size, tolerance = ASPECT_TOLERANCE): boolean {
	const ra = a.width / a.height;
	const rb = b.width / b.height;
	return Math.max(ra, rb) / Math.min(ra, rb) > 1 + tolerance;
}

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
	const shapes = `thumbnail ${input.thumbnail.width}x${input.thumbnail.height}, video ${input.video.width}x${input.video.height}`;
	if (input.thumbnailType === 'custom') return { action: 'flag', reason: `custom thumbnail differs from the video's shape (${shapes}); the owner chose it` };
	if (isBunnyStreamUrl(input.thumbnailUrl)) return { action: 'flag', reason: `Bunny's thumbnail differs from the video's shape (${shapes}); set a new thumbnail` };
	return { action: 'use_bunny', reason: `auto frame captured at the wrong shape (${shapes})` };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** Sign a Bunny Stream image URL of `videoId` when the library needs tokens. */
async function fetchableUrl(env: ThumbnailRepairEnv, videoId: string, url: string): Promise<string> {
	const host = env.BUNNY_SIGN_HOSTNAME || env.bunny_hostname;
	if (env.BUNNY_SIGN_URLS !== 'true' || !host || !url.includes(host) || url.includes('token=')) return url;
	const key = await getSecret(env.BUNNY_TOKEN_KEY as never, 'BUNNY_TOKEN_KEY');
	if (!key) return url;
	const signed = await signBunnyUrlsInText(JSON.stringify({ id: videoId, thumbnailUrl: url }), host, key);
	return (JSON.parse(signed) as { thumbnailUrl: string }).thumbnailUrl;
}

/** Size of the image at `url`; null when it is not an image we can read. Throws on network/5xx (retried). */
export async function fetchImageSize(env: ThumbnailRepairEnv, videoId: string, url: string): Promise<Size | null> {
	const response = await fetch(await fetchableUrl(env, videoId, url), { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } });
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
		bunny = await fetchBunnyVideo(env, videoId);
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
			const host = env.bunny_hostname;
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
