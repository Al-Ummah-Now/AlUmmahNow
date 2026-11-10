/**
 * Short vs video format backfill (packages/shared-types/src/video-format-ops.ts).
 *
 * Runs as a chain of messages on PROCESSING_CHECK_QUEUE (max_retries 5, then
 * the DLQ, whose consumer alerts and stores the dead letter). One message is
 * one page of the videos bucket:
 *
 * 1. classify every video with the shared rule;
 * 2. a video that cannot be classified yet (no duration or encoded size):
 *    - still processing: hand it to the processing-check loop, which stores
 *      Bunny's duration and resolution when encoding finishes;
 *    - ready: read the encoded size from Bunny (API, then the HLS master
 *      playlist's RESOLUTION for videos in another library) and store it;
 *      never guessed;
 *    - still unknown: flag it for an admin (`formatIssue`, admin-web
 *      "Video formats" → set Short / video by hand);
 * 3. re-project the page's ownership and search rows (is_short, needs_format);
 * 4. queue the next page.
 *
 * Ready videos are not sent through the processing loop: a video in a Bunny
 * library other than the configured one (prod's legacy library) answers 404
 * there, which the loop treats as "needs re-upload" and would mark it failed.
 *
 * Idempotent: a page only fills what is missing, its counts replace the
 * page's previous counts, and a page already done is acknowledged and skipped.
 * `dryRun` reads (including Bunny) and counts, but writes nothing except the
 * run's own state.
 */
