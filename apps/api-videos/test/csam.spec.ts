/**
 * CSAM response, platform side (docs/specs/CSAM-RESPONSE.md).
 *
 * Synthetic placeholders only: every "file" here is a short ASCII string or zero-filled bytes, and
 * no test uses a real hash, image or hash list.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import {
	CSAM_HOLD,
	VIDEO_REVIEW_SETTINGS_KEY,
	clearVideoReviewSettingsCache,
	CSAM_RETENTION_MIN_DAYS,
	csamRetainUntil,
	csamUrlKey,
	csamUrlRefusal,
	scanCsamUrls,
	extractCsamUrls,
	originalManifestKey,
	originalPartKey,
	parseCsamUrl,
	unwrapImageUrl,
	validCsamRetentionDays,
} from '@al-ummah/shared-types';
import csamRouter from '../src/routers/csam.router';
import { handleAdminJobBatch, type JobMessage } from '../src/lib/admin/jobs';
import { purgeDeletion, purgeVideoForCsam, ADMIN_JOB_HANDLERS } from '../src/lib/admin/service';
import { runOwnershipPass } from '../src/lib/search/ownership';
import { CHUNK_BYTES, EvidenceKeyError, openChunk, parseEvidenceKeys, sealChunk } from '../src/lib/csam/crypto';
import { resolveCsamUrl } from '../src/lib/csam/resolve';
import { finalizeSelfHosted } from '../src/lib/live/finalize';
import { setOnVodReady } from '../src/lib/live/vod-ready';
import { startLiveVodReview } from '../src/lib/review/live';
import { deleteSessionMedia } from '../src/lib/csam/recordings';
import { STEP_READS, copyStep, type CopyState } from '../src/lib/csam/evidence';
import { backfillImageOwnersStep, lookupImageOwner, recordImageOwner } from '../src/lib/csam/imageOwners';
import { endParts, holdTargets, takePart, writeTarget } from '../src/lib/privacy/erase-targets';
import { createJob } from '../src/lib/admin/jobs';
import { ERASE_MEDIA_JOB, eraseMediaHooks } from '../src/lib/privacy/erase-media';
import { eraseUserData } from '../src/lib/privacy/user-data';
import { OperationBudget } from '../src/lib/privacy/scan';
import { MemoryBucket, MemoryQueue, videoFixture } from './helpers';
import { AuthDb } from './auth-db';
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

const etagOf = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');

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
		return v ? { key, size: v.bytes.byteLength, etag: etagOf(v.bytes), customMetadata: v.meta } : null;
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
	async list(o: { prefix?: string; cursor?: string; limit?: number; delimiter?: string; startAfter?: string } = {}) {
		const all = [...this.store.entries()]
			.filter(([k]) => (!o.prefix || k.startsWith(o.prefix)) && (!o.startAfter || k > o.startAfter))
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([key, v]) => ({ key, size: v.bytes.byteLength, etag: etagOf(v.bytes) }));
		const rest = (key: string) => key.slice((o.prefix ?? '').length);
		const inside = (key: string) => !!o.delimiter && rest(key).includes(o.delimiter);
		const delimitedPrefixes = [...new Set(all.filter((x) => inside(x.key)).map((x) => `${o.prefix ?? ''}${rest(x.key).split(o.delimiter!)[0]}${o.delimiter}`))];
		const objects = all.filter((x) => !inside(x.key));
		return { objects: objects.slice(0, o.limit ?? 1000), delimitedPrefixes, truncated: objects.length > (o.limit ?? 1000) };
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
			'vid-synth-02': videoFixture({ id: 'vid-synth-02', userId: OWNER, channelId: 'chan-synth-01', isPublic: true, comments: [{ id: 'cmt-synth-01', userId: 'usr_commenter', videoId: 'vid-synth-02', text: PLACEHOLDER, replies: [{ id: 'rep-synth-01', userId: 'usr_replier', text: 'a reply', parentCommentId: 'cmt-synth-01' }] }, { id: 'cmt-synth-02', userId: 'usr_other', videoId: 'vid-synth-02', text: 'another comment' }] } as never),
			'livestream:live-synth-01': { id: 'live-synth-01', title: 'synthetic', userId: OWNER, channelId: 'chan-synth-01', status: 'ended' },
			'vid-synth-01': videoFixture({ id: 'vid-synth-01', userId: OWNER, channelId: 'chan-synth-01', isPublic: true, thumbnailUrl: 'https://images.alummahnow.net/thumbnails/vid-synth-01/custom.jpg', r2: { status: 'ready', access: 'pub', rev: 'r1' } }),
		}),
		profiles: new MemoryBucket({ [OWNER]: { id: OWNER, userName: 'synthetic', avatarUrl: 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg' } }),
		channels: new MemoryBucket({ 'chan-synth-01': { id: 'chan-synth-01', userId: OWNER, name: 'Synthetic channel', coverUrl: 'https://images.alummahnow.net/cover-placeholder_cover.png' } }),
		community_posts: new MemoryBucket({
			'posts/chan-synth-01/post-synth-01.json': { id: 'post-synth-01', userId: OWNER, channelId: 'chan-synth-01', status: 'published', content: 'synthetic', images: [{ url: 'https://images.alummahnow.net/community-posts/chan-synth-01/a.jpg' }, { url: 'https://images.alummahnow.net/community-posts/chan-synth-01/b.jpg' }] },
			'posts/chan-synth-01/index.json': { postIds: ['post-synth-01'] },
			'post-locations/post-synth-01': { channelId: 'chan-synth-01' },
			'comments/post-synth-01/top-level/pcm-synth-01.json': { id: 'pcm-synth-01', postId: 'post-synth-01', userId: 'usr_commenter', content: PLACEHOLDER, createdAt: '2026-11-01T00:00:00Z' },
			'comments/post-synth-01/top-level/index.json': { postId: 'post-synth-01', commentIds: ['pcm-synth-01'], lastUpdated: '' },
		}),
		channel_tabs: new MemoryBucket({ 'channel-handles/synthetic': { handle: 'synthetic', channelId: 'chan-synth-01', userId: OWNER, dateClaimed: '' }, 'site-hosts/scholar.example.json': { host: 'scholar.example', channelId: 'chan-synth-01', kind: 'custom', createdAt: '' }, 'site-hosts/synth.alummahnow.org.json': { host: 'synth.alummahnow.org', channelId: 'chan-synth-01', kind: 'subdomain', createdAt: '' }, 'site-hosts/else.alummahnow.org.json': { host: 'else.alummahnow.org', channelId: 'chan-synth-99', kind: 'subdomain', createdAt: '' } }),
		LIVE_MEDIA: new BinaryBucket(),
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

	it('knows every host our content is on, in each environment, and refuses look-alikes', () => {
		const video = { kind: 'page', page: 'video', id: 'vid-synth-01' };
		for (const host of ['videos.alummahnow.net', 'videos.stage.alummahnow.net', 'videos.qa.alummahnow.net', 'alummahnow.net', 'www.alummahnow.net', 'qa.alummahnow.net', 'stage.alummahnow.net', 'VIDEOS.alummahnow.net', 'videos.alummahnow.net.', 'videos.alummahnow.com']) {
			assert.deepEqual(parseCsamUrl(`https://${host}/en/video/vid-synth-01`), video, host);
			assert.deepEqual(extractCsamUrls(`${host.replace(/\.$/, '')}/en/video/vid-synth-01`).length, 1, host);
		}
		for (const host of ['alummahnow.link', 'stage.alummahnow.link', 'qa.alummahnow.link']) assert.deepEqual(parseCsamUrl(`https://${host}/v/vid-synth-01`), video, host);
		for (const host of ['media.alummahnow.net', 'media.stage.alummahnow.net', 'media.qa.alummahnow.net']) assert.equal(parseCsamUrl(`${host}/pub/vid-synth-01/r1/a.ts`)?.kind, 'video', host);
		for (const host of ['live.alummahnow.net', 'live.stage.alummahnow.net', 'live.qa.alummahnow.net']) assert.deepEqual(parseCsamUrl(`https://${host}/hls/sess-synth-01/720/seg_1.m4s`), { kind: 'live_session', sessionId: 'sess-synth-01' }, host);
		for (const host of ['scholar.alummahnow.org', 'scholar.stage.alummahnow.org', 'scholar.qa.alummahnow.org', 'one.qa-sites.alummahnow.com', 'one.stage-sites.alummahnow.com']) {
			assert.deepEqual(parseCsamUrl(`https://${host}/ar/watch/vid-synth-01/`), { kind: 'site', host, ours: true, item: 'video', id: 'vid-synth-01' }, host);
		}
		for (const url of [
			'https://videos.alummahnow.net.example.com/video/vid-synth-01',
			'https://videos-alummahnow.net/video/vid-synth-01',
			'https://evilalummahnow.net/video/vid-synth-01',
			'https://videos.alummahnow.net@example.com/video/vid-synth-01',
			'https://videos.alummahnow.net%2eexample.com/video/vid-synth-01',
			'https://alummahnow.link.example.com/v/vid-synth-01',
			'https://live.alummahnow.net.example.com/hls/sess-synth-01/x.m3u8',
			'https://scholar.alummahnow.org.example.com/video/vid-synth-01',
			'https://videos.alummahnow.net:8443/video/vid-synth-01',
			'https://videos.alummahnow.co/video/vid-synth-01',
			'https://\u0430lummahnow.net/video/vid-synth-01',
			'https://admin.alummahnow.net/videos/vid-synth-01',
			'https://admin.api.qa.alummahnow.net/api/videos/vid-synth-01',
			'https://example.com/en/video/vid-synth-01',
		]) {
			assert.equal(parseCsamUrl(url), null, url);
		}
		assert.deepEqual(extractCsamUrls('https://videos.alummahnow.net.example.com/video/vid-synth-01 evil-alummahnow.net/x https://example.com/?u=alummahnow.net/video/vid-synth-01'), []);
	});

	it('knows every page of the site, with and without a locale', () => {
		const site = 'https://videos.alummahnow.net';
		const video = (page: string) => ({ kind: 'page', page, id: 'vid-synth-01' });
		const cases: Array<[string, unknown]> = [
			['/video/vid-synth-01', video('video')],
			['/ar/video/vid-synth-01?list=pl-synth-01&index=2&t=30', video('video')],
			['/en/video/vid-synth-01/edit', video('video')],
			['/en/video?vid=vid-synth-01', video('video')],
			['/en/shorts/vid-synth-01', video('shorts')],
			['/embed/v/vid-synth-01?lang=ar', video('embed')],
			['/en/studio/video/vid-synth-01/edit', video('video')],
			['/en/studio/chan-synth-01/content/videos/vid-synth-01/edit', video('video')],
			['/en/analytics/videos/vid-synth-01', video('video')],
			['/studio-download/clip/chan-synth-01/vid-synth-01.mp4', video('video')],
			['/thumb/vid-synth-01.jpg?w=640', { kind: 'video_thumbnail', videoId: 'vid-synth-01' }],
			['/og/v/vid-synth-01.jpg', { kind: 'video_thumbnail', videoId: 'vid-synth-01' }],
			['/en/live/live-synth-01', { kind: 'live_stream', streamId: 'live-synth-01' }],
			['/en/studio/chan-synth-01/content/live/live-synth-01', { kind: 'live_stream', streamId: 'live-synth-01' }],
			['/en/post/post-synth-01', { kind: 'page', page: 'post', id: null, postId: 'post-synth-01' }],
			['/channels/chan-synth-01?tab=community&post=post-synth-01#post-post-synth-01', { kind: 'page', page: 'post', id: 'chan-synth-01', postId: 'post-synth-01' }],
			['/en/@synthetic.channel?tab=community&post=post-synth-01', { kind: 'page', page: 'post', id: null, postId: 'post-synth-01', handle: 'synthetic.channel' }],
			['/ar/c/synthetic?post=post-synth-01', { kind: 'page', page: 'post', id: null, postId: 'post-synth-01', handle: 'synthetic' }],
			['/en/channels/chan-synth-01', { kind: 'page', page: 'channel', id: 'chan-synth-01' }],
		];
		for (const [path, expected] of cases) assert.deepEqual(parseCsamUrl(site + path), expected, path);
		// Ours, but no single item: the case opens for a hand mapping, and nothing is taken down
		for (const path of ['/en/@synthetic', '/en/u/@synthetic', '/en/playlist/pl-synth-01', '/embed/p/pl-synth-01', '/embed/comments/vid-synth-01', '/feeds/chan-synth-01/videos.xml', '/og/c/chan-synth-01.jpg', '/en/search?q=x', '/en/video/%zz', '/some/file.jpg']) {
			assert.ok(['other', undefined].includes(parseCsamUrl(site + path)?.kind), path);
		}
		assert.equal(parseCsamUrl(`${site}/en/@synthetic`)?.kind, 'other');
		assert.equal(parseCsamUrl('https://cms.alummahnow.net/api/media/file/x.jpg')?.kind, 'other');
		const short: Array<[string, unknown]> = [
			['/s/vid-synth-01', video('shorts')],
			['/p/post-synth-01', { kind: 'page', page: 'post', id: null, postId: 'post-synth-01' }],
			['/e/live-synth-01', { kind: 'live_stream', streamId: 'live-synth-01' }],
			['/c/chan-synth-01', { kind: 'page', page: 'channel', id: 'chan-synth-01' }],
			['/l/pl-synth-01', { kind: 'other', host: 'alummahnow.link', path: '/l/pl-synth-01' }],
			['/@synthetic', { kind: 'other', host: 'alummahnow.link', path: '/@synthetic' }],
		];
		for (const [path, expected] of short) assert.deepEqual(parseCsamUrl(`https://alummahnow.link${path}`), expected, path);
	});

	it('a comment URL names the comment, never what it is on', () => {
		const site = 'https://videos.alummahnow.net';
		const onVideo = { kind: 'comment', on: 'video', parentId: 'vid-synth-01', commentId: 'cmt-synth-01' };
		for (const path of ['/en/video/vid-synth-01#comment-cmt-synth-01', '/video/vid-synth-01?comment=cmt-synth-01', '/ar/shorts/vid-synth-01?commentId=cmt-synth-01', '/en/video?vid=vid-synth-01&lc=cmt-synth-01', '/embed/comments/vid-synth-01#comment-cmt-synth-01', '/en/video/vid-synth-01#comment%3Dcmt-synth-01']) assert.deepEqual(parseCsamUrl(site + path), onVideo, path);
		for (const path of ['/en/post/post-synth-01?comment=cmt-synth-01', '/channels/chan-synth-01?post=post-synth-01#comment-cmt-synth-01', '/en/@synthetic?post=post-synth-01#comment-cmt-synth-01']) {
			assert.deepEqual(parseCsamUrl(site + path), { kind: 'comment', on: 'post', parentId: 'post-synth-01', commentId: 'cmt-synth-01' }, path);
		}
		// About comments, but not which: nothing to act on, and least of all the video
		for (const path of ['/en/video/vid-synth-01#comments', '/en/video/vid-synth-01?comment=', '/en/video/vid-synth-01?comment=../x', '/en/post/post-synth-01#comment-x', '/channels/chan-synth-01?post=a', '/en/live/live-synth-01?comment=cmt-synth-01', '/en/live/live-synth-01?message=msg-synth-01', '/en/live/live-synth-01#chat-msg-synth-01', '/en/video/vid-synth-01?comment=cmt-synth-01&lc=cmt-synth-02', '/en/video/vid-synth-01?comment=cmt-synth-01#comment-cmt-synth-02', '/embed/comments/vid-synth-01', '/thumb/vid-synth-01.jpg?comment=cmt-synth-01', '/en/video/vid-synth-01#replies', '/en/video/vid-synth-01#replies-cmt-synth-01', '/en/video/vid-synth-01?reply_id=x', '/en/video/vid-synth-01?message_id=msg-synth-01', '/en/live/live-synth-01?chat_id=msg-synth-01',
			// What a path says after the item is not the item
			'/en/video/vid-synth-01/comments', '/en/video/vid-synth-01/comments/cmt-synth-01', '/en/post/post-synth-01/comments', '/en/shorts/vid-synth-01/comments', '/en/live/live-synth-01/chat', '/en/channels/chan-synth-01/comments', '/en/studio/video/vid-synth-01/comments', '/en/studio/chan-synth-01/content/videos/vid-synth-01/comments', '/en/studio/chan-synth-01/content/live/live-synth-01/chat', '/embed/v/vid-synth-01/comments', '/embed/comments/vid-synth-01/x#comment-cmt-synth-01', '/en/@synthetic/comments?post=post-synth-01']) assert.equal(parseCsamUrl(site + path)?.kind, 'other', path);
		assert.deepEqual(parseCsamUrl(`${site}/en/video/vid-synth-01?comment=cmt-synth-01#comment-cmt-synth-01`), onVideo);
		assert.deepEqual(parseCsamUrl(`${site}/EN/video/vid-synth-01?Comment=cmt-synth-01`), onVideo);
	});

	it('every shape says it the same way: short links, scholar sites, own domains and files', () => {
		const bases: Array<[string, unknown]> = [
			['https://alummahnow.link/v/vid-synth-01', { kind: 'comment', on: 'video', parentId: 'vid-synth-01', commentId: 'cmt-synth-01' }],
			['https://alummahnow.link/s/vid-synth-01', { kind: 'comment', on: 'video', parentId: 'vid-synth-01', commentId: 'cmt-synth-01' }],
			['https://alummahnow.link/p/post-synth-01', { kind: 'comment', on: 'post', parentId: 'post-synth-01', commentId: 'cmt-synth-01' }],
			['https://scholar.alummahnow.org/en/watch/vid-synth-01', { kind: 'site', host: 'scholar.alummahnow.org', ours: true, item: 'video', id: 'vid-synth-01', commentId: 'cmt-synth-01' }],
			['https://scholar.alummahnow.org//ar/posts/post-synth-01/', { kind: 'site', host: 'scholar.alummahnow.org', ours: true, item: 'post', id: 'post-synth-01', commentId: 'cmt-synth-01' }],
			['https://scholar.example/en/watch/vid-synth-01', { kind: 'site', host: 'scholar.example', ours: false, item: 'video', id: 'vid-synth-01', commentId: 'cmt-synth-01' }],
		];
		for (const [base, expected] of bases) for (const tail of ['?comment=cmt-synth-01', '#comment-cmt-synth-01', '?lc=cmt-synth-01', '?t=5#reply-cmt-synth-01']) assert.deepEqual(parseCsamUrl(base + tail), expected, base + tail);
		// Pointing at a part without naming one comment never maps to the page, the post or the stream
		const names = (t: any) => t && (t.kind === 'page' || t.kind === 'video' || t.kind === 'video_thumbnail' || t.kind === 'post_image' || t.kind === 'live_stream' || t.kind === 'live_session' || t.kind === 'image' || (t.kind === 'site' && t.item));
		for (const base of [...bases.map(([b]) => b), 'https://alummahnow.link/e/live-synth-01', 'https://live.alummahnow.net/hls/sess-synth-01/master.m3u8', 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg', 'https://images.alummahnow.net/thumbnails/vid-synth-01/x.jpg', 'https://vz-abc123.b-cdn.net/vid-synth-01/thumbnail.jpg', 'https://videos.alummahnow.net/og/v/vid-synth-01.jpg']) {
			for (const tail of ['#comments', '?comment=', '?comment=a b', '?message=msg-synth-01', '#chat', '?comment=cmt-synth-01&reply=rep-synth-01']) assert.ok(!names(parseCsamUrl(base + tail)), base + tail);
		}
	});

	it('a page that names two items maps to neither', () => {
		const site = 'https://videos.alummahnow.net';
		for (const path of ['/en/video/vid-synth-01?vid=vid-synth-02', '/en/video/vid-synth-01?post=post-synth-01', '/en/shorts/vid-synth-01?post=post-synth-01', '/en/post/post-synth-01?post=post-synth-02', '/embed/v/vid-synth-01?vid=vid-synth-02', '/en/video?vid=vid-synth-01&vid=vid-synth-02', '/en/video?vid=vid-synth-01&VID=vid-synth-02', '/en/channels/chan-synth-01?post=post-synth-01&post=post-synth-02', '/en/live/live-synth-01?vid=vid-synth-02', '/en/live/live-synth-01?Post=post-synth-01', '/en/post/post-synth-01?vid=vid-synth-02', '/en/channels/chan-synth-01?vid=vid-synth-02', '/en/@synthetic?post=post-synth-01&vid=vid-synth-02', '/thumb/vid-synth-01.jpg?vid=vid-synth-02']) assert.equal(parseCsamUrl(site + path)?.kind, 'other', path);
		assert.equal(parseCsamUrl('https://alummahnow.link/v/vid-synth-01?vid=vid-synth-02')?.kind, 'other');
		assert.equal((parseCsamUrl('https://scholar.alummahnow.org/en/watch/vid-synth-01?vid=vid-synth-02') as any)?.item, null);
		assert.equal(parseCsamUrl('https://scholar.example/en/watch/vid-synth-01?post=post-synth-02'), null);
		// The fixed segments in any case; ids keep theirs
		for (const path of ['/EN/Video/Vid-Synth-01', '/Video/Vid-Synth-01', '/en/Video?VID=Vid-Synth-01']) assert.deepEqual(parseCsamUrl(site + path), { kind: 'page', page: 'video', id: 'Vid-Synth-01' }, path);
		assert.equal(parseCsamUrl('https://alummahnow.link/V/vid-synth-01')?.kind, 'page');
		assert.equal((parseCsamUrl('https://scholar.example/EN/Watch/vid-synth-01') as any)?.item, 'video');
		assert.equal(parseCsamUrl('https://media.alummahnow.net/PUB/vid-synth-01/r1/thumb.jpg')?.kind, 'video_thumbnail');
		assert.equal(parseCsamUrl(`${site}/en/video/vid-synth-01?vid=vid-synth-01`)?.kind, 'page');
	});

	it('says why a URL opens no case, and what was left out of a paste', () => {
		const reasons: Array<[string, string | null]> = [
			['https://example.com/video/vid-synth-01', 'other_site'],
			['https://admin.alummahnow.net/moderation', 'console'],
			['https://status.alummahnow.net/x', 'console'],
			['https://videos.alummahnow.net:8443/en/video/vid-synth-01', 'port'],
			['http://', 'not_a_url'],
			['https://videos.alummahnow.net/en/video/%zz', null],
			['https://user@videos.alummahnow.net/en/video/vid-synth-01', 'not_a_url'],
			['https://videos.alummahnow.net:pw@videos.alummahnow.net/en/video/vid-synth-01', 'not_a_url'],
			['vz-abc123.b-cdn.net/vid-synth-01/thumbnail.jpg', null],
			['https://scholar.example/en/watch/vid-synth-01', null],
		];
		for (const [url, reason] of reasons) assert.equal(csamUrlRefusal(url), reason, url);
		for (const [url] of reasons.filter(([, r]) => r === 'not_a_url')) assert.equal(parseCsamUrl(url), null, url);
		assert.equal(parseCsamUrl('https://videos.alummahnow.net/_next/image?url=ftp%3A%2F%2Fimages.alummahnow.net%2Fthumbnails%2Fvid-synth-01%2Fx.jpg')?.kind, 'other');
		assert.deepEqual(scanCsamUrls('vz-abc123.b-cdn.net/vid-synth-01/thumbnail.jpg').urls, ['vz-abc123.b-cdn.net/vid-synth-01/thumbnail.jpg']);
		const scan = scanCsamUrls('See https://example.com/a.jpg and evil.com/alummahnow.net/video/vid-synth-01, videos.alummahnow.net/en/video/vid-synth-01. e.g. this, 10/24 and and/or');
		assert.deepEqual(scan.urls, ['videos.alummahnow.net/en/video/vid-synth-01']);
		assert.deepEqual(scan.others, ['https://example.com/a.jpg', 'evil.com/alummahnow.net/video/vid-synth-01']);
	});

	it('only a token that starts with our host counts', () => {
		for (const text of ['evil.com/alummahnow.net/video/vid-synth-01', 'example.com/?u=alummahnow.net/video/vid-synth-01', 'example.com?u=https://alummahnow.net/video/vid-synth-01', 'https://example.com/https://alummahnow.net/video/vid-synth-01', 'user@alummahnow.net/video/vid-synth-01', 'evil.com:alummahnow.net/video/vid-synth-01', 'x=alummahnow.net/video/vid-synth-01', 'evil.com#alummahnow.net/video/vid-synth-01', 'evil.com\\alummahnow.net/video/vid-synth-01', '/alummahnow.net/video/vid-synth-01', 'evil.com/https://vz-abc123.b-cdn.net/vid-synth-01/x.jpg']) {
			assert.deepEqual(extractCsamUrls(text), [], text);
		}
		for (const text of ['alummahnow.net/video/vid-synth-01', '(alummahnow.net/video/vid-synth-01)', 'URL:alummahnow.net/video/vid-synth-01', '* [x](https://alummahnow.net/video/vid-synth-01)', '"https://alummahnow.net/video/vid-synth-01",', '-videos.alummahnow.net/en/video/vid-synth-01']) assert.equal(extractCsamUrls(text).length, 1, text);
		assert.deepEqual(extractCsamUrls('https://scholar.example/en/watch/vid-synth-01?t=3#comment-cmt-synth-01'), ['https://scholar.example/en/watch/vid-synth-01?t=3#comment-cmt-synth-01']);
	});

	it('cases are told apart by what the URL names on the same path', () => {
		const key = (u: string) => csamUrlKey(u);
		assert.equal(key('https://VIDEOS.alummahnow.net/en/video/vid-synth-01?t=9'), 'videos.alummahnow.net/en/video/vid-synth-01');
		assert.equal(key('alummahnow.net/channels/chan-synth-01?post=post-synth-01&x=1'), 'alummahnow.net/channels/chan-synth-01?post=post-synth-01');
		assert.notEqual(key('videos.alummahnow.net/en/video?vid=vid-synth-01'), key('videos.alummahnow.net/en/video?vid=vid-synth-02'));
		assert.notEqual(key('videos.alummahnow.net/en/video/vid-synth-01'), key('videos.alummahnow.net/en/video/vid-synth-01#comment-cmt-synth-01'));
		assert.notEqual(key('videos.alummahnow.net/en/video/vid-synth-01?comment=cmt-synth-01'), key('videos.alummahnow.net/en/video/vid-synth-01?comment=cmt-synth-02'));
	});

	it('unwraps optimizer URLs and refuses foreign hosts and traversal', () => {
		const wrapped = 'https://alummahnow.net/_next/image?url=https%3A%2F%2Fimages.alummahnow.net%2Fcommunity-posts%2Fchan-synth-01%2Fa.jpg&w=640&q=75';
		assert.deepEqual(parseCsamUrl(wrapped), { kind: 'post_image', channelId: 'chan-synth-01', path: '/community-posts/chan-synth-01/a.jpg' });
		assert.equal(unwrapImageUrl(new URL('https://alummahnow.net/cdn-cgi/image/width=320/https://images.alummahnow.net/x.jpg')).hostname, 'images.alummahnow.net');
		assert.equal(parseCsamUrl('https://example.com/pub/vid-synth-01/r1/thumb.jpg'), null);
		assert.equal(parseCsamUrl('https://alummahnow.net.example.com/video/vid-synth-01'), null);
		// Ours, but never a storage path: a person maps it
		for (const path of ['/a/..%2Fsecret', '/a/%5C..%5Csecret', '/a/%zz']) assert.equal(parseCsamUrl(`https://images.alummahnow.net${path}`)?.kind, 'other', path);
	});

	it('pulls every URL out of a pasted alert', () => {
		const text = `Synthetic alert\n- images.alummahnow.net/community-posts/chan-synth-01/a.jpg\n- https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg.\n- https://example.com/other.jpg`;
		assert.deepEqual(extractCsamUrls(text), ['images.alummahnow.net/community-posts/chan-synth-01/a.jpg', 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg']);
	});

	it('takes an optimizer URL without a scheme whole, and pages shaped like a scholar site', () => {
		const wrapped = 'videos.alummahnow.net/_next/image?url=https%3A%2F%2Fimages.alummahnow.net%2Fcommunity-posts%2Fchan-synth-01%2Fa.jpg&w=640';
		assert.deepEqual(extractCsamUrls(`- ${wrapped}`), [wrapped]);
		assert.deepEqual(extractCsamUrls('videos.alummahnow.net/_next/image?url=https://images.alummahnow.net/x.jpg'), ['videos.alummahnow.net/_next/image?url=https://images.alummahnow.net/x.jpg']);
		assert.deepEqual(extractCsamUrls('https://scholar.example/en/watch/vid-synth-01. scholar.example/ar/posts/post-synth-01 https://scholar.example/en/about'), ['https://scholar.example/en/watch/vid-synth-01', 'scholar.example/ar/posts/post-synth-01']);
		assert.deepEqual(parseCsamUrl(`https://videos.alummahnow.net/og/i/${Buffer.from('https://images.alummahnow.net/community-posts/chan-synth-01/a.jpg').toString('base64url')}.jpg`), { kind: 'post_image', channelId: 'chan-synth-01', path: '/community-posts/chan-synth-01/a.jpg' });
		// What our optimizer was pointed at elsewhere is not ours to map, and a foreign optimizer never unwraps to ours
		for (const inner of ['https://images.alummahnow.net.example.com/a.jpg', 'https://images.alummahnow.net:8443/thumbnails/vid-synth-01/x.jpg', 'https://admin.alummahnow.net/x.jpg']) assert.equal(parseCsamUrl(`https://videos.alummahnow.net/_next/image?url=${encodeURIComponent(inner)}`)?.kind, 'other', inner);
		assert.equal(parseCsamUrl(`https://example.com/_next/image?url=${encodeURIComponent('https://images.alummahnow.net/thumbnails/vid-synth-01/x.jpg')}`), null);
		assert.equal(parseCsamUrl(`https://videos.alummahnow.net:8443/_next/image?url=${encodeURIComponent('https://images.alummahnow.net/thumbnails/vid-synth-01/x.jpg')}`), null);
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

	it('finds posts by id alone, by handle and on scholar sites; an item the page did not show is left for a person', async () => {
		const { env } = setup();
		const post = { ok: true, resolution: { kind: 'post_image', channelId: 'chan-synth-01', postId: 'post-synth-01', uploaderId: OWNER } };
		const site = 'https://videos.alummahnow.net';
		for (const url of [`${site}/en/post/post-synth-01`, 'https://alummahnow.link/p/post-synth-01', `${site}/en/@synthetic?post=post-synth-01`, `${site}/channels/chan-synth-01?post=post-synth-01`, 'https://synth.alummahnow.org/en/posts/post-synth-01/', 'https://scholar.example/ar/posts/post-synth-01']) {
			assert.deepEqual(await resolveCsamUrl(env as never, url), post, url);
		}
		const video = { ok: true, resolution: { kind: 'video', videoId: 'vid-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } };
		for (const url of ['https://scholar.example/en/watch/vid-synth-01', `${site}/embed/v/vid-synth-01`, 'https://alummahnow.link/s/vid-synth-01', `${site}/en/video?vid=vid-synth-01`]) assert.deepEqual(await resolveCsamUrl(env as never, url), video, url);
		const reason = async (url: string) => { const r = await resolveCsamUrl(env as never, url); return r.ok ? 'mapped' : r.reason; };
		// Another channel's site, another channel's handle, an unknown handle, a gone site, a page with no item
		for (const url of ['https://else.alummahnow.org/en/watch/vid-synth-01', 'https://else.alummahnow.org/en/posts/post-synth-01', `${site}/channels/chan-synth-99?post=post-synth-01`, `${site}/en/@nobody?post=post-synth-01`, 'https://gone.alummahnow.org/en/watch/vid-synth-01', 'https://synth.alummahnow.org/en/about', `${site}/en/post/post-synth-99`, `${site}/en/search`, `${site}/embed/comments/vid-synth-02`]) {
			assert.equal(await reason(url), 'not_found', url);
		}
		assert.equal(await reason('https://someone-else.example/en/watch/vid-synth-01'), 'not_ours');
		assert.equal(await reason('https://someone-else.example/en/watch/vid-synth-01#comments'), 'not_ours');
		// A comment on a scholar site, only on that site's own channel
		assert.deepEqual(await resolveCsamUrl(env as never, 'https://scholar.example/en/watch/vid-synth-02?comment=cmt-synth-01'), { ok: true, resolution: { kind: 'comment', commentId: 'cmt-synth-01', commentOn: 'video', commentParentId: 'vid-synth-02', uploaderId: 'usr_commenter' } });
		for (const url of ['https://scholar.example/en/watch/vid-synth-02#comments', 'https://else.alummahnow.org/en/watch/vid-synth-02?comment=cmt-synth-01', 'https://alummahnow.link/v/vid-synth-02#comments']) assert.equal(await reason(url), 'not_found', url);
		assert.deepEqual((await resolveCsamUrl(env as never, 'https://alummahnow.link/v/vid-synth-02#comment-cmt-synth-01') as any).resolution.uploaderId, 'usr_commenter');
	});

	it('finds a comment and its author, and a live stream by its page or its media', async () => {
		const { env, db } = setup();
		const site = 'https://videos.alummahnow.net';
		assert.deepEqual(await resolveCsamUrl(env as never, `${site}/en/video/vid-synth-02#comment-cmt-synth-01`), { ok: true, resolution: { kind: 'comment', commentId: 'cmt-synth-01', commentOn: 'video', commentParentId: 'vid-synth-02', uploaderId: 'usr_commenter' } });
		assert.deepEqual(await resolveCsamUrl(env as never, `${site}/en/video/vid-synth-02?comment=rep-synth-01`), { ok: true, resolution: { kind: 'comment', commentId: 'rep-synth-01', commentOn: 'video', commentParentId: 'vid-synth-02', uploaderId: 'usr_replier' } });
		assert.deepEqual(await resolveCsamUrl(env as never, `${site}/en/post/post-synth-01?comment=pcm-synth-01`), { ok: true, resolution: { kind: 'comment', commentId: 'pcm-synth-01', commentOn: 'post', commentParentId: 'post-synth-01', uploaderId: 'usr_commenter' } });
		// A comment that is gone never falls back to what it was on
		for (const url of [`${site}/en/video/vid-synth-02#comment-cmt-synth-99`, `${site}/en/post/post-synth-01?comment=cmt-synth-99`, `${site}/en/video/vid-synth-02#comments`]) {
			const r = await resolveCsamUrl(env as never, url);
			assert.equal(r.ok, false, url);
		}
		await db.prepare("INSERT INTO live_sessions (id, stream_id, provider, status, reason, created_at) VALUES ('sess-synth-01', 'live-synth-01', 'selfhosted', 'ended', 'round_robin', 1)").run();
		const stream = { ok: true, resolution: { kind: 'live_stream', streamId: 'live-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } };
		for (const url of [`${site}/ar/live/live-synth-01`, 'https://alummahnow.link/e/live-synth-01', 'https://live.alummahnow.net/hls/sess-synth-01/720/seg_1.m4s']) assert.deepEqual(await resolveCsamUrl(env as never, url), stream, url);
		assert.equal((await resolveCsamUrl(env as never, 'https://live.alummahnow.net/hls/sess-synth-99/master.m3u8')).ok, false);
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

describe('taking a comment down', () => {
	for (const on of ['video', 'post'] as const) {
		it(`on a ${on}: the comment and its author only`, async () => {
			const t = setup();
			const url = on === 'video' ? 'https://videos.alummahnow.net/en/video/vid-synth-02#comment-cmt-synth-01' : 'https://videos.alummahnow.net/en/post/post-synth-01?comment=pcm-synth-01';
			const { resolution } = (await t.json('POST', '/resolve', { url })).body.result;
			const started = await t.json('POST', '/contain', { caseId: CASE, matchedUrl: url, resolution });
			assert.equal(started.status, 200);
			const stored = () => (on === 'video' ? t.env.videos.read('vid-synth-02').comments[0] : t.env.community_posts.read('comments/post-synth-01/top-level/pcm-synth-01.json'));
			assert.equal(stored().isDeleted, true);
			assert.ok(stored().csamTakedown);
			await t.drain();
			const job = (await t.json('GET', `/cases/${CASE}/job`)).body.result.job;
			assert.equal(job.status, 'succeeded', job.lastError);
			assert.equal(JSON.stringify(stored()).includes(PLACEHOLDER), false, 'the text is gone once it is kept');
			const manifest = (await t.json('GET', `/cases/${CASE}/manifest`)).body.result;
			assert.deepEqual(manifest.files.map((f: { name: string }) => f.name), ['record-comment.json']);
			const kept = await (await t.call('GET', `/cases/${CASE}/files/record-comment.json`)).text();
			assert.ok(kept.includes(PLACEHOLDER) && !kept.includes('a reply'));
			// What it was on, the replies of other people and everyone else stay
			const video = t.env.videos.read('vid-synth-02');
			assert.ok(!video.isHidden && !video.suspensionHolds && !video.csamTakedown);
			assert.equal(video.comments[0].replies[0].text, 'a reply');
			assert.equal(video.comments[1].text, 'another comment');
			assert.equal(t.env.community_posts.read('posts/chan-synth-01/post-synth-01.json').status, 'published');
			const banned = ((await t.db.prepare('SELECT user_id FROM videos_bans').bind().all()).results as Array<{ user_id: string }>).map((r) => r.user_id);
			assert.deepEqual(banned, ['usr_commenter']);
		});
	}

	it('holds its author\'s media from an erasure until it is done, and nothing of what it is on', async () => {
		for (const on of ['video', 'post'] as const) {
			const t = setup();
			const url = on === 'video' ? 'https://videos.alummahnow.net/en/video/vid-synth-02#comment-cmt-synth-01' : 'https://videos.alummahnow.net/en/post/post-synth-01?comment=pcm-synth-01';
			const { resolution } = (await t.json('POST', '/resolve', { url })).body.result;
			const { job } = (await t.json('POST', '/contain', { caseId: CASE, matchedUrl: url, resolution })).body.result;
			assert.deepEqual([job.targetKind, job.targetId], ['user', 'usr_commenter']);
			const held = () => t.db.db.prepare('SELECT target_kind AS kind, target_id AS id, held_by AS by FROM media_erase_targets WHERE held_by IS NOT NULL AND target_kind <> ?').all('comment').map((r) => ({ ...r }));
			assert.deepEqual(held(), [{ kind: 'user', id: 'usr_commenter', by: job.id }]);
			const take = async (target: { kind: 'user' | 'video' | 'channel'; id: string }) => {
				const taken = await takePart(t.db as never, 'erase', 'd', [target]);
				await endParts(t.db as never, 'erase', 'd', 'none');
				return taken;
			};
			assert.equal(await take({ kind: 'user', id: 'usr_commenter' }), false);
			for (const other of [{ kind: 'user', id: OWNER }, { kind: 'video', id: 'vid-synth-02' }, { kind: 'channel', id: 'chan-synth-01' }] as const) assert.equal(await take(other), true, `${on} ${other.id}`);
			await t.drain();
			assert.equal((await t.json('GET', `/cases/${CASE}/job`)).body.result.job.status, 'succeeded');
			assert.deepEqual(held(), []);
			assert.equal(await take({ kind: 'user', id: 'usr_commenter' }), true);
		}
		// Its author is not known: there is no account to hold
		const t = setup();
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution: { kind: 'comment', commentId: 'cmt-synth-01', commentOn: 'video', commentParentId: 'vid-synth-02', uploaderId: null } });
		assert.deepEqual(t.db.db.prepare('SELECT target_kind AS kind FROM media_erase_targets').all().map((r) => r.kind), ['comment']);
	});

	for (const on of ['video', 'post'] as const) {
		for (const what of ['its author erased their account', 'what it is on was erased', 'it was edited away'] as const) {
			it(`keeps what it said on a ${on} as the case found it, though ${what} before the evidence was kept`, async () => {
				const t = setup({ key: null });
				const env = t.env as Record<string, any>;
				for (const b of ['channel_sections', 'channel_tabs', 'subtitles', 'upload-defaults', 'global_settings', 'ADMIN_BACKUPS']) env[b] ??= new MemoryBucket();
				const url = on === 'video' ? 'https://videos.alummahnow.net/en/video/vid-synth-02#comment-cmt-synth-01' : 'https://videos.alummahnow.net/en/post/post-synth-01?comment=pcm-synth-01';
				const { resolution } = (await t.json('POST', '/resolve', { url })).body.result;
				await t.json('POST', '/contain', { caseId: CASE, matchedUrl: url, resolution });
				const text = () => JSON.stringify([...t.env.videos.store.values(), ...t.env.community_posts.store.values()]).includes(PLACEHOLDER);
				assert.ok(text());
				// The plan cannot keep it yet (no key)
				await t.drain();
				assert.equal((await t.json('GET', `/cases/${CASE}/job`)).body.result.job.status, 'failed');
				if (what === 'it was edited away') {
					for (const store of [t.env.videos, t.env.community_posts]) for (const [key, value] of [...store.store]) store.store.set(key, String(value).replaceAll(PLACEHOLDER, 'nothing'));
				} else {
					const who = what === 'its author erased their account' ? 'usr_commenter' : OWNER;
					const summary = await eraseUserData(env as never, who, new OperationBudget(5000), {});
					assert.equal(summary.complete, true);
				}
				assert.equal(text(), false, 'gone from the records');
				env.CSAM_EVIDENCE_KEY = KEY_V1;
				await t.json('POST', '/retry', { caseId: CASE });
				await t.drain();
				const job = (await t.json('GET', `/cases/${CASE}/job`)).body.result.job;
				assert.equal(job.status, 'succeeded', job.lastError);
				const kept = await (await t.call('GET', `/cases/${CASE}/files/record-comment.json`)).text();
				assert.ok(kept.includes(PLACEHOLDER) && kept.includes('usr_commenter') && !kept.includes('a reply'));
				// And nothing of it is left outside the evidence
				assert.equal(JSON.stringify(t.db.db.prepare('SELECT * FROM media_erase_targets').all()).includes(PLACEHOLDER), false);
				assert.equal(text(), false);
			});
		}
	}

	it('is held before it is hidden, again by the job, and only until the evidence has it', async () => {
		const t = setup();
		const resolution = { kind: 'comment', commentId: 'cmt-synth-01', commentOn: 'video', commentParentId: 'vid-synth-02', uploaderId: 'usr_commenter' };
		const rows = () => t.db.db.prepare("SELECT target_id AS id, media FROM media_erase_targets WHERE target_kind = 'comment'").all() as Array<{ id: string; media: string }>;
		const put = t.env.videos.put.bind(t.env.videos);
		let heldFirst = false;
		(t.env.videos as any).put = async (...args: [string, string]) => {
			heldFirst ||= rows().length === 1;
			return put(...args);
		};
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution });
		assert.ok(heldFirst);
		assert.deepEqual(rows().map((r) => [r.id, r.media.includes(PLACEHOLDER), r.media.includes('a reply')]), [['video:vid-synth-02/cmt-synth-01', true, false]]);
		// A request that stopped before it: the job does it
		t.db.db.prepare('DELETE FROM media_erase_targets').run();
		const at = async (phase: string) => {
			for (let i = 0; i < 20; i++) {
				const row = (await t.json('GET', `/cases/${CASE}/job`)).body.result.job;
				if (row.params.phase === phase) return;
				const out = (await ADMIN_JOB_HANDLERS['csam.contain']!(t.env as never, row)) as Record<string, any>;
				t.db.db.prepare('UPDATE admin_jobs SET params = ? WHERE id = ?').run(JSON.stringify(out.params), row.id);
			}
		};
		await at('purge');
		assert.equal(rows().length, 1);
		await at('ban');
		assert.equal(rows().length, 0);
	});

	it('a resolution can never carry a comment and what it is on', async () => {
		const t = setup();
		for (const resolution of [
			{ kind: 'comment', commentId: 'cmt-synth-01', commentOn: 'video', commentParentId: 'vid-synth-02', videoId: 'vid-synth-02', uploaderId: 'usr_commenter' },
			{ kind: 'comment', commentId: 'cmt-synth-01', commentOn: 'video', uploaderId: 'usr_commenter' },
			{ kind: 'video', videoId: 'vid-synth-02', commentId: 'cmt-synth-01', uploaderId: OWNER },
			{ kind: 'live_stream', streamId: 'live-synth-01', videoId: 'vid-synth-01', uploaderId: OWNER },
		]) {
			assert.equal((await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution })).status, 400);
		}
		assert.ok(!t.env.videos.read('vid-synth-02').csamTakedown && !t.env.videos.read('vid-synth-01').csamTakedown);
	});
});

describe('taking a live stream down', () => {
	const GUID = 'bunny-guid-01';
	/** Bunny: a live recording, encoded or not, with one file. */
	function bunny(state: { exists: boolean; finished: boolean; file: string | null; early?: boolean }) {
		const base = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith('https://video.bunnycdn.com/library/7/videos/')) {
				calls.push(`${init?.method ?? 'GET'} ${url}`);
				if (init?.method === 'DELETE') {
					state.exists = false;
					return new Response('{}');
				}
				return state.exists ? Response.json({ guid: GUID, status: state.finished ? 4 : 2, hasOriginal: true, availableResolutions: '720p' }) : new Response(null, { status: 404 });
			}
			if (new URL(url).hostname === 'vz-synth.b-cdn.net' && url.includes(GUID)) {
				if (!state.file || !(state.finished || state.early)) return new Response(null, { status: 404 });
				const bytes = enc(state.file);
				const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get('Range') ?? '');
				const [from, to] = range ? [Number(range[1]), Math.min(Number(range[2]), bytes.byteLength - 1)] : [0, bytes.byteLength - 1];
				return new Response(bytes.slice(from, to + 1), { status: 206, headers: { 'content-range': `bytes ${from}-${to}/${bytes.byteLength}` } });
			}
			return base(input as never, init);
		}) as typeof fetch;
		return state;
	}
	const start = async (t: ReturnType<typeof setup>, sessions: Array<[id: string, provider: string, ref: string | null]>) => {
		for (const [id, provider, ref] of sessions) await t.db.prepare("INSERT INTO live_sessions (id, stream_id, provider, provider_ref, status, reason, created_at, vod_url, vod_ready_at, first_segment_at) VALUES (?, 'live-synth-01', ?, ?, 'ended', 'round_robin', 1, 'https://recording', 2, 1)").bind(id, provider, ref).run();
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'https://videos.alummahnow.net/en/live/live-synth-01', resolution: { kind: 'live_stream', streamId: 'live-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } });
		await t.drain();
		return jobOf(t);
	};
	const jobOf = async (t: ReturnType<typeof setup>) => (await t.json('GET', `/cases/${CASE}/job`)).body.result.job;
	const manifestOf = async (t: ReturnType<typeof setup>) => (await t.json('GET', `/cases/${CASE}/manifest`)).body.result;
	const record = (t: ReturnType<typeof setup>) => t.env.videos.read('livestream:live-synth-01');

	it('hides and holds it, keeps its records and bans the uploader; nothing else is touched', async () => {
		const t = setup();
		const job = await start(t, [['sess-synth-01', 'selfhosted', null]]);
		assert.equal(job.status, 'succeeded', job.lastError);
		const stream = record(t);
		assert.ok(stream.isHidden && stream.csamTakedown && stream.suspensionHolds.includes(CSAM_HOLD));
		assert.doesNotMatch(stream.hiddenReason, /csam|abuse|child/i);
		assert.ok(!t.env.videos.read('vid-synth-01').csamTakedown);
		assert.deepEqual((await manifestOf(t)).files.map((f: { name: string }) => f.name).sort(), ['record-channel.json', 'record-live-sessions.json', 'record-live-stream.json', 'record-uploader-profile.json']);
	});

	/** The case's job one delivery at a time, until it is at `phase`. */
	const stepTo = async (t: ReturnType<typeof setup>, phase: string) => {
		for (let i = 0; i < 30; i++) {
			const row = await jobOf(t);
			if (row.params.phase === phase) return row;
			const out = (await ADMIN_JOB_HANDLERS['csam.contain']!(t.env as never, row)) as Record<string, any>;
			t.db.db.prepare('UPDATE admin_jobs SET params = ? WHERE id = ?').run(JSON.stringify(out.params), row.id);
		}
		throw new Error(`never at ${phase}`);
	};

	it('is found, kept and removed when its account was erased; held from the erasure, also while a late recording is kept', async () => {
		const t = setup();
		const seg = (n: number) => t.env.LIVE_MEDIA.set(`live/sess-synth-01/720/seg_${n}.m4s`, `${PLACEHOLDER}-${n}|`);
		seg(1);
		await t.db.prepare("INSERT INTO live_sessions (id, stream_id, provider, status, reason, created_at, first_segment_at) VALUES ('sess-synth-01', 'live-synth-01', 'selfhosted', 'ended', 'round_robin', 1, 1)").run();
		await eraseMediaHooks(t.env).onVideoDeleted('live-synth-01', record(t), 'livestream:live-synth-01');
		t.env.videos.store.delete('livestream:live-synth-01');
		const url = 'https://videos.alummahnow.net/en/live/live-synth-01';
		const { resolution } = (await t.json('POST', '/resolve', { url })).body.result;
		assert.deepEqual(resolution, { kind: 'live_stream', streamId: 'live-synth-01', channelId: 'chan-synth-01', uploaderId: null });
		// It was no video, and a video is no stream
		assert.equal((await t.json('POST', '/resolve', { url: 'https://videos.alummahnow.net/en/video/live-synth-01' })).body.result.ok, false);
		await writeTarget(t.db as never, { kind: 'video', id: 'vid-gone-01' }, 'j', { id: 'vid-gone-01', channelId: null });
		assert.equal((await t.json('POST', '/resolve', { url: 'https://videos.alummahnow.net/en/live/vid-gone-01' })).body.result.ok, false);

		const { job } = (await t.json('POST', '/contain', { caseId: CASE, matchedUrl: url, resolution })).body.result;
		assert.deepEqual([job.targetKind, job.targetId], ['channel', 'chan-synth-01']);
		const held = () => t.db.db.prepare('SELECT target_kind AS kind, target_id AS id FROM media_erase_targets WHERE held_by IS NOT NULL').all().map((r) => ({ ...r }));
		assert.deepEqual(held(), [{ kind: 'video', id: 'live-synth-01' }]);
		const erase = t.db.db.prepare('SELECT id FROM admin_jobs WHERE kind = ?').get(ERASE_MEDIA_JOB) as { id: string };
		const eraseRuns = async () => {
			t.db.db.prepare(`UPDATE admin_jobs SET params = json_remove(params, '$.runAfter', '$.delay') WHERE id = ?`).run(erase.id);
			const row = t.db.db.prepare('SELECT * FROM admin_jobs WHERE id = ?').get(erase.id) as Record<string, any>;
			return (await ADMIN_JOB_HANDLERS[ERASE_MEDIA_JOB]!(t.env as never, { id: erase.id, params: JSON.parse(row.params) } as never)) as Record<string, any>;
		};
		assert.match((await eraseRuns()).note, /a takedown case is open/);
		assert.equal(t.env.LIVE_MEDIA.store.size, 1, 'the erasure leaves it to the case');

		await stepTo(t, 'ban');
		assert.equal(t.env.LIVE_MEDIA.store.size, 0, 'kept, then removed');
		// A segment that comes in now goes back to the copy, and is still held
		t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_2.m4s', `${PLACEHOLDER}-2, longer than what was kept|`);
		const row = await jobOf(t);
		const again = (await ADMIN_JOB_HANDLERS['csam.contain']!(t.env as never, row)) as Record<string, any>;
		assert.deepEqual([again.done, again.params.phase], [false, 'copy-public']);
		assert.deepEqual(held(), [{ kind: 'video', id: 'live-synth-01' }]);
		assert.match((await eraseRuns()).note, /a takedown case is open/);
		assert.equal(t.env.LIVE_MEDIA.store.size, 1);
		t.db.db.prepare('UPDATE admin_jobs SET params = ? WHERE id = ?').run(JSON.stringify(again.params), row.id);
		t.db.db.prepare("UPDATE admin_jobs SET status = 'failed' WHERE id = ?").run(erase.id);
		await t.drain();
		const done = await jobOf(t);
		assert.equal(done.status, 'succeeded', done.lastError);
		assert.deepEqual([held(), t.env.LIVE_MEDIA.store.size, done.result.ban], [[], 0, 'no_uploader']);
		const manifest = await manifestOf(t);
		const names = manifest.files.map((f: { name: string }) => f.name);
		for (const name of ['06-live-recording-1.mp4', '06-live-recording-2.mp4', 'erased-video.json', 'record-live-sessions.json']) assert.ok(names.includes(name), `${name}: ${names}`);
		assert.match(manifest.missing.find((m: { name: string }) => m.name === 'record').reason, /the record was erased on .* its media was kept/);
	});

	it('waits for a part of it an erasure is deleting; a stream is hidden and ended once', async () => {
		const t = setup();
		t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_1.m4s', PLACEHOLDER);
		const erase = await createJob(t.env as never, { kind: ERASE_MEDIA_JOB, targetKind: 'user', targetId: 'deleted-user', actorId: 'system', params: { items: [] } });
		await takePart(t.db as never, erase.id, 'd', [{ kind: 'video', id: 'live-synth-01' }]);
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution: { kind: 'live_stream', streamId: 'live-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } });
		const told = t.env.queue.messages.length;
		const marked = t.env.videos.store.get('livestream:live-synth-01');
		await new Promise((done) => setTimeout(done, 5));
		for (let i = 0; i < 2; i++) {
			const out = (await ADMIN_JOB_HANDLERS['csam.contain']!(t.env as never, await jobOf(t))) as Record<string, any>;
			assert.deepEqual([out.done, out.delaySeconds], [false, 30]);
		}
		assert.equal((await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution: { kind: 'live_stream', streamId: 'live-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } })).body.result.existing, true);
		assert.deepEqual([t.env.queue.messages.length, t.env.videos.store.get('livestream:live-synth-01'), t.env.LIVE_MEDIA.store.size], [told, marked, 1]);
		// Shown again by something else: hidden again before anything is kept
		t.env.videos.store.set('livestream:live-synth-01', JSON.stringify({ ...record(t), isHidden: false }));
		await ADMIN_JOB_HANDLERS['csam.contain']!(t.env as never, await jobOf(t));
		assert.equal(record(t).isHidden, true);
		// Written down, but its record is still there: nothing is said of it
		await endParts(t.db as never, erase.id, 'd', 'none');
		await writeTarget(t.db as never, { kind: 'video', id: 'live-synth-01' }, erase.id, { id: 'live-synth-01', stream: true });
		const planned = (await ADMIN_JOB_HANDLERS['csam.contain']!(t.env as never, await jobOf(t))) as Record<string, any>;
		assert.deepEqual([planned.params.phase, planned.params.missing], ['copy-public', []]);
	});

	it('a Bunny recording is read by its own guid, whatever an erasure wrote down under that name', async () => {
		const t = setup();
		bunny({ exists: true, finished: true, file: PLACEHOLDER });
		(t.env as Record<string, unknown>).bunny_hostname = 'vz-synth.b-cdn.net';
		await writeTarget(t.db as never, { kind: 'video', id: GUID }, 'j', { id: GUID, media: { providers: { bunny: { ref: 'another' } } } });
		const job = await start(t, [['sess-synth-02', 'bunny', GUID]]);
		assert.equal(job.status, 'succeeded', job.lastError);
		assert.ok((await manifestOf(t)).files.some((f: { name: string }) => f.name === '06-live-recording-1.mp4'));
		assert.ok(!calls.some((c) => c.includes('another')));
	});

	it('nothing is copied or removed while the stream is not hidden', async () => {
		const t = setup();
		t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_1.m4s', PLACEHOLDER);
		const put = t.env.videos.put.bind(t.env.videos);
		(t.env.videos as any).put = async (key: string, value: string, opts: never) => (key === 'livestream:live-synth-01' ? null : put(key, value, opts));
		const job = await start(t, [['sess-synth-01', 'selfhosted', null]]).catch(() => null);
		assert.ok(!job || job.status === 'failed');
		assert.equal(t.env.LIVE_MEDIA.store.size, 1);
		(t.env.videos as any).put = put;
	});

	it('a self-hosted recording is kept whole (best rendition, in order), then every object of it is removed and the CDN purged', async () => {
		const t = setup();
		(t.env as Record<string, unknown>).LIVE_PUBLIC_HOST = 'live.test';
		const put = (path: string, value: string) => t.env.LIVE_MEDIA.set(`live/sess-synth-01/${path}`, value);
		put('master.m3u8', '#EXTM3U');
		put('720/index.m3u8', '#EXTM3U\n#EXT-X-MAP:URI="init_0.mp4"');
		put('720/init_0.mp4', 'INIT|');
		for (const n of [10, 2, 1]) put(`720/seg_${n}.m4s`, `${PLACEHOLDER}-${n}|`);
		put('360/index.m3u8', '#EXTM3U');
		put('360/seg_1.m4s', 'small');
		t.env.LIVE_MEDIA.set('live/sess-other-01/720/seg_1.m4s', 'another stream');
		const job = await start(t, [['sess-synth-01', 'selfhosted', null]]);
		assert.equal(job.status, 'succeeded', job.lastError);
		assert.equal(await (await t.call('GET', `/cases/${CASE}/files/06-live-recording-1.mp4`)).text(), `INIT|${PLACEHOLDER}-1|${PLACEHOLDER}-2|${PLACEHOLDER}-10|`);
		assert.deepEqual([...t.env.LIVE_MEDIA.store.keys()], ['live/sess-other-01/720/seg_1.m4s']);
		assert.ok(calls.some((c) => c.includes('/purge_cache') && c.includes('live.test/hls/sess-synth-01/')));
		const session = (await t.db.prepare("SELECT vod_url, vod_ready_at FROM live_sessions WHERE id = 'sess-synth-01'").bind().first()) as any;
		assert.deepEqual({ ...session }, { vod_url: null, vod_ready_at: null });
		assert.ok((await manifestOf(t)).completedAt);
	});

	it('a Bunny recording is kept, then deleted at Bunny', async () => {
		const t = setup();
		(t.env as Record<string, unknown>).bunny_hostname = 'vz-synth.b-cdn.net';
		const state = bunny({ exists: true, finished: true, file: `${PLACEHOLDER}-bunny` });
		const job = await start(t, [['sess-synth-02', 'bunny', GUID]]);
		assert.equal(job.status, 'succeeded', job.lastError);
		assert.equal(await (await t.call('GET', `/cases/${CASE}/files/06-live-recording-1.mp4`)).text(), `${PLACEHOLDER}-bunny`);
		assert.equal(state.exists, false);
	});

	it('while Bunny is still processing, nothing is deleted, the case says what to do, and the retry finishes it', async () => {
		const t = setup();
		(t.env as Record<string, unknown>).bunny_hostname = 'vz-synth.b-cdn.net';
		const state = bunny({ exists: true, finished: false, file: `${PLACEHOLDER}-bunny` });
		const job = await start(t, [['sess-synth-02', 'bunny', GUID]]);
		assert.equal(job.status, 'failed');
		assert.match(job.lastError, /Nobody can reach the stream.*bunny-guid-01.*still processing.*retry/);
		assert.equal(state.exists, true);
		assert.equal(record(t).isHidden, true, 'out of reach all the same');
		state.finished = true;
		await t.json('POST', '/retry', { caseId: CASE });
		await t.drain();
		assert.equal((await jobOf(t)).status, 'succeeded', (await jobOf(t)).lastError);
		assert.equal(state.exists, false);
		assert.ok((await manifestOf(t)).files.some((f: { name: string }) => f.name === '06-live-recording-1.mp4'));
	});

	it('a recording that cannot be copied is never deleted; once a person has removed it, the retry finishes', async () => {
		const t = setup();
		(t.env as Record<string, unknown>).bunny_hostname = 'vz-synth.b-cdn.net';
		const state = bunny({ exists: true, finished: true, file: null });
		const job = await start(t, [['sess-synth-02', 'bunny', GUID]]);
		assert.equal(job.status, 'failed');
		assert.match(job.lastError, /could not be copied; download it/);
		assert.ok(state.exists && !calls.some((c) => c.startsWith('DELETE https://video.bunnycdn.com')));
		state.exists = false;
		await t.json('POST', '/retry', { caseId: CASE });
		await t.drain();
		assert.equal((await jobOf(t)).status, 'succeeded', (await jobOf(t)).lastError);
		assert.ok((await manifestOf(t)).missing.some((m: { name: string }) => m.name === '06-live-recording-1.mp4'), 'the manifest says it was not copied');
	});

	it('ending the stream does not remove what was streamed before it is kept, even with recording off', async () => {
		const t = setup();
		t.env.videos.store.set('livestream:live-synth-01', JSON.stringify({ ...record(t), status: 'live', sessionId: 'sess-synth-01' }));
		t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_1.m4s', PLACEHOLDER);
		await t.db.prepare("INSERT INTO live_sessions (id, stream_id, provider, status, reason, created_at) VALUES ('sess-synth-01', 'live-synth-01', 'selfhosted', 'live', 'round_robin', 1)").run();
		await finalizeSelfHosted(t.env as never, { id: 'sess-synth-01', stream_id: 'live-synth-01' } as never, { recordVod: false });
		assert.equal(t.env.LIVE_MEDIA.store.size, 0, 'an ordinary stream keeps nothing');
		t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_1.m4s', PLACEHOLDER);
		t.env.videos.store.set('livestream:live-synth-01', JSON.stringify({ ...record(t), csamTakedown: { caseId: CASE } }));
		await finalizeSelfHosted(t.env as never, { id: 'sess-synth-01', stream_id: 'live-synth-01' } as never, { recordVod: false });
		assert.equal(t.env.LIVE_MEDIA.store.size, 1);
	});

	it('ending it publishes no recording and starts no review', async () => {
		const t = setup();
		(t.env as Record<string, unknown>).LIVE_PUBLIC_HOST = 'live.test';
		t.env.videos.store.set('livestream:live-synth-01', JSON.stringify({ ...record(t), csamTakedown: { caseId: CASE } }));
		t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_1.m4s', PLACEHOLDER);
		await t.db.prepare("INSERT INTO live_sessions (id, stream_id, provider, status, reason, created_at) VALUES ('sess-synth-01', 'live-synth-01', 'selfhosted', 'ended', 'round_robin', 1)").run();
		await t.db.prepare("INSERT INTO live_segments (session_id, rendition, seq, uri, duration, bytes, received_at) VALUES ('sess-synth-01', '720', 1, 'seg_1.m4s', 2, 10, 1)").run();
		const ready: string[] = [];
		setOnVodReady(async (_env, s) => void ready.push(s.id));
		await finalizeSelfHosted(t.env as never, { id: 'sess-synth-01', stream_id: 'live-synth-01' } as never, { recordVod: true });
		setOnVodReady(null);
		assert.deepEqual([...t.env.LIVE_MEDIA.store.keys()], ['live/sess-synth-01/720/seg_1.m4s']);
		assert.equal(((await t.db.prepare("SELECT vod_url FROM live_sessions WHERE id = 'sess-synth-01'").bind().first()) as any).vod_url, null);
		assert.deepEqual(ready, []);
		const sent: unknown[] = [];
		Object.assign(t.env, { TRANSCODE_QUEUE: { send: async (m: unknown) => void sent.push(m) }, VIDEO_REVIEW_ALLOWED: 'true' });
		(t.env as any).global_settings = new MemoryBucket({ [VIDEO_REVIEW_SETTINGS_KEY]: { mode: 'shadow' } });
		clearVideoReviewSettingsCache();
		const out = await startLiveVodReview(t.env as never, 'live-synth-01', { id: 'sess-synth-01', vod_url: 'https://live.test/hls/sess-synth-01/vod.m3u8' });
		clearVideoReviewSettingsCache();
		assert.deepEqual(out, { started: false, why: 'taken down' });
		assert.equal(sent.length, 0);
	});

	it('a recording of many small segments is copied within the reads of a step, and what began is never left behind', async () => {
		const t = setup();
		const keys = { current: { key: await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']), version: 1 } } as never;
		const plan = { name: '06-live-recording-1.mp4', source: { type: 'live' as const, sessionId: 'sess-synth-01', rendition: '720' }, contentType: 'video/mp4' };
		const segment = new Uint8Array(40_000).fill(7);
		for (let n = 0; n < 900; n++) t.env.LIVE_MEDIA.store.set(`live/sess-synth-01/720/seg_${n}.m4s`, { bytes: segment, meta: undefined });
		let reads = 0;
		const get = t.env.LIVE_MEDIA.get.bind(t.env.LIVE_MEDIA);
		(t.env.LIVE_MEDIA as any).get = async (key: string, opts: never) => ((reads += 1), get(key, opts));
		let state: CopyState = { file: 0, parts: [], chunk: 0, chunkSha256: [], bytes: 0 };
		let steps = 0;
		for (;;) {
			reads = 0;
			const step = await copyStep(t.env as never, keys, CASE, plan, state);
			steps++;
			assert.ok(reads <= STEP_READS + 5, `${reads} reads`);
			if (step.status === 'file_done') {
				assert.equal(step.file!.bytes, 900 * 40_000);
				break;
			}
			state = step.state;
		}
		assert.ok(steps > 1);
		// A failure in the step that began the upload aborts it
		(t.env.LIVE_MEDIA as any).get = async () => { throw new Error('unavailable'); };
		(t.env.LIVE_MEDIA as any).head = async () => null;
		(t.env.LIVE_MEDIA as any).get = async (key: string) => (key.endsWith('.m3u8') ? null : Promise.reject(new Error('unavailable')));
		await assert.rejects(copyStep(t.env as never, keys, CASE, plan, { file: 0, parts: [], chunk: 0, chunkSha256: [], bytes: 0 }), /unavailable/);
		assert.equal(t.env.CSAM_EVIDENCE.uploads.size, 0);
		// Segments too small to read even one part of it: a person has to
		t.env.LIVE_MEDIA.store.clear();
		(t.env.LIVE_MEDIA as any).get = get;
		for (let n = 0; n < 700; n++) t.env.LIVE_MEDIA.store.set(`live/sess-synth-01/720/seg_${n}.m4s`, { bytes: new Uint8Array(10), meta: undefined });
		await assert.rejects(copyStep(t.env as never, keys, CASE, plan, { file: 0, parts: [], chunk: 0, chunkSha256: [], bytes: 0 }), /too many to read/);
		assert.equal(t.env.CSAM_EVIDENCE.uploads.size, 0);
	});

	it('a copy starts over when its source changed under it', async () => {
		const t = setup();
		const keys = { current: { key: await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']), version: 1 } } as never;
		const plan = { name: '06-live-recording-1.mp4', source: { type: 'live' as const, sessionId: 'sess-synth-01', rendition: '720' }, contentType: 'video/mp4' };
		t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_1.m4s', 'one');
		const upload = await t.env.CSAM_EVIDENCE.createMultipartUpload('cases/x');
		const step = await copyStep(t.env as never, keys, CASE, plan, { file: 0, uploadId: upload.uploadId, size: 2, parts: [{ partNumber: 1, etag: 'e' }], chunk: 1, chunkSha256: ['x'], bytes: 2 });
		assert.deepEqual(step, { status: 'copying', state: { file: 0, parts: [], chunk: 0, chunkSha256: [], bytes: 0 } });
		assert.equal(t.env.CSAM_EVIDENCE.uploads.size, 0);
		// The same size, made of something else
		const other = await t.env.CSAM_EVIDENCE.createMultipartUpload('cases/x');
		const again = await copyStep(t.env as never, keys, CASE, plan, { file: 0, uploadId: other.uploadId, size: 3, list: 'another', parts: [{ partNumber: 1, etag: 'e' }], chunk: 1, chunkSha256: ['x'], bytes: 3 });
		assert.deepEqual(again, step);
	});

	it('a file Bunny answers with while it is still encoding is not the recording', async () => {
		const t = setup();
		(t.env as Record<string, unknown>).bunny_hostname = 'vz-synth.b-cdn.net';
		const state = bunny({ exists: true, finished: false, file: `${PLACEHOLDER}-part`, early: true });
		assert.equal((await start(t, [['sess-synth-02', 'bunny', GUID]])).status, 'failed');
		assert.equal(state.exists, true);
		assert.ok(!((await manifestOf(t)).files as Array<{ name: string }>).some((f) => f.name.startsWith('06-')));
	});

	it('a recording that turns up after the plan, and segments that came in after the copy, are kept before they are removed', async () => {
		const t = setup();
		(t.env as Record<string, unknown>).bunny_hostname = 'vz-synth.b-cdn.net';
		const state = bunny({ exists: false, finished: true, file: `${PLACEHOLDER}-bunny` });
		t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_1.m4s', 'one|');
		// The rest arrives while the first copy is written to the store
		const put = t.env.CSAM_EVIDENCE.createMultipartUpload.bind(t.env.CSAM_EVIDENCE);
		let late = false;
		(t.env.CSAM_EVIDENCE as any).createMultipartUpload = async (key: string, opts: never) => {
			const upload = await put(key, opts);
			if (late) return upload;
			late = true;
			const complete = upload.complete;
			upload.complete = async (parts: never) => {
				t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_2.m4s', 'two|');
				state.exists = true;
				return complete(parts);
			};
			return upload;
		};
		const job = await start(t, [['sess-synth-01', 'selfhosted', null], ['sess-synth-02', 'bunny', GUID]]);
		assert.equal(job.status, 'succeeded', job.lastError);
		const files = ((await manifestOf(t)).files as Array<{ name: string }>).map((f) => f.name).filter((n) => n.startsWith('06-'));
		assert.equal(files.length, 3);
		const texts = await Promise.all(files.map(async (n) => (await t.call('GET', `/cases/${CASE}/files/${n}`)).text()));
		assert.deepEqual(texts.sort(), [`${PLACEHOLDER}-bunny`, 'one|', 'one|two|'].sort());
		assert.equal(t.env.LIVE_MEDIA.store.size, 0);
		assert.equal(state.exists, false);
	});

	const copies = async (t: ReturnType<typeof setup>) => {
		const files = ((await manifestOf(t)).files as Array<{ name: string }>).map((f) => f.name).filter((n) => n.startsWith('06-'));
		return Promise.all(files.map(async (n) => (await t.call('GET', `/cases/${CASE}/files/${n}`)).text()));
	};
	const toBan = async (t: ReturnType<typeof setup>) => {
		await t.db.prepare("INSERT INTO live_sessions (id, stream_id, provider, status, reason, created_at, first_segment_at) VALUES ('sess-synth-01', 'live-synth-01', 'selfhosted', 'ended', 'round_robin', 1, 1)").run();
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution: { kind: 'live_stream', streamId: 'live-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } });
		await stepTo(t, 'ban');
	};

	it('a late segment is copied before it is removed, however small, in whichever rendition, and where one was before', async () => {
		for (const [what, key, text, expected] of [
			['smaller than the copy', '720/seg_9.m4s', 'x', ['one|two|', 'x']],
			['as long as the copy', '720/seg_9.m4s', '12345678', ['12345678', 'one|two|']],
			['a moment another rendition lacks', '360/seg_9.m4s', 'low', ['low', 'one|two|']],
			['another one under a name that was copied', '720/seg_1.m4s', 'uno|', ['one|two|', 'uno|']],
		] as Array<[string, string, string, string[]]>) {
			const t = setup();
			const put = (path: string, value: string) => t.env.LIVE_MEDIA.set(`live/sess-synth-01/${path}`, value);
			put('720/seg_1.m4s', 'one|');
			put('720/seg_2.m4s', 'two|');
			put('360/seg_1.m4s', '1');
			await toBan(t);
			assert.equal(t.env.LIVE_MEDIA.store.size, 0, what);
			put(key, text);
			await t.drain();
			const job = await jobOf(t);
			assert.equal(job.status, 'succeeded', `${what}: ${job.lastError}`);
			assert.deepEqual((await copies(t)).sort(), expected, what);
			assert.equal(t.env.LIVE_MEDIA.store.size, 0, what);
		}
	});

	it('what only a lesser rendition has is copied from there, while the best one is still stored', async () => {
		const t = setup();
		for (const n of [1, 2]) t.env.LIVE_MEDIA.set(`live/sess-synth-01/720/seg_${n}.m4s`, `long ${n}|`);
		t.env.LIVE_MEDIA.set('live/sess-synth-01/360/seg_1.m4s', '1');
		await t.db.prepare("INSERT INTO live_sessions (id, stream_id, provider, status, reason, created_at, first_segment_at) VALUES ('sess-synth-01', 'live-synth-01', 'selfhosted', 'ended', 'round_robin', 1, 1)").run();
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution: { kind: 'live_stream', streamId: 'live-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } });
		await stepTo(t, 'purge-public');
		t.env.LIVE_MEDIA.set('live/sess-synth-01/360/seg_3.m4s', '3');
		await t.drain();
		assert.equal((await jobOf(t)).status, 'succeeded', (await jobOf(t)).lastError);
		assert.deepEqual((await copies(t)).sort(), ['13', 'long 1|long 2|']);
		assert.equal(t.env.LIVE_MEDIA.store.size, 0);
	});

	it('what comes in, or changes, between the question and the removal stays for the copy', async () => {
		for (const [key, text] of [['720/seg_5.m4s', 'late'], ['720/seg_1.m4s', 'uno|']] as const) {
			const t = setup();
			t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_1.m4s', 'one|');
			const list = t.env.LIVE_MEDIA.list.bind(t.env.LIVE_MEDIA);
			let once = false;
			const at = await (async () => {
				await t.db.prepare("INSERT INTO live_sessions (id, stream_id, provider, status, reason, created_at, first_segment_at) VALUES ('sess-synth-01', 'live-synth-01', 'selfhosted', 'ended', 'round_robin', 1, 1)").run();
				await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution: { kind: 'live_stream', streamId: 'live-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } });
				return stepTo(t, 'purge-public');
			})();
			assert.ok(at);
			let wholeListings = 0;
			(t.env.LIVE_MEDIA as any).list = async (o: any) => {
				// The first listing of the whole session asks what is kept; the second is the removal's
				if (o.prefix === 'live/sess-synth-01/' && !o.delimiter && ++wholeListings === 2 && !once) {
					once = true;
					t.env.LIVE_MEDIA.set(`live/sess-synth-01/${key}`, text);
				}
				return list(o);
			};
			await t.drain();
			assert.equal((await jobOf(t)).status, 'succeeded', (await jobOf(t)).lastError);
			assert.ok(once);
			assert.ok((await copies(t)).some((c) => c.includes(text)), `${key} was copied`);
			assert.equal(t.env.LIVE_MEDIA.store.size, 0);
		}
	});

	it('a removal that goes on where it stopped copies nothing again, and an object changed under a copy starts it over', async () => {
		const t = setup();
		for (const n of [1, 2, 3]) t.env.LIVE_MEDIA.set(`live/sess-synth-01/720/seg_${n}.m4s`, `${n}|`);
		t.env.LIVE_MEDIA.set('live/sess-synth-01/360/seg_2.m4s', 'low');
		t.env.LIVE_MEDIA.set('live/sess-synth-01/master.m3u8', '#EXTM3U');
		await t.db.prepare("INSERT INTO live_sessions (id, stream_id, provider, status, reason, created_at, first_segment_at) VALUES ('sess-synth-01', 'live-synth-01', 'selfhosted', 'ended', 'round_robin', 1, 1)").run();
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution: { kind: 'live_stream', streamId: 'live-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER } });
		// Replaced by another of the same size while the copy reads it
		const get = t.env.LIVE_MEDIA.get.bind(t.env.LIVE_MEDIA);
		let changed = false;
		(t.env.LIVE_MEDIA as any).get = async (key: string, opts: any) => {
			const object = await get(key, opts);
			if (key.endsWith('seg_3.m4s') && !changed) {
				changed = true;
				t.env.LIVE_MEDIA.set('live/sess-synth-01/720/seg_1.m4s', 'A|');
			}
			return object;
		};
		await stepTo(t, 'purge-public');
		assert.ok(changed);
		// Some of it was removed by a run that stopped
		t.env.LIVE_MEDIA.store.delete('live/sess-synth-01/720/seg_1.m4s');
		t.env.LIVE_MEDIA.store.delete('live/sess-synth-01/720/seg_2.m4s');
		await t.drain();
		assert.equal((await jobOf(t)).status, 'succeeded', (await jobOf(t)).lastError);
		assert.deepEqual(await copies(t), ['A|2|3|']);
		assert.equal(t.env.LIVE_MEDIA.store.size, 0);
		const list = JSON.parse(await (await t.call('GET', `/cases/${CASE}/files/segments-of-recording-1.json`)).text());
		assert.deepEqual(list.parts.map(([key]: [string]) => key), [1, 2, 3].map((n) => `live/sess-synth-01/720/seg_${n}.m4s`), 'what the copy holds is in the evidence');
	});

	it('what an earlier run removed is forgotten by the next one', async () => {
		const t = setup();
		const job = await start(t, [['sess-synth-01', 'selfhosted', null]]);
		assert.equal(job.status, 'succeeded', job.lastError);
		const session = (await t.db.prepare("SELECT vod_url, vod_ready_at FROM live_sessions WHERE id = 'sess-synth-01'").bind().first()) as any;
		assert.deepEqual({ ...session }, { vod_url: null, vod_ready_at: null });
	});

	it('a long recording is removed in steps', async () => {
		const t = setup();
		for (let n = 0; n < 2500; n++) t.env.LIVE_MEDIA.set(`live/sess-synth-01/720/seg_${n}.m4s`, 'x'.repeat(1));
		const first = await deleteSessionMedia(t.env as never, 'sess-synth-01', 2, () => true);
		assert.deepEqual(first, { pages: 2, done: false, late: false });
		assert.equal(t.env.LIVE_MEDIA.store.size, 500);
		assert.deepEqual(await deleteSessionMedia(t.env as never, 'sess-synth-01', 2, () => true), { pages: 1, done: true, late: false });
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

	const URL_OF = 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg';
	const RESOLUTION = { kind: 'video_thumbnail', videoId: 'vid-synth-01', channelId: 'chan-synth-01', uploaderId: OWNER };

	it('its row is there before the item is touched, and a hide that failed is made up for', async () => {
		const t = setup();
		seedOriginal(t.env);
		const put = t.env.videos.put.bind(t.env.videos);
		const seen: boolean[] = [];
		(t.env.videos as any).put = async (...args: [string, string]) => {
			seen.push(!!t.db.db.prepare("SELECT 1 FROM admin_jobs WHERE kind = 'csam.contain' AND target_kind = 'video' AND target_id = 'vid-synth-01'").get());
			throw new Error('R2 down');
		};
		const input = { caseId: CASE, matchedUrl: URL_OF, resolution: RESOLUTION };
		assert.equal((await t.json('POST', '/contain', input)).status, 500);
		assert.ok(seen.length && seen.every(Boolean), 'the row first');
		assert.equal(await takePart(t.db as never, 'erase', 'd', [{ kind: 'video', id: 'vid-synth-01' }]), false, 'from then on no erasure starts');
		(t.env.videos as any).put = put;
		// Asked again: hidden at once
		assert.equal((await t.json('POST', '/contain', input)).body.result.existing, true);
		assert.ok(t.env.videos.read('vid-synth-01').suspensionHolds.includes(CSAM_HOLD));
		// Not asked again: the job hides it first
		const u = setup();
		seedOriginal(u.env);
		(u.env.videos as any).put = async () => { throw new Error('R2 down'); };
		const putU = MemoryBucket.prototype.put.bind(u.env.videos);
		await u.json('POST', '/contain', input);
		(u.env.videos as any).put = putU;
		let hiddenFirst: boolean | null = null;
		const evidencePut = u.env.CSAM_EVIDENCE.put.bind(u.env.CSAM_EVIDENCE);
		(u.env.CSAM_EVIDENCE as any).put = async (...args: any[]) => {
			hiddenFirst ??= !!u.env.videos.read('vid-synth-01').isHidden;
			return (evidencePut as any)(...args);
		};
		await u.drain();
		assert.equal(hiddenFirst, true);
		assert.equal((await u.json('GET', `/cases/${CASE}/job`)).body.result.job.status, 'succeeded');
	});

	const V = { kind: 'video' as const, id: 'vid-synth-01' };
	const eraseJob = async (t: ReturnType<typeof setup>) => (await createJob(t.env as never, { kind: ERASE_MEDIA_JOB, targetKind: 'user', targetId: 'deleted-user', actorId: 'system', params: { items: [] } })).id;

	it('waits while an erasure is deleting a part of it, then says since when some of it was gone', async () => {
		const t = setup();
		seedOriginal(t.env);
		const erase = await eraseJob(t);
		t.db.db.prepare("UPDATE admin_jobs SET status = 'running' WHERE id = ?").run(erase);
		assert.equal(await takePart(t.db as never, erase, 'd', [V]), true);
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: URL_OF, resolution: RESOLUTION });
		const before = t.env.MEDIA.store.size;
		const { job: row } = (await t.json('GET', `/cases/${CASE}/job`)).body.result;
		const out = (await ADMIN_JOB_HANDLERS['csam.contain']!(t.env as never, row)) as Record<string, any>;
		assert.deepEqual([out.done, out.delaySeconds], [false, 30]);
		assert.match(out.note, /account erasure/);
		assert.equal(t.env.MEDIA.store.size, before, 'nothing copied or deleted yet');
		assert.equal(t.env.CSAM_EVIDENCE.store.size, 0);
		assert.ok(t.env.videos.read('vid-synth-01').isHidden, 'hidden meanwhile');
		assert.equal(await takePart(t.db as never, erase, 'd', [V]), false, 'and the erasure gets no further');
		await endParts(t.db as never, erase, 'd', 'deleted');
		t.db.db.prepare("UPDATE admin_jobs SET status = 'failed' WHERE id = ?").run(erase);
		await t.drain();
		const manifest = (await t.json('GET', `/cases/${CASE}/manifest`)).body.result;
		const { first_deleted_at: first } = t.db.db.prepare('SELECT first_deleted_at FROM media_erase_targets WHERE first_deleted_at IS NOT NULL').get() as Record<string, string>;
		assert.deepEqual(manifest.missing.filter((m: { source: string }) => m.source === 'video vid-synth-01').map((m: { name: string; reason: string }) => [m.name, m.reason.includes(`between ${first}`)]), [['media', true]]);
		assert.ok(manifest.files.some((f: { name: string }) => f.name === '02-video-original'), 'what was left is kept');
	});

	it('an erasure that only looked, or whose job is not at work, is neither waited for nor reported', async () => {
		const t = setup();
		seedOriginal(t.env);
		const erase = await eraseJob(t);
		await takePart(t.db as never, erase, 'd', [V]);
		await endParts(t.db as never, erase, 'd', 'none');
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: URL_OF, resolution: RESOLUTION });
		await t.drain();
		const manifest = (await t.json('GET', `/cases/${CASE}/manifest`)).body.result;
		assert.deepEqual(manifest.missing, []);
		const u = setup();
		seedOriginal(u.env);
		const dead = await eraseJob(u);
		await takePart(u.db as never, dead, 'd', [V]);
		u.db.db.prepare("UPDATE admin_jobs SET status = 'failed' WHERE id = ?").run(dead);
		await u.json('POST', '/contain', { caseId: CASE, matchedUrl: URL_OF, resolution: RESOLUTION });
		await u.drain();
		assert.match((await u.json('GET', `/cases/${CASE}/manifest`)).body.result.missing[0].reason, /may have removed part of its media/);
	});

	it('works from what an account erasure wrote down when the record is gone, and keeps it from the erasure', async () => {
		const t = setup();
		const size = seedOriginal(t.env);
		await eraseMediaHooks(t.env).onVideoDeleted('vid-synth-01', t.env.videos.read('vid-synth-01'), 'vid-synth-01');
		t.env.videos.store.delete('vid-synth-01');
		const pageUrl = 'https://alummahnow.net/en/video/vid-synth-01';
		const resolved = (await t.json('POST', '/resolve', { url: pageUrl })).body.result;
		assert.deepEqual(resolved.resolution, { kind: 'video', videoId: 'vid-synth-01', channelId: 'chan-synth-01', uploaderId: null });
		assert.deepEqual((await t.json('POST', '/resolve-by-hand', { kind: 'video', videoId: 'vid-synth-01' })).body.result, resolved.resolution);
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: pageUrl, resolution: resolved.resolution });
		const { job: row } = (await t.json('GET', `/cases/${CASE}/job`)).body.result;
		// A request that stopped before the hold: the job holds it first
		t.db.db.prepare('DELETE FROM media_erase_targets WHERE held_by IS NOT NULL').run();
		await ADMIN_JOB_HANDLERS['csam.contain']!(t.env as never, row);
		const held = t.db.db.prepare('SELECT job_id, erased_at FROM media_erase_targets WHERE erased_at IS NOT NULL').get() as Record<string, string>;
		assert.deepEqual({ ...(t.db.db.prepare('SELECT target_id, held_by FROM media_erase_targets WHERE held_by IS NOT NULL').get() as object) }, { target_id: 'vid-synth-01', held_by: row.id });
		assert.equal(await takePart(t.db as never, held.job_id, 'd', [V]), false);
		// The erasure's own job comes round meanwhile: untouched
		t.db.db.prepare(`UPDATE admin_jobs SET params = json_remove(params, '$.runAfter') WHERE id = ?`).run(held.job_id);
		const erase = t.db.db.prepare('SELECT * FROM admin_jobs WHERE id = ?').get(held.job_id) as Record<string, any>;
		await ADMIN_JOB_HANDLERS[ERASE_MEDIA_JOB]!(t.env as never, { id: erase.id, params: JSON.parse(erase.params) } as never);
		assert.ok(t.env.MEDIA.store.has('pub/vid-synth-01/r1/thumb.jpg') && t.env.MEDIA_ORIGINALS.store.size > 0);
		t.db.db.prepare("UPDATE admin_jobs SET status = 'failed' WHERE id = ?").run(held.job_id);
		await t.drain();
		const job = (await t.json('GET', `/cases/${CASE}/job`)).body.result.job;
		assert.equal(job.status, 'succeeded', job.lastError);
		const manifest = (await t.json('GET', `/cases/${CASE}/manifest`)).body.result;
		const names = manifest.files.map((f: { name: string }) => f.name).sort();
		assert.deepEqual(names, ['02-video-original', '03-thumbnail.jpg', '04-custom-thumbnail.jpg', 'erased-video.json', 'record-channel.json']);
		assert.equal(manifest.files.find((f: { name: string }) => f.name === '02-video-original').bytes, size);
		assert.deepEqual(manifest.missing, [{ name: 'record', source: 'video vid-synth-01', reason: `the record was erased on ${held.erased_at} by account deletion; its media was kept` }]);
		// Purged by the case, the custom thumbnail too
		assert.equal(images.has('/thumbnails/vid-synth-01/custom.jpg'), false);
		assert.equal(t.env.MEDIA.store.size, 0);
		assert.ok(calls.some((c) => c.startsWith('DELETE https://video.bunnycdn.com/library/7/videos/vid-synth-01')));
	});

	it('copies and purges the Bunny video of an erased record by its own id there', async () => {
		const t = setup();
		(t.env as Record<string, unknown>).bunny_hostname = 'vz-x.b-cdn.net';
		const record = { ...t.env.videos.read('vid-synth-01'), media: { providers: { bunny: { ref: 'guid-1' } } } };
		await eraseMediaHooks(t.env).onVideoDeleted('vid-synth-01', record, 'vid-synth-01');
		t.env.videos.store.delete('vid-synth-01');
		t.db.db.prepare("UPDATE admin_jobs SET status = 'failed' WHERE kind = ?").run(ERASE_MEDIA_JOB);
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution: { kind: 'video', videoId: 'vid-synth-01', channelId: null, uploaderId: null } });
		await t.drain();
		assert.ok(calls.some((c) => c.startsWith('GET https://vz-x.b-cdn.net/guid-1/')), 'its source');
		assert.ok(calls.some((c) => c.startsWith('DELETE https://video.bunnycdn.com/library/7/videos/guid-1')));
		assert.ok(!calls.some((c) => /(b-cdn\.net|videos)\/vid-synth-01/.test(c)), 'never by another');
	});

	it('and for a post, a channel image and a profile image', async () => {
		const t = setup();
		const hooks = eraseMediaHooks(t.env);
		await hooks.onPostDeleted('chan-synth-01', 'post-synth-01', t.env.community_posts.read('posts/chan-synth-01/post-synth-01.json'));
		await hooks.onChannelDeleted('chan-synth-01', t.env.channels.read('chan-synth-01'));
		await hooks.onProfileDeleted(OWNER, t.env.profiles.read(OWNER));
		t.env.community_posts.store.clear();
		t.env.channels.store.clear();
		t.env.profiles.store.clear();
		const byHand = async (input: unknown) => (await t.json('POST', '/resolve-by-hand', input)).body.result;
		assert.deepEqual(await byHand({ kind: 'profile_image', id: OWNER, field: 'avatarUrl' }), { kind: 'profile_image', imageField: 'avatarUrl', imagePath: '/avatar-placeholder_avatar.jpeg', channelId: null, uploaderId: null });
		assert.deepEqual(await byHand({ kind: 'channel_image', id: 'chan-synth-01', field: 'coverUrl' }), { kind: 'channel_image', channelId: 'chan-synth-01', imageField: 'coverUrl', imagePath: '/cover-placeholder_cover.png', uploaderId: null });
		assert.deepEqual(await byHand({ kind: 'post', channelId: 'chan-synth-01', postId: 'post-synth-01' }), { kind: 'post_image', channelId: 'chan-synth-01', postId: 'post-synth-01', uploaderId: null });
		assert.equal((await t.json('POST', '/resolve', { url: 'https://images.alummahnow.net/community-posts/chan-synth-01/a.jpg' })).body.result.ok, true);
		const resolved = (await t.json('POST', '/resolve', { url: 'https://www.alummahnow.net/channels/chan-synth-01?post=post-synth-01' })).body.result;
		assert.equal(resolved.ok, true);
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution: resolved.resolution });
		const jobs = t.db.db.prepare('SELECT id FROM admin_jobs WHERE kind = ?').all(ERASE_MEDIA_JOB) as Array<{ id: string }>;
		assert.equal(await takePart(t.db as never, jobs[0].id, 'd', [{ kind: 'channel', id: 'chan-synth-01' }]), false, 'the folder its images are in');
		t.db.db.prepare("UPDATE admin_jobs SET status = 'failed' WHERE kind = ?").run(ERASE_MEDIA_JOB);
		await t.drain();
		const manifest = (await t.json('GET', `/cases/${CASE}/manifest`)).body.result;
		assert.deepEqual(manifest.files.map((f: { name: string }) => f.name).sort(), ['05-post-image-1.jpg', '05-post-image-2.jpg', 'erased-post.json']);
		assert.ok(manifest.missing.some((m: { source: string; reason: string }) => m.source === 'post chan-synth-01/post-synth-01' && /its media was kept/.test(m.reason)));
		assert.equal(images.has('/community-posts/chan-synth-01/a.jpg'), false, 'then purged');
	});

	it('a case on an erased profile names no account, bans none, and holds the image all the same', async () => {
		for (const how of ['url', 'hand', 'erased after it was mapped'] as const) {
			const t = setup();
			await recordImageOwner(t.db as never, 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg', { kind: 'profile_avatar', ownerId: OWNER });
			const resolve = async () => (how === 'hand' ? (await t.json('POST', '/resolve-by-hand', { kind: 'profile_image', id: OWNER, field: 'avatarUrl' })).body.result : (await t.json('POST', '/resolve', { url: 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg' })).body.result.resolution);
			const early = await resolve();
			assert.equal(early.uploaderId, OWNER, 'while the profile is there');
			await eraseMediaHooks(t.env).onProfileDeleted(OWNER, t.env.profiles.read(OWNER));
			t.env.profiles.store.clear();
			const resolution = how === 'erased after it was mapped' ? early : await resolve();
			if (how !== 'erased after it was mapped') assert.deepEqual(resolution, { kind: 'profile_image', imageField: 'avatarUrl', imagePath: '/avatar-placeholder_avatar.jpeg', channelId: null, uploaderId: null });
			const started = await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'https://images.alummahnow.net/avatar-placeholder_avatar.jpeg', resolution });
			assert.equal(started.status, 200, JSON.stringify(started.body));
			// For admin-api's freeze, told to the intake alone
			assert.equal(started.body.result.account, how === 'erased after it was mapped' ? undefined : OWNER);
			const asked = await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'x', resolution });
			assert.deepEqual([asked.body.result.existing, asked.body.result.account], [true, started.body.result.account]);
			const erase = t.db.db.prepare('SELECT id FROM admin_jobs WHERE kind = ?').get(ERASE_MEDIA_JOB) as { id: string };
			assert.equal(await takePart(t.db as never, erase.id, 'd', [{ kind: 'user', id: OWNER }]), false, 'held at once');
			assert.equal(await takePart(t.db as never, erase.id, 'd', [{ kind: 'channel', id: 'x' }, { kind: 'user', id: OWNER }]), false);
			t.db.db.prepare("UPDATE admin_jobs SET status = 'failed' WHERE kind = ?").run(ERASE_MEDIA_JOB);
			await t.drain();
			const job = (await t.json('GET', `/cases/${CASE}/job`)).body.result.job;
			assert.equal(job.status, 'succeeded', job.lastError);
			assert.equal(job.result.ban, how === 'erased after it was mapped' ? 'account_erased' : 'no_uploader');
			assert.equal(await t.db.prepare('SELECT user_id FROM videos_bans').first(), null);
			assert.equal(t.db.db.prepare("SELECT COUNT(*) AS n FROM admin_jobs WHERE kind = 'user.sync-holds'").get()!.n, 0);
			const manifest = (await t.json('GET', `/cases/${CASE}/manifest`)).body.result;
			assert.ok(manifest.files.some((f: { name: string }) => f.name === '01-matched-image.jpeg'), 'the evidence');
			assert.match(manifest.missing[0].reason, /the record was erased on .* its media was kept/);
			if (how !== 'erased after it was mapped') assert.ok(!JSON.stringify([job, manifest]).includes(OWNER), 'nothing names it');
			assert.equal(t.db.db.prepare('SELECT COUNT(*) AS n FROM media_erase_targets WHERE held_by IS NOT NULL').get()!.n, 0, 'the hold ends with the case');
		}
	});

	it('an account is told of only by the image\'s own upload row, and only for an erased profile', async () => {
		const t = setup();
		const path = '/avatar-placeholder_avatar.jpeg';
		const ask = async (caseId: string, resolution: object) => (await t.json('POST', '/contain', { caseId, matchedUrl: 'x', resolution })).body.result.account;
		const image = { kind: 'profile_image', imageField: 'avatarUrl', imagePath: path, channelId: null };
		assert.equal(await ask('case-synthetic-a', { ...image, uploaderId: null }), undefined, 'no row');
		t.db.db.prepare("INSERT INTO image_owners (path, kind, owner_id, channel_id, created_at) VALUES (?, 'profile_avatar', ?, NULL, '2026-11-01T00:00:00.000Z')").run(path, OWNER);
		assert.equal(await ask('case-synthetic-b', { ...image, uploaderId: null }), undefined, 'a guess');
		t.db.db.prepare("UPDATE image_owners SET created_at = '2026-11-01T00:00:00.000+00:00', channel_id = 'chan-synth-01'").run();
		assert.equal(await ask('case-synthetic-c', { ...image, uploaderId: null }), undefined, 'a channel\'s');
		t.db.db.prepare('UPDATE image_owners SET channel_id = NULL').run();
		assert.equal(await ask('case-synthetic-d', { ...image, uploaderId: null }), OWNER);
		assert.equal(await ask('case-synthetic-e', { ...image, uploaderId: OWNER }), undefined, 'the case names it');
		assert.equal(await ask('case-synthetic-f', { kind: 'post_image', channelId: 'chan-synth-01', imagePath: path, uploaderId: null }), undefined);
	});

	it('the purges of deleted records wait for it, and it for them', async () => {
		const t = setup();
		seedOriginal(t.env);
		const env = t.env as Record<string, any>;
		env.channel_sections = new MemoryBucket();
		env.channel_tabs = new MemoryBucket();
		for (const kind of ['channel', 'video', 'playlist', 'stream'] as const) await runOwnershipPass(env as never, kind, { maxPages: 10 });
		const set = (bucket: string, key: string, over: object) => env[bucket].store.set(key, JSON.stringify({ ...env[bucket].read(key), ...over }));
		set('videos', 'vid-synth-01', { isDeleted: true });
		set('channels', 'chan-synth-01', { isDeleted: true });
		set('community_posts', 'posts/chan-synth-01/post-synth-01.json', { status: 'deleted' });
		const run = (kind: 'video.purge' | 'channel.purge', targetId: string) => ADMIN_JOB_HANDLERS[kind]!(env as never, { id: `job-${kind}`, kind, targetKind: kind.split('.')[0], targetId, params: { userId: OWNER, channelId: 'chan-synth-01' } } as never) as Promise<Record<string, any>>;
		const post = () => purgeDeletion(env as never, { kind: 'post', id: 'post-synth-01', parentId: 'chan-synth-01' } as never);
		const V2 = await createJob(env as never, { kind: 'csam.contain', targetKind: 'video', targetId: 'vid-synth-01', actorId: 'system', params: {} });
		const CH = await createJob(env as never, { kind: 'csam.contain', targetKind: 'channel', targetId: 'chan-synth-01', actorId: 'system', params: {} });
		const kept = () => [env.MEDIA.store.has('pub/vid-synth-01/r1/thumb.jpg'), env.videos.store.has('vid-synth-01'), images.has('/community-posts/chan-synth-01/a.jpg'), env.community_posts.store.has('posts/chan-synth-01/post-synth-01.json'), env.channels.store.has('chan-synth-01')];
		for (const outcome of [await run('video.purge', 'vid-synth-01'), await run('channel.purge', 'chan-synth-01')]) {
			assert.deepEqual([outcome.done, outcome.delaySeconds, outcome.note], [false, 3600, 'a takedown case is open']);
			assert.equal(outcome.params.channelId, 'chan-synth-01', 'as it was: it comes again');
		}
		await assert.rejects(post(), /a takedown case is open/);
		assert.deepEqual(kept(), [true, true, true, true, true]);
		// One of them still: the video alone, then the channel alone
		t.db.db.prepare("UPDATE admin_jobs SET status = 'succeeded' WHERE id = ?").run(CH.id);
		const some = await run('channel.purge', 'chan-synth-01');
		assert.deepEqual([some.done, some.delaySeconds, env.videos.store.has('vid-synth-01')], [false, 3600, true], 'the channel does not go before its video');
		assert.ok(env.channels.store.has('chan-synth-01'));
		// A hold counts as a case does
		t.db.db.prepare("UPDATE admin_jobs SET status = 'succeeded' WHERE id = ?").run(V2.id);
		const other = await createJob(env as never, { kind: 'csam.contain', targetKind: 'channel', targetId: 'elsewhere', actorId: 'system', params: {} });
		await holdTargets(t.db as never, [V], other);
		assert.equal((await run('video.purge', 'vid-synth-01')).delaySeconds, 3600);
		t.db.db.prepare("UPDATE admin_jobs SET status = 'succeeded' WHERE id = ?").run(other.id);
		// And the case waits for a purge that is deleting
		const job = await createJob(env as never, { kind: 'video.purge', targetKind: 'video', targetId: 'vid-synth-01', actorId: 'system', params: {} });
		await takePart(t.db as never, job.id, 'd', [V]);
		await t.json('POST', '/contain', { caseId: CASE, matchedUrl: URL_OF, resolution: RESOLUTION });
		const { job: row } = (await t.json('GET', `/cases/${CASE}/job`)).body.result;
		assert.equal(((await ADMIN_JOB_HANDLERS['csam.contain']!(env as never, row)) as Record<string, any>).delaySeconds, 30);
		await endParts(t.db as never, job.id, 'd', 'none');
		t.db.db.prepare("UPDATE admin_jobs SET status = 'succeeded'").run();
		assert.deepEqual(await run('video.purge', 'vid-synth-01'), { done: true });
		assert.equal(env.MEDIA.store.has('pub/vid-synth-01/r1/thumb.jpg'), false);
		assert.ok(t.db.db.prepare("SELECT first_deleted_at AS at FROM media_erase_targets WHERE job_id = 'job-video.purge'").get()!.at, 'since when, for a later case');
	});

	it('a channel under a case keeps its files and its record, at every stage of its purge', async () => {
		const t = setup();
		const env = t.env as Record<string, any>;
		env.channel_sections = new MemoryBucket();
		env.channel_tabs = new MemoryBucket();
		for (const kind of ['channel', 'video', 'playlist', 'stream'] as const) await runOwnershipPass(env as never, kind, { maxPages: 10 });
		env.channels.store.set('chan-synth-01', JSON.stringify({ ...env.channels.read('chan-synth-01'), isDeleted: true }));
		const open = await createJob(env as never, { kind: 'csam.contain', targetKind: 'channel', targetId: 'chan-synth-01', actorId: 'system', params: {} });
		const run = (params: object) => ADMIN_JOB_HANDLERS['channel.purge']!(env as never, { id: 'p1', kind: 'channel.purge', targetKind: 'channel', targetId: 'chan-synth-01', params: { userId: OWNER, ...params } } as never) as Promise<Record<string, any>>;
		const first = await run({});
		assert.deepEqual([first.delaySeconds, first.params.stage], [3600, undefined]);
		assert.ok(env.community_posts.store.has('posts/chan-synth-01/post-synth-01.json'));
		assert.equal((await run({ stage: 'playlists' })).delaySeconds, 3600);
		assert.ok(env.channels.store.has('chan-synth-01'));
		t.db.db.prepare("UPDATE admin_jobs SET status = 'succeeded' WHERE id = ?").run(open.id);
		assert.equal((await run({})).params.stage, 'playlists');
		assert.equal((await run({ stage: 'playlists' })).done, true);
		assert.deepEqual([env.community_posts.store.has('posts/chan-synth-01/post-synth-01.json'), env.channels.store.has('chan-synth-01')], [false, false]);
	});

	it('a deleted post is purged once no case holds it, and leaves no row', async () => {
		const t = setup();
		const env = t.env as Record<string, any>;
		const key = 'posts/chan-synth-01/post-synth-01.json';
		env.community_posts.store.set(key, JSON.stringify({ ...env.community_posts.read(key), status: 'deleted' }));
		assert.deepEqual(await purgeDeletion(env as never, { kind: 'post', id: 'post-synth-01', parentId: 'chan-synth-01' } as never), { state: 'purged' });
		assert.deepEqual([env.community_posts.store.has(key), images.has('/community-posts/chan-synth-01/a.jpg')], [false, false]);
		assert.equal(t.db.db.prepare('SELECT COUNT(*) AS n FROM media_erase_targets').get()!.n, 0);
	});

	it('finds a case\'s job by its index', async () => {
		const t = setup();
		t.db.trace = [];
		await t.json('GET', `/cases/${CASE}/job`);
		const query = t.db.trace.find((q) => /caseId/.test(q.sql))!;
		const plan = t.db.plan(query).join(' | ');
		t.db.trace = null;
		assert.match(plan, /SEARCH admin_jobs USING INDEX idx_admin_jobs_csam_case/, plan);
		assert.doesNotMatch(plan, /SCAN|TEMP B-TREE/, plan);
	});

	it('leaves nothing listing the video, also while the playlist index is rebuilt, and never waits for it', async () => {
		for (const complete of [true, false]) {
			const t = setup();
			const env = t.env as Record<string, any>;
			env.channel_sections = new MemoryBucket({ 'chan-synth-01/s1.json': { id: 's1', videoIds: ['vid-synth-01', 'other'] } });
			env.playlists = new MemoryBucket({ pl1: { id: 'pl1', userId: OWNER, channelId: 'chan-synth-01', videos: ['other', 'vid-synth-01'] } });
			// The case named the channel the video was on before it moved to this one
			const resolution = { kind: 'video_thumbnail', videoId: 'vid-synth-01', channelId: 'chan-before', uploaderId: OWNER };
			if (complete) await runOwnershipPass(env as never, 'playlist', { maxPages: 10 });
			await t.json('POST', '/contain', { caseId: CASE, matchedUrl: 'https://media.alummahnow.net/pub/vid-synth-01/r1/thumb.jpg', resolution });
			await t.drain();
			assert.equal((await t.json('GET', `/cases/${CASE}/job`)).body.result.job.status, 'succeeded');
			assert.ok(await t.db.prepare('SELECT user_id FROM videos_bans WHERE user_id = ?').bind(OWNER).first());
			assert.equal(t.env.videos.read('vid-synth-01'), null);
			assert.deepEqual(env.playlists.read('pl1').videos, ['other'], `complete ${complete}`);
			assert.deepEqual(env.channel_sections.read('chan-synth-01/s1.json').videoIds, ['other']);
			const jobs = t.db.db.prepare("SELECT status, params FROM admin_jobs WHERE kind = 'video.purge'").all() as Array<{ status: string; params: string }>;
			assert.deepEqual(jobs.map((j) => [j.status, JSON.parse(j.params).channelId, JSON.parse(j.params).referencesOnly]), complete ? [] : [['succeeded', 'chan-synth-01', true]], 'the media is gone by then: only the references');
		}
	});

	it('the purge job a takedown leaves only removes references', async () => {
		const t = setup();
		const env = t.env as Record<string, any>;
		env.playlists = new MemoryBucket({ pl1: { id: 'pl1', userId: OWNER, channelId: 'chan-synth-01', videos: ['vid-synth-01', 'other'] } });
		await runOwnershipPass(env as never, 'playlist', { maxPages: 10 });
		t.env.videos.store.delete('vid-synth-01');
		const real = globalThis.fetch;
		const asked: string[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			asked.push(`${init?.method ?? 'GET'} ${url}`);
			return new Response('{}', { status: 500 });
		}) as typeof fetch;
		try {
			const outcome = (await ADMIN_JOB_HANDLERS['video.purge']!(env as never, { id: 'j', kind: 'video.purge', targetId: 'vid-synth-01', params: { userId: null, channelId: 'chan-synth-01', referencesOnly: true } } as never)) as any;
			assert.equal(outcome.done, true);
		} finally {
			globalThis.fetch = real;
		}
		assert.deepEqual(asked, [], 'no provider or CDN is asked again');
		assert.deepEqual(env.playlists.read('pl1').videos, ['other']);
	});

	it('a takedown that stopped after the record was gone still cleans what lists the video', async () => {
		const t = setup();
		const env = t.env as Record<string, any>;
		env.playlists = new MemoryBucket({ pl1: { id: 'pl1', userId: OWNER, channelId: 'chan-synth-01', videos: ['vid-synth-01'] } });
		await runOwnershipPass(env as never, 'playlist', { maxPages: 10 });
		t.env.videos.store.delete('vid-synth-01');
		await purgeVideoForCsam(env as never, 'vid-synth-01', 'chan-synth-01');
		assert.deepEqual(env.playlists.read('pl1').videos, []);
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

describe('the accounts behind the uploaders', () => {
	it('reads them by user id, deleted ones that are not purged yet included and marked', async () => {
		const t = setup();
		const auth = new AuthDb({ usr_live: 'Live@Example.test' }).add('usr_deleted', 'deleted@example.test', { status: 'deleted', deletedAt: 1 });
		(t.env as Record<string, unknown>).AUTH_DB = auth;
		const res = await t.json('POST', '/accounts', { ids: ['usr_live', 'usr_deleted', 'usr_purged'] });
		assert.deepEqual(res.body.result, { accounts: { usr_live: { email: 'live@example.test', deleted: false }, usr_deleted: { email: 'deleted@example.test', deleted: true } } });
		assert.deepEqual(auth.plans().filter((p) => !/^SEARCH users USING INDEX sqlite_autoindex_users_1 \(id=\?\)/.test(p)), [], 'primary key only');
		assert.equal((await t.json('POST', '/accounts', { ids: [] })).status, 400);
		auth.fail = true;
		assert.equal((await t.json('POST', '/accounts', { ids: ['usr_live'] })).status, 503);
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
