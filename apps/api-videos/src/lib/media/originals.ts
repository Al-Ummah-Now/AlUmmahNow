/**
 * Our own copy of each upload, so the R2 transcode never waits for Bunny
 * (docs/media-delivery/ORIGINALS.md). Bucket: al-ummah-now-media-originals[-env] (MEDIA_ORIGINALS).
 *
 *   TUS PATCH ─► teePatch: one branch to Bunny (unchanged), one to src/<id>/<upload>/<offset>
 *   POST /upload (multipart) ─► putWholeOriginal
 *   markUploadComplete ─► completeOriginal: parts cover [0, size)? manifest + media_originals row
 *   daily cron ─► sweepOriginals (retention), purge ─► deleteOriginal
 *
 * Never fails an upload: every R2 problem is logged and the transcode falls back to Bunny's MP4.
 */
import { originalManifestKey, originalPartKey, originalPrefix, partsCover, partsFromKeys, type OriginalManifest } from '@al-ummah/shared-types';
import { logger } from '../logger';

export interface OriginalsEnv {
	MEDIA_ORIGINALS?: R2Bucket;
	SEARCH_DB?: D1Database;
	/** Keep at least this many days after upload, and until R2 is ready (default 30) */
	ORIGINALS_RETENTION_DAYS?: string;
	/** Hard ceiling for originals whose transcode never succeeds (default 90) */
	ORIGINALS_MAX_DAYS?: string;
}

/** Copy a PATCH only when its length is known and small enough to buffer safely in a tee. */
export const MAX_TEE_BYTES = 64 * 1024 * 1024;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Split a TUS PATCH body: the returned body goes to Bunny exactly as before; `stored` settles when
 * the copy is in R2 (true) or was skipped/failed (false). Await `stored` before answering, so a
 * completed upload's last part is in R2 when markUploadComplete looks.
 */
export function teePatch(
	env: OriginalsEnv,
	body: ReadableStream<Uint8Array>,
	p: { videoId: string; uploadId: string; offset: number; length: number | null },
): { body: ReadableStream<Uint8Array>; stored: Promise<boolean> } {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket || p.length === null || !(p.length > 0) || p.length > MAX_TEE_BYTES || !Number.isFinite(p.offset)) {
		if (bucket && p.length !== 0) logger.warn('[Originals] PATCH not copied', { videoId: p.videoId, offset: p.offset, length: p.length });
		return { body, stored: Promise.resolve(false) };
	}
	const [toBunny, toR2] = body.tee();
	const fixed = new FixedLengthStream(p.length);
	const piped = toR2.pipeTo(fixed.writable).catch(() => undefined);
	const stored = bucket
		.put(originalPartKey(p.videoId, p.uploadId, p.offset), fixed.readable, { httpMetadata: { contentType: 'application/octet-stream' } })
		.then(async () => {
			await piped;
			return true;
		})
		.catch((error) => {
			logger.warn('[Originals] PATCH copy failed; this upload will use Bunny for R2', { videoId: p.videoId, offset: p.offset, error: msg(error) });
			return false;
		});
	return { body: toBunny, stored };
}

/** The whole file at once (POST /upload). */
export async function putWholeOriginal(env: OriginalsEnv, videoId: string, uploadId: string, data: ArrayBuffer | Blob): Promise<boolean> {
	if (!env.MEDIA_ORIGINALS) return false;
	try {
		await env.MEDIA_ORIGINALS.put(originalPartKey(videoId, uploadId, 0), data, { httpMetadata: { contentType: 'application/octet-stream' } });
		return true;
	} catch (error) {
		logger.warn('[Originals] Whole-file copy failed', { videoId, error: msg(error) });
		return false;
	}
}

