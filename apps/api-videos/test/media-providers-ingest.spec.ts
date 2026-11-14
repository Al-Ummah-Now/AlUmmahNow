/**
 * Ingest through the providers (docs/media-delivery/PROVIDERS.md §IDs, §Ingest): our own video ids,
 * the Bunny GUID kept as a ref, R2-only uploads through our own TUS target to a ready, published
 * video, and every path that used to treat the video id as Bunny's id. Bunny is a stubbed fetch
 * that fails the test when an R2-only upload reaches it.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { DEFAULT_MEDIA_SETTINGS, mediaFileToken, originalManifestKey, verifyMediaToken, type TranscodeJobMessage, type TranscodeResult } from '@al-ummah/shared-types';
import { createTusRouter, clearTusSessionCache } from '../src/endpoints/video/tus/tusProxy';
import { planIngest, uploadsToBunny } from '../src/lib/media/ingest';
import { initialMedia, readRecordByBunnyGuid, recordProviderRef, videoIdForRef } from '../src/lib/media/refs';
import { clearMediaSettingsCache, saveMediaSettings } from '../src/lib/media/settings';
import { applyJobEvent, clearDeliverySettingsCache, enqueueTranscode, purgeVideoMedia } from '../src/lib/media/r2-delivery';
import { r2UploadOffset } from '../src/lib/media/r2-tus';
import { sweepOriginals } from '../src/lib/media/originals';
import { signBunnyUrlsInText } from '../src/lib/bunny-signing';
import { signMediaFramesInText } from '../src/lib/media/frame-signing';
import { storeCustomThumbnail, r2ThumbnailPrefix } from '../src/lib/thumbnail/store';
import { isR2FrameOf, isR2ThumbnailOf } from '../src/lib/thumbnail/shape';
import { checkReusable } from '../src/lib/uploads/placeholder';
import { fetchTusOffset } from '../src/lib/uploads/reaper';
import { playlistLocation, readEncodedSize } from '../src/lib/video-format/job';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue, videoFixture } from './helpers';

(globalThis as Record<string, unknown>).FixedLengthStream ??= class {
	constructor() {
		return new TransformStream();
	}
};

const ID = '912859ed-e618-4d04-8438-874a74a251dd';
const GUID = '0d6e7a1c-3b5f-4e8a-9c2d-1f4b6a8e0c3d';
const OTHER = '5b1f0c9e-2a3d-4e7f-8a1b-6c2d3e4f5a6b';
const BUNNY_HOST = 'vz-cb79844a-c5d.b-cdn.net';
const MEDIA_HOST = 'media.qa.alummahnow.net';
const CHUNK = 1024;
const SIZE = 3 * CHUNK;

const R2_ONLY = {
	...DEFAULT_MEDIA_SETTINGS,
	ingest: ['r2'],
	playback: { ...DEFAULT_MEDIA_SETTINGS.playback, strategy: 'priority', order: ['r2', 'bunny'] },
	thumbnails: { store: 'r2' },
};

const RESULT: TranscodeResult = {
	rungs: [{ name: '720p', width: 1280, height: 720, maxrate: 2500000, bytes: 10, segments: 1 }],
	objects: 5,
	bytes: 100,
	durationSeconds: 42,
	source: { width: 1280, height: 720, durationSeconds: 42, bytes: SIZE, hasAudio: true },
	timings: { downloadMs: 1, transcodeMs: 2, uploadMs: 3, totalMs: 6 },
	thumbnail: 'thumb.jpg',
};

/** Byte-exact bucket with prefix listing (originals, media). */
class Bucket {
	store = new Map<string, Uint8Array>();
	meta = new Map<string, unknown>();
	async put(key: string, value: ReadableStream | ArrayBuffer | string, options?: { httpMetadata?: unknown }) {
		this.store.set(key, new Uint8Array(await new Response(value as BodyInit).arrayBuffer()));
		this.meta.set(key, options?.httpMetadata);
		return { key };
	}
	async get(key: string) {
		const v = this.store.get(key);
		return v ? { key, body: new Response(v).body, json: async () => JSON.parse(new TextDecoder().decode(v)) } : null;
	}
	async head(key: string) {
		return this.store.has(key) ? { key } : null;
	}
	async delete(keys: string | string[]) {
		for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
	}
	async list(o: { prefix?: string } = {}) {
		const keys = [...this.store.keys()].filter((k) => !o.prefix || k.startsWith(o.prefix)).sort();
		return { objects: keys.map((key) => ({ key, size: this.store.get(key)!.length, uploaded: new Date() })), truncated: false, cursor: undefined };
	}
}

