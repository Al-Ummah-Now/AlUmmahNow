/**
 * Cloudflare R2 adapter: renditions transcoded by apps/media from our kept original (or Bunny's MP4
 * when no original was kept), served from media.<env>.alummahnow.net. The copy's state is the
 * record's `r2` field (lib/media/r2-delivery.ts); the provider-side id is our video id.
 */
import { MEDIA_THUMBNAIL, type VideoProviderRecord } from '@al-ummah/shared-types';
import { r2Urls } from '../r2-delivery';
import type { MediaProvider, ProbeResult, ProviderPlayback, ProviderVideo, ProvidersEnv } from './types';

const PROBE_KEY = 'pub/_health/probe.txt';
const PROBE_TIMEOUT_MS = 5_000;

function status(video: ProviderVideo): VideoProviderRecord['status'] {
	switch (video.r2?.status) {
		case 'ready':
			return 'ready';
		case 'failed':
			return 'failed';
		case 'queued':
		case 'transcoding':
			return 'processing';
		default:
			return 'pending';
	}
}

export const r2Provider: MediaProvider = {
	id: 'r2',
	ingest: 'from-original',

	record(video) {
		const r2 = video.r2;
		// A new-style record that lists R2 but whose job has not been queued yet
		if (!r2 && !video.media?.providers?.r2) return null;
		return {
			provider: 'r2',
			ref: video.id,
			status: status(video),
			renditions: r2?.result?.rungs.map((r) => r.name) ?? [],
			...(r2?.readyAt ? { readyAt: r2.readyAt } : {}),
			...(r2?.error ? { error: r2.error } : {}),
			...(video.media ? {} : { legacy: true }),
		};
	},

	async playback(env, video): Promise<ProviderPlayback | null> {
		const urls = await r2Urls(env, { id: video.id, r2: video.r2 });
		return urls ? { playUrl: urls.playUrl, thumbnailUrl: urls.thumbnailUrl } : null;
	},

	isOwnAutoThumbnail(video, url) {
		if (!url || video.thumbnailType === 'custom' || !video.r2) return false;
		try {
			const u = new URL(url);
			return u.pathname.endsWith(`/${video.id}/${video.r2.rev}/${MEDIA_THUMBNAIL}`) && /^\/(pub|priv)\//.test(u.pathname);
		} catch {
			return false;
		}
	},

	async probe(env: ProvidersEnv): Promise<ProbeResult> {
		const started = Date.now();
		if (!env.MEDIA_PUBLIC_HOST || !env.MEDIA) return { ok: false, ms: 0, error: 'media host or bucket not configured' };
		try {
			// A tiny canary under pub/, read through the public domain; written (through the binding) only when missing
			const head = () => fetch(`https://${env.MEDIA_PUBLIC_HOST}/${PROBE_KEY}`, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
			let res = await head();
			if (res.status === 404) {
				await env.MEDIA.put(PROBE_KEY, 'ok', { httpMetadata: { contentType: 'text/plain', cacheControl: 'no-store' } });
				res = await head();
			}
			return { ok: res.ok, ms: Date.now() - started, status: res.status };
		} catch (error) {
			return { ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
		}
	},
};
