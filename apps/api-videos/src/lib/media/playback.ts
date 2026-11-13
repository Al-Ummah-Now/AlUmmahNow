/**
 * One playback URL per response (epic #687, owner decision 2026-11-12): the API decides the source and
 * the player never chooses.
 *
 *   GET /api/videos/:id, playlist videoItems ─► choosePlayback ─► applyPlayback
 *       playUrl / thumbnailUrl = the chosen source's (R2 signed here, Bunny signed by the middleware)
 *       delivery = { source } (a label only; no second URL anywhere)
 *   player error on R2 ─► GET /api/videos/:id/playback?exclude=r2&reason=<code> ─► Bunny's URLs
 *
 * Every decision writes one log line, the single source of truth for "why did this play come from X":
 *   { videoId, mode, r2Percent, bucket, r2Status, chosen, reason }
 * Decisions are info (stage and QA; production runs at warn), fallbacks are warn (always kept) and
 * are also counted per day and reason in playback_fallback_daily (migrations/search/0024).
 */
import { deliveryBucket, isPlaybackFallbackReason, type PlaybackFallbackReason, type PlaybackSource } from '@al-ummah/shared-types';
import { logger } from '../logger';
import { publicMp4Url, readDeliverySettings, r2Urls, type MediaEnv, type MediaVideo } from './r2-delivery';

export type DecisionReason =
	| 'mode_bunny'
	| 'mode_r2'
	| 'split_r2'
	| 'split_bunny'
	| 'r2_not_ready'
	| 'r2_url_failed'
	| `excluded_r2:${PlaybackFallbackReason}`;

export interface PlaybackDecision {
	videoId: string;
	mode: 'bunny' | 'r2' | 'split';
	r2Percent: number;
	/** 0..99: the video's bucket (assign = video) or this request's draw (assign = view); split only */
	bucket?: number;
	r2Status: string;
	chosen: PlaybackSource;
	reason: DecisionReason;
	context?: string;
}

export interface PlaybackChoice {
	source: PlaybackSource;
	/** Set when the source is R2: its signed master playlist and thumbnail */
	r2?: { playUrl: string; thumbnailUrl: string };
	decision: PlaybackDecision;
}

/** 0..99 drawn per request (assign = view). Statistics only, but never Math.random. */
function drawBucket(): number {
	// Rejection sampling: bytes 200..255 would make low buckets likelier
	const byte = new Uint8Array(1);
	do crypto.getRandomValues(byte);
	while (byte[0]! >= 200);
	return byte[0]! % 100;
}

export async function choosePlayback(
	env: MediaEnv,
	video: Pick<MediaVideo, 'id' | 'r2'>,
	opts: { exclude?: PlaybackSource; reason?: PlaybackFallbackReason; context?: string; draw?: () => number } = {},
): Promise<PlaybackChoice> {
	const settings = await readDeliverySettings(env);
	const base = { videoId: video.id, mode: settings.mode, r2Percent: settings.r2Percent, r2Status: video.r2?.status ?? 'none', ...(opts.context ? { context: opts.context } : {}) };
	const bunny = (reason: DecisionReason, bucket?: number): PlaybackChoice => ({
		source: 'bunny',
		decision: { ...base, ...(bucket !== undefined ? { bucket } : {}), chosen: 'bunny', reason },
	});

	if (opts.exclude === 'r2') return bunny(`excluded_r2:${opts.reason ?? 'other'}`);
	if (settings.mode === 'bunny') return bunny('mode_bunny');
	let bucket: number | undefined;
	if (settings.mode === 'split') {
		bucket = settings.assign === 'view' ? (opts.draw ?? drawBucket)() : deliveryBucket(video.id);
		if (bucket >= settings.r2Percent) return bunny('split_bunny', bucket);
	}
	if (video.r2?.status !== 'ready') return bunny('r2_not_ready', bucket);
	let urls: { playUrl: string; thumbnailUrl: string } | null = null;
	try {
		urls = await r2Urls(env, video);
	} catch (error) {
		logger.warn('[Media] Could not build R2 URLs; serving Bunny', { videoId: video.id, error: error instanceof Error ? error.message : String(error) });
	}
	if (!urls) return bunny('r2_url_failed', bucket);
	return {
		source: 'r2',
		r2: urls,
		decision: { ...base, ...(bucket !== undefined ? { bucket } : {}), chosen: 'r2', reason: settings.mode === 'r2' ? 'mode_r2' : 'split_r2' },
	};
}