async function listAll(bucket: R2Bucket, prefix: string): Promise<{ key: string; size: number; uploaded: Date }[]> {
	const out: { key: string; size: number; uploaded: Date }[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		for (const o of page.objects) out.push({ key: o.key, size: o.size, uploaded: o.uploaded });
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return out;
}

/**
 * Upload done (Bunny holds every byte): if our parts of the newest upload id cover the file, write
 * the manifest the media worker reads. Returns whether an original is available.
 */
export async function completeOriginal(env: OriginalsEnv, videoId: string, size: number): Promise<boolean> {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket || !(size > 0)) return false;
	try {
		const objects = (await listAll(bucket, originalPrefix(videoId))).filter((o) => !o.key.endsWith('/manifest.json'));
		// The newest upload id (a re-upload starts a new session; its parts are written last)
		const byUpload = new Map<string, number>();
		for (const o of objects) {
			const uploadId = o.key.slice(originalPrefix(videoId).length).split('/')[0]!;
			byUpload.set(uploadId, Math.max(byUpload.get(uploadId) ?? 0, o.uploaded.getTime()));
		}
		const uploadId = [...byUpload.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		if (!uploadId) return false;
		const parts = partsFromKeys(objects, videoId, uploadId);
		const cover = partsCover(parts, size);
		if (!cover.complete) {
			logger.warn('[Originals] Incomplete copy; R2 will use Bunny for this video', { videoId, uploadId, size, firstGapAt: cover.firstGapAt });
			return false;
		}
		const manifest: OriginalManifest = { uploadId, size, parts: parts.length, completedAt: new Date().toISOString() };
		await bucket.put(originalManifestKey(videoId), JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
		await env.SEARCH_DB?.prepare(
			`INSERT INTO media_originals (video_id, upload_id, bytes, parts, completed_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL)
			 ON CONFLICT (video_id) DO UPDATE SET upload_id = excluded.upload_id, bytes = excluded.bytes, parts = excluded.parts, completed_at = excluded.completed_at, deleted_at = NULL`,
		)
			.bind(videoId, uploadId, size, parts.length, manifest.completedAt)
			.run()
			.catch((error) => logger.warn('[Originals] Could not record the original', { videoId, error: msg(error) }));
		return true;
	} catch (error) {
		logger.warn('[Originals] Completion check failed', { videoId, error: msg(error) });
		return false;
	}
}

/** Every original object of a video (purge, erase, retention). Idempotent. */
export async function deleteOriginal(env: OriginalsEnv, videoId: string): Promise<number> {
	const bucket = env.MEDIA_ORIGINALS;
	if (!bucket) return 0;
	const keys = (await listAll(bucket, originalPrefix(videoId))).map((o) => o.key);
	for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
	await env.SEARCH_DB?.prepare('UPDATE media_originals SET deleted_at = ?2 WHERE video_id = ?1 AND deleted_at IS NULL')
		.bind(videoId, new Date().toISOString())
		.run()
		.catch(() => undefined);
	return keys.length;
}

const days = (v: string | undefined, d: number) => {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : d;
};

/**
 * Daily: delete originals kept at least ORIGINALS_RETENTION_DAYS whose R2 rendition is ready, and
 * any older than ORIGINALS_MAX_DAYS. Bounded per run.
 */
export async function sweepOriginals(env: OriginalsEnv, now = Date.now()): Promise<{ deleted: number }> {
	if (!env.SEARCH_DB || !env.MEDIA_ORIGINALS) return { deleted: 0 };
	const keepUntil = new Date(now - days(env.ORIGINALS_RETENTION_DAYS, 30) * 86400_000).toISOString();
	const maxUntil = new Date(now - days(env.ORIGINALS_MAX_DAYS, 90) * 86400_000).toISOString();
	const { results } = await env.SEARCH_DB.prepare(
		`SELECT o.video_id FROM media_originals o LEFT JOIN media_jobs j ON j.video_id = o.video_id
		 WHERE o.deleted_at IS NULL AND ((o.completed_at < ?1 AND j.status = 'ready') OR o.completed_at < ?2)
		 ORDER BY o.completed_at LIMIT 200`,
	)
		.bind(keepUntil, maxUntil)
		.all<{ video_id: string }>();
	let deleted = 0;
	for (const r of results ?? []) {
		try {
			await deleteOriginal(env, r.video_id);
			deleted++;
		} catch (error) {
			logger.warn('[Originals] Retention delete failed', { videoId: r.video_id, error: msg(error) });
		}
	}
	return { deleted };
}

/** Bytes currently kept (daily cost job). */
export async function originalsStoredBytes(env: OriginalsEnv): Promise<number | undefined> {
	try {
		const row = await env.SEARCH_DB?.prepare('SELECT COALESCE(SUM(bytes), 0) AS b FROM media_originals WHERE deleted_at IS NULL').first<{ b: number }>();
		return row?.b ?? undefined;
	} catch {
		return undefined;
	}
}
