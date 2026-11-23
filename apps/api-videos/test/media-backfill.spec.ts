/** R2 backfill of existing videos (AUN-R2-MIGRATION): estimate, copy + checksums, transcode, verify, budget, flip, Bunny removal. */
import { backfillOverview, resetOverviewCache } from '../src/lib/media/backfill/overview';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { purgeVideoMedia } from '../src/lib/media/r2-delivery';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	backfillCost,
	durationMatches,
	parseBackfillScope,
	parseBackfillSettings,
	playlistUris,
	resolveKey,
	withinBudget,
	DEFAULT_BACKFILL_SETTINGS,
} from '@al-ummah/shared-types';
import { cancelRun, changeSettings, copyMessage, createRun, handleBackfillMessage, pauseRun, retryItem, startRun, restartQuietRuns } from '../src/lib/media/backfill/run';
import { readRun, listItems, getItem } from '../src/lib/media/backfill/store';
import { PART_BYTES, scopePage } from '../src/lib/media/backfill/estimate';
import { uploadIdFor } from '../src/lib/media/backfill/copy';
import { flipChannel, flipGlobal, flipVideos } from '../src/lib/media/backfill/flip';
import { cancelRemovals, librarySummaries, queueDueRemovals, removeFromBunny, scheduleRemovals } from '../src/lib/media/backfill/removal';
import { bunnyRef } from '../src/lib/media/providers';
import { clearMediaSettingsCache, readMediaSettings } from '../src/lib/media/settings';
import { SqliteD1 } from './search-sqlite-d1';

// ---------------------------------------------------------------------------
// A binary R2 bucket whose etag is the MD5 of what it stored (as R2's is for a single put)
// ---------------------------------------------------------------------------
class BinBucket {
	store = new Map<string, Uint8Array>();
	corrupt = false;
	async put(key: string, value: unknown) {
		let bytes: Uint8Array;
		if (typeof value === 'string') bytes = new TextEncoder().encode(value);
		else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
		else if (value instanceof Uint8Array) bytes = value;
		else bytes = new Uint8Array(await new Response(value as ReadableStream).arrayBuffer());
		this.store.set(key, bytes);
		const etag = this.corrupt ? '00000000000000000000000000000000' : createHash('md5').update(bytes).digest('hex');
		return { key, size: bytes.byteLength, etag };
	}
	async get(key: string) {
		const b = this.store.get(key);
		if (!b) return null;
		return { key, size: b.byteLength, text: async () => new TextDecoder().decode(b), json: async () => JSON.parse(new TextDecoder().decode(b)), arrayBuffer: async () => b.buffer };
	}
	async head(key: string) {
		const b = this.store.get(key);
		return b ? { key, size: b.byteLength, etag: createHash('md5').update(b).digest('hex') } : null;
	}
	async list(opts: { prefix?: string }) {
		const objects = [...this.store.entries()].filter(([k]) => k.startsWith(opts.prefix ?? '')).map(([key, b]) => ({ key, size: b.byteLength, uploaded: new Date() }));
		return { objects, truncated: false };
	}
	async delete(keys: string | string[]) {
		for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
	}
}

