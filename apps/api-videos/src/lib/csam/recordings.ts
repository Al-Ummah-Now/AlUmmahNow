/**
 * A live stream's recordings in a takedown (docs/specs/CSAM-RESPONSE.md §4): what is stored, its copy as evidence,
 * and its removal once the copy is in the store.
 *
 *   self-hosted  `live/<session>/…` in LIVE_MEDIA: the best rendition's init segment and segments, in order, are one
 *                playable file. Copied with the public files, then the session's whole prefix is deleted.
 *   Bunny        the library video with the stream's guid: copied from Bunny's best file, then deleted there.
 */
import type { PlannedFile, EvidenceEnv } from './evidence';
import { deleteBunnyRecording, readBunnyRecording, type LiveEnv } from '../live/providers';

export type RecordingEnv = LiveEnv & EvidenceEnv;

export interface StoredRecording {
	sessionId: string;
	provider: 'selfhosted' | 'bunny';
	/** Bunny's guid */
	guid: string | null;
	/** self-hosted: the rendition kept as evidence */
	rendition: string | null;
	/** bunny: its files can be read now */
	ready: boolean;
}

const SEGMENT = /^seg_(\d+)\.(?:m4s|ts|mp4)$/;
const INIT = /^init(?:_\d{1,3})?\.mp4$/;
const prefixOf = (sessionId: string) => `live/${sessionId}/`;

async function objectsUnder(bucket: R2Bucket, prefix: string): Promise<Array<{ key: string; size: number }>> {
	const out: Array<{ key: string; size: number }> = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
		out.push(...page.objects.map((o) => ({ key: o.key, size: o.size })));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out;
}

