/**
 * Calls to api-videos over the service binding (X-API-Key = INTERNAL_API_KEY).
 *
 *   GET  /internal/media/source/:videoId   → { url }  the original upload (Bunny "original", signed)
 *   POST /internal/media/events            TranscodeJobEvent → the video record
 */
import type { TranscodeJobEvent } from '@al-ummah/shared-types';
import { secret, type Env } from './env';

const ORIGIN = 'https://videos.internal';

async function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
	const key = await secret(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY');
	const headers = new Headers(init.headers);
	headers.set('X-API-Key', key);
	return env.VIDEOS.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }));
}

const sources = new Map<string, { at: number; url: string }>();
const SOURCE_TTL_MS = 30 * 60 * 1000;

/** Signed URL of the video's original, cached 30 min per isolate (the signature lives 6 h). */
export async function sourceUrl(env: Env, videoId: string): Promise<string | null> {
	const hit = sources.get(videoId);
	if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return hit.url;
	const res = await call(env, `/internal/media/source/${encodeURIComponent(videoId)}`);
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`api-videos source ${videoId}: HTTP ${res.status}`);
	const { url } = (await res.json()) as { url?: string };
	if (!url) return null;
	sources.set(videoId, { at: Date.now(), url });
	if (sources.size > 200) sources.delete(sources.keys().next().value!);
	return url;
}

/** Report a job event; throws when api-videos did not take it (the caller keeps it for later). */
export async function reportEvent(env: Env, event: TranscodeJobEvent): Promise<void> {
	const res = await call(env, '/internal/media/events', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(event),
	});
	if (!res.ok) throw new Error(`api-videos event ${event.type} for ${event.videoId}: HTTP ${res.status}`);
}