function kv() {
	const data = new Map<string, string>();
	return { data, get: async (k: string) => data.get(k) ?? null, put: async (k: string, v: string) => void data.set(k, v), delete: async (k: string) => void data.delete(k) };
}

const realFetch = globalThis.fetch;
let bunnyCalls: string[] = [];
beforeEach(() => {
	bunnyCalls = [];
	clearMediaSettingsCache();
	clearDeliverySettingsCache();
	clearTusSessionCache();
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		bunnyCalls.push(`${init?.method ?? 'GET'} ${url}`);
		return new Response('{}', { status: 200 });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

function env(extra: Record<string, unknown> = {}) {
	return {
		videos: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		TUS_SESSIONS: kv(),
		queue: new MemoryQueue(),
		TRANSCODE_QUEUE: new MemoryQueue(),
		PROCESSING_CHECK_QUEUE: new MemoryQueue(),
		MEDIA: new Bucket(),
		MEDIA_PRIVATE: new Bucket(),
		MEDIA_ORIGINALS: new Bucket(),
		SEARCH_DB: new SqliteD1(),
		MEDIA_PUBLIC_HOST: MEDIA_HOST,
		MEDIA_SIGN_KEY: 'sign-key',
		bunny_hostname: BUNNY_HOST,
		'bunny-stream-key': 'k',
		bunny_stream_library_id: '123',
		...extra,
	};
}

describe('our ids, Bunny GUID as a ref', () => {
	it('default settings: our own id, Bunny created once with its GUID as the ref, R2 pending beside it', async () => {
		const e = env();
		let created = 0;
		const plan = await planIngest(e as never, 'ch1', async () => {
			created++;
			return { guid: GUID, libraryId: 123 };
		});
		assert.equal(created, 1);
		assert.notEqual(plan.videoId, GUID);
		assert.match(plan.videoId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'same shape as a Bunny GUID');
		assert.deepEqual(plan.targets, ['bunny', 'r2']);
		assert.equal(plan.media.providers.bunny?.ref, GUID);
		assert.equal(plan.media.providers.bunny?.libraryId, 123);
		assert.equal(plan.media.providers.r2?.ref, plan.videoId);
		assert.equal(await videoIdForRef(e as never, 'bunny', GUID), plan.videoId, 'the GUID maps back to our id');
	});

	it('Bunny off for ingest: Bunny is never called and the video names R2 alone', async () => {
		const e = env();
		await saveMediaSettings(e as never, R2_ONLY, 'admin-1');
		const plan = await planIngest(e as never, 'ch1', async () => assert.fail('Bunny must not be created'));
		assert.deepEqual(plan.targets, ['r2']);
		assert.equal(plan.bunny, null);
		assert.deepEqual(Object.keys(plan.media.providers), ['r2']);
		assert.equal(uploadsToBunny({ media: plan.media }), false);
		assert.equal(uploadsToBunny({}), true, 'a legacy row (no media) uploads to Bunny as before');
	});

	it('a channel override sends one channel R2-only while the rest stays on Bunny', async () => {
		const e = env();
		await saveMediaSettings(e as never, { ...DEFAULT_MEDIA_SETTINGS, playback: { ...DEFAULT_MEDIA_SETTINGS.playback, order: ['bunny', 'r2'] }, channels: { chR2: { ingest: ['r2'] } } }, 'admin-1');
		const r2 = await planIngest(e as never, 'chR2', async () => assert.fail('no Bunny for this channel'));
		assert.deepEqual(r2.targets, ['r2']);
		const other = await planIngest(e as never, 'ch1', async () => ({ guid: GUID, libraryId: 123 }));
		assert.deepEqual(other.targets, ['bunny', 'r2']);
	});

	it('a record is found from its Bunny GUID (new videos) and from its id (legacy, GUID = id)', async () => {
		const e = env();
		await e.videos.put(ID, JSON.stringify({ id: ID, media: initialMedia(['bunny'], { videoId: ID, bunnyGuid: GUID }) }));
		await e.videos.put(OTHER, JSON.stringify({ id: OTHER }));
		await recordProviderRef(e as never, 'bunny', GUID, ID);
		assert.equal((await readRecordByBunnyGuid(e as never, GUID))?.id, ID);
		assert.equal((await readRecordByBunnyGuid(e as never, OTHER))?.id, OTHER);
		assert.equal(await readRecordByBunnyGuid(e as never, '11111111-2222-4333-8444-555555555555'), null);
	});
});

/** An R2-only record and its TUS session, as initiate leaves them. */
async function r2Upload(e: ReturnType<typeof env>) {
	await saveMediaSettings(e as never, R2_ONLY, 'admin-1');
	await e.videos.put(ID, JSON.stringify(videoFixture({
		id: ID, userId: 'alice', channelId: 'ch', uploadStatus: 'uploading', fileSize: SIZE, isPublic: true,
		media: initialMedia(['r2'], { videoId: ID }),
	})));
	e.TUS_SESSIONS.data.set('tus:session:s1', JSON.stringify({
		videoId: ID, userId: 'alice', channelId: 'ch', tusEndpoint: 'https://video.bunnycdn.com/tusupload',
		tusHeaders: {}, expiresAt: '2099-01-01T00:00:00.000Z',
	}));
	const app = new Hono();
	app.use('*', async (c, next) => {
		c.set('userId' as never, 'alice' as never);
		c.set('auth' as never, { userId: 'alice' } as never);
		await next();
	});
	app.route('/api/videos/tus', createTusRouter());
	const request = (path: string, init: RequestInit) => app.request(path, init, e);
	const post = (length = SIZE) => request('/api/videos/tus', {
		method: 'POST',
		headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(length), 'Upload-Metadata': `tusSessionId ${btoa('s1')}` },
	});
	const patch = (id: string, offset: number, bytes = CHUNK) => request(`/api/videos/tus/${id}`, {
		method: 'PATCH',
		body: new Uint8Array(bytes).fill(offset / CHUNK + 1),
		headers: { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset), 'Content-Length': String(bytes), 'Tus-Resumable': '1.0.0' },
	});
	const head = (id: string) => request(`/api/videos/tus/${id}`, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } });
	const del = (id: string) => request(`/api/videos/tus/${id}`, { method: 'DELETE', headers: { 'Tus-Resumable': '1.0.0' } });
	return { post, patch, head, del };
}

