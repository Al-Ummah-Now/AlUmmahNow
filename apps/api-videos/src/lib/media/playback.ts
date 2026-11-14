/**
 * Playback across providers (docs/media-delivery/PROVIDERS.md). The API decides; players follow the
 * list they are given:
 *
 *   GET /api/videos/:id, playlist videoItems ─► choosePlayback ─► applyPlayback
 *       sources  = every ready provider's signed playlist, in the order to try (rules + health)
 *       playUrl  = sources[0] (clients that only know one URL), thumbnailUrl = its frame unless the
 *                  stored thumbnail is a custom or legacy image (those are never replaced)
 *       delivery = { source } (a label only)
 *   player error ─► next entry of `sources`, or GET /api/videos/:id/playback?exclude=<provider>[,…]
 *       (players that keep one URL): decided again without the failed providers, counted as a
 *       failure of the provider that failed (health) and in playback_fallback_daily.
 *
 * Every decision writes one log line, the single source of truth for "why did this play come from X":
 *   { videoId, strategy, order, ready, unhealthy, bucket, sources, chosen, reason }
 * Decisions are info (stage and QA; production runs at warn), fallbacks are warn (always kept).
 */
import {
	effectiveRules,
	isMediaProviderId,
	isPlaybackFallbackReason,
	planSources,
	playBucket,
	unhealthyProviders,
	MEDIA_PROVIDER_IDS,
	type MediaProviderId,
	type PlaybackFallbackReason,
	type PlaybackSource,
	type PlaybackSourceView,
	type PlaybackStrategy,
	type PlanReason,
} from '@al-ummah/shared-types';
import { logger } from '../logger';
import { readHealth } from './health';
import { allProviders, provider, videoProviderRecords, type ProviderVideo, type ProvidersEnv } from './providers';
import { publicMp4Url } from './r2-delivery';
import { readMediaSettings } from './settings';

export type DecisionReason = PlanReason | 'url_failed' | `excluded:${PlaybackFallbackReason}`;

export interface PlaybackDecision {
	videoId: string;
	strategy: PlaybackStrategy;
	/** The effective provider order (settings, then channel and video overrides) */
	order: MediaProviderId[];
	/** Providers whose copy is ready */
	ready: MediaProviderId[];
	unhealthy: MediaProviderId[];
	excluded?: MediaProviderId[];
	/** 0..99: the video's bucket (assign = video) or this request's draw (assign = view) */
	bucket: number;
	/** Providers in the order the player tries them */
	sources: MediaProviderId[];
	chosen: MediaProviderId | null;
	reason: DecisionReason;
	/** Providers that were ready but whose URLs could not be built */
	failed?: MediaProviderId[];
	context?: string;
}

export interface ResolvedSource {
	provider: MediaProviderId;
	playUrl: string;
	thumbnailUrl?: string;
}