/** JSON video records with optimistic updates (R2Repository uses get/put/head + etag). */
class JsonBucket {
	store = new Map<string, string>();
	v = new Map<string, number>();
	constructor(init: Record<string, unknown> = {}) {
		for (const [k, val] of Object.entries(init)) this.store.set(k, JSON.stringify(val));
	}
	async get(key: string) {
		const raw = this.store.get(key);
		if (raw === undefined) return null;
		return { key, etag: `v${this.v.get(key) ?? 0}`, httpEtag: `"v${this.v.get(key) ?? 0}"`, json: async () => JSON.parse(raw), text: async () => raw, uploaded: new Date() };
	}
	async head(key: string) {
		return this.store.has(key) ? { key, etag: `v${this.v.get(key) ?? 0}` } : null;
	}
	async put(key: string, value: string, opts?: { onlyIf?: { etagMatches?: string } }) {
		const etag = `v${this.v.get(key) ?? 0}`;
		if (opts?.onlyIf?.etagMatches && opts.onlyIf.etagMatches.replace(/"/g, '') !== etag) return null;
		this.store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
		this.v.set(key, (this.v.get(key) ?? 0) + 1);
		return { key, etag: `v${this.v.get(key)}` };
	}
	async delete(key: string) {
		this.store.delete(key);
	}
	async list() {
		return { objects: [...this.store.keys()].map((key) => ({ key })), truncated: false };
	}
	read(key: string) {
		return JSON.parse(this.store.get(key)!);
	}
}

class Queue {
	sent: { body: any; delaySeconds?: number }[] = [];
	async send(body: unknown, opts?: { delaySeconds?: number }) {
		this.sent.push({ body: JSON.parse(JSON.stringify(body)), delaySeconds: opts?.delaySeconds });
	}
}

const nodeMd5 = () => {
	const h = createHash('md5');
	return { update: (c: Uint8Array) => void h.update(c), hex: async () => h.digest('hex') };
};

const LEGACY_LIB = 400189;
const PRIMARY_LIB = 498994;
const LEGACY_HOST = 'vz-legacy.b-cdn.net';
const id = (n: number) => `0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;
const SOURCE = new Uint8Array(PART_BYTES + 1000).map((_, i) => i % 251);

let bunnyDeletes: string[] = [];
let failRanges = false;
const realFetch = globalThis.fetch;
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input);
	const headers = new Headers(init?.headers);
	if (url.startsWith('https://video.bunnycdn.com/library/')) {
		const [, lib, , guid] = new URL(url).pathname.split('/').filter(Boolean);
		if (init?.method === 'DELETE') {
			bunnyDeletes.push(`${lib}/${guid}`);
			return new Response('{}', { status: 200 });
		}
		return Response.json({ guid, length: 90, height: 720, width: 1280, availableResolutions: '720p,480p', hasOriginal: false, status: 4 });
	}
	if (url.startsWith(`https://${LEGACY_HOST}/`)) {
		if (url.includes('thumbnail.jpg')) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
		if (!url.includes('play_720p.mp4')) return new Response('no', { status: 404 });
		const range = headers.get('range');
		const m = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
		if (!m) return new Response(SOURCE, { status: 200, headers: { 'content-length': String(SOURCE.length) } });
		if (failRanges) return new Response('busy', { status: 503 });
		const start = Number(m[1]);
		const end = Math.min(Number(m[2]), SOURCE.length - 1);
		return new Response(SOURCE.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${SOURCE.length}` } });
	}
	return new Response('unexpected', { status: 599 });
}) as typeof fetch;

function legacyVideo(n: number, extra: Record<string, unknown> = {}) {
	return {
		id: id(n),
		title: `Legacy ${n}`,
		channelId: 'chan-0001-aaaa',
		uploadStatus: 'ready',
		duration: 90,
		playUrl: `https://${LEGACY_HOST}/${id(n)}/playlist.m3u8`,
		thumbnailUrl: `https://${LEGACY_HOST}/${id(n)}/thumbnail.jpg`,
		thumbnailType: 'auto',
		isPublic: true,
		...extra,
	};
}

async function makeEnv(videos: Record<string, unknown>) {
	const db = new SqliteD1();
	for (const [vid, v] of Object.entries(videos) as [string, any][]) {
		await db
			.prepare("INSERT INTO content_ownership (kind, id, owner_id, channel_id, is_deleted, is_live, duration, created_at, indexed_at) VALUES ('video', ?, 'u1', ?, 0, 0, 90, ?, 0)")
			.bind(vid, v.channelId ?? null, Date.parse('2024-05-01T00:00:00Z'))
			.run();
	}
	// History: two finished transcodes (ratio 0.5 container s per video s, 100 kB per s, 1 object per s)
	for (const j of ['hist-0001-aaaa', 'hist-0002-aaaa']) {
		await db
			.prepare("INSERT INTO media_jobs (video_id, job_id, status, access, attempts, queued_at, updated_at, duration_seconds, container_seconds, bytes, objects) VALUES (?, 'j', 'ready', 'pub', 1, 't', 't', 100, 50, 10000000, 100)")
			.bind(j)
			.run();
	}
	return {
		videos: new JsonBucket(videos),
		global_settings: new BinBucket(),
		MEDIA: new BinBucket(),
		MEDIA_PRIVATE: new BinBucket(),
		MEDIA_ORIGINALS: new BinBucket(),
		SEARCH_DB: db,
		TRANSCODE_QUEUE: new Queue(),
		PROCESSING_CHECK_QUEUE: new Queue(),
		MEDIA_PUBLIC_HOST: 'media.qa.alummahnow.net',
		MEDIA_TRANSCODE_CEILING: '2',
		bunny_stream_library_id: String(PRIMARY_LIB),
		'bunny-stream-key': 'primary-key',
		bunny_hostname: 'vz-primary.b-cdn.net',
		BUNNY_LEGACY_LIBRARY_ID: String(LEGACY_LIB),
		BUNNY_LEGACY_HOSTNAME: LEGACY_HOST,
		BUNNY_LEGACY_STREAM_KEY: 'legacy-key',
	} as any;
}

/** Deliver every queued backfill message (ticks only `ticks` times), like the consumer. */
async function drain(env: any, opts: { ticks?: number; onTranscode?: (videoId: string) => Promise<void> } = {}) {
	let ticks = opts.ticks ?? 5;
	const q: Queue = env.PROCESSING_CHECK_QUEUE;
	for (let guard = 0; guard < 200 && q.sent.length; guard++) {
		const { body } = q.sent.shift()!;
		if (body.op === 'tick' && ticks-- <= 0) continue;
		if (opts.onTranscode) {
			while (env.TRANSCODE_QUEUE.sent.length) await opts.onTranscode(env.TRANSCODE_QUEUE.sent.shift()!.body.videoId);
		}
		const outcome: string[] = [];
		let attempts = 1;
		for (;;) {
			outcome.length = 0;
			await handleBackfillMessage(env, undefined, { body, attempts, ack: () => outcome.push('ack'), retry: () => outcome.push('retry') }, { fetch: fakeFetch, md5: nodeMd5, removal: (e, c, v, last) => removeFromBunny(e, c, v, last, fakeFetch) });
			if (outcome[0] !== 'retry' || attempts >= 6) break;
			attempts++;
		}
	}
	if (opts.onTranscode) while (env.TRANSCODE_QUEUE.sent.length) await opts.onTranscode(env.TRANSCODE_QUEUE.sent.shift()!.body.videoId);
}

/** What apps/media would do for a job: write the rendition to R2 and mark the record ready. */
function fakeTranscoder(env: any, opts: { duration?: number; dropSegment?: boolean } = {}) {
	return async (videoId: string) => {
		const rec = env.videos.read(videoId);
		const { rev, access } = rec.r2;
		const prefix = `${access}/${videoId}/${rev}/`;
		const bucket = access === 'pub' ? env.MEDIA : env.MEDIA_PRIVATE;
		await bucket.put(`${prefix}master.m3u8`, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n480p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\n720p/index.m3u8\n');
		for (const rung of ['480p', '720p']) {
			await bucket.put(`${prefix}${rung}/index.m3u8`, '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nseg_00001.m4s\n#EXTINF:6,\nseg_00002.m4s\n');
			await bucket.put(`${prefix}${rung}/init.mp4`, 'init');
			await bucket.put(`${prefix}${rung}/seg_00001.m4s`, 'seg');
			if (!opts.dropSegment) await bucket.put(`${prefix}${rung}/seg_00002.m4s`, 'seg');
		}
		await bucket.put(`${prefix}thumb.jpg`, 'jpg');
		rec.r2 = {
			...rec.r2,
			status: 'ready',
			readyAt: new Date().toISOString(),
			containerSeconds: 40,
			result: {
				rungs: [
					{ name: '480p', width: 854, height: 480, maxrate: 1, bandwidth: 1, bytes: 1, segments: 2 },
					{ name: '720p', width: 1280, height: 720, maxrate: 1, bandwidth: 1, bytes: 1, segments: 2 },
				],
				objects: 12,
				bytes: 5_000_000,
				durationSeconds: opts.duration ?? 90,
				source: { width: 1280, height: 720, durationSeconds: 90, bytes: SOURCE.length, file: 'original' },
				timings: {},
				thumbnail: 'thumb.jpg',
			},
		};
		await env.videos.put(videoId, JSON.stringify(rec));
	};
}

beforeEach(() => {
	globalThis.fetch = fakeFetch;
	bunnyDeletes = [];
	failRanges = false;
	clearMediaSettingsCache();
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('backfill helpers (shared-types)', () => {
	it('validates scopes', () => {
		assert.deepEqual(parseBackfillScope({ kind: 'all' }), { ok: true, scope: { kind: 'all', onlyMissing: false } });
		assert.equal(parseBackfillScope({ kind: 'channel' }).ok, false);
		assert.equal(parseBackfillScope({ kind: 'dates', from: '2025-02-01', to: '2025-01-01' }).ok, false);
		assert.deepEqual(parseBackfillScope({ kind: 'videos', videoIds: [id(1), id(1), ` ${id(2)} `], onlyMissing: true }), { ok: true, scope: { kind: 'videos', videoIds: [id(1), id(2)], onlyMissing: true } });
		assert.equal(parseBackfillScope({ kind: 'videos', videoIds: ['../x'] }).ok, false);
		assert.equal(parseBackfillScope({ kind: 'nope' }).ok, false);
	});
	it('validates settings', () => {
		assert.deepEqual(parseBackfillSettings({ concurrency: 3, budgetUsd: 1.234 }, DEFAULT_BACKFILL_SETTINGS), { ok: true, settings: { ...DEFAULT_BACKFILL_SETTINGS, concurrency: 3, budgetUsd: 1.23 } });
		assert.equal(parseBackfillSettings({ concurrency: 0 }, DEFAULT_BACKFILL_SETTINGS).ok, false);
		assert.equal(parseBackfillSettings({ budgetUsd: 10_001 }, DEFAULT_BACKFILL_SETTINGS).ok, false);
	});
	it('budget, duration and playlist helpers', () => {
		assert.equal(withinBudget(0, 0, 0, 0), false, 'no cap never passes');
		assert.equal(withinBudget(1, 0.5, 0.2, 0.3), true);
		assert.equal(withinBudget(1, 0.5, 0.2, 0.31), false);
		assert.equal(durationMatches(91.5, 90), true);
		assert.equal(durationMatches(1000, 1012), false);
		assert.equal(durationMatches(1000, 1009), true);
		assert.deepEqual(playlistUris('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nseg_1.m4s?x=1\nhttps://cdn/x.ts\n'), ['init.mp4', 'seg_1.m4s']);
		assert.equal(resolveKey('pub/v/r/720p/index.m3u8', '../thumb.jpg'), 'pub/v/r/thumb.jpg');
		const c = backfillCost({ containerInstanceSecond: 0.001, r2GbMonth: 0.015, r2ClassAPerMillion: 4.5, bunnyEgressGb: 0.01 }, { egressBytes: 1024 ** 3, transcodeSeconds: 100, storageBytes: 2 * 1024 ** 3, classAOps: 1e6 });
		assert.deepEqual([c.egressUsd, c.transcodeUsd, c.storageUsdMonth, c.opsUsd, c.totalUsd], [0.01, 0.1, 0.03, 4.5, 4.64]);
	});
});

describe('backfill estimate', () => {
	it('pages the scope from the ownership index', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1), [id(2)]: legacyVideo(2, { channelId: 'chan-0002-bbbb' }) });
		const all = await scopePage(env.SEARCH_DB, { kind: 'all', onlyMissing: false }, null, 1);
		assert.deepEqual([all.rows.map((r) => r.id), all.next], [[id(1)], id(1)]);
		const ch = await scopePage(env.SEARCH_DB, { kind: 'channel', channelId: 'chan-0002-bbbb', onlyMissing: false }, null);
		assert.deepEqual(ch.rows.map((r) => r.id), [id(2)]);
		const dates = await scopePage(env.SEARCH_DB, { kind: 'dates', from: '2024-05-02', onlyMissing: false }, null);
		assert.equal(dates.rows.length, 0);
		const list = await scopePage(env.SEARCH_DB, { kind: 'videos', videoIds: [id(2), id(9)], onlyMissing: false }, null);
		assert.deepEqual(list.rows.map((r) => r.id), [id(2), id(9)]);
	});

	it('estimates from real sizes and measured ratios, and skips what needs nothing', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1), [id(2)]: legacyVideo(2, { isLive: true }), [id(3)]: legacyVideo(3, { suspensionHolds: ['csam'], isHidden: true }) });
		const run = await createRun(env, { kind: 'videos', videoIds: [id(1), id(2), id(3), id(9)], onlyMissing: false }, 'admin-1');
		assert.equal(run.status, 'estimating');
		await drain(env);
		const done = (await readRun(env.SEARCH_DB, run.id))!;
		assert.equal(done.status, 'estimated');
		assert.equal(done.estimate!.videos, 1);
		assert.deepEqual(done.estimate!.skipped, { live: 1, not_found: 1, held: 1 }, 'a held (CSAM) video is never copied');
		assert.equal(done.estimate!.egressBytes, SOURCE.length, "Bunny's Content-Range size");
		assert.equal(done.estimate!.transcodeSeconds, 45, '90 s × 0.5 measured');
		assert.equal(done.estimate!.basis.assumed, false);
		const ceiling = done.estimate!.ceiling!;
		assert.equal(ceiling.transcodeSeconds, 360, '90 s × 4 (the ceiling rate, above the measured 0.5)');
		assert.equal(ceiling.egressBytes, done.estimate!.egressBytes, 'the copy is the real size in both');
		assert.ok(ceiling.totalUsd > done.estimate!.totalUsd, 'the ceiling is above the likely cost');
		assert.equal(done.settings.budgetUsd, Math.ceil(done.estimate!.totalUsd * 100) / 100, 'the cap starts at the estimate');
		const item = (await listItems(env.SEARCH_DB, run.id, { state: 'pending' })).items[0]!;
		assert.deepEqual([item.sourceFile, item.libraryId, item.hasOriginal], ['play_720p.mp4', LEGACY_LIB, false]);
	});
});

