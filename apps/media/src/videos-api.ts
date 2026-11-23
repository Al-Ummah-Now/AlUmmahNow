/**
 * Calls to api-videos over the service binding (X-API-Key = INTERNAL_API_KEY).
 *
 *   GET  /internal/media/source/:videoId   → { url }  the original upload (Bunny "original", signed)
 *   POST /internal/media/events            TranscodeJobEvent → the video record
 *   POST /internal/media/mp4               Mp4JobEvent (remux-only job) → the video record
 *   POST /internal/review/livestream/:id/media  a live recording's review media (VR9)
 *   POST /internal/captions/jobs/:jobId/audio    a caption job's extracted audio (AUN-CAPTIONS §5.2)
 *   POST /internal/audio-tracks/:videoId/:trackId/prepared   a normalised audio track (AUN-MULTI-AUDIO)
 *   POST /internal/audio-tracks/:videoId/package             the demuxed multi-audio package
 *   POST /internal/audio-tracks/:videoId/detected            the source file's audio streams
 */
import type { AudioExtractJobEvent, AudioPackageReport, AudioProbeReport, AudioTrackReport, CaptionAudioReport, LiveVodReviewMediaRequest, Mp4JobEvent, TranscodeJobEvent } from '@al-ummah/shared-types';
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

/** Report a remux-only job's end; throws when api-videos did not take it. */
export async function reportMp4Event(env: Env, event: Mp4JobEvent): Promise<void> {
	const res = await call(env, '/internal/media/mp4', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(event),
	});
	if (!res.ok) throw new Error(`api-videos mp4 event ${event.type} for ${event.videoId}: HTTP ${res.status}`);
}

/** Report an audio-extract remux job's end (E14-S2); throws when api-videos did not take it. */
export async function reportAudioExtractEvent(env: Env, event: AudioExtractJobEvent): Promise<void> {
	const res = await call(env, '/internal/media/audio-extract', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(event),
	});
	if (!res.ok) throw new Error(`api-videos audio-extract event ${event.type} for ${event.videoId}: HTTP ${res.status}`);
}

/** A live recording's review media are ready (or extraction failed): api-videos queues the scan. */
export async function reportLiveReviewMedia(env: Env, streamId: string, body: LiveVodReviewMediaRequest): Promise<void> {
	const res = await call(env, `/internal/review/livestream/${encodeURIComponent(streamId)}/media`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	// 409: a newer recording replaced this review; nothing to do
	if (!res.ok && res.status !== 409) throw new Error(`api-videos live review media for ${streamId}: HTTP ${res.status}`);
}

/** A caption job's audio is ready (or could not be extracted): api-videos queues the transcription or fails the job. */
export async function reportCaptionAudio(env: Env, jobId: string, body: CaptionAudioReport): Promise<void> {
	const res = await call(env, `/internal/captions/jobs/${encodeURIComponent(jobId)}/audio`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	// 409: the job was cancelled or already finished; nothing to do
	if (!res.ok && res.status !== 409) throw new Error(`api-videos caption audio for ${jobId}: HTTP ${res.status}`);
}

async function post(env: Env, path: string, body: unknown, what: string): Promise<void> {
	const res = await call(env, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	// Stale or already applied reports are answered 200; anything else is kept and resent
	if (!res.ok) throw new Error(`api-videos ${what}: HTTP ${res.status}`);
}

/** An audio track was normalised (or gave up): api-videos queues its review and the package. */
export const reportAudioTrack = (env: Env, videoId: string, trackId: string, body: AudioTrackReport) =>
	post(env, `/internal/audio-tracks/${encodeURIComponent(videoId)}/${encodeURIComponent(trackId)}/prepared`, body, `audio track ${videoId}/${trackId}`);

/** The package was written (or gave up): api-videos switches playback to the new master. */
export const reportAudioPackage = (env: Env, videoId: string, body: AudioPackageReport) =>
	post(env, `/internal/audio-tracks/${encodeURIComponent(videoId)}/package`, body, `audio package ${videoId}`);

/** The source file's audio streams (Studio offers them as tracks). */
export const reportAudioProbe = (env: Env, videoId: string, body: AudioProbeReport) =>
	post(env, `/internal/audio-tracks/${encodeURIComponent(videoId)}/detected`, body, `audio probe ${videoId}`);
