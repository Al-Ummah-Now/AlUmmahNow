/**
 * CSAM response, platform side (docs/specs/CSAM-RESPONSE.md).
 *
 * Synthetic placeholders only: every "file" here is a short ASCII string or zero-filled bytes, and
 * no test uses a real hash, image or hash list.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import {
	CSAM_HOLD,
	CSAM_RETENTION_MIN_DAYS,
	csamRetainUntil,
	extractCsamUrls,
	originalManifestKey,
	originalPartKey,
	parseCsamUrl,
	unwrapImageUrl,
	validCsamRetentionDays,
} from '@al-ummah/shared-types';
import csamRouter from '../src/routers/csam.router';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { CHUNK_BYTES, EvidenceKeyError, openChunk, parseEvidenceKeys, sealChunk } from '../src/lib/csam/crypto';
import { resolveCsamUrl } from '../src/lib/csam/resolve';
import { backfillImageOwnersStep, lookupImageOwner, recordImageOwner } from '../src/lib/csam/imageOwners';
import { MemoryBucket, MemoryQueue, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const PLACEHOLDER = 'SYNTHETIC-PLACEHOLDER-NOT-AN-IMAGE';
const KEY_V1 = `1:${Buffer.alloc(32, 1).toString('base64')}`;
const KEY_V2 = `2:${Buffer.alloc(32, 2).toString('base64')}`;
const CASE = 'case-0001-synthetic';
const OWNER = 'usr_uploader';
const enc = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// A binary R2 stand-in with ranges and multipart uploads
// ---------------------------------------------------------------------------

class BinaryBucket {
	store = new Map<string, { bytes: Uint8Array; meta?: Record<string, string> }>();
	uploads = new Map<string, { key: string; parts: Map<number, Uint8Array>; meta?: Record<string, string> }>();
	private n = 0;
	set(key: string, value: string | Uint8Array) {
		this.store.set(key, { bytes: typeof value === 'string' ? enc(value) : value });
	}
	text(key: string) {
		const v = this.store.get(key);
		return v ? new TextDecoder().decode(v.bytes) : null;
	}
	async head(key: string) {
		const v = this.store.get(key);
		return v ? { key, size: v.bytes.byteLength, customMetadata: v.meta } : null;
	}
	async get(key: string, opts?: { range?: { offset: number; length: number } }) {
		const v = this.store.get(key);
		if (!v) return null;
		const bytes = opts?.range ? v.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length) : v.bytes;
		return {
			key,
			size: v.bytes.byteLength,
			customMetadata: v.meta,
			arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
			json: async () => JSON.parse(new TextDecoder().decode(bytes)),
			text: async () => new TextDecoder().decode(bytes),
		};
	}
	async put(key: string, value: Uint8Array | string, opts?: { customMetadata?: Record<string, string> }) {
		this.store.set(key, { bytes: typeof value === 'string' ? enc(value) : new Uint8Array(value), meta: opts?.customMetadata });
		return { key };
	}
	async delete(keys: string | string[]) {
		for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
	}
	async list(o: { prefix?: string; cursor?: string; limit?: number } = {}) {
		const objects = [...this.store.entries()].filter(([k]) => !o.prefix || k.startsWith(o.prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ key, size: v.bytes.byteLength }));
		return { objects, truncated: false };
	}
	private upload(key: string, uploadId: string) {
		return {
			uploadId,
			uploadPart: async (partNumber: number, value: Uint8Array) => {
				this.uploads.get(uploadId)!.parts.set(partNumber, new Uint8Array(value));
				return { partNumber, etag: `e${partNumber}` };
			},
			complete: async (parts: Array<{ partNumber: number }>) => {
				const u = this.uploads.get(uploadId)!;
				const chunks = parts.map((p) => u.parts.get(p.partNumber)!);
				const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
				let at = 0;
				for (const c of chunks) {
					out.set(c, at);
					at += c.byteLength;
				}
				this.store.set(key, { bytes: out, meta: u.meta });
				this.uploads.delete(uploadId);
				return { key };
			},
			abort: async () => {
				this.uploads.delete(uploadId);
			},
		};
	}
	async createMultipartUpload(key: string, opts?: { customMetadata?: Record<string, string> }) {
		const id = `up${++this.n}`;
		this.uploads.set(id, { key, parts: new Map(), meta: opts?.customMetadata });
		return this.upload(key, id);
	}
	resumeMultipartUpload(key: string, uploadId: string) {
		return this.upload(key, uploadId);
	}
}

/** The admin-jobs queue and consumer (retried messages come back with attempts + 1). */
class JobsQueue {
	pending: { body: unknown; attempts: number }[] = [];
	dlq: unknown[] = [];
	async send(body: unknown) {
		this.pending.push({ body, attempts: 1 });
	}
	async drain(env: unknown) {
		for (let guard = 0; this.pending.length && guard < 400; guard++) {
			const d = this.pending.shift()!;
			let retried = false;
			const msg: JobMessage = { body: d.body, attempts: d.attempts, ack: () => undefined, retry: () => { retried = true; } };
			await handleAdminJobBatch({ messages: [msg] }, env as never, ADMIN_JOB_HANDLERS);
			if (!retried) continue;
			if (d.attempts > 5) this.dlq.push(d.body);
			else this.pending.push({ ...d, attempts: d.attempts + 1 });
		}
	}
}

