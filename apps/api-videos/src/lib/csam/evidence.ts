/**
 * The CSAM evidence store (docs/specs/CSAM-RESPONSE.md §4): a private R2 bucket
 * (CSAM_EVIDENCE, `al-ummah-now-csam-evidence[-qa|-stage]`) holding, per case, encrypted copies of
 * the matched file, the item's best source file and snapshots of the records, plus an encrypted
 * manifest. Not in any erasure or backfill path: only this module and the retention sweep (on the
 * admin's instruction, after the legal minimum) delete from it.
 *
 * The copy runs inside the `csam.contain` job before anything is purged, in resumable steps: each
 * delivery seals up to STEP_CHUNKS chunks (crypto.ts) and uploads each as one part of an R2
 * multipart upload, so a multi-GB original is copied across deliveries without ever being in memory.
 */
import {
	MEDIA_THUMBNAIL,
	originalManifestKey,
	originalPrefix,
	partsFromKeys,
	type CsamEvidenceFile,
	type CsamEvidenceManifest,
	type CsamResolution,
	type OriginalManifest,
} from '@al-ummah/shared-types';
import { getSecret } from '../env-helpers';
import { sourceCandidates, type MediaEnv } from '../media/r2-delivery';
import { imagePathOf } from './imageOwners';
import { CHUNK_BYTES, SEALED_CHUNK_BYTES, evidenceKeys, openChunk, openJson, sealChunk, sealJson, sha256Hex, type EvidenceKeys } from './crypto';

export interface EvidenceEnv {
	CSAM_EVIDENCE?: R2Bucket;
	CSAM_EVIDENCE_KEY?: unknown;
	MEDIA?: R2Bucket;
	MEDIA_PRIVATE?: R2Bucket;
	MEDIA_ORIGINALS?: R2Bucket;
	videos?: R2Bucket;
	profiles?: R2Bucket;
	channels?: R2Bucket;
	community_posts?: R2Bucket;
	image_storage_key?: unknown;
	ZONE?: string;
}

/** Where a file comes from; plain data so it survives between job deliveries. */
export type EvidenceSource =
	| { type: 'r2'; bucket: 'MEDIA' | 'MEDIA_PRIVATE' | 'MEDIA_ORIGINALS'; key: string }
	| { type: 'original'; videoId: string; uploadId: string; size: number }
	| { type: 'image'; path: string }
	| { type: 'bunny'; videoId: string };

export interface PlannedFile {
	name: string;
	source: EvidenceSource;
	contentType: string;
}

/** Copy progress of the file being copied (job params). */
export interface CopyState {
	file: number;
	uploadId?: string;
	parts: Array<{ partNumber: number; etag: string }>;
	chunk: number;
	chunkSha256: string[];
	bytes: number;
	/** The Bunny file that answered, so later deliveries read the same one */
	bunnyFile?: string;
}

export const STEP_CHUNKS = 12;
export const caseKey = (caseId: string, name: string) => `cases/${caseId}/${name}.bin`;
export const manifestKey = (caseId: string) => `cases/${caseId}/manifest.bin`;

