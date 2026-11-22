/**
 * An imported item's video through the channel's normal upload (wiki TOOLS-ADMIN TA-9; the TA-5 path):
 *
 *   1. initiate   the same route Admin Tools uses (/internal/admin/import/initiate, called in process):
 *                 the video is owned by the channel's owner, uploaded by the admin, with the categories,
 *                 review and processing of any upload. The file claim (fingerprint named by source and
 *                 item) makes a retry reuse the same video.
 *   2. transfer   the file is copied into the originals bucket in parts (src/<videoId>/<uploadKey>/<offset>,
 *                 the keys the TUS proxy writes; lib/media/r2-tus.ts), resuming at the bytes already
 *                 stored, at most STEP_BYTES per job step. When the channel's uploads go to Bunny too, the
 *                 stored original is then sent to Bunny in one PUT.
 *   3. complete   markUploadComplete, as when a TUS upload finishes: processing, transcode, review.
 */
import { IMPORT_MAX_VIDEO_BYTES, originalPartKey, type ImportedFrom as YoutubeImportedFrom, type SourceImportedFrom, type VideoObject } from '@al-ummah/shared-types';
import { checkUrl, PreviewError } from '../link-preview';
import { r2UploadOffset, writeR2Part } from '../media/r2-tus';
import { uploadsToBunny } from '../media/ingest';
import { bunnyRef } from '../media/providers';
import { markUploadComplete } from '../uploads/lifecycle';
import R2Repository from '../r2Repo';
import { patchVideo } from '../videoWrites';
import { requireSecret } from '../env-helpers';
import { resolveSourceUrl } from './media';
import type { FetchedVideo } from './fetchers';
import { SourceError } from './store';
import { logger } from '../logger';

/** Part size written to the originals bucket (one part in memory at a time). */
export const PART_BYTES = 8 * 1024 * 1024;
/** Bytes copied per job step; the job continues where the stored parts end. */
export const STEP_BYTES = 256 * 1024 * 1024;
const BUNNY_VIDEO_API = 'https://video.bunnycdn.com';

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** How long a video server has to answer, and to send the next bytes once it does. */
const ANSWER_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;

/**
 * Follows redirects through the public-address check; never a private or internal host. A server that
 * doesn't answer within ANSWER_TIMEOUT_MS is given up on (the job step retries with backoff).
 */
async function fetchPublic(url: string, init: RequestInit, f: typeof fetch): Promise<Response> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), ANSWER_TIMEOUT_MS);
	try {
		return await followPublic(url, { ...init, signal: ctl.signal }, f);
	} catch (error) {
		if (ctl.signal.aborted) throw new Error('The video server did not answer in time');
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/** The next bytes of a download, or an error when none come for IDLE_TIMEOUT_MS (the caller cancels the reader). */
async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadableStreamReadResult<Uint8Array>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			reader.read(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('The video stopped arriving')), IDLE_TIMEOUT_MS);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function followPublic(url: string, init: RequestInit, f: typeof fetch): Promise<Response> {
	let next = checkUrl(url);
	for (let hop = 0; hop <= 5; hop++) {
		const res = await f(next.toString(), { ...init, redirect: 'manual' });
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get('location');
			await res.body?.cancel().catch(() => undefined);
			if (!location) break;
			next = checkUrl(new URL(location, next).toString());
			continue;
		}
		return res;
	}
	throw new PreviewError('too_many_redirects');
}

/** The file's size: given by the network, else from a one-byte range request. */
export async function sourceSize(url: string, known: number | null | undefined, f: typeof fetch = fetch): Promise<number | null> {
	if (known && known > 0) return known;
	const res = await fetchPublic(url, { method: 'GET', headers: { Range: 'bytes=0-0' } }, f);
	await res.body?.cancel().catch(() => undefined);
	const range = res.headers.get('content-range')?.match(/\/(\d+)$/);
	if (range) return Number(range[1]);
	const len = Number(res.headers.get('content-length') ?? '');
	return res.status === 200 && Number.isFinite(len) && len > 0 ? len : null;
}

export interface ImportVideoEnv {
	videos: R2Bucket;
	MEDIA_ORIGINALS?: R2Bucket;
	[binding: string]: unknown;
}

