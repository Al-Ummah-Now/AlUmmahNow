/**
 * The provider contract (docs/media-delivery/PROVIDERS.md). One adapter per provider; call sites
 * only ever go through the registry (./index.ts), so adding a provider means writing an adapter
 * and adding its id to MEDIA_PROVIDER_IDS, never editing call sites.
 */
import type { MediaOverride, MediaProviderId, StoredProviderRef, VideoMediaProviders, VideoProviderRecord, VideoR2State } from '@al-ummah/shared-types';
import type { MediaEnv } from '../r2-delivery';

/** The fields of a video record the adapters read. */
export interface ProviderVideo {
	id: string;
	channelId?: string | null;
	uploadStatus?: string;
	playUrl?: string;
	thumbnailUrl?: string;
	thumbnailType?: string;
	availableResolutions?: string[];
	bunnyLibraryId?: number;
	isPublic?: boolean;
	isDeleted?: boolean;
	isHidden?: boolean;
	r2?: VideoR2State;
	/** New videos: which providers hold the video and their provider-side ids */
	media?: VideoMediaProviders;
	/**
	 * Per-video playback override (admin, lib/media/video-override.ts). Kept beside `media`, not in it:
	 * a legacy row stays legacy (no `media`) when an admin pins its playback.
	 */
	mediaOverride?: MediaOverride;
	readyAt?: string;
	playableAt?: string;
}

/** Signed URLs one provider issues for one ready video. */
export interface ProviderPlayback {
	/** HLS master playlist (signed when the provider needs it) */
	playUrl: string;
	/** The provider's own frame of the video (signed when needed) */
	thumbnailUrl?: string;
}

export interface PlaybackSignOptions {
	nowSeconds?: number;
}

export interface ProbeResult {
	ok: boolean;
	ms: number;
	status?: number;
	error?: string;
}

export type ProvidersEnv = MediaEnv & {
	BUNNY_SIGN_URLS?: string;
};

export interface MediaProvider {
	readonly id: MediaProviderId;
	/**
	 * How it takes new uploads: `upload-proxy` providers receive the bytes through our TUS proxy as
	 * they arrive; `from-original` providers build their copy from our kept original afterwards.
	 */
	readonly ingest: 'upload-proxy' | 'from-original';
	/** This video's copy at the provider, or null when it holds none. Legacy rows are read in code. */
	record(video: ProviderVideo): VideoProviderRecord | null;
	/**
	 * Signed playback and thumbnail URLs of a ready copy; null when they cannot be built.
	 * `nowSeconds` pins the signing clock (embeds sign per hour so their URLs stay cacheable).
	 */
	playback(env: ProvidersEnv, video: ProviderVideo, record: VideoProviderRecord, opts?: PlaybackSignOptions): Promise<ProviderPlayback | null>;
	/** Is a stored thumbnail URL this provider's automatic frame of the video (replaceable by another provider's)? */
	isOwnAutoThumbnail(video: ProviderVideo, url: string | undefined): boolean;
	/** Can viewers reach the provider right now (cron, once a minute)? */
	probe(env: ProvidersEnv): Promise<ProbeResult>;
}

/** The stored ref of a provider on a new-style record (undefined on legacy rows and for absent providers). */
export function storedRef(video: ProviderVideo, provider: MediaProviderId): StoredProviderRef | undefined {
	return video.media?.providers?.[provider];
}

/** A row written before provider records existed: it has no `media` field. */
export function isLegacyRow(video: ProviderVideo): boolean {
	return !video.media;
}