describe('backfill overview', () => {
	it('counts videos without a ready rendition and prices likely and ceiling from live counts', async () => {
		resetOverviewCache();
		const env = await makeEnv({ [id(1)]: legacyVideo(1), [id(2)]: legacyVideo(2) });
		// id(2) already has a ready R2 rendition: not counted
		await env.SEARCH_DB.prepare("INSERT INTO media_jobs (video_id, job_id, status, access, attempts, queued_at, updated_at, duration_seconds, container_seconds, bytes, objects) VALUES (?, 'j', 'ready', 'pub', 1, 't', 't', 0, 0, 0, 0)").bind(id(2)).run();
		const GB = 1024 ** 3;
		const o = await backfillOverview(env as never, Date.parse('2026-11-15T00:00:00Z'), async () => 10 * GB);
		assert.equal(o.videos, 1);
		assert.equal(o.videoSeconds, 90);
		assert.equal(o.bunnyStoredBytes, 10 * GB);
		assert.equal(o.likely.egressBytes, 5 * GB, 'half the video time is missing → half of what Bunny stores');
		assert.equal(o.ceiling.egressBytes, 10 * GB, 'the ceiling copies all of it');
		assert.equal(o.likely.transcodeSeconds, 45, 'measured 0.5');
		assert.equal(o.ceiling.transcodeSeconds, 360, 'ceiling 4');
		assert.ok(o.ceiling.totalUsd > o.likely.totalUsd);
	});

	it('still answers when Bunny cannot be read (copies not counted)', async () => {
		resetOverviewCache();
		const env = await makeEnv({ [id(1)]: legacyVideo(1) });
		const o = await backfillOverview(env as never, Date.now(), async () => undefined);
		assert.equal(o.bunnyStoredBytes, null);
		assert.equal(o.likely.egressBytes, 0);
		assert.equal(o.videos, 1);
	});
});