import {
	classifyVideoFormat,
	EMPTY_PAGE_COUNTS,
	isVideoFormatJobMessage,
	newVideoFormatRun,
	readVideoFormatRunFrom,
	startVideoFormatRunWith,
	VIDEO_FORMAT_PAGE_SIZE,
	wasShortByOldRule,
	writeVideoFormatRun,
	type VideoFormatIssue,
	type VideoFormatJobMessage,
	type VideoFormatPageCounts,
	type VideoFormatRun,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import R2Repository from '../r2Repo';
import { getSecret } from '../env-helpers';
import { bunnyDirectoryToken, signedBunnyUrl, tokenExpiry } from '../bunny-signing';
import { fetchBunnyVideo, startProcessingLoop, type ProcessingEnv } from '../processing/loop';
import { backfillOwnershipPage, ownershipIdForKey } from '../search/ownership';
import { backfillSearchPage } from '../search/backfill';

export interface VideoFormatEnv extends ProcessingEnv {
	global_settings?: R2Bucket;
	BUNNY_SIGN_HOSTNAME?: string;
	BUNNY_SIGN_URLS?: string;
	BUNNY_TOKEN_KEY?: unknown;
}

interface FormatVideo {
	id: string;
	title?: string;
	channelId?: string;
	uploadStatus?: string;
	isLive?: boolean;
	isDeleted?: boolean;
	playUrl?: string;
	duration?: number;
	width?: number;
	height?: number;
	format?: 'short' | 'video';
	formatIssue?: VideoFormatIssue;
	dateModified?: string;
}

export interface EncodedSize {
	width?: number;
	height?: number;
	duration?: number;
	/** Where it came from (for the log) */
	source: 'bunny-api' | 'playlist';
}

/** Delivery attempt from which a failing video is flagged instead of retried. */
export const FLAG_ON_ATTEMPT = 4;

const PROCESSING_STATES = new Set(['initiated', 'uploading', 'processing']);

function positive(n: unknown): number | undefined {
	return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Largest RESOLUTION=WxH in an HLS master playlist (all renditions share the shape). */
export function largestResolution(playlist: string): { width: number; height: number } | null {
	let best: { width: number; height: number } | null = null;
	for (const m of playlist.matchAll(/RESOLUTION=(\d+)x(\d+)/g)) {
		const width = Number(m[1]);
		const height = Number(m[2]);
		if (width > 0 && height > 0 && (!best || width * height > best.width * best.height)) best = { width, height };
	}
	return best;
}

/** The encoded size from the CDN's master playlist (signed when the library uses token auth). */
async function sizeFromPlaylist(env: VideoFormatEnv, video: FormatVideo): Promise<EncodedSize | null> {
	const match = /^https:\/\/([^/]+)\/([A-Za-z0-9-]+)\/playlist\.m3u8$/.exec(video.playUrl ?? '');
	if (!match || match[2] !== video.id) return null;
	const [, host, id] = match;
	let url = video.playUrl as string;
	const signHost = env.BUNNY_SIGN_HOSTNAME || env.bunny_hostname;
	if (env.BUNNY_SIGN_URLS === 'true' && host === signHost) {
		const key = await getSecret(env.BUNNY_TOKEN_KEY, 'BUNNY_TOKEN_KEY');
		if (key) {
			const expires = tokenExpiry();
			url = signedBunnyUrl(host, id, 'playlist.m3u8', await bunnyDirectoryToken(key, id, expires), expires);
		}
	}
	const res = await fetch(url);
	if (res.status === 403 || res.status === 404) return null;
	if (!res.ok) throw new Error(`playlist ${id}: HTTP ${res.status}`);
	const size = largestResolution(await res.text());
	return size ? { ...size, source: 'playlist' } : null;
}

/**
 * Bunny's encoded size (and length) of a ready video: the Stream API for the
 * configured library, else the master playlist. Null when neither has it.
 * Throws on transient errors (the page is retried).
 */
export async function readEncodedSize(env: VideoFormatEnv, video: FormatVideo): Promise<EncodedSize | null> {
	const bunny = await fetchBunnyVideo(env, video.id);
	if (bunny && positive(bunny.width) && positive(bunny.height)) {
		return { width: bunny.width, height: bunny.height, duration: positive(bunny.length), source: 'bunny-api' };
	}
	const fromPlaylist = await sizeFromPlaylist(env, video);
	if (fromPlaylist) return { ...fromPlaylist, duration: positive(bunny?.length) };
	return bunny && positive(bunny.length) ? { duration: bunny.length, source: 'bunny-api' } : null;
}

function issueFor(video: FormatVideo, missing: Array<'duration' | 'dimensions'>, now: Date, why?: string): VideoFormatIssue {
	const what = missing.join(' and ');
	return {
		reason: why ?? `Bunny reports no ${what} for this video; choose Short or video`,
		missing,
		at: now.toISOString(),
	};
}

export interface PageResult {
	counts: VideoFormatPageCounts;
	nextCursor: string | null;
	errors: Array<{ id: string; error: string }>;
}

/** One page: classify, fill encoded sizes, recheck or flag, re-project. */
export async function runVideoFormatPage(
	env: VideoFormatEnv,
	message: Pick<VideoFormatJobMessage, 'cursor' | 'limit' | 'dryRun'>,
	opts: { now?: Date; flagErrors?: boolean } = {},
): Promise<PageResult> {
	const now = opts.now ?? new Date();
	const limit = Math.min(Math.max(Math.floor(message.limit || VIDEO_FORMAT_PAGE_SIZE), 1), 100);
	const listing = await env.videos.list({ limit, ...(message.cursor ? { cursor: message.cursor } : {}) });
	const repo = new R2Repository<FormatVideo>(env.videos);
	const counts: VideoFormatPageCounts = { ...EMPTY_PAGE_COUNTS };
	const errors: Array<{ id: string; error: string }> = [];

	const flag = async (id: string, issue: VideoFormatIssue) => {
		counts.flagged++;
		if (message.dryRun) return;
		await repo.updateObject(id, (fresh) => {
			if (fresh.format || classifyVideoFormat(fresh).source !== 'unknown') return false;
			if (fresh.formatIssue?.reason === issue.reason) return false;
			fresh.formatIssue = issue;
			return true;
		});
	};

	for (const object of listing.objects) {
		const id = ownershipIdForKey('video', object.key);
		if (!id) continue;
		let video: FormatVideo | null;
		try {
			video = await repo.getObject(id);
		} catch (error) {
			errors.push({ id, error: errorText(error) });
			continue;
		}
		if (!video || video.isDeleted) continue;
		counts.scanned++;
		const local: FormatVideo = { ...video };
		try {
			let decision = classifyVideoFormat(local);
			if (decision.source === 'unknown' && !PROCESSING_STATES.has(local.uploadStatus ?? '') && local.uploadStatus !== 'failed') {
				const size = await readEncodedSize(env, local);
				const patch: Partial<FormatVideo> = {};
				if (size?.width && size.height && !(positive(local.width) && positive(local.height))) {
					patch.width = size.width;
					patch.height = size.height;
				}
				if (size?.duration && !positive(local.duration)) patch.duration = size.duration;
				if (Object.keys(patch).length) {
					Object.assign(local, patch);
					if (patch.width) counts.dimensionsStored++;
					if (!message.dryRun) {
						await repo.updateObject(id, (fresh) => {
							let changed = false;
							if (patch.width && !(positive(fresh.width) && positive(fresh.height))) {
								fresh.width = patch.width;
								fresh.height = patch.height;
								changed = true;
							}
							if (patch.duration && !positive(fresh.duration)) {
								fresh.duration = patch.duration;
								changed = true;
							}
							if (fresh.formatIssue && classifyVideoFormat(fresh).source !== 'unknown') {
								delete fresh.formatIssue;
								changed = true;
							}
							if (changed) fresh.dateModified = now.toISOString();
							return changed;
						});
					}
					logger.info('[VideoFormat] Encoded size stored', { videoId: id, source: size?.source, ...patch, dryRun: message.dryRun });
				}
				decision = classifyVideoFormat(local);
				if (decision.source === 'unknown') await flag(id, issueFor(local, decision.missing ?? [], now));
			} else if (decision.source === 'unknown' && PROCESSING_STATES.has(local.uploadStatus ?? '')) {
				// Still encoding: the processing loop stores duration and size when Bunny finishes
				counts.rechecking++;
				if (!message.dryRun) await startProcessingLoop(env, id, { reason: 'video-format', now });
			}
			if (decision.source === 'override') counts.overrides++;
			else if (decision.source === 'live') counts.live++;
			else if (decision.source === 'unknown') counts.unknown++;
			const short = decision.format === 'short';
			const oldShort = wasShortByOldRule(video);
			if (short) counts.shorts++;
			else counts.videos++;
			if (oldShort) counts.oldRuleShorts++;
			if (short && !oldShort) counts.becameShorts++;
			if (!short && oldShort) counts.becameVideos++;
		} catch (error) {
			counts.errors++;
			errors.push({ id, error: errorText(error) });
			if (opts.flagErrors) {
				try {
					await flag(id, issueFor(local, classifyVideoFormat(local).missing ?? [], now, `Format check failed: ${errorText(error)}`));
				} catch (flagError) {
					logger.error('[VideoFormat] Could not flag video', { videoId: id, error: errorText(flagError) });
				}
			}
		}
	}

	if (errors.length && !opts.flagErrors) {
		// Transient (Bunny / R2): retry the whole page; everything above is idempotent
		throw new Error(`video format page: ${errors.length} video(s) failed: ${errors.slice(0, 3).map((e) => `${e.id}: ${e.error}`).join('; ')}`);
	}

	if (!message.dryRun) {
		// Re-project the page (is_short, needs_format), including records nothing above changed
		await backfillOwnershipPage(env as never, 'video', { cursor: message.cursor, limit });
		await backfillSearchPage(env as never, 'video', { cursor: message.cursor, limit });
	}
	return { counts, nextCursor: listing.truncated ? listing.cursor ?? null : null, errors };
}

export async function readVideoFormatRun(env: Pick<VideoFormatEnv, 'global_settings'>, runId?: string): Promise<VideoFormatRun | null> {
	return env.global_settings ? readVideoFormatRunFrom(env.global_settings, runId) : null;
}

async function writeRun(env: VideoFormatEnv, run: VideoFormatRun): Promise<void> {
	if (!env.global_settings) throw new Error('global_settings bucket is not bound');
	await writeVideoFormatRun(env.global_settings, run);
}

/** Start a run: write its state and queue page 0. */
export async function startVideoFormatRun(
	env: VideoFormatEnv,
	opts: { dryRun: boolean; requestedBy?: string; limit?: number; now?: Date },
): Promise<VideoFormatRun> {
	if (!env.PROCESSING_CHECK_QUEUE) throw new Error('PROCESSING_CHECK_QUEUE is not bound');
	if (!env.global_settings) throw new Error('global_settings bucket is not bound');
	const run = await startVideoFormatRunWith(env.global_settings, env.PROCESSING_CHECK_QUEUE, opts);
	logger.info('[VideoFormat] Run started', { runId: run.runId, dryRun: run.dryRun, requestedBy: opts.requestedBy });
	return run;
}

interface QueueMessageLike {
	body: unknown;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** Consumer for one video-format message (see index.ts queue()). */
export async function handleVideoFormatMessage(env: VideoFormatEnv, msg: QueueMessageLike, now = new Date()): Promise<void> {
	const body = msg.body;
	if (!isVideoFormatJobMessage(body)) {
		logger.error('[VideoFormat] Malformed message dropped', { body });
		msg.ack();
		return;
	}
	try {
		const run = (await readVideoFormatRun(env, body.runId)) ?? newVideoFormatRun(body.runId, body.dryRun, now, body.requestedBy);
		const pagesDone = Object.keys(run.pages).length;
		if (run.status === 'done' || body.page < pagesDone) {
			logger.info('[VideoFormat] Duplicate page delivery acknowledged', { runId: body.runId, page: body.page, pagesDone });
			msg.ack();
			return;
		}
		const result = await runVideoFormatPage(env, body, { now, flagErrors: msg.attempts >= FLAG_ON_ATTEMPT });
		// Next page first: if the state write then fails, the retry re-runs this
		// (idempotent) page and the duplicate next page is acknowledged above
		if (result.nextCursor) {
			await env.PROCESSING_CHECK_QUEUE!.send({ ...body, page: body.page + 1, cursor: result.nextCursor } satisfies VideoFormatJobMessage);
		}
		run.pages[String(body.page)] = result.counts;
		run.updatedAt = now.toISOString();
		run.nextCursor = result.nextCursor;
		delete run.lastError;
		if (!result.nextCursor) {
			run.status = 'done';
			run.finishedAt = now.toISOString();
		}
		await writeRun(env, run);
		logger.info('[VideoFormat] Page done', { runId: body.runId, page: body.page, counts: result.counts, done: run.status === 'done' });
		msg.ack();
	} catch (error) {
		const delaySeconds = Math.min(300, 30 * 2 ** Math.max(0, msg.attempts - 1));
		logger.warn('[VideoFormat] Page failed; retrying (dead-lettered after the last retry)', {
			runId: body.runId,
			page: body.page,
			attempts: msg.attempts,
			delaySeconds,
			error: errorText(error),
		});
		try {
			const run = await readVideoFormatRun(env, body.runId);
			if (run) {
				run.lastError = `page ${body.page}, attempt ${msg.attempts}: ${errorText(error)}`;
				run.updatedAt = now.toISOString();
				await writeRun(env, run);
			}
		} catch {
			// The run state is informational; the retry is what matters
		}
		msg.retry({ delaySeconds });
	}
}
