/**
 * Copy our original from Bunny into R2 (al-ummah-now-media-originals), in the layout the upload path
 * writes (docs/media-delivery/ORIGINALS.md): one object per 64 MiB range at src/<id>/<uploadId>/<offset>,
 * then manifest.json and a media_originals row. The media worker's source handler then reads it like
 * any kept upload.
 *
 * Resumable and idempotent: a few ranges per queue message, keyed by offset (a redelivered range
 * overwrites the same object). Every range's MD5 is computed while it streams and must equal the
 * ETag R2 returns for the object (R2's MD5 of what it stored), and its size must match. The original
 * is kept (keep = 'backfill'): once Bunny is retired it is the master copy.
 */
import { originalManifestKey, originalPartKey, partsCover, type OriginalManifest, type OriginalPart } from '@al-ummah/shared-types';
import R2Repository from '../../r2Repo';
import { bunnyLibraryForVideo, type LibraryHints } from '../../bunny/libraries';
import { bunnyRef } from '../providers';
import { PART_BYTES } from './estimate';
import { totalFromContentRange, bunnyFileUrl } from './source';
import { updateItem, type ItemRow } from './store';
import type { BackfillEnv } from './types';

export const PARTS_PER_MESSAGE = 2;

/** A failure a retry cannot fix: the item fails at once. */
export class BackfillFatal extends Error {
	constructor(message: string, readonly step: string) {
		super(message);
		this.name = 'BackfillFatal';
	}
}

export function uploadIdFor(runId: string): string {
	return `bf-${runId.replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}`;
}

/** An incremental MD5 (Workers: crypto.DigestStream; tests pass Node's). */
export interface Md5Hasher {
	update(chunk: Uint8Array): void | Promise<void>;
	hex(): Promise<string>;
}

