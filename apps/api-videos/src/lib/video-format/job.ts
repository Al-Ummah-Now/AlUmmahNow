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
	VIDEO_FORMAT_APPLIED_KEY,
	VIDEO_FORMAT_PAGE_DELAY_SECONDS,
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
import { bunnyDirectoryToken, signedBunnyUrl, tokenExpiry } from '../bunny-signing';
import { fetchBunnyVideo, startProcessingLoop, type ProcessingEnv } from '../processing/loop';
import { bunnyLibraryForHost, type BunnyLibrariesEnv, type LibraryHints } from '../bunny/libraries';
import { backfillOwnershipPage, ownershipIdForKey } from '../search/ownership';
import { backfillSearchPage } from '../search/backfill';

export interface VideoFormatEnv extends ProcessingEnv {
	global_settings?: R2Bucket;
	/** Seconds between pages (default VIDEO_FORMAT_PAGE_DELAY_SECONDS) */
	VIDEO_FORMAT_PAGE_DELAY_SECONDS?: string;
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

/** Total of a media playlist's segment lengths (#EXTINF), in whole seconds; null when it has none. */
export function playlistDuration(playlist: string): number | null {
	let total = 0;
	for (const m of playlist.matchAll(/#EXTINF:\s*([0-9]+(?:\.[0-9]+)?)/g)) total += Number(m[1]);
	return total > 0 ? Math.round(total) : null;
}

/** First media playlist a master playlist points to (relative to the master's URL). */
export function firstMediaPlaylist(master: string): string | null {
	const lines = master.split(/\r?\n/).map((l) => l.trim());
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
			const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
			if (uri) return uri;
		}
	}
	return null;
}

/** The Bunny CDN host and video id a record plays from (its playUrl, else the configured library). */
export function playlistLocation(env: Pick<VideoFormatEnv, 'bunny_hostname'>, video: Pick<FormatVideo, 'id' | 'playUrl'>): { host: string; id: string } | null {
	const match = /^https:\/\/([^/]+)\/([A-Za-z0-9-]+)\/playlist\.m3u8$/.exec(video.playUrl ?? '');
	if (match) return match[2] === video.id ? { host: match[1], id: match[2] } : null;
	return env.bunny_hostname ? { host: env.bunny_hostname, id: video.id } : null;
}

async function fetchText(url: string, what: string): Promise<string | null> {
	const res = await fetch(url);
	if (res.status === 403 || res.status === 404) return null;
	if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
	return res.text();
}

/**
 * Encoded size and length from Bunny's CDN, for any library: the master
 * playlist's largest RESOLUTION and the sum of a media playlist's segments.
 * Signed with the library's token key where token authentication is on.
 */
async function sizeFromPlaylist(env: VideoFormatEnv, video: FormatVideo, opts: { needDuration: boolean }): Promise<EncodedSize | null> {
	const where = playlistLocation(env, video);
	if (!where) return null;
	const { host, id } = where;
	let url = `https://${host}/${id}/playlist.m3u8`;
	// Signed with the token key of the library serving that host (lib/bunny/libraries.ts)
	const library = await bunnyLibraryForHost(env as BunnyLibrariesEnv, host);
	if (library?.tokenKey) {
		const expires = tokenExpiry();
		url = signedBunnyUrl(host, id, 'playlist.m3u8', await bunnyDirectoryToken(library.tokenKey, id, expires), expires);
	}
	const master = await fetchText(url, `playlist ${id}`);
	if (!master) return null;
	const size = largestResolution(master);
	let duration: number | undefined;
	if (opts.needDuration) {
		const media = firstMediaPlaylist(master);
		if (media) duration = playlistDuration((await fetchText(new URL(media, url).toString(), `media playlist ${id}`)) ?? '') ?? undefined;
	}
	if (!size && !duration) return null;
	return { ...(size ?? {}), duration, source: 'playlist' };
}

/**
 * Bunny's encoded size and length of a ready video, whichever library holds
 * it: the Stream API when the video plays from a configured library (prod:
 * 498994, and legacy 400189 on vz-215a1ffd), and Bunny's CDN playlists for any other
 * library (and when the API has no size). Null when Bunny cannot describe it.
 * Throws on transient errors (the page is retried).
 */
export async function readEncodedSize(env: VideoFormatEnv, video: FormatVideo): Promise<EncodedSize | null> {
	const where = playlistLocation(env, video);
	// Any configured library (primary or legacy) answers through its Stream API
	const configuredLibrary = !where || !!(await bunnyLibraryForHost(env as BunnyLibrariesEnv, where.host));
	const bunny = configuredLibrary ? await fetchBunnyVideo(env, video.id, video as LibraryHints) : null;
	const apiSize = bunny && positive(bunny.width) && positive(bunny.height) ? { width: bunny.width, height: bunny.height } : null;
	const apiDuration = positive(bunny?.length);
	if (apiSize && (apiDuration || positive(video.duration))) return { ...apiSize, duration: apiDuration, source: 'bunny-api' };
	const cdn = await sizeFromPlaylist(env, video, { needDuration: !apiDuration && !positive(video.duration) });
	const width = apiSize?.width ?? cdn?.width;
	const height = apiSize?.height ?? cdn?.height;
	const duration = apiDuration ?? cdn?.duration;
	if (!width && !duration) return null;
	return { width, height, duration, source: apiSize || apiDuration ? 'bunny-api' : 'playlist' };
}

function pageDelaySeconds(env: VideoFormatEnv): number {
	const n = Number(env.VIDEO_FORMAT_PAGE_DELAY_SECONDS);
	return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 600) : VIDEO_FORMAT_PAGE_DELAY_SECONDS;
}

/**
 * Daily: classify what imports, syncs and uploads added since the last run
 * (an idempotent run over every video; only unclassified ones are read from
 * Bunny). Starts only once an admin has completed a real run (so a new
 * environment always starts with a dry run), and not while a run is going.
 */
export async function startDailyVideoFormatRun(env: VideoFormatEnv, now = new Date()): Promise<{ started: boolean; why?: string; runId?: string }> {
	if (!env.global_settings || !env.PROCESSING_CHECK_QUEUE) return { started: false, why: 'not configured' };
	const applied = await env.global_settings.get(VIDEO_FORMAT_APPLIED_KEY);
	if (!applied) return { started: false, why: 'no applied run yet (an admin starts the first one)' };
	const latest = await readVideoFormatRun(env);
	const stale = latest ? now.getTime() - Date.parse(latest.updatedAt) > 2 * 60 * 60 * 1000 : true;
	if (latest?.status === 'running' && !stale) return { started: false, why: 'a run is in progress' };
	const run = await startVideoFormatRun(env, { dryRun: false, requestedBy: 'daily', now });
	return { started: true, runId: run.runId };
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
			await env.PROCESSING_CHECK_QUEUE!.send({ ...body, page: body.page + 1, cursor: result.nextCursor } satisfies VideoFormatJobMessage, {
				delaySeconds: pageDelaySeconds(env),
			});
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
		if (run.status === 'done' && !run.dryRun) {
			await env.global_settings!.put(VIDEO_FORMAT_APPLIED_KEY, JSON.stringify({ runId: run.runId, finishedAt: run.finishedAt }), {
				httpMetadata: { contentType: 'application/json' },
			});
		}
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
