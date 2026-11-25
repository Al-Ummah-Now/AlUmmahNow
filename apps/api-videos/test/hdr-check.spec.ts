/** HDR check (lib/media/hdr-check.ts): read only, paged, finds renditions that still say HDR. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HdrCheckRun } from '@al-ummah/shared-types';
import { handleHdrCheckMessage, HDR_CHECK_STALE_MS, isHdrCheckMessage, readHdrCheck, startHdrCheck } from '../src/lib/media/hdr-check';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const REV = 'e29db4ad6918a943';
const id = (n: number) => `${String(n).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`;
const video = (n: number, r2: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({ id: id(n), title: `Lesson ${n}`, r2: { status: 'ready', rev: REV, access: 'pub', result: { rungs: [{ name: '360p' }, { name: '720p' }] }, ...r2 }, ...over });
const colr = (p: number, t: number, m: number) => Uint8Array.from([0, 0, 0, 19, 0x63, 0x6f, 0x6c, 0x72, 0x6e, 0x63, 0x6c, 0x78, 0, p, 0, t, 0, m, 0]);

class Media {
	reads: string[] = [];
	constructor(private objects: Record<string, string | Uint8Array>) {}
	async get(key: string) {
		this.reads.push(key);
		const v = this.objects[key];
		if (v === undefined) return null;
		const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : v;
		return { text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.slice().buffer };
	}
}

class Queue {
	sent: any[] = [];
	async send(body: unknown) {
		this.sent.push(body);
	}
}

const rendition = (access: string, n: number, init: Uint8Array | null, uri = 'init_0.mp4') => ({
	[`${access}/${id(n)}/${REV}/360p/index.m3u8`]: `#EXTM3U\n#EXT-X-MAP:URI="${uri}"\n#EXTINF:6,\nseg_00000.m4s\n`,
	...(init ? { [`${access}/${id(n)}/${REV}/360p/${uri}`]: init } : {}),
});

async function setup(videos: ReturnType<typeof video>[], objects: Record<string, string | Uint8Array>, priv: Record<string, string | Uint8Array> = {}, extra: string[] = []) {
	const db = new SqliteD1();
	for (const v of [...videos.map((x) => x.id), ...extra]) await db.prepare("INSERT INTO media_jobs (video_id, job_id, status, access, attempts, queued_at, updated_at) VALUES (?, 'j', 'ready', 'pub', 1, 't', 't')").bind(v).run();
	const bucket = new MemoryBucket(Object.fromEntries(videos.map((v) => [v.id, v])));
	return { env: { videos: bucket, global_settings: new MemoryBucket(), SEARCH_DB: db, MEDIA: new Media(objects), MEDIA_PRIVATE: new Media(priv), PROCESSING_CHECK_QUEUE: new Queue() } as any, bucket };
}

async function drain(env: any): Promise<string[]> {
	const said: string[] = [];
	while (env.PROCESSING_CHECK_QUEUE.sent.length) {
		const body = env.PROCESSING_CHECK_QUEUE.sent.shift();
		assert.ok(isHdrCheckMessage(body));
		await handleHdrCheckMessage(env, { body, attempts: 1, ack: () => said.push('ack'), retry: () => said.push('retry') });
	}
	return said;
}

describe('HDR check', () => {
	it('finds HLG, PQ and BT.2020 in both buckets, and leaves SDR, untagged and unready ones', async () => {
		const videos = [video(1), video(2), video(3, { access: 'priv' }), video(4), video(5, { status: 'queued', result: undefined }), video(6, {}, { isDeleted: true }), video(7), video(8)];
		const { env, bucket } = await setup(
			videos,
			{ ...rendition('pub', 1, colr(9, 18, 9)), ...rendition('pub', 2, colr(1, 1, 1)), ...rendition('pub', 4, Uint8Array.from([1, 2, 3])), ...rendition('pub', 7, null), ...rendition('pub', 8, colr(9, 14, 9), '../../x.mp4') },
			rendition('priv', 3, colr(9, 16, 9)),
			[id(9)],
		);
		const before = JSON.stringify([...bucket.store]);
		const { started, run } = await startHdrCheck(env, 'admin-1');
		assert.equal(started, true);
		assert.equal(run.status, 'running');
		assert.deepEqual(await drain(env), ['ack']);
		const done = (await readHdrCheck(env)) as HdrCheckRun;
		assert.equal(done.status, 'done');
		assert.equal(done.startedBy, 'admin-1');
		assert.deepEqual(done.counts, { scanned: 9, checked: 4, hdr: 2, skipped: 3, unreadable: 2 });
		assert.deepEqual(done.items.map((i) => [i.id, i.kind, i.now]), [[id(1), 'hlg', 'same'], [id(3), 'pq', 'same']]);
		assert.equal(JSON.stringify([...bucket.store]), before, 'no video changed');
		assert.ok(!env.MEDIA.reads.some((k: string) => k.includes('..')), 'never reads outside the rendition');
	});

	it('pages by primary key and counts a redelivered page once', async () => {
		const videos = Array.from({ length: 45 }, (_, i) => video(i + 1));
		const { env } = await setup(videos, Object.assign({}, ...videos.map((_, i) => rendition('pub', i + 1, colr(9, 18, 9)))));
		await startHdrCheck(env, 'a');
		const first = { ...env.PROCESSING_CHECK_QUEUE.sent[0] };
		assert.deepEqual(await drain(env), ['ack', 'ack', 'ack']);
		const run = (await readHdrCheck(env))!;
		assert.deepEqual([run.counts.scanned, run.counts.hdr, run.items.length, run.status], [45, 45, 45, 'done']);
		const said: string[] = [];
		await handleHdrCheckMessage(env, { body: first, attempts: 2, ack: () => said.push('ack'), retry: () => said.push('retry') });
		assert.deepEqual(said, ['ack']);
		assert.equal((await readHdrCheck(env))!.counts.scanned, 45);
	});

	it('waits for the page before when a copy comes early, and drops another run', async () => {
		const { env } = await setup([video(1)], rendition('pub', 1, colr(1, 1, 1)));
		await startHdrCheck(env, 'a');
		const body = env.PROCESSING_CHECK_QUEUE.sent[0];
		const said: string[] = [];
		const send = (over: object) => handleHdrCheckMessage(env, { body: { ...body, ...over }, attempts: 1, ack: () => said.push('ack'), retry: () => said.push('retry') });
		await send({ page: 1 });
		await send({ runId: 'another-run-0001' });
		assert.deepEqual(said, ['retry', 'ack']);
	});

	it('one check at a time, unless the last one died', async () => {
		const { env } = await setup([], {});
		const t0 = new Date('2026-11-25T10:00:00Z');
		assert.equal((await startHdrCheck(env, 'a', t0)).started, true);
		assert.equal((await startHdrCheck(env, 'b', new Date(t0.getTime() + 60_000))).started, false);
		assert.equal((await startHdrCheck(env, 'b', new Date(t0.getTime() + HDR_CHECK_STALE_MS + 1))).started, true);
	});

	it('says where a listed video is now', async () => {
		const { env, bucket } = await setup([video(1), video(2), video(3)], { ...rendition('pub', 1, colr(9, 18, 9)), ...rendition('pub', 2, colr(9, 18, 9)), ...rendition('pub', 3, colr(9, 18, 9)) });
		await startHdrCheck(env, 'a');
		await drain(env);
		bucket.store.set(id(1), JSON.stringify(video(1, { rev: 'aaaabbbbccccdddd' })));
		bucket.store.set(id(2), JSON.stringify(video(2, { status: 'transcoding' })));
		bucket.store.delete(id(3));
		assert.deepEqual((await readHdrCheck(env))!.items.map((i) => i.now), ['replaced', 'encoding', 'gone']);
	});

	it('null before the first check', async () => {
		const { env } = await setup([], {});
		assert.equal(await readHdrCheck(env), null);
	});
});