export interface InitiateInput {
	channelId: string;
	actorId: string;
	sourceId: string;
	itemId: string;
	title: string;
	description: string;
	bytes: number;
	mimeType: string;
}

/** Makes (or, on a retry, finds again) the item's video. Throws SourceError with the route's code on a refusal. */
/** What the upload route answers: the video and its resumable upload (the TUS session belongs to the admin). */
export interface ImportUpload {
	videoId: string;
	tusSessionId?: string;
	tusUploadId?: string;
	chunkSize?: number;
	resumable?: boolean;
	expiresAt?: string;
	reused?: boolean;
}

export async function initiateImportVideo(env: ImportVideoEnv, ctx: ExecutionContext, input: InitiateInput): Promise<{ videoId: string; upload: ImportUpload }> {
	// In process: the route is behind the INTERNAL_API_KEY check of /internal/* (src/index.ts), already passed here
	const { default: adminInternalRouter } = await import('../../routers/admin.router');
	const hash = await sha256Hex(`import-source:${input.sourceId}:${input.itemId}`);
	const res = await adminInternalRouter.request(
		'/import/initiate',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': input.actorId },
			body: JSON.stringify({
				channelId: input.channelId,
				title: input.title.slice(0, 100) || 'Video',
				description: input.description.slice(0, 5000),
				fileSize: input.bytes,
				mimeType: input.mimeType.startsWith('video/') ? input.mimeType : 'video/mp4',
				visibility: 'public',
				fingerprint: { name: `import-source-${input.sourceId}-${hash.slice(0, 16)}`, size: input.bytes, lastModified: 0, hash },
			}),
		},
		env as never,
		ctx,
	);
	const body = (await res.json().catch(() => ({}))) as { success?: boolean; code?: string; error?: string; result?: ImportUpload };
	if (!res.ok || !body.result?.videoId) {
		if (res.status >= 500 || res.status === 429) throw new Error(`Video upload could not start (${res.status} ${body.code ?? body.error ?? ''})`.trim());
		throw new SourceError(422, body.code ?? 'post_refused', body.error ?? 'The upload was refused');
	}
	return { videoId: body.result.videoId, upload: body.result };
}

/** Marks the video with where it came from (the post carries the same marker). */
export async function markVideoImported(env: ImportVideoEnv, videoId: string, ownerId: string, importedFrom: SourceImportedFrom | YoutubeImportedFrom): Promise<void> {
	await patchVideo(
		new R2Repository<VideoObject>(env.videos),
		videoId,
		(current) => (current.isDeleted || (current as { importedFrom?: unknown }).importedFrom ? false : ({ importedFrom } as Partial<VideoObject>)),
		{ ownerId },
	);
}

export type TransferOutcome = { status: 'done' } | { status: 'continue'; stored: number } | { status: 'skipped'; note: 'too_large' | 'media_unavailable' };

/**
 * Copies the next stretch of the file into the originals bucket; when it is all there, sends it to Bunny
 * (when the channel's uploads go there) and marks the upload complete. Safe to repeat: stored parts are
 * kept, a part is rewritten at the same key, and a finished upload is not marked twice.
 */
