/**
 * A live stream's recordings in a takedown (docs/specs/CSAM-RESPONSE.md §4): what is stored, its copy as evidence,
 * and its removal once the copy is in the store.
 *
 *   self-hosted  `live/<session>/…` in LIVE_MEDIA: the best rendition's init segment and segments, in order, are one
 *                playable file. Copied with the public files, with a list of what the copy holds; then each segment the
 *                list covers is deleted, and the rest of the session when nothing is left. A segment the list does
 *                not cover (it came in later, or changed) is copied first, whatever its size.
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

interface StoredObject {
	key: string;
	size: number;
	etag: string;
}

async function objectsUnder(bucket: R2Bucket, prefix: string): Promise<StoredObject[]> {
	const out: StoredObject[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
		out.push(...page.objects.map((o) => ({ key: o.key, size: o.size, etag: o.etag })));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out;
}

/** The rendition prefixes of a session, and whether anything at all is stored of it. One list call. */
async function renditionsOf(bucket: R2Bucket, sessionId: string): Promise<{ stored: boolean; renditions: string[] }> {
	const base = prefixOf(sessionId);
	const page = await bucket.list({ prefix: base, delimiter: '/' });
	const renditions = (page.delimitedPrefixes ?? []).map((p) => p.slice(base.length).replace(/\/$/, ''));
	return { stored: page.objects.length > 0 || renditions.length > 0, renditions };
}

/** The rendition to keep: the one with the most bytes. Null when no rendition has a segment (nothing was streamed). */
async function bestRendition(env: RecordingEnv, sessionId: string, renditions: string[]): Promise<string | null> {
	const { results } = await env.SEARCH_DB!
		.prepare('SELECT rendition, SUM(bytes) AS bytes FROM live_segments WHERE session_id = ? GROUP BY rendition')
		.bind(sessionId)
		.all<{ rendition: string; bytes: number }>();
	const bytes = new Map<string, number>();
	for (const r of results ?? []) if (renditions.includes(r.rendition) && r.bytes > 0) bytes.set(r.rendition, r.bytes);
	// The index is dropped some time after the stream (lib/live/qoe.ts), and may miss a rendition: look at the objects
	for (const rendition of renditions) {
		if (bytes.has(rendition)) continue;
		const page = await env.LIVE_MEDIA!.list({ prefix: `${prefixOf(sessionId)}${rendition}/` });
		const segments = page.objects.filter((o) => SEGMENT.test(o.key.slice(o.key.lastIndexOf('/') + 1)));
		if (segments.length || page.truncated) bytes.set(rendition, segments.reduce((n, o) => n + o.size, 0));
	}
	return [...bytes].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
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
		if (!env.LIVE_MEDIA) continue;
		const { stored, renditions } = await renditionsOf(env.LIVE_MEDIA, s.id);
		if (stored) out.push({ sessionId: s.id, provider: 'selfhosted', guid: null, rendition: await bestRendition(env, s.id, renditions), ready: true });
	}
	return out;
}

/** The evidence files of the recordings (evidence.ts copies them). */
export const recordingFiles = (recordings: StoredRecording[], after = 0): PlannedFile[] =>
	recordings.flatMap((r, i): PlannedFile[] => {
		const name = `06-live-recording-${after + i + 1}.mp4`;
		if (r.provider === 'bunny') return [{ name, source: { type: 'bunny_live', guid: r.guid! }, contentType: 'video/mp4' }];
		return r.rendition ? [{ name, source: { type: 'live', sessionId: r.sessionId, rendition: r.rendition }, contentType: 'video/mp4' }] : [];
	});

export interface RecordingPart {
	key: string;
	offset: number;
	size: number;
	etag: string;
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
	let init: StoredObject | null = null;
	for (const key of candidates) {
		const head = await bucket.head(key);
		if (head) {
			init = { key, size: head.size, etag: head.etag };
			break;
		}
	}
	let offset = 0;
	return [...(init ? [init] : []), ...segments].map((o) => {
		const part = { key: o.key, offset, size: o.size, etag: o.etag };
		offset += o.size;
		return part;
	});
}

/** How many objects a range is in (one read each). */
export const readsOf = (parts: RecordingPart[], offset: number, length: number): number => parts.filter((p) => p.offset < offset + length && p.offset + p.size > offset).length;

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

/** What a kept copy of a rendition holds: its objects in order, by key and etag. */
export interface CopiedList {
	sessionId: string;
	rendition: string;
	parts: Array<[key: string, etag: string]>;
}
export const copiedList = (sessionId: string, rendition: string, parts: RecordingPart[]): CopiedList => ({ sessionId, rendition, parts: parts.map((p) => [p.key, p.etag]) });

