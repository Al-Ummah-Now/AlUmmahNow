/**
 * Counting views (lib/view-counter.ts, SCALABILITY-AUDIT AV-1): the API hands
 * each view to a per-video counter shard and never writes the video JSON
 * itself; when the counter is unreachable it falls back to a compare-and-swap
 * increment that loses nothing under concurrency.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VideoView } from '../src/endpoints/video/videoView';
import { VIEW_COUNTER_SHARDS, countView, viewCounterName } from '../src/lib/view-counter';
import { parseJsonc } from '../../../scripts/release/jsonc';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

/** A MemoryBucket whose calls take a random few ms, so parallel requests interleave like isolates. */
class SlowBucket extends MemoryBucket {
	private pause() {
		return new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * 4)));
	}
	async get(key: string) {
		await this.pause();
		return super.get(key);
	}
	async put(key: string, value: string, options?: { onlyIf?: { etagMatches?: string } }) {
		await this.pause();
		return super.put(key, value, options);
	}
}

/** Stand-in for the VIEW_COUNTER namespace: records which shard got each view. */
function fakeCounter(opts: { fail?: boolean } = {}) {
	const calls: { name: string; body: { videoId: string; shard: number } }[] = [];
	const totals = new Map<string, number>();
	const ns = {
		idFromName: (name: string) => name,
		get: (name: string) => ({
			fetch: async (_url: string, init: { body: string }) => {
				const body = JSON.parse(init.body);
				calls.push({ name, body });
				if (opts.fail) return new Response('Expected WebSocket upgrade', { status: 426 });
				const total = (totals.get(name) ?? 0) + 1;
				totals.set(name, total);
				return Response.json({ unflushed: total });
			},
		}),
	};
	return { ns: ns as unknown as DurableObjectNamespace, calls };
}

function routes(r: any) {
	r.post('/api/videos/:id/view', VideoView);
}

async function postView(env: Record<string, unknown>, id = 'v1') {
	const app = buildApp(routes);
	return app.request(`/api/videos/${id}/view`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env);
}

describe('POST /api/videos/:id/view with the view counter', () => {
	it('counts through a counter shard and never writes the video', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ views: 10 }) });
		const counter = fakeCounter();
		const res = await postView({ videos, queue: new MemoryQueue(), VIEW_COUNTER: counter.ns });
		assert.equal(res.status, 200);
		const body = (await res.json()) as { result: { viewCount: number } };
		assert.equal(body.result.viewCount, 11, 'stored count plus the shard’s unflushed view');
		assert.equal(counter.calls.length, 1);
		const { name, body: sent } = counter.calls[0];
		assert.equal(sent.videoId, 'v1');
		assert.equal(name, viewCounterName('v1', sent.shard));
		assert.ok(sent.shard >= 0 && sent.shard < VIEW_COUNTER_SHARDS);
		assert.equal(videos.versions.get('v1'), undefined, 'the video JSON was not written');
	});

	it('spreads one video’s views over all shards', async () => {
		const videos = new MemoryBucket({ v1: videoFixture() });
		const counter = fakeCounter();
		let i = 0;
		const random = () => (i++ % VIEW_COUNTER_SHARDS) / VIEW_COUNTER_SHARDS;
		for (let n = 0; n < VIEW_COUNTER_SHARDS * 3; n++) await countView({ videos: videos as never, VIEW_COUNTER: counter.ns }, 'v1', random);
		assert.equal(new Set(counter.calls.map((c) => c.name)).size, VIEW_COUNTER_SHARDS);
	});

	it('falls back to a direct increment when the counter is not reachable', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ views: 4 }) });
		const res = await postView({ videos, queue: new MemoryQueue(), VIEW_COUNTER: fakeCounter({ fail: true }).ns });
		assert.equal(res.status, 200);
		assert.equal(((await res.json()) as { result: { viewCount: number } }).result.viewCount, 5);
		assert.equal(JSON.parse(videos.store.get('v1')!).views, 5);
	});

	it('does not count a view of a removed video', async () => {
		const videos = new MemoryBucket({ v1: videoFixture({ views: 4, isDeleted: true }) });
		const counter = fakeCounter();
		const res = await postView({ videos, queue: new MemoryQueue(), VIEW_COUNTER: counter.ns });
		assert.equal(res.status, 404);
		assert.equal(counter.calls.length, 0);
	});
});

describe('view counting under concurrency', () => {
	it('200 parallel fallback views: every view that succeeded is stored, none lost', async () => {
		const videos = new SlowBucket({ v1: videoFixture({ views: 0, title: 'keep me' }) });
		const results = await Promise.allSettled(
			Array.from({ length: 200 }, () => countView({ videos: videos as never }, 'v1')),
		);
		const counted = results.filter((r) => r.status === 'fulfilled').length;
		const stored = JSON.parse(videos.store.get('v1')!);
		assert.equal(stored.views, counted, 'no acknowledged view is lost');
		assert.equal(stored.title, 'keep me');
		assert.ok(counted > 0);
	});

	it('200 parallel views through the endpoint each reach the counter exactly once', async () => {
		const videos = new SlowBucket({ v1: videoFixture({ views: 0 }) });
		const counter = fakeCounter();
		const env = { videos, queue: new MemoryQueue(), VIEW_COUNTER: counter.ns };
		const responses = await Promise.all(Array.from({ length: 200 }, () => postView(env)));
		assert.ok(responses.every((r) => r.status === 200));
		assert.equal(counter.calls.length, 200);
		assert.equal(videos.versions.get('v1'), undefined, 'the hot path does no R2 write at all');
	});
});

describe('VIEW_COUNTER binding', () => {
	const read = (file: string) => parseJsonc(readFileSync(join(__dirname, '..', file), 'utf8')) as any;
	const binding = (cfg: any) => cfg.durable_objects?.bindings?.find((b: any) => b.name === 'VIEW_COUNTER');

	it('binds the counter of the same environment, never another one', () => {
		const prod = read('wrangler.jsonc');
		const qa = read('wrangler.qa.jsonc');
		const expected = [
			[binding(prod), 'al-ummah-now-comms'],
			[binding(prod.env.stage), 'al-ummah-now-comms-stage'],
			[binding(qa), 'al-ummah-now-comms-qa'],
		] as const;
		for (const [b, script] of expected) {
			assert.ok(b, `VIEW_COUNTER is bound (${script})`);
			assert.equal(b.script_name, script);
			assert.equal(b.class_name, 'WebSocketDurableObject');
		}
	});

	it('the realtime worker of each environment can write that environment’s videos bucket', () => {
		const ws = (f: string) => parseJsonc(readFileSync(join(__dirname, '../../websocket-server', f), 'utf8')) as any;
		const bucket = (cfg: any) => cfg.r2_buckets?.find((b: any) => b.binding === 'VIDEOS')?.bucket_name;
		const api = (cfg: any) => cfg.r2_buckets?.find((b: any) => b.binding === 'videos')?.bucket_name;
		const prod = read('wrangler.jsonc');
		assert.equal(bucket(ws('wrangler.jsonc')), api(prod));
		assert.equal(bucket(ws('wrangler.jsonc').env.stage), api(prod.env.stage));
		assert.equal(bucket(ws('wrangler.qa.jsonc')), api(read('wrangler.qa.jsonc')));
	});
});
