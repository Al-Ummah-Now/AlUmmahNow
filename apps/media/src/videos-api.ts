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

const sources = new Map<string, { at: number; urls: string[] }>();
const SOURCE_TTL_MS = 30 * 60 * 1000;

/** Signed source candidates (original first, then MP4 fallbacks), cached 30 min per isolate (signatures live 6 h). */
export async function sourceCandidates(env: Env, videoId: string): Promise<string[]> {
	const hit = sources.get(videoId);
	if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return hit.urls;
	const res = await call(env, `/internal/media/source/${encodeURIComponent(videoId)}`);
	if (res.status === 404) return [];
	if (!res.ok) throw new Error(`api-videos source ${videoId}: HTTP ${res.status}`);
	const body = (await res.json()) as { url?: string; candidates?: string[] };
	const urls = body.candidates?.length ? body.candidates : body.url ? [body.url] : [];
	sources.set(videoId, { at: Date.now(), urls });
	if (sources.size > 200) sources.delete(sources.keys().next().value!);
	return urls;
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