export function logDecision(d: PlaybackDecision): void {
	if (d.reason.startsWith('excluded_r2:')) logger.warn('[Media] Playback fell back to Bunny', { ...d });
	else logger.info('[Media] Playback decision', { ...d });
}

/** Fields of a video view this rewrites. */
interface PlayableView {
	playUrl?: string;
	/** Stable public MP4 for search engines (D-SEO-11); public R2 videos only */
	contentUrl?: string;
	thumbnailUrl?: string;
	thumbnailType?: string;
	delivery?: { source: PlaybackSource };
}

/**
 * Point the view at the chosen source: one playUrl, one thumbnail, and `delivery.source` as a label.
 * A creator's custom thumbnail (image CDN, thumbnailType 'custom') is kept whatever the source.
 */
export function applyPlayback<T extends PlayableView>(view: T, choice: PlaybackChoice): T {
	const v = view as PlayableView;
	if (choice.source === 'r2' && choice.r2) {
		v.playUrl = choice.r2.playUrl;
		if (v.thumbnailType !== 'custom') v.thumbnailUrl = choice.r2.thumbnailUrl;
	}
	v.delivery = { source: choice.source };
	return view;
}

/** Choose, log and apply (the read paths). Never throws: on any error the view keeps Bunny. */
export async function withPlayback<T extends PlayableView>(
	env: MediaEnv,
	video: Pick<MediaVideo, 'id' | 'r2'>,
	view: T,
	context?: string,
): Promise<T> {
	if (!env.MEDIA_PUBLIC_HOST) return view;
	// Whatever source plays, a public video with an R2 MP4 names it for search engines
	const mp4 = publicMp4Url(env, video);
	if (mp4) (view as PlayableView).contentUrl = mp4;
	try {
		const choice = await choosePlayback(env, video, { context });
		logDecision(choice.decision);
		return applyPlayback(view, choice);
	} catch (error) {
		logger.warn('[Media] Playback choice failed; serving Bunny', { videoId: video.id, error: error instanceof Error ? error.message : String(error) });
		(view as PlayableView).delivery = { source: 'bunny' };
		return view;
	}
}

/** One count per fallback in playback_fallback_daily (best effort). */
export async function countFallback(
	env: Pick<MediaEnv, 'SEARCH_DB'>,
	row: { day: string; requested: PlaybackSource; actual: PlaybackSource; reason: PlaybackFallbackReason; column: 'server_fallbacks' | 'qoe_sessions' },
): Promise<void> {
	if (!env.SEARCH_DB) return;
	try {
		await env.SEARCH_DB.prepare(
			`INSERT INTO playback_fallback_daily (day, requested, actual, reason, server_fallbacks, qoe_sessions) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
			 ON CONFLICT (day, requested, actual, reason) DO UPDATE SET server_fallbacks = server_fallbacks + excluded.server_fallbacks, qoe_sessions = qoe_sessions + excluded.qoe_sessions`,
		)
			.bind(row.day, row.requested, row.actual, row.reason, row.column === 'server_fallbacks' ? 1 : 0, row.column === 'qoe_sessions' ? 1 : 0)
			.run();
	} catch (error) {
		logger.warn('[Media] Could not count a fallback', { error: error instanceof Error ? error.message : String(error) });
	}
}

export function parseFallbackReason(value: string | undefined | null): PlaybackFallbackReason {
	return value && isPlaybackFallbackReason(value) ? value : 'other';
}