const segmentOf = (sessionId: string, key: string): { rendition: string; seq: number } | null => {
	const [rendition, file, ...more] = key.slice(prefixOf(sessionId).length).split('/');
	const seq = file && !more.length ? SEGMENT.exec(file)?.[1] : undefined;
	return seq === undefined ? null : { rendition: rendition!, seq: Number(seq) };
};

/**
 * Whether the copies hold an object of the session: that very object (key and etag), or the same moment in another
 * rendition. What is no segment holds nothing by itself.
 */
export function coveredBy(sessionId: string, lists: readonly CopiedList[]): (o: { key: string; etag: string }) => boolean {
	const etags = new Map<string, Set<string>>();
	const renditions = new Set<string>();
	const seqs = new Set<number>();
	for (const list of lists) {
		renditions.add(list.rendition);
		for (const [key, etag] of list.parts) {
			etags.set(key, (etags.get(key) ?? new Set()).add(etag));
			const segment = segmentOf(sessionId, key);
			if (segment) seqs.add(segment.seq);
		}
	}
	return (o) => {
		const segment = segmentOf(sessionId, o.key);
		if (!segment) return true;
		const copied = etags.get(o.key);
		if (copied) return copied.has(o.etag);
		return !renditions.has(segment.rendition) && seqs.has(segment.seq);
	};
}

/** The rendition to copy next: the one with the most that no copy holds. Null when the copies hold everything. */
export async function lateRendition(env: RecordingEnv, sessionId: string, lists: readonly CopiedList[]): Promise<string | null> {
	if (!env.LIVE_MEDIA) return null;
	const covered = coveredBy(sessionId, lists);
	const bytes = new Map<string, number>();
	for (const o of await objectsUnder(env.LIVE_MEDIA, prefixOf(sessionId))) {
		if (covered(o)) continue;
		const { rendition } = segmentOf(sessionId, o.key)!;
		bytes.set(rendition, (bytes.get(rendition) ?? 0) + o.size);
	}
	return [...bytes].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
}

/**
 * Deletes a self-hosted session's objects, up to `pages` × 1000 listed. Only what the copies hold, asked of each
 * object as it is listed; playlists and init segments last, once nothing else is stored. `late`: something is not held.
 */
export async function deleteSessionMedia(env: RecordingEnv, sessionId: string, pages: number, covered: (o: { key: string; etag: string }) => boolean): Promise<{ pages: number; done: boolean; late: boolean }> {
	const bucket = env.LIVE_MEDIA;
	if (!bucket) return { pages: 0, done: true, late: false };
	const rest: string[] = [];
	let late = false;
	let startAfter: string | undefined;
	for (let used = 1; used <= pages; used++) {
		const page = await bucket.list({ prefix: prefixOf(sessionId), ...(startAfter ? { startAfter } : {}) });
		const go: string[] = [];
		for (const o of page.objects) {
			if (!segmentOf(sessionId, o.key)) rest.push(o.key);
			else if (covered(o)) go.push(o.key);
			else late = true;
		}
		if (go.length) await bucket.delete(go);
		startAfter = page.objects.at(-1)?.key;
		if (page.truncated) continue;
		if (!late) for (let i = 0; i < rest.length; i += 1000) await bucket.delete(rest.slice(i, i + 1000));
		return { pages: used, done: !late, late };
	}
	return { pages, done: false, late: false };
}

export const deleteBunny = (env: RecordingEnv, guid: string) => deleteBunnyRecording(env, guid);

/** Nothing points at a removed recording any more: every session of the stream that has nothing stored (also one an earlier run removed). */
export async function forgetRemovedRecordings(env: RecordingEnv, streamId: string, stored: StoredRecording[]): Promise<void> {
	await env.SEARCH_DB!
		.prepare('UPDATE live_sessions SET vod_url = NULL, vod_ready_at = NULL WHERE stream_id = ? AND (vod_url IS NOT NULL OR vod_ready_at IS NOT NULL) AND id NOT IN (SELECT value FROM json_each(?))')
		.bind(streamId, JSON.stringify(stored.map((r) => r.sessionId)))
		.run();
}

/** What a person must do about a recording the takedown could not finish with. */
export function recordingInstruction(r: StoredRecording, kept: boolean): string {
	const what = r.provider === 'bunny' ? `Bunny Stream video ${r.guid}` : `R2 live/${r.sessionId}/`;
	if (kept) return `${what}: a copy is kept; delete it there, then retry.`;
	if (r.provider === 'bunny' && !r.ready) return `${what}: Bunny is still processing it; retry in an hour. If it never finishes, download it from Bunny's dashboard, keep the file with this case, delete it there, then retry.`;
	return `${what}: it could not be copied; download it, keep the file with this case, delete it there, then retry.`;
}