describe('backfill run', () => {
	it('copies the original with checksums, transcodes, verifies and marks the video R2-ready', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1) });
		const run = await createRun(env, { kind: 'all', onlyMissing: false }, 'admin-1');
		await drain(env);
		await assert.rejects(startRun(env, undefined, run.id).then(() => changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 0 })).then(() => startRun(env, undefined, run.id)));
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		await drain(env, { ticks: 6, onTranscode: fakeTranscoder(env) });
		const item = (await getItem(env.SEARCH_DB, run.id, id(1)))!;
		assert.equal(item.state, 'verified', item.error ?? '');
		// The original: two ranges, each with its MD5, the manifest and a kept row
		const keys = [...env.MEDIA_ORIGINALS.store.keys()].sort();
		assert.equal(keys.length, 3);
		const manifest = JSON.parse(new TextDecoder().decode(env.MEDIA_ORIGINALS.store.get(`src/${id(1)}/manifest.json`)));
		assert.equal(manifest.size, SOURCE.length);
		assert.equal(Object.keys(JSON.parse(item.parts!)).length, 2);
		const kept = await env.SEARCH_DB.prepare('SELECT keep, bytes FROM media_originals WHERE video_id = ?').bind(id(1)).first();
		assert.deepEqual({ ...kept }, { keep: 'backfill', bytes: SOURCE.length });
		const verified = await env.SEARCH_DB.prepare('SELECT rev, library_id FROM media_r2_verified WHERE video_id = ?').bind(id(1)).first();
		assert.equal(verified.library_id, LEGACY_LIB);
		assert.equal(verified.rev, env.videos.read(id(1)).r2.rev);
		const view = (await readRun(env.SEARCH_DB, run.id))!;
		assert.equal(view.status, 'done');
		assert.equal(view.spent.egressBytes, SOURCE.length);
		assert.equal(view.spent.transcodeSeconds, 40);
		assert.equal(env.TRANSCODE_QUEUE.sent.length, 0);
	});

	it('fails an item whose rendition is missing a segment, and Retry runs it again', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1) });
		const run = await createRun(env, { kind: 'all', onlyMissing: false }, 'admin-1');
		await drain(env);
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		await startRun(env, undefined, run.id);
		await drain(env, { ticks: 6, onTranscode: fakeTranscoder(env, { dropSegment: true }) });
		let item = (await getItem(env.SEARCH_DB, run.id, id(1)))!;
		assert.equal(item.state, 'failed');
		assert.equal(item.error_step, 'verify');
		assert.match(item.error!, /objects \(missing: 480p\/seg_00002\.m4s/);
		// Fixed (the segment arrives), then Retry: the original is kept, the rendition verifies
		const rec = env.videos.read(id(1));
		await env.MEDIA.put(`pub/${id(1)}/${rec.r2.rev}/480p/seg_00002.m4s`, 'seg');
		await env.MEDIA.put(`pub/${id(1)}/${rec.r2.rev}/720p/seg_00002.m4s`, 'seg');
		assert.deepEqual(await retryItem(env, undefined, run.id, id(1)), { retried: true });
		await drain(env, { ticks: 6 });
		item = (await getItem(env.SEARCH_DB, run.id, id(1)))!;
		assert.equal(item.state, 'verified', item.error ?? '');
		// A permanent delete of the video takes its backfill rows with it
		await purgeVideoMedia(env as never, id(1));
		for (const table of ['media_r2_verified', 'media_backfill_items']) {
			assert.equal((await env.SEARCH_DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE video_id = ?`).bind(id(1)).first())!.n, 0, table);
		}
	});

	it('a checksum mismatch retries, and after the last delivery the item fails', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1) });
		const run = await createRun(env, { kind: 'all', onlyMissing: false }, 'admin-1');
		await drain(env);
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		await startRun(env, undefined, run.id);
		env.MEDIA_ORIGINALS.corrupt = true;
		await drain(env, { ticks: 2 });
		const item = (await getItem(env.SEARCH_DB, run.id, id(1)))!;
		assert.equal(item.state, 'failed');
		assert.match(item.error!, /checksum mismatch/);
		assert.equal(await env.SEARCH_DB.prepare('SELECT COUNT(*) AS n FROM media_originals').first().then((r: any) => r.n), 0, 'no manifest row for a bad copy');
	});

	it('stops when the next video would pass the budget cap', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1) });
		const run = await createRun(env, { kind: 'all', onlyMissing: false }, 'admin-1');
		await drain(env);
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 0.0001 });
		await startRun(env, undefined, run.id);
		await drain(env, { ticks: 2 });
		const view = (await readRun(env.SEARCH_DB, run.id))!;
		assert.equal(view.status, 'stopped_budget');
		assert.match(view.stopReason!, /Budget cap \$0\.00 reached/);
		assert.equal(view.counts.pending, 1, 'nothing started');
		await assert.rejects(startRun(env, undefined, run.id), /budget|Raise/i);
		// A cap that covers the next video resumes it
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		assert.equal((await startRun(env, undefined, run.id)).status, 'running');
	});

	it('a video put under a hold after the estimate is left out at start, nothing copied', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1) });
		const run = await createRun(env, { kind: 'all', onlyMissing: false }, 'admin-1');
		await drain(env);
		await env.videos.put(id(1), JSON.stringify({ ...env.videos.read(id(1)), suspensionHolds: ['csam'], isHidden: true }));
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		await startRun(env, undefined, run.id);
		await drain(env, { ticks: 2 });
		const item = (await getItem(env.SEARCH_DB, run.id, id(1)))!;
		assert.deepEqual([item.state, item.skip_reason], ['skipped', 'held']);
		assert.equal(env.MEDIA_ORIGINALS.store.size, 0, 'nothing copied');
	});

	it('a hold that lands mid-copy stops the copy and drops the parts this run wrote', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1) });
		const run = await createRun(env, { kind: 'all', onlyMissing: false }, 'admin-1');
		await drain(env);
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		await startRun(env, undefined, run.id);
		// Run the tick only: the item is copying and its first copy message is queued
		const q = env.PROCESSING_CHECK_QUEUE;
		const tick = q.sent.shift()!;
		await handleBackfillMessage(env, undefined, { body: tick.body, attempts: 1, ack: () => {}, retry: () => {} }, { fetch: fakeFetch, md5: nodeMd5 });
		assert.equal((await getItem(env.SEARCH_DB, run.id, id(1)))!.state, 'copying');
		// A part from an earlier delivery, and an upload's own kept original that must stay
		await env.MEDIA_ORIGINALS.put(`src/${id(1)}/${uploadIdFor(run.id)}/000000000000000`, 'part');
		await env.MEDIA_ORIGINALS.put(`src/${id(1)}/upload-own/000000000000000`, 'theirs');
		await env.videos.put(id(1), JSON.stringify({ ...env.videos.read(id(1)), suspensionHolds: ['csam'], isHidden: true }));
		await copyMessage(env, undefined, run.id, id(1), 0, fakeFetch, new Date(), nodeMd5);
		const item = (await getItem(env.SEARCH_DB, run.id, id(1)))!;
		assert.deepEqual([item.state, item.skip_reason], ['skipped', 'held']);
		assert.deepEqual([...env.MEDIA_ORIGINALS.store.keys()], [`src/${id(1)}/upload-own/000000000000000`]);
	});

	it('a hold that lands during the transcode leaves the video out before it is verified', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1) });
		const run = await createRun(env, { kind: 'all', onlyMissing: false }, 'admin-1');
		await drain(env);
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		await startRun(env, undefined, run.id);
		const finish = fakeTranscoder(env);
		await drain(env, {
			ticks: 6,
			onTranscode: async (videoId) => {
				await finish(videoId);
				await env.videos.put(videoId, JSON.stringify({ ...env.videos.read(videoId), suspensionHolds: ['user:u1'] }));
			},
		});
		const item = (await getItem(env.SEARCH_DB, run.id, id(1)))!;
		assert.deepEqual([item.state, item.skip_reason], ['skipped', 'held']);
		assert.equal(await env.SEARCH_DB.prepare('SELECT COUNT(*) AS n FROM media_r2_verified').first().then((r: any) => r.n), 0, 'never marked R2-ready');
	});

	it('pause starts nothing; cancel cancels what has not started', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1), [id(2)]: legacyVideo(2) });
		const run = await createRun(env, { kind: 'all', onlyMissing: false }, 'admin-1');
		await drain(env);
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		await startRun(env, undefined, run.id);
		await pauseRun(env, run.id);
		await drain(env, { ticks: 3 });
		assert.equal((await readRun(env.SEARCH_DB, run.id))!.counts.pending, 2);
		const cancelled = await cancelRun(env, run.id);
		assert.equal(cancelled.status, 'cancelled');
		assert.equal(cancelled.counts.cancelled, 2);
	});

	it('the cron restarts a running loop that went quiet', async () => {
		const env = await makeEnv({ [id(1)]: legacyVideo(1) });
		const run = await createRun(env, { kind: 'all', onlyMissing: false }, 'admin-1');
		await drain(env);
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		await startRun(env, undefined, run.id);
		env.PROCESSING_CHECK_QUEUE.sent = [];
		assert.equal(await restartQuietRuns(env, new Date(Date.now() + 10 * 60_000)), 1);
		assert.equal(env.PROCESSING_CHECK_QUEUE.sent[0].body.op, 'tick');
	});
});

describe('flip to R2 first', () => {
	async function verifiedEnv() {
		const env = await makeEnv({ [id(1)]: legacyVideo(1), [id(2)]: legacyVideo(2) });
		const run = await createRun(env, { kind: 'videos', videoIds: [id(1)], onlyMissing: false }, 'admin-1');
		await drain(env);
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		await startRun(env, undefined, run.id);
		await drain(env, { ticks: 6, onTranscode: fakeTranscoder(env) });
		return env;
	}

	it('per video: only verified videos, through the video override; undo clears it', async () => {
		const env = await verifiedEnv();
		const res = await flipVideos(env, [id(1), id(2)], 'admin-1');
		assert.deepEqual(res, { flipped: [id(1)], refused: [{ videoId: id(2), problem: 'not_verified' }] });
		assert.deepEqual(env.videos.read(id(1)).mediaOverride.order, ['r2', 'bunny']);
		assert.equal(env.videos.read(id(1)).media, undefined, 'a legacy row stays legacy');
		assert.deepEqual((await flipVideos(env, [id(1)], 'admin-1', true)).flipped, [id(1)]);
		assert.equal(env.videos.read(id(1)).mediaOverride, undefined);
	});

	it('per channel and global: the provider settings, Bunny kept as the fallback', async () => {
		const env = await verifiedEnv();
		await flipChannel(env, 'chan-0001-aaaa', 'admin-1');
		let s = await readMediaSettings(env, true);
		assert.deepEqual(s.channels['chan-0001-aaaa']!.order, ['r2', 'bunny']);
		await flipChannel(env, 'chan-0001-aaaa', 'admin-1', true);
		s = await readMediaSettings(env, true);
		assert.equal(s.channels['chan-0001-aaaa'], undefined);
		await flipGlobal(env, 'admin-1');
		assert.deepEqual((await readMediaSettings(env, true)).playback.order, ['r2', 'bunny']);
		await flipGlobal(env, 'admin-1', true);
		assert.deepEqual((await readMediaSettings(env, true)).playback.order.slice(0, 2), ['bunny', 'r2']);
	});
});

describe('retiring a Bunny library', () => {
	async function verified() {
		const env = await makeEnv({ [id(1)]: legacyVideo(1) });
		const run = await createRun(env, { kind: 'all', onlyMissing: false }, 'admin-1');
		await drain(env);
		await changeSettings(env, run.id, { concurrency: 1, spacingSeconds: 0, budgetUsd: 5 });
		await startRun(env, undefined, run.id);
		await drain(env, { ticks: 6, onTranscode: fakeTranscoder(env) });
		return env;
	}

	it('refuses the primary library and a short grace period', async () => {
		const env = await verified();
		await assert.rejects(scheduleRemovals(env, PRIMARY_LIB, 30, 'admin-1'), /primary/);
		await assert.rejects(scheduleRemovals(env, LEGACY_LIB, 3, 'admin-1'), /grace period/);
	});

	it('removes only after the grace period: keeps the thumbnail, marks the record, deletes at Bunny', async () => {
		const env = await verified();
		const now = new Date();
		const { scheduled } = await scheduleRemovals(env, LEGACY_LIB, 7, 'admin-1', now);
		assert.equal(scheduled, 1);
		env.PROCESSING_CHECK_QUEUE.sent = [];
		assert.equal(await queueDueRemovals(env, new Date(now.getTime() + 6 * 86_400_000)), 0, 'not before the grace period');
		const lib = (await librarySummaries(env)).find((l) => l.libraryId === LEGACY_LIB)!;
		assert.deepEqual([lib.verified, lib.scheduled], [1, 1]);
		assert.equal(await queueDueRemovals(env, new Date(now.getTime() + 8 * 86_400_000)), 1);
		await drain(env);
		const rec = env.videos.read(id(1));
		assert.equal(rec.bunnyRemoved.libraryId, LEGACY_LIB);
		assert.equal(bunnyRef(rec), null, 'no code asks Bunny for it any more');
		assert.match(rec.thumbnailUrl, /^https:\/\/media\.qa\.alummahnow\.net\/pub\/thumbs\/.+\/kept-.+\.jpg$/);
		assert.deepEqual([...env.MEDIA.store.get(new URL(rec.thumbnailUrl).pathname.slice(1))!], [1, 2, 3, 4], 'the same image, byte for byte');
		assert.deepEqual(bunnyDeletes, [`${LEGACY_LIB}/${id(1)}`]);
		const row = await env.SEARCH_DB.prepare('SELECT status FROM media_bunny_removals WHERE video_id = ?').bind(id(1)).first();
		assert.equal(row.status, 'removed');
	});

	it('a video under a hold (CSAM evidence) is never deleted from Bunny', async () => {
		const env = await verified();
		const now = new Date();
		await scheduleRemovals(env, LEGACY_LIB, 7, 'admin-1', now);
		await env.videos.put(id(1), JSON.stringify({ ...env.videos.read(id(1)), suspensionHolds: ['csam'], isHidden: true }));
		await queueDueRemovals(env, new Date(now.getTime() + 8 * 86_400_000));
		await drain(env);
		assert.deepEqual(bunnyDeletes, []);
		assert.equal(env.videos.read(id(1)).bunnyRemoved, undefined);
		const row = await env.SEARCH_DB.prepare('SELECT status, error FROM media_bunny_removals WHERE video_id = ?').bind(id(1)).first();
		assert.equal(row.status, 'cancelled');
		assert.match(row.error, /under a hold/);
	});

	it('a hold that lands while the removal runs is caught before Bunny is asked to delete', async () => {
		const env = await verified();
		const now = new Date();
		await scheduleRemovals(env, LEGACY_LIB, 7, 'admin-1', now);
		await queueDueRemovals(env, new Date(now.getTime() + 8 * 86_400_000));
		// The hold arrives between the first read and the compare-and-swap (here: while the thumbnail is kept)
		const holdingFetch: typeof fetch = async (input, init) => {
			await env.videos.put(id(1), JSON.stringify({ ...env.videos.read(id(1)), suspensionHolds: ['csam'], isHidden: true }));
			return fakeFetch(input, init);
		};
		const body = env.PROCESSING_CHECK_QUEUE.sent.find((m: any) => m.body.op === 'removal')!.body;
		await removeFromBunny(env, undefined, body.videoId, false, holdingFetch);
		assert.deepEqual(bunnyDeletes, []);
		assert.equal(env.videos.read(id(1)).bunnyRemoved, undefined, 'the record keeps its Bunny copy');
		const row = await env.SEARCH_DB.prepare('SELECT status, error FROM media_bunny_removals WHERE video_id = ?').bind(id(1)).first();
		assert.deepEqual([row.status, /under a hold/.test(row.error)], ['cancelled', true]);
	});

	it('cancel stops scheduled removals; a re-transcoded (unverified) rendition is never removed', async () => {
		const env = await verified();
		const now = new Date();
		await scheduleRemovals(env, LEGACY_LIB, 7, 'admin-1', now);
		assert.deepEqual(await cancelRemovals(env, LEGACY_LIB), { cancelled: 1 });
		await scheduleRemovals(env, LEGACY_LIB, 7, 'admin-1', now);
		const rec = env.videos.read(id(1));
		rec.r2.rev = 'ffffffffffffffff';
		await env.videos.put(id(1), JSON.stringify(rec));
		await queueDueRemovals(env, new Date(now.getTime() + 8 * 86_400_000));
		await drain(env);
		assert.deepEqual(bunnyDeletes, []);
		const row = await env.SEARCH_DB.prepare('SELECT status, error FROM media_bunny_removals WHERE video_id = ?').bind(id(1)).first();
		assert.equal(row.status, 'failed');
		assert.match(row.error, /not verified at its current rendition/);
	});
});