export interface PlaybackChoice {
	/** The provider that plays first (a label); with nothing ready, the provider the video is on */
	source: PlaybackSource;
	sources: ResolvedSource[];
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

export type PlaybackEnv = ProvidersEnv & { SEARCH_DB?: D1Database };

/** Parse `exclude=r2` / `exclude=r2,bunny` (unknown ids are ignored). */
export function parseExclude(value: string | string[] | undefined | null): MediaProviderId[] {
	const parts = (Array.isArray(value) ? value : [value ?? '']).flatMap((v) => String(v).split(','));
	const out: MediaProviderId[] = [];
	for (const p of parts.map((s) => s.trim())) if (isMediaProviderId(p) && !out.includes(p)) out.push(p);
	return out;
}

export async function choosePlayback(
	env: PlaybackEnv,
	video: ProviderVideo,
	opts: { exclude?: MediaProviderId | MediaProviderId[]; reason?: PlaybackFallbackReason; context?: string; draw?: () => number; nowSeconds?: number } = {},
): Promise<PlaybackChoice> {
	const settings = await readMediaSettings(env);
	const rules = effectiveRules(settings, video.channelId ? settings.channels[video.channelId] : undefined, video.media?.override);
	const records = videoProviderRecords(video);
	const ready = records.filter((r) => r.status === 'ready').map((r) => r.provider);
	const enabled = MEDIA_PROVIDER_IDS.filter((p) => settings.providers[p].enabled);
	const unhealthy = unhealthyProviders(await readHealth(env), settings.health);
	const exclude = opts.exclude === undefined ? [] : Array.isArray(opts.exclude) ? opts.exclude : [opts.exclude];
	const bucket = playBucket(rules, video.id, opts.draw ?? drawBucket);
	const plan = planSources({ rules, enabled, ready, unhealthy, exclude, bucket });

	const sources: ResolvedSource[] = [];
	const failed: MediaProviderId[] = [];
	for (const id of plan.order) {
		const record = records.find((r) => r.provider === id)!;
		try {
			const urls = await provider(id).playback(env, video, record, { nowSeconds: opts.nowSeconds });
			if (urls) sources.push({ provider: id, ...urls });
			else failed.push(id);
		} catch (error) {
			failed.push(id);
			logger.warn('[Media] Could not build playback URLs; trying the next provider', { videoId: video.id, provider: id, error: error instanceof Error ? error.message : String(error) });
		}
	}
	// Nothing playable yet: the label names the provider the video is on (the view keeps its stored URLs)
	const holder = rules.order.find((p) => records.some((r) => r.provider === p)) ?? records[0]?.provider ?? 'bunny';
	const reason: DecisionReason = exclude.length ? `excluded:${opts.reason ?? 'other'}` : !sources.length && failed.length ? 'url_failed' : plan.reason;
	return {
		source: sources[0]?.provider ?? holder,
		sources,
		decision: {
			videoId: video.id,
			strategy: rules.strategy,
			order: rules.order,
			ready,
			unhealthy,
			...(exclude.length ? { excluded: exclude } : {}),
			bucket,
			sources: sources.map((s) => s.provider),
			chosen: sources[0]?.provider ?? null,
			reason,
			...(failed.length ? { failed } : {}),
			...(opts.context ? { context: opts.context } : {}),
		},
	};
}

export function logDecision(d: PlaybackDecision): void {
	if (d.excluded?.length || d.failed?.length) logger.warn('[Media] Playback fell back', { ...d });
	else logger.info('[Media] Playback decision', { ...d });
}

/** Fields of a video view this rewrites. */
interface PlayableView {
	playUrl?: string;
	/** Stable public MP4 for search engines (D-SEO-11); public R2 videos only */
	contentUrl?: string;
	thumbnailUrl?: string;
	thumbnailType?: string;
	thumbnailSizes?: Record<string, string>;
	delivery?: { source?: PlaybackSource };
	sources?: PlaybackSourceView[];
}

/**
 * The stored thumbnail may be swapped for the playing provider's frame only when it is one of the
 * providers' automatic frames of this video. Custom thumbnails and legacy (imported) images are
 * never replaced (owner, 2026-11-10).
 */
function replaceableThumbnail(video: ProviderVideo, url: string | undefined): boolean {
	if (video.thumbnailType === 'custom' || !url) return false;
	return allProviders().some((p) => p.isOwnAutoThumbnail(video, url));
}

/** Point the view at the chosen sources: the list, playUrl = the first, and its frame when replaceable. */
export function applyPlayback<T extends object>(view: T, choice: PlaybackChoice, video?: ProviderVideo): T {
	const v = view as unknown as PlayableView;
	const first = choice.sources[0];
	if (first) {
		v.playUrl = first.playUrl;
		const subject = video ?? (view as unknown as ProviderVideo);
		if (first.thumbnailUrl && replaceableThumbnail(subject, v.thumbnailUrl)) {
			v.thumbnailUrl = first.thumbnailUrl;
			// Size variants of another provider's frame would show a different image
			delete v.thumbnailSizes;
		}
	}
	v.sources = choice.sources.map((s) => ({ provider: s.provider, src: s.playUrl, type: 'application/x-mpegURL' as const }));
	v.delivery = { source: choice.source };
	return view;
}

/** Choose, log and apply (the read paths). Never throws: on any error the view keeps its stored URLs. */
export async function withPlayback<T extends object>(env: PlaybackEnv, video: ProviderVideo, view: T, context?: string): Promise<T> {
	// Whatever source plays, a public video with an R2 MP4 names it for search engines
	const mp4 = env.MEDIA_PUBLIC_HOST ? publicMp4Url(env, video) : null;
	if (mp4) (view as unknown as PlayableView).contentUrl = mp4;
	try {
		const choice = await choosePlayback(env, video, { context });
		logDecision(choice.decision);
		return applyPlayback(view, choice, video);
	} catch (error) {
		logger.warn('[Media] Playback choice failed; serving the stored URLs', { videoId: video.id, error: error instanceof Error ? error.message : String(error) });
		(view as unknown as PlayableView).delivery = { source: 'bunny' };
		return view;
	}
}

/** One count per fallback in playback_fallback_daily (best effort). */
export async function countFallback(
	env: Pick<PlaybackEnv, 'SEARCH_DB'>,
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