describe('R2-only upload through our own TUS target', () => {
	it('upload → original kept → transcode queued, and Bunny never hears of it', async () => {
		const e = env();
		const t = await r2Upload(e);
		const created = await t.post();
		assert.equal(created.status, 201, await created.clone().text());
		const uploadId = created.headers.get('Location')!.split('/').pop()!;

		assert.equal((await t.patch(uploadId, 0)).status, 204);
		// A retried or skipped chunk: 409 with where the stored bytes end
		const skipped = await t.patch(uploadId, 2 * CHUNK);
		assert.equal(skipped.status, 409);
		assert.equal(skipped.headers.get('Upload-Offset'), String(CHUNK));
		const head = await t.head(uploadId);
		assert.equal(head.headers.get('Upload-Offset'), String(CHUNK));
		assert.equal((await t.patch(uploadId, CHUNK)).status, 204);
		assert.equal((await t.patch(uploadId, 2 * CHUNK)).status, 204);

		assert.ok(e.MEDIA_ORIGINALS.store.has(originalManifestKey(ID)), 'the original is complete');
		const jobs = e.TRANSCODE_QUEUE.messages as TranscodeJobMessage[];
		assert.equal(jobs.length, 1, 'one transcode');
		assert.equal(jobs[0].videoId, ID);
		const record = e.videos.read(ID);
		assert.equal(record.r2.status, 'queued');
		assert.deepEqual(bunnyCalls.filter((c) => c.includes('bunnycdn')), [], 'no Bunny request');
		assert.equal(e.PROCESSING_CHECK_QUEUE.messages.length, 0, 'Bunny is not polled for it');

		// The finished bytes are the only copy: no more writes, no delete
		assert.equal((await t.patch(uploadId, 0)).status, 409);
		assert.equal((await t.del(uploadId)).status, 409);
		assert.ok(e.MEDIA_ORIGINALS.store.has(originalManifestKey(ID)));
	});

	it('refuses an upload without its size, larger than announced, or past its length', async () => {
		const e = env();
		const t = await r2Upload(e);
		assert.equal((await t.post(SIZE + 1)).status, 400, 'not the file announced at initiate');
		const created = await t.post();
		const uploadId = created.headers.get('Location')!.split('/').pop()!;
		assert.equal((await t.patch(uploadId, 0, SIZE + CHUNK)).status, 400);
	});

	it('a client giving up deletes its partial bytes; the reaper reads the offset from the bucket', async () => {
		const e = env();
		const t = await r2Upload(e);
		const created = await t.post();
		const uploadId = created.headers.get('Location')!.split('/').pop()!;
		await t.patch(uploadId, 0);
		const record = e.videos.read(ID);
		assert.equal(await fetchTusOffset(e as never, record), CHUNK);
		assert.equal(await r2UploadOffset(e as never, ID, record.tusUpload.sessionId), CHUNK);
		assert.equal((await t.del(uploadId)).status, 204);
		assert.equal(await r2UploadOffset(e as never, ID, record.tusUpload.sessionId), 0);
	});

	it('the transcode turns it ready and published on the Cloudflare stack, with its own frame', async () => {
		const e = env();
		const t = await r2Upload(e);
		const created = await t.post();
		const uploadId = created.headers.get('Location')!.split('/').pop()!;
		for (let at = 0; at < SIZE; at += CHUNK) await t.patch(uploadId, at);
		const job = (e.TRANSCODE_QUEUE.messages as TranscodeJobMessage[])[0];
		await applyJobEvent(e as never, undefined, { videoId: ID, jobId: job.jobId, type: 'started', at: '2026-11-14T10:00:00.000Z', attempt: 1 });
		await applyJobEvent(e as never, undefined, { videoId: ID, jobId: job.jobId, type: 'ready', at: '2026-11-14T10:01:00.000Z', attempt: 1, result: RESULT, containerSeconds: 30 } as never);
		const v = e.videos.read(ID);
		assert.equal(v.uploadStatus, 'ready');
		assert.ok(v.playableAt);
		assert.equal(v.duration, 42);
		assert.equal(v.width, 1280);
		assert.equal(v.height, 720);
		assert.equal(v.media.providers.r2.status, 'ready');
		assert.equal(v.thumbnailType, 'auto');
		assert.equal(v.thumbnailUrl, `https://${MEDIA_HOST}/${job.access}/${ID}/${job.rev}/thumb.jpg`.replace(`/priv/`, '/priv/-/'));
		assert.equal(v.playUrl, undefined, 'no Bunny playlist on the record');
	});

	it('a failed final transcode fails the R2-only video and flags it', async () => {
		const e = env();
		const t = await r2Upload(e);
		const created = await t.post();
		const uploadId = created.headers.get('Location')!.split('/').pop()!;
		for (let at = 0; at < SIZE; at += CHUNK) await t.patch(uploadId, at);
		const job = (e.TRANSCODE_QUEUE.messages as TranscodeJobMessage[])[0];
		await applyJobEvent(e as never, undefined, { videoId: ID, jobId: job.jobId, type: 'failed', at: '2026-11-14T10:01:00.000Z', attempt: 3, final: true, error: 'ffmpeg exited 1' } as never);
		const v = e.videos.read(ID);
		assert.equal(v.uploadStatus, 'failed');
		assert.equal(v.processingIssue?.kind, 'encode_failed');
	});

	it('a placeholder without a Bunny copy is reused on a retry without asking Bunny', async () => {
		const e = env();
		await e.videos.put(ID, JSON.stringify(videoFixture({ id: ID, userId: 'alice', channelId: 'ch', uploadStatus: 'uploading', media: initialMedia(['r2'], { videoId: ID }) })));
		assert.deepEqual(await checkReusable(e as never, ID, { ownerId: 'alice', channelId: 'ch' }), { kind: 'reuse' });
		assert.deepEqual(bunnyCalls, []);
	});

	it('a Bunny upload of a new video signs its TUS requests with the GUID, not our id', async () => {
		const e = env();
		await e.videos.put(ID, JSON.stringify(videoFixture({ id: ID, userId: 'alice', channelId: 'ch', uploadStatus: 'uploading', fileSize: SIZE, media: initialMedia(['bunny'], { videoId: ID, bunnyGuid: GUID, bunnyLibraryId: 123 }) })));
		e.TUS_SESSIONS.data.set('tus:session:s1', JSON.stringify({ videoId: ID, userId: 'alice', channelId: 'ch', tusEndpoint: 'https://video.bunnycdn.com/tusupload', tusHeaders: {}, expiresAt: '2099-01-01T00:00:00.000Z' }));
		const headers: Record<string, string>[] = [];
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			headers.push(init?.headers as Record<string, string>);
			return new Response(null, { status: 201, headers: { Location: '/tusupload/b1' } });
		}) as typeof fetch;
		const app = new Hono();
		app.use('*', async (c, next) => {
			c.set('userId' as never, 'alice' as never);
			c.set('auth' as never, { userId: 'alice' } as never);
			await next();
		});
		app.route('/api/videos/tus', createTusRouter());
		const res = await app.request('/api/videos/tus', { method: 'POST', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(SIZE), 'Upload-Metadata': `tusSessionId ${btoa('s1')}` } }, e);
		assert.equal(res.status, 201, await res.clone().text());
		assert.equal(headers[0].VideoId, GUID);
		assert.equal(headers[0].LibraryId, '123');
	});
});