// ---------------------------------------------------------------------------
// fetch: Bunny Storage (images), Bunny Stream, Cloudflare purge, error ingest
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
let images: Map<string, Uint8Array>;
let calls: string[];
let failCdn = false;

function stubFetch() {
	images = new Map();
	calls = [];
	failCdn = false;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		calls.push(`${method} ${url}${init?.body && typeof init.body === 'string' ? ` ${init.body}` : ''}`);
		const storage = /^https:\/\/storage\.bunnycdn\.com\/zone(\/.*)$/.exec(url);
		if (storage) {
			const path = decodeURIComponent(storage[1]!);
			if (method === 'DELETE') return new Response(null, { status: images.delete(path) ? 200 : 404 });
			const bytes = images.get(path);
			if (!bytes) return new Response(null, { status: 404 });
			const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get('Range') ?? '');
			const [from, to] = range ? [Number(range[1]), Math.min(Number(range[2]), bytes.byteLength - 1)] : [0, bytes.byteLength - 1];
			return new Response(bytes.slice(from, to + 1), { status: 206, headers: { 'content-range': `bytes ${from}-${to}/${bytes.byteLength}` } });
		}
		if (url.includes('/purge_cache')) return new Response(JSON.stringify({ success: !failCdn }), { status: failCdn ? 500 : 200 });
		if (url.startsWith('https://video.bunnycdn.com/')) return new Response('{}', { status: 200 });
		return new Response('{}', { status: 200 });
	}) as typeof fetch;
}

// ---------------------------------------------------------------------------
// The env
// ---------------------------------------------------------------------------

