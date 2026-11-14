/**
 * Per-video playback override (docs/media-delivery/PROVIDERS.md §Playback). An admin can pin one
 * video's providers, strategy and weights from the videos admin video page; the planner applies it
 * after the global rules and the channel's override (effectiveRules in shared-types).
 *
 * Stored on the record as `mediaOverride`, beside `media` rather than in it: `media` present means
 * "a new-style record" to every adapter, so pinning a legacy video must not add it.
 *
 *   adminVideoMedia(env, video)          ─► copies, override, effective rules (video page)
 *   setVideoOverride(env, id, input, by) ─► check ─► record.mediaOverride (null clears it)
 */
import {
	MEDIA_PROVIDER_IDS,
	effectiveRules,
	normaliseMediaOverride,
	type AdminVideoMedia,
	type MediaOverride,
	type MediaProviderId,
	type MediaSettings,
	type VideoProviderRecord,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { videoProviderRecords, type ProviderVideo } from './providers';
import { readMediaSettings } from './settings';

type OverrideEnv = { videos: R2Bucket; global_settings?: R2Bucket };

export type OverrideProblem = 'not_found' | 'deleted' | 'not_playable' | 'weights_zero';

function enabledOf(settings: MediaSettings): MediaProviderId[] {
	return MEDIA_PROVIDER_IDS.filter((p) => settings.providers[p].enabled);
}

/** The video page's providers view: each copy, the override and the rules a play uses now. */
export function adminVideoMediaFrom(settings: MediaSettings, video: ProviderVideo): AdminVideoMedia {
	const channel = video.channelId ? settings.channels[video.channelId] : undefined;
	const override = normaliseMediaOverride(video.mediaOverride) ?? null;
	return {
		copies: videoProviderRecords(video).map(({ provider, status, renditions, readyAt, error, legacy }) => ({
			provider,
			status,
			renditions,
			...(readyAt ? { readyAt } : {}),
			...(error ? { error: error.slice(0, 300) } : {}),
			...(legacy ? { legacy } : {}),
		})),
		override,
		channelOverride: !!channel && !!(channel.order || channel.strategy || channel.weights),
		effective: effectiveRules(settings, channel, override),
		enabled: enabledOf(settings),
	};
}

export async function adminVideoMedia(env: { global_settings?: R2Bucket }, video: ProviderVideo): Promise<AdminVideoMedia> {
	return adminVideoMediaFrom(await readMediaSettings(env), video);
}

/**
 * Why an override would leave the video unplayable (null: fine). Its order must reach a provider
 * that is switched on and holds a copy that has not failed; weighted, one of those needs a weight.
 */
export function overrideProblem(settings: MediaSettings, video: ProviderVideo, override: MediaOverride): OverrideProblem | null {
	const channel = video.channelId ? settings.channels[video.channelId] : undefined;
	const rules = effectiveRules(settings, channel, override);
	const on = new Set(enabledOf(settings));
	const holds = new Set(videoProviderRecords(video).filter((r: VideoProviderRecord) => r.status !== 'failed').map((r) => r.provider));
	const usable = rules.order.filter((p) => on.has(p) && holds.has(p));
	if (!usable.length) return 'not_playable';
	if (rules.strategy === 'weighted' && !usable.some((p) => (rules.weights[p] ?? 0) > 0)) return 'weights_zero';
	return null;
}

/**
 * Set (or with null, clear) a video's override. Ingest targets are channel-level only and are
 * dropped. Returns the stored override, or the reason it was refused.
 */
export async function setVideoOverride(
	env: OverrideEnv,
	videoId: string,
	input: unknown,
	actorId: string,
	now: Date = new Date(),
): Promise<{ ok: true; override: MediaOverride | null; media: AdminVideoMedia } | { ok: false; problem: OverrideProblem }> {
	const normalised = input === null ? null : normaliseMediaOverride(input);
	const override: MediaOverride | null = normalised ? { ...normalised, updatedAt: now.toISOString(), updatedBy: actorId } : null;
	if (override) delete override.ingest;
	const settings = await readMediaSettings(env, true);
	const repo = new R2Repository<ProviderVideo & { isDeleted?: boolean }>(env.videos);
	const { data, rejected } = await repo.updateObjectOrReject<OverrideProblem>(videoId, (video) => {
		if (video.isDeleted) return { reject: 'deleted' };
		if (override) {
			const problem = overrideProblem(settings, video, override);
			if (problem) return { reject: problem };
			video.mediaOverride = override;
			return true;
		}
		if (!video.mediaOverride) return false;
		delete video.mediaOverride;
		return true;
	});
	if (!data) return { ok: false, problem: 'not_found' };
	if (rejected) {
		logger.debug('[Media] Video override refused', { videoId, problem: rejected });
		return { ok: false, problem: rejected };
	}
	logger.info('[Media] Video playback override changed', { videoId, actorId, cleared: !override, order: override?.order, strategy: override?.strategy });
	return { ok: true, override, media: adminVideoMediaFrom(settings, { ...data, id: videoId }) };
}