describe('signing, thumbnails, originals', () => {
	it('a new video\'s Bunny URLs are signed only through its own GUID → id mapping', async () => {
		const body = JSON.stringify({ items: [
			{ id: ID, playUrl: `https://${BUNNY_HOST}/${GUID}/playlist.m3u8`, thumbnailUrl: `https://${BUNNY_HOST}/${GUID}/thumbnail.jpg` },
			// Another record claiming the same GUID gets nothing
			{ id: OTHER, playUrl: `https://${BUNNY_HOST}/${GUID}/playlist.m3u8` },
		] });
		const resolve = async (guid: string) => (guid === GUID ? ID : null);
		const out = JSON.parse(await signBunnyUrlsInText(body, BUNNY_HOST, 'token-key', 1_800_000_000, resolve));
		assert.match(out.items[0].playUrl, /bcdn_token=/);
		assert.match(out.items[0].thumbnailUrl, /\?token=/);
		assert.equal(out.items[1].playUrl, `https://${BUNNY_HOST}/${GUID}/playlist.m3u8`, 'not signed for another record');
		// Without the resolver (old behaviour) a GUID that is not the id stays unsigned
		assert.equal(await signBunnyUrlsInText(body, BUNNY_HOST, 'token-key', 1_800_000_000), body);
	});

	it('a stored private R2 frame is signed per response for its own video only', async () => {
		const frame = `https://${MEDIA_HOST}/priv/-/${ID}/abcdefgh12345678/thumb.jpg`;
		const body = JSON.stringify({ videos: [{ id: ID, thumbnailUrl: frame }, { id: OTHER, thumbnailUrl: frame }] });
		const out = JSON.parse(await signMediaFramesInText(body, MEDIA_HOST, 'sign-key', 1_800_000_000));
		const expires = Math.ceil((1_800_000_000 + 6 * 3600) / 3600) * 3600;
		// A file token: the frame alone, never the playlist (apps/media/src/edge.ts)
		const token = await mediaFileToken('sign-key', ID, 'abcdefgh12345678', 'thumb.jpg', expires);
		assert.equal(out.videos[0].thumbnailUrl, `https://${MEDIA_HOST}/priv/${token}/${ID}/abcdefgh12345678/thumb.jpg`);
		assert.ok(!(await verifyMediaToken('sign-key', token, ID, 'abcdefgh12345678', 1_800_000_000)), 'not a folder token');
		assert.equal(out.videos[1].thumbnailUrl, frame, 'never for another video');
		assert.ok(isR2FrameOf(frame, ID, MEDIA_HOST));
		assert.ok(!isR2FrameOf(frame, OTHER, MEDIA_HOST));
	});

	it('custom thumbnails go where the settings store them; the purge removes R2 copies', async () => {
		const e = env();
		await saveMediaSettings(e as never, R2_ONLY, 'admin-1');
		const stored = await storeCustomThumbnail(e as never, ID, new Uint8Array([0xff, 0xd8, 0xff]).buffer, { type: 'image/jpeg', extension: 'jpg' });
		assert.equal(stored.store, 'r2');
		assert.ok(stored.thumbnailUrl.startsWith(`https://${MEDIA_HOST}/${r2ThumbnailPrefix(ID)}`));
		assert.ok(isR2ThumbnailOf(stored.thumbnailUrl, ID, MEDIA_HOST));
		assert.equal(stored.thumbnailSizes.hd, stored.thumbnailUrl);
		assert.equal([...e.MEDIA.store.keys()].filter((k) => k.startsWith(r2ThumbnailPrefix(ID))).length, 1);
		await purgeVideoMedia(e as never, ID);
		assert.equal([...e.MEDIA.store.keys()].filter((k) => k.startsWith(r2ThumbnailPrefix(ID))).length, 0);
	});

	it('retention never deletes the original of a video R2 alone holds', async () => {
		const e = env();
		const old = '2026-01-01T00:00:00.000Z';
		for (const [id, media] of [[ID, initialMedia(['r2'], { videoId: ID })], [OTHER, undefined]] as const) {
			await e.videos.put(id, JSON.stringify({ id, ...(media ? { media } : {}) }));
			await e.MEDIA_ORIGINALS.put(originalManifestKey(id), '{}');
			await e.SEARCH_DB.prepare('INSERT INTO media_originals (video_id, upload_id, bytes, parts, completed_at) VALUES (?1, ?2, 10, 1, ?3)').bind(id, 'u', old).run();
		}
		assert.deepEqual(await sweepOriginals(e as never, Date.parse('2026-11-14T00:00:00Z')), { deleted: 1 });
		assert.ok(e.MEDIA_ORIGINALS.store.has(originalManifestKey(ID)), 'the sole copy\'s master stays');
		assert.ok(!e.MEDIA_ORIGINALS.store.has(originalManifestKey(OTHER)), 'a legacy (Bunny) original past the ceiling goes');
		const row = await e.SEARCH_DB.prepare('SELECT keep FROM media_originals WHERE video_id = ?1').bind(ID).first<{ keep: string }>();
		assert.equal(row?.keep, 'sole_copy');
		// Marked: the next run does not read it again
		assert.deepEqual(await sweepOriginals(e as never, Date.parse('2026-11-15T00:00:00Z')), { deleted: 0 });
	});

	it('the transcode of a video that names R2 runs even when global ingest leaves R2 out', async () => {
		const e = env();
		await saveMediaSettings(e as never, { ...DEFAULT_MEDIA_SETTINGS, ingest: ['bunny'] }, 'admin-1');
		await e.videos.put(ID, JSON.stringify(videoFixture({ id: ID, uploadStatus: 'processing', media: initialMedia(['r2'], { videoId: ID }) })));
		assert.equal((await enqueueTranscode(e as never, ID, 'upload')).queued, true);
	});

	it('the Short/format check reads Bunny under the GUID, and an R2-only video from its transcode', async () => {
		const bunnyVideo = { id: ID, playUrl: `https://${BUNNY_HOST}/${GUID}/playlist.m3u8`, media: initialMedia(['bunny'], { videoId: ID, bunnyGuid: GUID }) };
		assert.deepEqual(playlistLocation({ bunny_hostname: BUNNY_HOST }, bunnyVideo), { host: BUNNY_HOST, id: GUID });
		assert.deepEqual(playlistLocation({ bunny_hostname: BUNNY_HOST }, { id: OTHER }), { host: BUNNY_HOST, id: OTHER }, 'legacy: the id is the GUID');
		const r2Only = { id: ID, width: 720, height: 1280, duration: 30, media: initialMedia(['r2'], { videoId: ID }) };
		assert.equal(playlistLocation({ bunny_hostname: BUNNY_HOST }, r2Only), null);
		assert.deepEqual(await readEncodedSize(env() as never, r2Only), { width: 720, height: 1280, duration: 30, source: 'transcode' });
		assert.deepEqual(bunnyCalls, [], 'Bunny is not asked about a video it does not hold');
	});
});