/** Everything of the stream that is still stored. */
export async function storedRecordings(env: RecordingEnv, streamId: string): Promise<StoredRecording[]> {
	const { results } = await env.SEARCH_DB!
		.prepare('SELECT id, provider, provider_ref FROM live_sessions WHERE stream_id = ? ORDER BY created_at LIMIT 200')
		.bind(streamId)
		.all<{ id: string; provider: 'selfhosted' | 'bunny'; provider_ref: string | null }>();
	const out: StoredRecording[] = [];
	for (const s of results ?? []) {
		if (s.provider === 'bunny') {
			if (!s.provider_ref) continue;
			const recording = await readBunnyRecording(env, s.provider_ref);
			if (recording.exists) out.push({ sessionId: s.id, provider: 'bunny', guid: s.provider_ref, rendition: null, ready: recording.finished });
			continue;
		}
		// Where no bucket is bound no self-hosted stream ever ran
		const objects = env.LIVE_MEDIA ? await objectsUnder(env.LIVE_MEDIA, prefixOf(s.id)) : [];
		if (!objects.length) continue;
		const bytes = new Map<string, number>();
		for (const o of objects) {
			const [rendition, file] = o.key.slice(prefixOf(s.id).length).split('/');
			if (file && SEGMENT.test(file)) bytes.set(rendition!, (bytes.get(rendition!) ?? 0) + o.size);
		}
		const best = [...bytes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
		out.push({ sessionId: s.id, provider: 'selfhosted', guid: null, rendition: best, ready: true });
	}
	return out;
}

/** The evidence files of the recordings (evidence.ts copies them). */
export const recordingFiles = (recordings: StoredRecording[]): PlannedFile[] =>
	recordings.flatMap((r, i): PlannedFile[] => {
		const name = `06-live-recording-${i + 1}.mp4`;
		if (r.provider === 'bunny') return [{ name, source: { type: 'bunny_live', guid: r.guid! }, contentType: 'video/mp4' }];
		return r.rendition ? [{ name, source: { type: 'live', sessionId: r.sessionId, rendition: r.rendition }, contentType: 'video/mp4' }] : [];
	});

export interface RecordingPart {
	key: string;
	offset: number;
	size: number;
}

/** One rendition's objects in playing order: its init segment, then its segments by number. */
export async function recordingParts(env: RecordingEnv, sessionId: string, rendition: string): Promise<RecordingPart[]> {
	const bucket = env.LIVE_MEDIA;
	if (!bucket) return [];
	const base = prefixOf(sessionId);
	const objects = await objectsUnder(bucket, `${base}${rendition}/`);
	const fileOf = (key: string) => key.slice(key.lastIndexOf('/') + 1);
	const segments = objects
		.map((o) => ({ ...o, seq: Number(SEGMENT.exec(fileOf(o.key))?.[1] ?? NaN) }))
		.filter((o) => Number.isFinite(o.seq))
		.sort((a, b) => a.seq - b.seq);
	if (!segments.length) return [];
	// The init segment its playlist names, beside it or at the session's root; else the only one there is
	const playlist = await bucket.get(`${base}${rendition}/index.m3u8`);
	const uri = playlist ? /#EXT-X-MAP:URI="([^"]+)"/.exec(await playlist.text())?.[1]?.split('/').pop() : undefined;
	const candidates = [...(uri && INIT.test(uri) ? [`${base}${rendition}/${uri}`, `${base}${uri}`] : []), ...objects.filter((o) => INIT.test(fileOf(o.key))).map((o) => o.key), `${base}init.mp4`];
	let init: { key: string; size: number } | null = null;
	for (const key of candidates) {
		const head = await bucket.head(key);
		if (head) {
			init = { key, size: head.size };
			break;
		}
	}
	let offset = 0;
	return [...(init ? [init] : []), ...segments].map((o) => {
		const part = { key: o.key, offset, size: o.size };
		offset += o.size;
		return part;
	});
}

/** Reads a range across parts. */
export async function readParts(bucket: R2Bucket, parts: RecordingPart[], offset: number, length: number): Promise<Uint8Array> {
	const total = parts.reduce((n, p) => n + p.size, 0);
	const out = new Uint8Array(Math.max(0, Math.min(length, total - offset)));
	let filled = 0;
	for (const part of parts) {
		if (filled === out.byteLength) break;
		const start = Math.max(offset + filled, part.offset);
		const end = Math.min(offset + out.byteLength, part.offset + part.size);
		if (end <= start) continue;
		const object = await bucket.get(part.key, { range: { offset: start - part.offset, length: end - start } });
		if (!object) throw new Error(`gone: ${part.key}`);
		out.set(new Uint8Array(await object.arrayBuffer()), filled);
		filled += end - start;
	}
	if (filled !== out.byteLength) throw new Error('recording parts do not cover the range');
	return out;
}

/** Deletes a self-hosted session's objects. Its copy is in the store by now. */
export async function deleteSessionMedia(env: RecordingEnv, sessionId: string): Promise<number> {
	if (!env.LIVE_MEDIA) return 0;
	const keys = (await objectsUnder(env.LIVE_MEDIA, prefixOf(sessionId))).map((o) => o.key);
	for (let i = 0; i < keys.length; i += 1000) await env.LIVE_MEDIA.delete(keys.slice(i, i + 1000));
	return keys.length;
}

export const deleteBunny = (env: RecordingEnv, guid: string) => deleteBunnyRecording(env, guid);

/** Nothing points at a removed recording any more. */
export async function forgetRecording(env: RecordingEnv, sessionId: string): Promise<void> {
	await env.SEARCH_DB!.prepare('UPDATE live_sessions SET vod_url = NULL, vod_ready_at = NULL WHERE id = ?').bind(sessionId).run();
}

/** What a person must do about a recording the takedown could not finish with. */
export function recordingInstruction(r: StoredRecording, kept: boolean): string {
	const what = r.provider === 'bunny' ? `Bunny Stream video ${r.guid}` : `R2 live/${r.sessionId}/`;
	if (kept) return `${what}: a copy is kept; delete it there, then retry.`;
	if (r.provider === 'bunny' && !r.ready) return `${what}: Bunny is still processing it; retry in an hour. If it never finishes, download it from Bunny's dashboard, keep the file with this case, delete it there, then retry.`;
	return `${what}: it could not be copied; download it, keep the file with this case, delete it there, then retry.`;
}