export async function transferImportVideo(
	env: ImportVideoEnv,
	input: { videoId: string; actorId: string; sourceId: string; network: string; itemId: string; video: FetchedVideo; bytes: number },
	f: typeof fetch = fetch,
): Promise<TransferOutcome> {
	if (!env.MEDIA_ORIGINALS) throw new Error('MEDIA_ORIGINALS is not bound');
	if (input.bytes > IMPORT_MAX_VIDEO_BYTES) return { status: 'skipped', note: 'too_large' };
	const record = await new R2Repository<VideoObject & { uploadStatus?: string }>(env.videos).getObject(input.videoId);
	if (!record || record.isDeleted) return { status: 'skipped', note: 'media_unavailable' };
	if (record.uploadStatus && !['initiated', 'uploading'].includes(record.uploadStatus)) return { status: 'done' };
	const uploadKey = `imp${(await sha256Hex(`${input.sourceId}:${input.itemId}`)).slice(0, 29)}`;
	let offset = await r2UploadOffset(env as never, input.videoId, uploadKey);

	if (offset < input.bytes) {
		const source = await resolveSourceUrl(env, input.network, input.video.url, f);
		if (!source) return { status: 'skipped', note: 'media_unavailable' };
		const res = await fetchPublic(source.url, { headers: offset > 0 ? { Range: `bytes=${offset}-` } : {} }, f);
		if (res.status === 404 || res.status === 410) {
			await res.body?.cancel().catch(() => undefined);
			return { status: 'skipped', note: 'media_unavailable' };
		}
		if (!res.ok || !res.body) {
			await res.body?.cancel().catch(() => undefined);
			throw new Error(`The video could not be read (${res.status})`);
		}
		// A server without ranges sends it all again: skip what is stored
		let skip = offset > 0 && res.status === 200 ? offset : 0;
		const reader = res.body.getReader();
		const stepEnd = Math.min(input.bytes, offset + STEP_BYTES);
		let buffer = new Uint8Array(PART_BYTES);
		let filled = 0;
		const flush = async () => {
			if (!filled) return;
			const part = buffer.subarray(0, filled);
			await writeR2Part(env as never, { videoId: input.videoId, uploadKey, offset, length: filled, body: new Blob([part]).stream() as ReadableStream<Uint8Array> });
			offset += filled;
			filled = 0;
			buffer = new Uint8Array(PART_BYTES);
		};
		try {
			while (offset + filled < stepEnd) {
				const { done, value } = await readWithin(reader);
				if (done) break;
				let chunk = value;
				if (skip) {
					const drop = Math.min(skip, chunk.byteLength);
					skip -= drop;
					chunk = chunk.subarray(drop);
				}
				while (chunk.byteLength) {
					const room = Math.min(PART_BYTES - filled, stepEnd - offset - filled, chunk.byteLength);
					if (room <= 0) break;
					buffer.set(chunk.subarray(0, room), filled);
					filled += room;
					chunk = chunk.subarray(room);
					if (filled === PART_BYTES) await flush();
				}
			}
			await flush();
		} finally {
			await reader.cancel().catch(() => undefined);
		}
		if (offset < input.bytes) {
			if (offset < stepEnd) throw new Error(`The video ended early (${offset} of ${input.bytes} bytes)`);
			logger.debug('[ImportSources] Video transfer continues', { videoId: input.videoId, stored: offset, bytes: input.bytes });
			return { status: 'continue', stored: offset };
		}
	}

	// All stored. Bunny gets the same file when the channel's uploads go there
	const guid = bunnyRef(record as never);
	if (uploadsToBunny(record as never) && guid) await sendToBunny(env, input.videoId, uploadKey, input.bytes, guid, f);
	await markUploadComplete(env as never, { videoId: input.videoId, userId: input.actorId, fileSize: input.bytes, uploadKey });
	return { status: 'done' };
}

/** The stored parts, in order, as one stream (each part read when the previous one is sent). */
function partsStream(bucket: R2Bucket, videoId: string, uploadKey: string, bytes: number): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (offset >= bytes) return controller.close();
			const part = await bucket.get(originalPartKey(videoId, uploadKey, offset));
			if (!part) return controller.error(new Error(`Part at ${offset} is missing`));
			const data = new Uint8Array(await part.arrayBuffer());
			offset += data.byteLength;
			controller.enqueue(data);
		},
	});
}

async function sendToBunny(env: ImportVideoEnv, videoId: string, uploadKey: string, bytes: number, guid: string, f: typeof fetch): Promise<void> {
	const libraryId = (await requireSecret(env.bunny_stream_library_id as never, 'bunny_stream_library_id')).trim();
	const key = await requireSecret(env['bunny-stream-key'] as never, 'bunny-stream-key');
	const fixed = new FixedLengthStream(bytes);
	const piped = partsStream(env.MEDIA_ORIGINALS!, videoId, uploadKey, bytes).pipeTo(fixed.writable);
	const res = await f(`${BUNNY_VIDEO_API}/library/${encodeURIComponent(libraryId)}/videos/${encodeURIComponent(guid)}`, {
		method: 'PUT',
		headers: { AccessKey: key, 'Content-Type': 'application/octet-stream' },
		body: fixed.readable,
	});
	await piped.catch(() => undefined);
	if (!res.ok) throw new Error(`Bunny did not take the video (${res.status})`);
}