const SAFE_CASE = /^[A-Za-z0-9-]{8,64}$/;
const extOf = (key: string, fallback: string) => (/\.([a-z0-9]{2,5})(?:$|\?)/i.exec(key)?.[1] ?? fallback).toLowerCase();
const typeOf = (ext: string) =>
	({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', m3u8: 'application/vnd.apple.mpegurl', ts: 'video/mp2t' })[ext] ??
	'application/octet-stream';

function store(env: EvidenceEnv): R2Bucket {
	if (!env.CSAM_EVIDENCE) throw new Error('CSAM_EVIDENCE bucket is not bound');
	return env.CSAM_EVIDENCE;
}

async function json<T>(bucket: R2Bucket | undefined, key: string): Promise<T | null> {
	const object = await bucket?.get(key);
	if (!object) return null;
	try {
		return (await object.json()) as T;
	} catch {
		return null;
	}
}

/**
 * The matched media file named by its URL. Bucket keys carry the access prefix: the public domain
 * serves `pub/<id>/<rev>/<file>` as is; `/priv/<token>/<id>/<rev>/<file>` is `priv/<id>/<rev>/<file>`.
 */
function mediaKeyOf(matchedUrl: string): { bucket: 'MEDIA' | 'MEDIA_PRIVATE'; key: string } | null {
	try {
		const parts = new URL(matchedUrl.startsWith('http') ? matchedUrl : `https://${matchedUrl}`).pathname.split('/').filter(Boolean);
		if (parts.some((p) => p === '..' || p === '.')) return null;
		if (parts[0] === 'pub' && parts.length >= 4) return { bucket: 'MEDIA', key: parts.join('/') };
		if (parts[0] === 'priv' && parts.length >= 5) return { bucket: 'MEDIA_PRIVATE', key: ['priv', ...parts.slice(2)].join('/') };
	} catch {
		return null;
	}
	return null;
}

/**
 * What to keep for a case: snapshots of the records (sealed at once, they are small) and the files
 * to copy, best source first. Returns the files; the snapshots are already in the store.
 */
export async function planEvidence(env: EvidenceEnv, keys: EvidenceKeys, caseId: string, matchedUrl: string, r: CsamResolution): Promise<{ files: PlannedFile[]; snapshots: CsamEvidenceFile[] }> {
	if (!SAFE_CASE.test(caseId)) throw new Error('invalid case id');
	const files: PlannedFile[] = [];
	const snapshots: CsamEvidenceFile[] = [];
	const snapshot = async (name: string, source: string, value: unknown) => {
		if (value == null) return;
		const sealed = await sealJson(keys.current.key, value, { caseId, name });
		await store(env).put(caseKey(caseId, name), sealed);
		const plain = new TextEncoder().encode(JSON.stringify(value));
		snapshots.push({ name, source, contentType: 'application/json', bytes: plain.byteLength, chunkSha256: [await sha256Hex(plain)], chunkBytes: CHUNK_BYTES, keyVersion: keys.current.version, copiedAt: new Date().toISOString() });
	};

	// The matched file itself first
	const media = mediaKeyOf(matchedUrl);
	if (media) files.push({ name: `01-matched.${extOf(media.key, 'bin')}`, source: { type: 'r2', ...media }, contentType: typeOf(extOf(media.key, 'bin')) });
	if (r.imagePath) files.push({ name: `01-matched-image.${extOf(r.imagePath, 'jpg')}`, source: { type: 'image', path: r.imagePath }, contentType: typeOf(extOf(r.imagePath, 'jpg')) });

	if (r.videoId) {
		const video = await json<Record<string, any>>(env.videos, r.videoId);
		await snapshot('record-video.json', `videos/${r.videoId}`, video);
		// The video's best source: the kept original, else Bunny's best file
		const manifest = await json<OriginalManifest>(env.MEDIA_ORIGINALS, originalManifestKey(r.videoId));
		if (manifest) files.push({ name: '02-video-original', source: { type: 'original', videoId: r.videoId, uploadId: manifest.uploadId, size: manifest.size }, contentType: 'application/octet-stream' });
		else files.push({ name: '02-video-source.mp4', source: { type: 'bunny', videoId: r.videoId }, contentType: 'video/mp4' });
		// The thumbnail viewers saw, when the matched file was something else
		const rev = video?.r2?.rev;
		const access = video?.r2?.access === 'priv' ? 'priv' : 'pub';
		if (rev && !media) files.push({ name: '03-thumbnail.jpg', source: { type: 'r2', bucket: access === 'priv' ? 'MEDIA_PRIVATE' : 'MEDIA', key: `${access}/${r.videoId}/${rev}/${MEDIA_THUMBNAIL}` }, contentType: 'image/jpeg' });
		const custom = imagePathOf(video?.thumbnailUrl);
		if (custom?.startsWith(`/thumbnails/${r.videoId}/`)) files.push({ name: `04-custom-thumbnail.${extOf(custom, 'jpg')}`, source: { type: 'image', path: custom }, contentType: typeOf(extOf(custom, 'jpg')) });
	}
	if (r.postId && r.channelId) {
		const post = await json<{ images?: Array<{ url?: string }> }>(env.community_posts, `posts/${r.channelId}/${r.postId}.json`);
		await snapshot('record-post.json', `community_posts/posts/${r.channelId}/${r.postId}`, post);
		(post?.images ?? []).forEach((image, i) => {
			const path = imagePathOf(image.url);
			if (path && path !== r.imagePath && path.startsWith(`/community-posts/${r.channelId}/`)) files.push({ name: `05-post-image-${i + 1}.${extOf(path, 'jpg')}`, source: { type: 'image', path }, contentType: typeOf(extOf(path, 'jpg')) });
		});
	}
	if (r.channelId) await snapshot('record-channel.json', `channels/${r.channelId}`, await json(env.channels, r.channelId));
	if (r.uploaderId) await snapshot('record-uploader-profile.json', `profiles/${r.uploaderId}`, await json(env.profiles, r.uploaderId));
	return { files, snapshots };
}

// --- Reading a source by range ------------------------------------------------------------

type Ranged = { size: number; read(offset: number, length: number): Promise<Uint8Array> } | null;

async function rangedHttp(url: string, headers: Record<string, string>): Promise<Ranged> {
	const head = await fetch(url, { method: 'GET', headers: { ...headers, Range: 'bytes=0-0' } });
	if (head.status !== 206 && head.status !== 200) return null;
	const total = Number(/\/(\d+)$/.exec(head.headers.get('content-range') ?? '')?.[1] ?? head.headers.get('content-length') ?? NaN);
	await head.body?.cancel();
	if (!Number.isFinite(total)) return null;
	return {
		size: total,
		async read(offset, length) {
			const res = await fetch(url, { headers: { ...headers, Range: `bytes=${offset}-${offset + length - 1}` } });
			if (res.status !== 206 && !(res.status === 200 && offset === 0)) throw new Error(`source answered ${res.status}`);
			return new Uint8Array(await res.arrayBuffer()).subarray(0, length);
		},
	};
}

async function openSource(env: EvidenceEnv, source: EvidenceSource, state: CopyState): Promise<Ranged> {
	if (source.type === 'r2') {
		const bucket = env[source.bucket];
		const head = await bucket?.head(source.key);
		if (!bucket || !head) return null;
		return {
			size: head.size,
			async read(offset, length) {
				const object = await bucket.get(source.key, { range: { offset, length } });
				if (!object) throw new Error(`gone: ${source.key}`);
				return new Uint8Array(await object.arrayBuffer());
			},
		};
	}
	if (source.type === 'original') {
		const bucket = env.MEDIA_ORIGINALS;
		if (!bucket) return null;
		const listed: Array<{ key: string; size: number }> = [];
		let cursor: string | undefined;
		do {
			const page = await bucket.list({ prefix: `${originalPrefix(source.videoId)}${source.uploadId}/`, ...(cursor ? { cursor } : {}) });
			listed.push(...page.objects.map((o) => ({ key: o.key, size: o.size })));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
		const parts = partsFromKeys(listed, source.videoId, source.uploadId);
		if (!parts.length) return null;
		return {
			size: source.size,
			async read(offset, length) {
				const out = new Uint8Array(Math.min(length, source.size - offset));
				let filled = 0;
				for (const part of parts) {
					const start = Math.max(offset + filled, part.offset);
					const end = Math.min(offset + out.byteLength, part.offset + part.size);
					if (end <= start || start !== offset + filled) continue;
					const object = await bucket.get(part.key, { range: { offset: start - part.offset, length: end - start } });
					if (!object) throw new Error(`gone: ${part.key}`);
					out.set(new Uint8Array(await object.arrayBuffer()), filled);
					filled += end - start;
					if (filled === out.byteLength) break;
				}
				if (filled !== out.byteLength) throw new Error('original parts do not cover the range');
				return out;
			},
		};
	}
	if (source.type === 'image') {
		// Straight from the storage zone: the public host may be blocked by Cloudflare by now
		const key = env.image_storage_key ? await getSecret(env.image_storage_key, 'image_storage_key') : '';
		if (!key || !env.ZONE) return null;
		return rangedHttp(`https://storage.bunnycdn.com/${env.ZONE}${source.path.split('/').map(encodeURIComponent).join('/')}`, { AccessKey: key });
	}
	// Bunny Stream: the first candidate that answers (the original when Bunny serves it, else the best MP4)
	const record = await json<Record<string, any>>(env.videos, source.videoId);
	const candidates = await sourceCandidates(env as unknown as MediaEnv, source.videoId, record as never);
	const ordered = state.bunnyFile ? candidates.filter((u) => u.includes(`/${state.bunnyFile}`)) : candidates;
	for (const url of ordered) {
		const ranged = await rangedHttp(url, {});
		if (ranged) {
			state.bunnyFile = /\/([^/?]+)(?:\?|$)/.exec(url)?.[1];
			return ranged;
		}
	}
	return null;
}

// --- The resumable copy -------------------------------------------------------------------

export type CopyStep =
	| { status: 'copying'; state: CopyState }
	| { status: 'file_done'; file: CsamEvidenceFile | null; missing?: { name: string; source: string; reason: string } };

const label = (s: EvidenceSource) => (s.type === 'r2' ? `${s.bucket}/${s.key}` : s.type === 'original' ? `MEDIA_ORIGINALS/${originalPrefix(s.videoId)}${s.uploadId}/` : s.type === 'image' ? `images${s.path}` : `bunny/${s.videoId}`);

/** Copies up to STEP_CHUNKS chunks of one planned file. Call again with the returned state until file_done. */
export async function copyStep(env: EvidenceEnv, keys: EvidenceKeys, caseId: string, planned: PlannedFile, state: CopyState): Promise<CopyStep> {
	const bucket = store(env);
	const source = await openSource(env, planned.source, state);
	if (!source) {
		if (state.uploadId) await bucket.resumeMultipartUpload(caseKey(caseId, planned.name), state.uploadId).abort().catch(() => undefined);
		return { status: 'file_done', file: null, missing: { name: planned.name, source: label(planned.source), reason: 'not found at the source' } };
	}
	const key = caseKey(caseId, planned.name);
	const upload = state.uploadId ? bucket.resumeMultipartUpload(key, state.uploadId) : await bucket.createMultipartUpload(key, { customMetadata: { caseId, keyVersion: String(keys.current.version) } });
	const next: CopyState = { ...state, uploadId: upload.uploadId, parts: [...state.parts], chunkSha256: [...state.chunkSha256] };
	const total = Math.max(1, Math.ceil(source.size / CHUNK_BYTES));
	for (let n = 0; n < STEP_CHUNKS && next.chunk < total; n++) {
		const offset = next.chunk * CHUNK_BYTES;
		const plain = source.size === 0 ? new Uint8Array(0) : await source.read(offset, Math.min(CHUNK_BYTES, source.size - offset));
		const sealed = await sealChunk(keys.current.key, plain, { caseId, name: planned.name, index: next.chunk });
		const part = await upload.uploadPart(next.chunk + 1, sealed);
		next.parts.push({ partNumber: part.partNumber, etag: part.etag });
		next.chunkSha256.push(await sha256Hex(plain));
		next.bytes += plain.byteLength;
		next.chunk++;
	}
	if (next.chunk < total) return { status: 'copying', state: next };
	await upload.complete(next.parts);
	return {
		status: 'file_done',
		file: { name: planned.name, source: label(planned.source), contentType: planned.contentType, bytes: next.bytes, chunkSha256: next.chunkSha256, chunkBytes: CHUNK_BYTES, keyVersion: keys.current.version, copiedAt: new Date().toISOString() },
	};
}

export async function writeManifest(env: EvidenceEnv, keys: EvidenceKeys, manifest: CsamEvidenceManifest): Promise<void> {
	await store(env).put(manifestKey(manifest.caseId), await sealJson(keys.current.key, manifest, { caseId: manifest.caseId, name: 'manifest' }), {
		customMetadata: { keyVersion: String(keys.current.version) },
	});
}

export async function readManifest(env: EvidenceEnv, caseId: string): Promise<CsamEvidenceManifest | null> {
	if (!SAFE_CASE.test(caseId)) return null;
	const object = await store(env).get(manifestKey(caseId));
	if (!object) return null;
	const keys = await evidenceKeys(env);
	const version = Number(object.customMetadata?.keyVersion ?? keys.current.version);
	const key = keys.byVersion.get(version);
	if (!key) throw new Error(`evidence key version ${version} is not configured`);
	return openJson<CsamEvidenceManifest>(key, new Uint8Array(await object.arrayBuffer()), { caseId, name: 'manifest' });
}

/** A file's plaintext as a stream: each chunk decrypted and checked against the manifest's hash. */
export async function openEvidenceFile(env: EvidenceEnv, caseId: string, name: string): Promise<{ file: CsamEvidenceFile; body: ReadableStream<Uint8Array> } | null> {
	const manifest = await readManifest(env, caseId);
	const file = manifest?.files.find((f) => f.name === name);
	if (!file) return null;
	const keys = await evidenceKeys(env);
	const key = keys.byVersion.get(file.keyVersion);
	if (!key) throw new Error(`evidence key version ${file.keyVersion} is not configured`);
	const bucket = store(env);
	const objectKey = caseKey(caseId, name);
	const isJson = file.contentType === 'application/json' && file.chunkSha256.length === 1 && file.bytes < CHUNK_BYTES;
	let index = 0;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (index >= file.chunkSha256.length) return controller.close();
			const object = isJson ? await bucket.get(objectKey) : await bucket.get(objectKey, { range: { offset: index * SEALED_CHUNK_BYTES, length: SEALED_CHUNK_BYTES } });
			if (!object) return controller.error(new Error('evidence chunk missing'));
			const plain = await openChunk(key, new Uint8Array(await object.arrayBuffer()), { caseId, name, index });
			if ((await sha256Hex(plain)) !== file.chunkSha256[index]) return controller.error(new Error('evidence chunk failed its integrity check'));
			controller.enqueue(plain);
			index++;
		},
	});
	return { file, body };
}

/** Deletes a case's evidence (the retention sweep, after the legal minimum and with no hold). */
export async function deleteEvidence(env: EvidenceEnv, caseId: string): Promise<number> {
	if (!SAFE_CASE.test(caseId)) throw new Error('invalid case id');
	const bucket = store(env);
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: `cases/${caseId}/`, ...(cursor ? { cursor } : {}) });
		if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
		deleted += page.objects.length;
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return deleted;
}
