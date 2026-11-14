/**
 * Our own TUS upload target (docs/media-delivery/PROVIDERS.md §Ingest): when Bunny does not take an
 * upload, the TUS proxy (endpoints/video/tus/tusProxy.ts) writes each PATCH straight into the
 * originals bucket under the same keys the Bunny tee uses (src/<videoId>/<uploadKey>/<offset>), so
 * completeOriginal, the transcoder and retention work unchanged.
 *
 * The offset is the contiguous coverage of the stored parts from byte 0: no session write per
 * chunk, a retried PATCH at the same offset rewrites the same key (idempotent), and a resumed
 * upload continues exactly where the stored bytes end.
 */
import { originalPartKey, originalPrefix, partsFromKeys } from '@al-ummah/shared-types';
import { logger } from '../logger';
import type { OriginalsEnv } from './originals';

/** Largest PATCH accepted (Workers take at most 100 MB per request; the client sends 5 MB chunks). */
export const MAX_R2_PATCH_BYTES = 100 * 1024 * 1024;

async function listParts(bucket: R2Bucket, videoId: string, uploadKey: string): Promise<{ key: string; size: number }[]> {
	const out: { key: string; size: number }[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: `${originalPrefix(videoId)}${uploadKey}/`, cursor, limit: 1000 });
		for (const o of page.objects) out.push({ key: o.key, size: o.size });
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out;
}

/** Bytes stored from 0 without a gap. Throws when the bucket fails (the client retries). */
export async function r2UploadOffset(env: OriginalsEnv, videoId: string, uploadKey: string): Promise<number> {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket) throw new Error('MEDIA_ORIGINALS is not bound');
	let covered = 0;
	for (const p of partsFromKeys(await listParts(bucket, videoId, uploadKey), videoId, uploadKey)) {
		if (p.offset > covered) break;
		covered = Math.max(covered, p.offset + p.size);
	}
	return covered;
}

/** Store one PATCH body of a known length at `offset`. Throws when the bucket fails. */
export async function writeR2Part(env: OriginalsEnv, p: { videoId: string; uploadKey: string; offset: number; length: number; body: ReadableStream<Uint8Array> }): Promise<void> {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket) throw new Error('MEDIA_ORIGINALS is not bound');
	const fixed = new FixedLengthStream(p.length);
	const piped = p.body.pipeTo(fixed.writable);
	await bucket.put(originalPartKey(p.videoId, p.uploadKey, p.offset), fixed.readable, { httpMetadata: { contentType: 'application/octet-stream' } });
	await piped;
}

/** The client gave up on the upload (TUS DELETE): its parts go. Never throws. */
export async function deleteR2Upload(env: OriginalsEnv, videoId: string, uploadKey: string): Promise<number> {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket) return 0;
	try {
		const keys = (await listParts(bucket, videoId, uploadKey)).map((o) => o.key);
		for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
		return keys.length;
	} catch (error) {
		logger.warn('[R2 TUS] Could not delete a terminated upload; deleting the video removes it', { videoId, uploadKey, error: error instanceof Error ? error.message : String(error) });
		return 0;
	}
}