export function digestStreamMd5(): Md5Hasher {
	const Digest = (crypto as unknown as { DigestStream: new (algorithm: string) => WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> } }).DigestStream;
	const stream = new Digest('MD5');
	const writer = stream.getWriter();
	return {
		update: (chunk) => writer.write(chunk),
		hex: async () => {
			await writer.close();
			return [...new Uint8Array(await stream.digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
		},
	};
}

/** Pass bytes through while hashing them. */
function md5Through(hasher: Md5Hasher): { stream: TransformStream<Uint8Array, Uint8Array>; digest: () => Promise<string>; bytes: () => number } {
	let n = 0;
	return {
		stream: new TransformStream<Uint8Array, Uint8Array>({
			async transform(chunk, controller) {
				await hasher.update(chunk);
				n += chunk.byteLength;
				controller.enqueue(chunk);
			},
		}),
		digest: () => hasher.hex(),
		bytes: () => n,
	};
}

/** R2 needs a known length for a streamed put (FixedLengthStream in Workers). */
function withLength(stream: ReadableStream<Uint8Array>, length: number): ReadableStream<Uint8Array> {
	const Fixed = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
	return Fixed ? stream.pipeThrough(new Fixed(length)) : stream;
}

const cleanEtag = (etag: string | undefined) => (etag ?? '').replace(/"/g, '').toLowerCase();

interface CopyVideo extends LibraryHints {
	id: string;
	isDeleted?: boolean;
	media?: unknown;
	bunnyRemoved?: unknown;
}

/**
 * One message's share of the copy, from `offset`. Returns the next offset, or done once the
 * manifest is written. Throws BackfillFatal when the source is gone or changed; other errors retry.
 */
export async function copyStep(
	env: BackfillEnv,
	item: ItemRow,
	offset: number,
	fetchImpl: typeof fetch = fetch,
	now = new Date(),
	md5: () => Md5Hasher = digestStreamMd5,
): Promise<{ done: boolean; next: number }> {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket) throw new Error('MEDIA_ORIGINALS is not bound');
	const size = item.source_bytes ?? 0;
	if (!(size > 0) || !item.source_file) throw new BackfillFatal('No Bunny source was found for this video', 'copy');
	const video = await new R2Repository<CopyVideo>(env.videos).getObject(item.video_id);
	if (!video || video.isDeleted) throw new BackfillFatal('The video was deleted', 'copy');
	const guid = bunnyRef({ ...video, id: item.video_id } as never);
	if (!guid) throw new BackfillFatal('Bunny holds no copy of this video', 'copy');
	const library = await bunnyLibraryForVideo(env, video);
	const uploadId = item.upload_id ?? uploadIdFor(item.run_id);
	const parts: Record<string, string> = item.parts ? JSON.parse(item.parts) : {};
	let pos = offset;
	let fetched = 0;
	let puts = 0;
	for (let i = 0; i < PARTS_PER_MESSAGE && pos < size; i++) {
		const end = Math.min(pos + PART_BYTES, size);
		const length = end - pos;
		const key = originalPartKey(item.video_id, uploadId, pos);
		const existing = parts[String(pos)] ? await bucket.head(key) : null;
		if (existing && existing.size === length && cleanEtag(existing.etag) === parts[String(pos)]) {
			pos = end;
			continue;
		}
		const url = await bunnyFileUrl(library, guid, item.source_file);
		if (!url) throw new BackfillFatal('The Bunny library has no CDN host', 'copy');
		const res = await fetchImpl(url, { headers: { Range: `bytes=${pos}-${end - 1}` } });
		if (res.status === 404 || res.status === 410) throw new BackfillFatal(`Bunny no longer serves ${item.source_file} (HTTP ${res.status})`, 'copy');
		const whole = res.status === 200 && pos === 0 && end === size;
		if (res.status !== 206 && !whole) throw new Error(`Bunny answered HTTP ${res.status} for a range of ${item.source_file}`);
		if (res.status === 206) {
			const total = totalFromContentRange(res.headers.get('content-range'));
			if (total !== null && total !== size) throw new BackfillFatal(`The Bunny file changed size (${size} → ${total} bytes); estimate again`, 'copy');
		}
		if (!res.body) throw new Error('Bunny sent no body');
		const hash = md5Through(md5());
		const stored = await bucket.put(key, withLength(res.body.pipeThrough(hash.stream), length), { httpMetadata: { contentType: 'application/octet-stream' } });
		const sum = await hash.digest();
		puts++;
		fetched += hash.bytes();
		if (hash.bytes() !== length || !stored || stored.size !== length) throw new Error(`Range ${pos}-${end - 1}: got ${hash.bytes()} bytes, stored ${stored?.size ?? 0}, expected ${length}`);
		if (cleanEtag(stored.etag) !== sum) throw new Error(`Range ${pos}-${end - 1}: checksum mismatch (MD5 ${sum}, R2 ${cleanEtag(stored.etag)})`);
		parts[String(pos)] = sum;
		pos = end;
	}
	const copied = Object.keys(parts).length ? Math.min(size, pos) : 0;
	const fields: Partial<ItemRow> = {
		upload_id: uploadId,
		parts: JSON.stringify(parts),
		copied_bytes: copied,
		egress_bytes: item.egress_bytes + fetched,
		class_a_ops: item.class_a_ops + puts,
		stored_bytes: Math.max(item.stored_bytes, copied),
	};
	if (pos < size) {
		await updateItem(env.SEARCH_DB!, item.run_id, item.video_id, fields, now);
		return { done: false, next: pos };
	}
	// Every range is there: the manifest the media worker reads, and the kept-original row
	const list: OriginalPart[] = Object.keys(parts)
		.map(Number)
		.sort((a, b) => a - b)
		.map((o) => ({ offset: o, size: Math.min(PART_BYTES, size - o), key: originalPartKey(item.video_id, uploadId, o) }));
	const cover = partsCover(list, size);
	if (!cover.complete) throw new Error(`The copy has a gap at ${cover.firstGapAt}`);
	const keys = list;
	const manifest: OriginalManifest = { uploadId, size, parts: keys.length, completedAt: now.toISOString() };
	await bucket.put(originalManifestKey(item.video_id), JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
	await env.SEARCH_DB!.prepare(
		`INSERT INTO media_originals (video_id, upload_id, bytes, parts, completed_at, deleted_at, keep) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'backfill')
		 ON CONFLICT (video_id) DO UPDATE SET upload_id = excluded.upload_id, bytes = excluded.bytes, parts = excluded.parts, completed_at = excluded.completed_at, deleted_at = NULL, keep = 'backfill'`,
	)
		.bind(item.video_id, uploadId, size, keys.length, manifest.completedAt)
		.run();
	await updateItem(env.SEARCH_DB!, item.run_id, item.video_id, { ...fields, class_a_ops: (fields.class_a_ops ?? 0) + 1, has_original: 1 }, now);
	return { done: true, next: size };
}
