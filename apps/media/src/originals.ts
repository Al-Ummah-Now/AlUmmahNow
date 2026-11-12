/**
 * The upload as we kept it (al-ummah-now-media-originals; docs/media-delivery/ORIGINALS.md), served to
 * the container's Range requests by virtual concatenation of the per-PATCH parts. Nothing is copied.
 */
import { originalManifestKey, originalPrefix, partsCover, partsFromKeys, planOriginalRange, type OriginalManifest, type OriginalPart } from '@al-ummah/shared-types';
import type { Env } from './env';

const index = new Map<string, { at: number; size: number; parts: OriginalPart[] } | null>();
const INDEX_TTL_MS = 10 * 60 * 1000;

/** The original's parts, or null when there is no complete original (then Bunny is the source). */
export async function originalIndex(env: Pick<Env, 'MEDIA_ORIGINALS'>, videoId: string): Promise<{ size: number; parts: OriginalPart[] } | null> {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket) return null;
	const hit = index.get(videoId);
	if (hit !== undefined && hit && Date.now() - hit.at < INDEX_TTL_MS) return hit;
	const m = await bucket.get(originalManifestKey(videoId));
	if (!m) return null;
	const manifest = (await m.json()) as OriginalManifest;
	const objects: { key: string; size: number }[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: `${originalPrefix(videoId)}${manifest.uploadId}/`, cursor, limit: 1000 });
		for (const o of page.objects) objects.push({ key: o.key, size: o.size });
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	const parts = partsFromKeys(objects, videoId, manifest.uploadId);
	if (!partsCover(parts, manifest.size).complete) return null;
	const entry = { at: Date.now(), size: manifest.size, parts };
	index.set(videoId, entry);
	if (index.size > 100) index.delete(index.keys().next().value!);
	return entry;
}

/** Parse "bytes=a-b" (or "bytes=a-") against a size; the whole file when absent. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
	if (!header) return { start: 0, end: size - 1 };
	const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
	if (!m) return null;
	const start = Number(m[1]);
	const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
	return start <= end && start < size ? { start, end } : null;
}

/** 206 (or 200 for no Range) streaming the requested bytes from the parts in order. */
export async function serveOriginal(env: Pick<Env, 'MEDIA_ORIGINALS'>, videoId: string, rangeHeader: string | null): Promise<Response | null> {
	const idx = await originalIndex(env, videoId);
	if (!idx) return null;
	const range = parseRange(rangeHeader, idx.size);
	if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${idx.size}` } });
	const plan = planOriginalRange(idx.parts, range.start, range.end);
	const planned = plan.reduce((n, p) => n + (p.to - p.from + 1), 0);
	if (planned !== range.end - range.start + 1) return null;
	const bucket = env.MEDIA_ORIGINALS!;
	const { readable, writable } = new FixedLengthStream(planned);
	(async () => {
		try {
			for (const p of plan) {
				const obj = await bucket.get(p.key, { range: { offset: p.from, length: p.to - p.from + 1 } });
				if (!obj) throw new Error(`part ${p.key} vanished`);
				await obj.body.pipeTo(writable, { preventClose: true });
			}
			await writable.close();
		} catch (error) {
			await writable.abort(error).catch(() => undefined);
		}
	})();
	const headers = new Headers({ 'content-type': 'application/octet-stream', 'content-length': String(planned), 'x-media-source': 'original' });
	if (rangeHeader) headers.set('content-range', `bytes ${range.start}-${range.end}/${idx.size}`);
	return new Response(readable, { status: rangeHeader ? 206 : 200, headers });
}
