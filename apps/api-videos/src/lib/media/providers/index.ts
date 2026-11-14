/**
 * Provider registry: the only place that knows which adapters exist. Every call site asks here.
 */
import { MEDIA_PROVIDER_IDS, type MediaProviderId, type VideoProviderRecord } from '@al-ummah/shared-types';
import { bunnyProvider } from './bunny';
import { r2Provider } from './r2';
import type { MediaProvider, ProviderVideo } from './types';

const ADAPTERS: Record<MediaProviderId, MediaProvider> = { bunny: bunnyProvider, r2: r2Provider };

export function provider(id: MediaProviderId): MediaProvider {
	return ADAPTERS[id];
}

export function allProviders(): MediaProvider[] {
	return MEDIA_PROVIDER_IDS.map((id) => ADAPTERS[id]);
}

/** Every provider's copy of the video (legacy rows: Bunny, plus R2 where it exists). */
export function videoProviderRecords(video: ProviderVideo): VideoProviderRecord[] {
	const out: VideoProviderRecord[] = [];
	for (const adapter of allProviders()) {
		const record = adapter.record(video);
		if (record) out.push(record);
	}
	return out;
}

export { bunnyRef } from './bunny';
export type { MediaProvider, ProviderVideo, ProviderPlayback, ProvidersEnv, ProbeResult, PlaybackSignOptions } from './types';
