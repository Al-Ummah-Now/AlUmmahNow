/** The sealed records of an item reported for child safety (lib/csam/reportEvidence.ts). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_COPIES, deleteReportEvidence, keepReportEvidence, readReportEvidence } from '../src/lib/csam/reportEvidence';
import { withSearchSync } from '../src/lib/search/sync';
import { JobsQueue, MemoryBucket, MemoryQueue, videoFixture } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

type Json = Record<string, any>;

class Store {
	objects = new Map<string, { bytes: Uint8Array; meta?: Record<string, string> }>();
	async get(key: string) {
		const o = this.objects.get(key);
		return o ? { customMetadata: o.meta, arrayBuffer: async () => o.bytes.slice().buffer } : null;
	}
	async put(key: string, bytes: Uint8Array, opts?: { customMetadata?: Record<string, string> }) {
		this.objects.set(key, { bytes: new Uint8Array(bytes), meta: opts?.customMetadata });
	}
	async delete(keys: string[]) {
		for (const k of keys) this.objects.delete(k);
	}
	async list({ prefix, limit = 1000 }: { prefix: string; limit?: number }) {
		return { objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((key) => ({ key })), truncated: false };
	}
}

async function setup() {
	const db = new SqliteD1();
	const pending: Promise<unknown>[] = [];
	const store = new Store();
	const raw: Json = { SEARCH_DB: db, NOTIFICATIONS_DB: createSqliteD1(), ADMIN_JOBS_QUEUE: new JobsQueue(), queue: new MemoryQueue(), CSAM_EVIDENCE: store, CSAM_EVIDENCE_KEY: `1:${Buffer.alloc(32, 7).toString('base64')}` };
	for (const b of ['videos', 'channels', 'profiles', 'playlists', 'community_posts', 'subtitles', 'global_settings']) raw[b] = new MemoryBucket();
	const env = withSearchSync(raw, { waitUntil: (p: Promise<unknown>) => void pending.push(p) }) as Json;
	const settle = async () => { while (pending.length) await pending.shift(); };
	await env.profiles.put('usr_owner', JSON.stringify({ id: 'usr_owner', userName: 'owner' }));
	await env.videos.put('vid-1', JSON.stringify(videoFixture({ id: 'vid-1', title: 'A title', userId: 'usr_owner', channelId: 'ch-1', comments: [{ id: 'cmt-1', userId: 'usr_c', videoId: 'vid-1', text: 'the comment', replies: [{ id: 'rep-1', userId: 'usr_r', text: 'a reply' }] }] } as never)));
	await env.community_posts.put('posts/ch-1/post-1.json', JSON.stringify({ id: 'post-1', channelId: 'ch-1', userId: 'usr_owner', content: 'the post', status: 'published' }));
	await env.videos.put('livestream:live-1', JSON.stringify({ id: 'live-1', title: 'Halqa', userId: 'usr_owner', channelId: 'ch-1', status: 'ended', streamKey: 'the-key', rtmpUrl: 'rtmp://x', dateCreated: '2026-11-20T00:00:00Z' }));
	await settle();
	const keep = (entityType: string, entityId: string, over: Json = {}) => keepReportEvidence(env as never, { entityType: entityType as never, entityId, publicOnly: true, reportedText: null, ...over });
	const read = (entityType: string, entityId: string) => readReportEvidence(env as never, entityType as never, entityId);
	return { env, raw, store, keep, read, settle };
}

describe('the kept record of a reported item', () => {
	it('is sealed, and stays when the item and the account are gone', async () => {
		const t = await setup();
		assert.deepEqual(await t.keep('video', 'vid-1'), { kept: true });
		for (const { bytes } of t.store.objects.values()) assert.ok(!Buffer.from(bytes).includes('A title'));
		await t.env.videos.delete('vid-1');
		await t.env.profiles.delete('usr_owner');
		await t.settle();
		assert.deepEqual(await t.keep('video', 'vid-1'), { kept: true }, 'nothing to keep now, and what was kept is not lost');
		const [copy, ...more] = (await t.read('video', 'vid-1'))!;
		assert.equal(more.length, 0);
		assert.equal((copy.records.video as Json).title, 'A title');
		assert.equal((copy.records.ownerProfile as Json).userName, 'owner');
		assert.equal((copy.records.video as Json).comments, undefined, 'what other people wrote is not part of it');
	});

	it('holds the item itself only: a comment without its replies, a stream without its key', async () => {
		const t = await setup();
		await t.keep('comment', 'cmt-1');
		const comment = (await t.read('comment', 'cmt-1'))?.[0].records.comment as Json;
		if (comment) assert.deepEqual([comment.text, comment.replies, comment.parentId], ['the comment', undefined, 'vid-1']);
		await t.keep('post', 'post-1');
		assert.equal(((await t.read('post', 'post-1'))![0].records.post as Json).content, 'the post');
		await t.keep('livestream', 'live-1');
		assert.ok(!JSON.stringify(await t.read('livestream', 'live-1')).match(/the-key|rtmp:/));
	});

	it('a chat message only guests reported, and nobody may read, is not kept; what a signed-in reporter read is', async () => {
		const t = await setup();
		assert.deepEqual(await t.keep('live_chat', 'msg-1'), { kept: false });
		assert.equal(await t.read('live_chat', 'msg-1'), null);
		assert.deepEqual(await t.keep('live_chat', 'msg-1', { publicOnly: false, reportedText: 'what they saw' }), { kept: true });
		assert.equal((await t.read('live_chat', 'msg-1'))![0].records.reportedText, 'what they saw');
	});

	it('the same records are stored once, changed ones again, up to a limit', async () => {
		const t = await setup();
		for (let n = 0; n < MAX_COPIES + 4; n++) {
			await t.keep('video', 'vid-1');
			await t.keep('video', 'vid-1');
			const video = JSON.parse(await (await t.raw.videos.get('vid-1')).text());
			await t.env.videos.put('vid-1', JSON.stringify({ ...video, title: `Title ${n}` }));
			await t.settle();
		}
		assert.equal((await t.read('video', 'vid-1'))!.length, MAX_COPIES);
	});

	it('is deleted whole when its time is over, and nothing of another item', async () => {
		const t = await setup();
		await t.keep('video', 'vid-1');
		await t.keep('post', 'post-1');
		assert.equal(await deleteReportEvidence(t.env as never, 'video', 'vid-1'), 1);
		assert.equal(await t.read('video', 'vid-1'), null);
		assert.equal((await t.read('post', 'post-1'))!.length, 1);
		assert.equal(await deleteReportEvidence(t.env as never, 'video', 'vid-1'), 0);
	});

	it('nothing about an item that is not there, and an error when the store is not bound', async () => {
		const t = await setup();
		assert.deepEqual(await t.keep('video', 'vid-missing'), { kept: false });
		delete t.env.CSAM_EVIDENCE;
		delete t.raw.CSAM_EVIDENCE;
		await assert.rejects(t.keep('video', 'vid-1'), /not bound/);
	});
});
