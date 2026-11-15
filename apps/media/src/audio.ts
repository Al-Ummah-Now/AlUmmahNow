/**
 * Multiple audio tracks (wiki AUN-MULTI-AUDIO): what the Transcoder's audio outbound handlers may
 * read and write, the uploaded file served by virtual concatenation of its chunks, and the queue
 * policy of the three audio jobs.
 */
import { audioTrackFileKey, audioTrackPrefix, isAudioMasterFile, isAudioTrackId, partsCover, planOriginalRange, type OriginalPart } from '@al-ummah/shared-types';
import { parseRange } from './originals';
import type { Env } from './env';

/** An uploaded track's chunks (`<prefix><uploadId>/<12-digit offset>`), in order. */
export function audioPartsFromKeys(objects: { key: string; size: number }[], videoId: string, trackId: string, uploadId: string): OriginalPart[] {
	const base = `${audioTrackPrefix(videoId, trackId)}${uploadId}/`;
	const parts: OriginalPart[] = [];
	for (const o of objects) {
		if (!o.key.startsWith(base)) continue;
		const rest = o.key.slice(base.length);
		if (!/^[0-9]{12}$/.test(rest)) continue;
		parts.push({ key: o.key, offset: Number(rest), size: o.size });
	}
	return parts.sort((a, b) => a.offset - b.offset);
}

/** 206/200 of the uploaded file's bytes, or a 404 when its chunks do not cover `bytes`. */
export async function serveAudioUpload(
	env: Pick<Env, 'MEDIA_ORIGINALS'>,
	p: { videoId: string; trackId: string; uploadId: string; bytes: number },
	rangeHeader: string | null,
): Promise<Response> {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket) return new Response('originals not bound', { status: 404 });
	const objects: { key: string; size: number }[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: `${audioTrackPrefix(p.videoId, p.trackId)}${p.uploadId}/`, cursor, limit: 1000 });
		for (const o of page.objects) objects.push({ key: o.key, size: o.size });
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	const parts = audioPartsFromKeys(objects, p.videoId, p.trackId, p.uploadId);
	if (!partsCover(parts, p.bytes).complete) return new Response('upload_incomplete', { status: 404 });
	const range = parseRange(rangeHeader, p.bytes);
	if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${p.bytes}` } });
	const plan = planOriginalRange(parts, range.start, range.end);
	const planned = plan.reduce((n, x) => n + (x.to - x.from + 1), 0);
	if (planned !== range.end - range.start + 1) return new Response('upload_incomplete', { status: 404 });
	const { readable, writable } = new FixedLengthStream(planned);
	(async () => {
		try {
			for (const x of plan) {
				const obj = await bucket.get(x.key, { range: { offset: x.from, length: x.to - x.from + 1 } });
				if (!obj) throw new Error(`chunk ${x.key} vanished`);
				await obj.body.pipeTo(writable, { preventClose: true });
			}
			await writable.close();
		} catch (error) {
			await writable.abort(error).catch(() => undefined);
		}
	})();
	const headers = new Headers({ 'content-type': 'application/octet-stream', 'content-length': String(planned) });
	if (rangeHeader) headers.set('content-range', `bytes ${range.start}-${range.end}/${p.bytes}`);
	return new Response(readable, { status: rangeHeader ? 206 : 200, headers });
}

/**
 * Whether a package job may touch `key`: its rendition's `a/` folder (video-only rungs, the
 * original audio, the tracks) and its versioned master, nothing else of the rendition.
 */
export function packageKeyAllowed(prefix: string, key: string): boolean {
	if (!key.startsWith(`${prefix}/`)) return false;
	const rest = key.slice(prefix.length + 1);
	if (isAudioMasterFile(rest as unknown)) return true;
	const parts = rest.split('/');
	if (parts[0] !== 'a') return false;
	const file = parts[parts.length - 1]!;
	if (!/^(index\.m3u8|init\.mp4|seg_[0-9]{5}\.m4s)$/.test(file)) return false;
	if (parts.length === 4) return parts[1] === 'v' && /^[0-9]{2,4}p$/.test(parts[2]!);
	if (parts.length === 3) return isAudioTrackId(parts[1]);
	return false;
}

/** The normalised file a track job writes, and the only object it may write in the originals bucket. */
export const trackOutputKey = (videoId: string, trackId: string) => audioTrackFileKey(videoId, trackId);

/** Attempts before an audio job gives up (the queue's max_retries is 8: report before the DLQ). */
export const AUDIO_MAX_ATTEMPTS = 6;

/**
 * Queue policy of the audio jobs: ready acks; busy (the container runs something else) waits a
 * minute and counts, so a video that stays busy still ends in a report instead of the DLQ; a
 * passing failure backs off; a fatal one or the last attempt gives up (api-videos flags the admin).
 */
export function audioQueueAction(
	result: { outcome: 'ready' | 'busy' | 'failed'; fatal?: boolean },
	attempts: number,
): { ack: true; giveUp: boolean } | { ack: false; delaySeconds: number } {
	if (result.outcome === 'ready') return { ack: true, giveUp: false };
	if (result.fatal || attempts >= AUDIO_MAX_ATTEMPTS) return { ack: true, giveUp: true };
	if (result.outcome === 'busy') return { ack: false, delaySeconds: 60 * attempts };
	return { ack: false, delaySeconds: Math.min(900, 60 * 2 ** Math.max(0, attempts - 1)) };
}