function setup(opts: { key?: string | null } = {}) {
	const db = new SqliteD1();
	const env = {
		SEARCH_DB: db,
		videos: new MemoryBucket({
			'vid-synth-01': videoFixture({ id: 'vid-synth-01', userId: OWNER, channelId: 'chan-synth-01', isPublic: true, thumbnailUrl: 'https://images.alummahnow.net/thumbnails/vid-synth-01/custom.jpg', r2: { status: 'ready', access: 'pub', rev: 'r1' } }),
		}),
		profiles: new MemoryBucket({ [OWNER]: { id: OWNER, userName: 'synthetic', avatarUrl: 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg' } }),
		channels: new MemoryBucket({ 'chan-synth-01': { id: 'chan-synth-01', userId: OWNER, name: 'Synthetic channel', coverUrl: 'https://images.alummahnow.net/cover-placeholder_cover.png' } }),
		community_posts: new MemoryBucket({
			'posts/chan-synth-01/post-synth-01.json': { id: 'post-synth-01', userId: OWNER, channelId: 'chan-synth-01', status: 'published', content: 'synthetic', images: [{ url: 'https://images.alummahnow.net/community-posts/chan-synth-01/a.jpg' }, { url: 'https://images.alummahnow.net/community-posts/chan-synth-01/b.jpg' }] },
			'posts/chan-synth-01/index.json': { postIds: ['post-synth-01'] },
		}),
		playlists: new MemoryBucket(),
		watch_history: new MemoryBucket(),
		reports: new MemoryBucket(),
		queue: new MemoryQueue(),
		ADMIN_JOBS_QUEUE: new JobsQueue(),
		PROCESSING_CHECK_QUEUE: new MemoryQueue(),
		MEDIA: new BinaryBucket(),
		MEDIA_PRIVATE: new BinaryBucket(),
		MEDIA_ORIGINALS: new BinaryBucket(),
		CSAM_EVIDENCE: new BinaryBucket(),
		...(opts.key === null ? {} : { CSAM_EVIDENCE_KEY: opts.key ?? KEY_V1 }),
		MEDIA_PUBLIC_HOST: 'media.alummahnow.net',
		MEDIA_CDN_API_TOKEN: 'synthetic-token',
		image_storage_key: 'synthetic-storage-key',
		ZONE: 'zone',
		'bunny-stream-key': 'synthetic-stream-key',
		bunny_stream_library_id: '7',
	};
	env.MEDIA.set('pub/vid-synth-01/r1/thumb.jpg', `${PLACEHOLDER}-thumb`);
	env.MEDIA.set('pub/vid-synth-01/r1/master.m3u8', '#EXTM3U synthetic');
	images.set('/thumbnails/vid-synth-01/custom.jpg', enc(`${PLACEHOLDER}-custom`));
	images.set('/community-posts/chan-synth-01/a.jpg', enc(`${PLACEHOLDER}-a`));
	images.set('/community-posts/chan-synth-01/b.jpg', enc(`${PLACEHOLDER}-b`));
	images.set('/avatar-placeholder_avatar.jpeg', enc(`${PLACEHOLDER}-avatar`));
	const app = new Hono();
	app.route('/internal/csam', csamRouter);
	const call = async (method: string, path: string, body?: unknown) => {
		const res = await app.request(`/internal/csam${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': 'usr_super' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
		return res;
	};
	const json = async (method: string, path: string, body?: unknown) => {
		const res = await call(method, path, body);
		return { status: res.status, body: (await res.json()) as any };
	};
	return { env, db, call, json, drain: () => env.ADMIN_JOBS_QUEUE.drain(env) };
}

/** A 20 MiB synthetic original (zero bytes plus a marker), as TUS PATCH parts. */
function seedOriginal(env: ReturnType<typeof setup>['env']) {
	const size = 2 * CHUNK_BYTES + 4096;
	const first = new Uint8Array(CHUNK_BYTES + 100);
	first.set(enc(PLACEHOLDER), 0);
	const second = new Uint8Array(size - first.byteLength);
	second.set(enc('END'), second.byteLength - 3);
	env.MEDIA_ORIGINALS.set(originalPartKey('vid-synth-01', 'u1', 0), first);
	env.MEDIA_ORIGINALS.set(originalPartKey('vid-synth-01', 'u1', first.byteLength), second);
	env.MEDIA_ORIGINALS.set(originalManifestKey('vid-synth-01'), JSON.stringify({ uploadId: 'u1', size, parts: 2, completedAt: '2026-11-01T00:00:00Z' }));
	return size;
}

beforeEach(stubFetch);
afterEach(() => {
	globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

describe('CSAM URLs (shared-types)', () => {
	it('names our items from the URLs Cloudflare lists', () => {
		assert.deepEqual(parseCsamUrl('https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg'), { kind: 'video_thumbnail', videoId: 'vid-synth-01' });
		assert.deepEqual(parseCsamUrl('media.qa.alummahnow.net/priv/tok123/vid-synth-01/r1/720p/seg-1.ts'), { kind: 'video', videoId: 'vid-synth-01', file: '720p/seg-1.ts' });
		assert.deepEqual(parseCsamUrl('images.alummahnow.net/thumbnails/vid-synth-01/x.jpg'), { kind: 'video_thumbnail', videoId: 'vid-synth-01' });
		assert.deepEqual(parseCsamUrl('https://images.alummahnow.org/community-posts/chan-synth-01/a.jpg'), { kind: 'post_image', channelId: 'chan-synth-01', path: '/community-posts/chan-synth-01/a.jpg' });
		assert.deepEqual(parseCsamUrl('https://images.alummahnow.net/abc_avatar.jpeg'), { kind: 'image', path: '/abc_avatar.jpeg' });
		assert.deepEqual(parseCsamUrl('https://alummahnow.net/ar/video/vid-synth-01'), { kind: 'page', page: 'video', id: 'vid-synth-01' });
		assert.deepEqual(parseCsamUrl('https://www.alummahnow.net/channels/chan-synth-01?post=post-synth-01'), { kind: 'page', page: 'post', id: 'chan-synth-01', postId: 'post-synth-01' });
		assert.deepEqual(parseCsamUrl('https://vz-abc123.b-cdn.net/vid-synth-01/thumbnail.jpg'), { kind: 'video_thumbnail', videoId: 'vid-synth-01' });
	});

	it('unwraps optimizer URLs and refuses foreign hosts and traversal', () => {
		const wrapped = 'https://alummahnow.net/_next/image?url=https%3A%2F%2Fimages.alummahnow.net%2Fcommunity-posts%2Fchan-synth-01%2Fa.jpg&w=640&q=75';
		assert.deepEqual(parseCsamUrl(wrapped), { kind: 'post_image', channelId: 'chan-synth-01', path: '/community-posts/chan-synth-01/a.jpg' });
		assert.equal(unwrapImageUrl(new URL('https://alummahnow.net/cdn-cgi/image/width=320/https://images.alummahnow.net/x.jpg')).hostname, 'images.alummahnow.net');
		assert.equal(parseCsamUrl('https://example.com/pub/vid-synth-01/r1/thumb.jpg'), null);
		assert.equal(parseCsamUrl('https://alummahnow.net.example.com/video/vid-synth-01'), null);
		assert.equal(parseCsamUrl('https://images.alummahnow.net/a/..%2Fsecret'), null);
		assert.equal(parseCsamUrl('https://images.alummahnow.net/a/%5C..%5Csecret'), null);
	});

	it('pulls every URL out of a pasted alert', () => {
		const text = `Synthetic alert\n- images.alummahnow.net/community-posts/chan-synth-01/a.jpg\n- https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg.\n- https://example.com/other.jpg`;
		assert.deepEqual(extractCsamUrls(text), ['images.alummahnow.net/community-posts/chan-synth-01/a.jpg', 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg']);
	});

	it('finds URLs after other text in a token, and stays fast on long runs of - and ,', () => {
		assert.deepEqual(extractCsamUrls('URL:https://alummahnow.net/video/vid-synth-01, (images.alummahnow.org/x/y.jpg).'), ['https://alummahnow.net/video/vid-synth-01', 'images.alummahnow.org/x/y.jpg']);
		const started = Date.now();
		assert.deepEqual(extractCsamUrls('-'.repeat(200_000) + ','.repeat(200_000) + 'x'), []);
		assert.deepEqual(extractCsamUrls(`alummahnow.net/a${','.repeat(200_000)}x`), [`alummahnow.net/a${','.repeat(200_000)}x`]);
		assert.ok(Date.now() - started < 1000);
	});

	it('keeps evidence a year after the report at least, forever under a hold, and never before a report', () => {
		assert.equal(csamRetainUntil({ reportedAt: null, legalHold: false }, 365), null);
		assert.equal(csamRetainUntil({ reportedAt: '2026-01-01T00:00:00.000Z', legalHold: true }, 365), null);
		assert.equal(csamRetainUntil({ reportedAt: '2026-01-01T00:00:00.000Z', legalHold: false }, 90), '2027-01-01T00:00:00.000Z');
		assert.equal(validCsamRetentionDays(CSAM_RETENTION_MIN_DAYS - 1), false);
		assert.equal(validCsamRetentionDays(730), true);
		assert.equal(validCsamRetentionDays(400.5), false);
	});
});

describe('evidence encryption', () => {
	it('round-trips and binds each chunk to its case, file and position', async () => {
		const keys = await parseEvidenceKeys(KEY_V1);
		const sealed = await sealChunk(keys.current.key, enc(PLACEHOLDER), { caseId: CASE, name: 'f', index: 0 });
		assert.notEqual(new TextDecoder().decode(sealed).includes(PLACEHOLDER), true);
		assert.equal(new TextDecoder().decode(await openChunk(keys.current.key, sealed, { caseId: CASE, name: 'f', index: 0 })), PLACEHOLDER);
		await assert.rejects(openChunk(keys.current.key, sealed, { caseId: CASE, name: 'f', index: 1 }));
		await assert.rejects(openChunk(keys.current.key, sealed, { caseId: 'case-other-0001', name: 'f', index: 0 }));
	});

	it('uses the newest key and still opens older ones; refuses missing or short keys', async () => {
		const keys = await parseEvidenceKeys(`${KEY_V1},${KEY_V2}`);
		assert.equal(keys.current.version, 2);
		const old = await parseEvidenceKeys(KEY_V1);
		const sealed = await sealChunk(old.current.key, enc('x'), { caseId: CASE, name: 'f', index: 0 });
		assert.equal(new TextDecoder().decode(await openChunk(keys.byVersion.get(1)!, sealed, { caseId: CASE, name: 'f', index: 0 })), 'x');
		await assert.rejects(parseEvidenceKeys(''), EvidenceKeyError);
		await assert.rejects(parseEvidenceKeys(`1:${Buffer.alloc(16).toString('base64')}`), EvidenceKeyError);
	});
});

describe('mapping a matched URL', () => {
	it('finds the video, the post and an avatar (image_owners), and says when it cannot', async () => {
		const { env, db } = setup();
		assert.deepEqual(await resolveCsamUrl(env as never, 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg'), { ok: true, resolution: { kind: 'video_thumbnail', videoId: 'vid-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } });
		const post = await resolveCsamUrl(env as never, 'images.alummahnow.net/community-posts/chan-synth-01/b.jpg');
		assert.deepEqual(post, { ok: true, resolution: { kind: 'post_image', channelId: 'chan-synth-01', imagePath: '/community-posts/chan-synth-01/b.jpg', postId: 'post-synth-01', uploaderId: OWNER } });
		assert.deepEqual(await resolveCsamUrl(env as never, 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg'), { ok: false, reason: 'not_found', target: { kind: 'image', path: '/avatar-placeholder_avatar.jpeg' } });
		await recordImageOwner(db as never, 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg', { kind: 'profile_avatar', ownerId: OWNER });
		const avatar = await resolveCsamUrl(env as never, 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg');
		assert.deepEqual(avatar, { ok: true, resolution: { kind: 'profile_image', imagePath: '/avatar-placeholder_avatar.jpeg', imageField: 'avatarUrl', channelId: null, uploaderId: OWNER } });
		assert.deepEqual(await resolveCsamUrl(env as never, 'https://example.com/x.jpg'), { ok: false, reason: 'not_ours' });
	});

	it('the backfill indexes stored avatars, covers and post images', async () => {
		const { env, db } = setup();
		let params: Record<string, unknown> = {};
		for (let i = 0; i < 10; i++) {
			const out = await backfillImageOwnersStep(env as never, params as never);
			if (out.done) break;
			params = out.params;
		}
		assert.equal((await lookupImageOwner(db as never, '/avatar-placeholder_avatar.jpeg'))?.ownerId, OWNER);
		assert.equal((await lookupImageOwner(db as never, '/cover-placeholder_cover.png'))?.kind, 'channel_cover');
		assert.equal((await lookupImageOwner(db as never, '/community-posts/chan-synth-01/a.jpg'))?.channelId, 'chan-synth-01');
	});
});

describe('taking a video down', () => {
	it('hides at once, keeps encrypted evidence, then purges every copy and bans the uploader', async () => {
		const t = setup();
		const size = seedOriginal(t.env);
		const resolved = await t.json('POST', '/resolve', { url: 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg' });
		assert.equal(resolved.body.result.ok, true);

		const started = await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg', resolution: resolved.body.result.resolution });
		assert.equal(started.status, 200);
		// Hidden at once: the hold is on before any job runs, and the matched URL was purged
		const hidden = t.env.videos.read('vid-synth-01');
		assert.ok(hidden.suspensionHolds.includes(CSAM_HOLD));
		assert.equal(hidden.isHidden, true);
		assert.ok(calls.some((c) => c.includes('/purge_cache') && c.includes('pub/vid-synth-01/r1/thumb.jpg')));
		// A second call for the case does not start a second takedown
		assert.equal((await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution: resolved.body.result.resolution })).body.result.existing, true);

		await t.drain();
		const job = (await t.json('GET', `/cases/${CASE}/job`)).body.result.job;
		assert.equal(job.status, 'succeeded', job.lastError);
		assert.equal(job.result.ban, 'banned');

		// Evidence: the matched file, the custom thumbnail, the original and the record snapshots
		const manifest = (await t.json('GET', `/cases/${CASE}/manifest`)).body.result;
		const names = manifest.files.map((f: { name: string }) => f.name).sort();
		assert.deepEqual(names, ['01-matched.jpg', '02-video-original', '04-custom-thumbnail.jpg', 'record-channel.json', 'record-uploader-profile.json', 'record-video.json']);
		assert.ok(manifest.completedAt);
		const original = manifest.files.find((f: { name: string }) => f.name === '02-video-original');
		assert.equal(original.bytes, size);
		assert.equal(original.chunkSha256.length, 3);
		// Nothing in the store is readable without the key
		for (const [, v] of t.env.CSAM_EVIDENCE.store) assert.equal(new TextDecoder().decode(v.bytes).includes(PLACEHOLDER), false);

		// Downloads decrypt, check every chunk and come as an opaque attachment
		const matched = await t.call('GET', `/cases/${CASE}/files/01-matched.jpg`);
		assert.equal(matched.headers.get('content-type'), 'application/octet-stream');
		assert.match(matched.headers.get('content-disposition') ?? '', /^attachment;/);
		assert.equal(matched.headers.get('cache-control'), 'no-store, private');
		assert.equal(await matched.text(), `${PLACEHOLDER}-thumb`);
		const big = new Uint8Array(await (await t.call('GET', `/cases/${CASE}/files/02-video-original`)).arrayBuffer());
		assert.equal(big.byteLength, size);
		assert.equal(new TextDecoder().decode(big.subarray(0, PLACEHOLDER.length)), PLACEHOLDER);
		assert.equal(new TextDecoder().decode(big.subarray(size - 3)), 'END');

		// Purged everywhere: record, renditions, original, custom thumbnail, Bunny Stream
		assert.equal(t.env.videos.read('vid-synth-01'), null);
		assert.equal(t.env.MEDIA.store.size, 0);
		assert.equal([...t.env.MEDIA_ORIGINALS.store.keys()].length, 0);
		assert.equal(images.has('/thumbnails/vid-synth-01/custom.jpg'), false);
		assert.ok(calls.some((c) => c.startsWith('DELETE https://video.bunnycdn.com/library/7/videos/vid-synth-01')));
		assert.ok(calls.some((c) => c.includes('/purge_cache') && c.includes('"prefixes"') && c.includes('pub/vid-synth-01/')));
		// Banned on videos
		const ban = await t.db.prepare('SELECT user_id FROM videos_bans WHERE user_id = ?').bind(OWNER).first();
		assert.ok(ban);
	});

	it('a tampered evidence chunk fails its check instead of streaming', async () => {
		const t = setup();
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg', resolution: { kind: 'video_thumbnail', videoId: 'vid-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } });
		await t.drain();
		const key = `cases/${CASE}/01-matched.jpg.bin`;
		const stored = t.env.CSAM_EVIDENCE.store.get(key)!;
		stored.bytes[20] ^= 0xff;
		const res = await t.call('GET', `/cases/${CASE}/files/01-matched.jpg`);
		await assert.rejects(res.text());
	});

	it('without the evidence key the item is still hidden, and the takedown waits (flags the admin) instead of purging', async () => {
		const t = setup({ key: null });
		(t.env as Record<string, unknown>).ERRORS_INGEST_URL = 'https://admin.example.test/internal/errors';
		(t.env as Record<string, unknown>).INTERNAL_API_KEY = 'synthetic-internal';
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg', resolution: { kind: 'video_thumbnail', videoId: 'vid-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } });
		assert.ok(t.env.videos.read('vid-synth-01').suspensionHolds.includes(CSAM_HOLD));
		await t.drain();
		await new Promise((r) => setTimeout(r, 10));
		const job = (await t.json('GET', `/cases/${CASE}/job`)).body.result.job;
		assert.equal(job.status, 'failed');
		// Nothing was destroyed before the evidence was kept
		assert.ok(t.env.videos.read('vid-synth-01'));
		assert.ok(t.env.MEDIA.store.has('pub/vid-synth-01/r1/thumb.jpg'));
		const flag = calls.find((c) => c.startsWith('POST https://admin.example.test/internal/errors') && c.includes('csam-contain:case-0001-synthetic'));
		assert.ok(flag);
		// No Errors-page Retry: only the case page (super admins) retries a CSAM takedown
		assert.equal(flag.includes('"retry"'), false);
		assert.ok(flag.includes('/moderation/csam/case-0001-synthetic'));
		// Retry once the key is there finishes it
		(t.env as Record<string, unknown>).CSAM_EVIDENCE_KEY = KEY_V1;
		assert.equal((await t.json('POST', '/retry', { caseId: CASE })).body.result.retried, true);
		await t.drain();
		assert.equal((await t.json('GET', `/cases/${CASE}/job`)).body.result.job.status, 'succeeded');
		assert.equal(t.env.videos.read('vid-synth-01'), null);
	});
});

describe('taking images down', () => {
	it('a post image: the post leaves view at once, every image of it is kept then deleted', async () => {
		const t = setup();
		const resolved = (await t.json('POST', '/resolve', { url: 'https://images.alummahnow.net/community-posts/chan-synth-01/a.jpg' })).body.result;
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'https://images.alummahnow.net/community-posts/chan-synth-01/a.jpg', resolution: resolved.resolution });
		assert.equal(t.env.community_posts.read('posts/chan-synth-01/post-synth-01.json').status, 'deleted');
		assert.deepEqual(t.env.community_posts.read('posts/chan-synth-01/index.json').postIds, []);
		await t.drain();
		const names = (await t.json('GET', `/cases/${CASE}/manifest`)).body.result.files.map((f: { name: string }) => f.name).sort();
		assert.deepEqual(names, ['01-matched-image.jpg', '05-post-image-2.jpg', 'record-channel.json', 'record-post.json', 'record-uploader-profile.json']);
		assert.equal(images.size, 2); // the custom thumbnail and the avatar are untouched
		assert.equal(t.env.community_posts.read('posts/chan-synth-01/post-synth-01.json'), null);
		assert.equal(await (await t.call('GET', `/cases/${CASE}/files/05-post-image-2.jpg`)).text(), `${PLACEHOLDER}-b`);
	});

	it("a post naming another account's file never deletes that file", async () => {
		const t = setup();
		const post = t.env.community_posts.read('posts/chan-synth-01/post-synth-01.json');
		post.images.push({ url: 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg' }, { url: 'https://images.alummahnow.net/community-posts/other-channel-01/z.jpg' });
		t.env.community_posts.store.set('posts/chan-synth-01/post-synth-01.json', JSON.stringify(post));
		images.set('/community-posts/other-channel-01/z.jpg', enc(`${PLACEHOLDER}-z`));
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'https://images.alummahnow.net/community-posts/chan-synth-01/a.jpg', resolution: { kind: 'post_image', channelId: 'chan-synth-01', postId: 'post-synth-01', imagePath: '/community-posts/chan-synth-01/a.jpg', uploaderId: OWNER } });
		await t.drain();
		assert.equal(images.has('/avatar-placeholder_avatar.jpeg'), true);
		assert.equal(images.has('/community-posts/other-channel-01/z.jpg'), true);
		assert.equal(images.has('/community-posts/chan-synth-01/b.jpg'), false);
	});

	it('an avatar: the field is cleared at once (kept on the takedown mark), the file kept then deleted, its index row gone', async () => {
		const t = setup();
		await recordImageOwner(t.db as never, 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg', { kind: 'profile_avatar', ownerId: OWNER });
		const resolved = (await t.json('POST', '/resolve', { url: 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg' })).body.result;
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg', resolution: resolved.resolution });
		const profile = t.env.profiles.read(OWNER);
		assert.equal(profile.avatarUrl, null);
		assert.equal(profile.csamTakedown[0].removed.avatarUrl, 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg');
		await t.drain();
		assert.equal(images.has('/avatar-placeholder_avatar.jpeg'), false);
		assert.equal(await lookupImageOwner(t.db as never, '/avatar-placeholder_avatar.jpeg'), null);
		assert.equal(await (await t.call('GET', `/cases/${CASE}/files/01-matched-image.jpeg`)).text(), `${PLACEHOLDER}-avatar`);
	});
});

describe('requests', () => {
	it('refuses bad case ids, file names and resolutions', async () => {
		const t = setup();
		assert.equal((await t.call("GET", "/cases/../manifest")).status, 404);
		assert.equal((await t.json('GET', `/cases/${CASE}/files/..%2Fmanifest`)).status, 400);
		assert.equal((await t.json('POST', '/contain', { caseId: 'x', matchedUrl: 'u', resolution: { kind: 'video', videoId: 'vid-synth-01', uploaderId: OWNER } })).status, 400);
		assert.equal((await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'u', resolution: { kind: 'video', uploaderId: OWNER } })).body.code, 'invalid_resolution');
		assert.equal((await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'u', resolution: { kind: 'post_image', channelId: 'chan-synth-01', imagePath: '/../x', uploaderId: OWNER } })).status, 400);
	});
});

describe('erasure never reaches the evidence store', () => {
	it('no erasure, privacy or backfill module names the CSAM bucket', () => {
		const roots = ['privacy', 'search', 'thumbnail', 'media'].map((d) => join(__dirname, '..', 'src', 'lib', d));
		const files = roots.flatMap((dir) => readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f)));
		for (const file of files) assert.equal(/CSAM_EVIDENCE|csam-evidence|cases\//.test(readFileSync(file, 'utf8')), false, file);
	});
});
