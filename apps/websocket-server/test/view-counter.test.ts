/**
 * Per-video view counter (src/view-counter.ts): many parallel writers, no lost views.
 *
 * The fakes add random async delays to every storage and R2 call so that
 * increments, flushes, metadata edits and legacy increments interleave the
 * way they do across isolates. Time is virtual: alarms fire only when due.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	FLUSH_DELAY_MS,
	VERIFY_DELAYS_MS,
	ViewCounter,
	mergeViewCounter,
	type CounterStorage,
	type VideoBucket,
} from '../src/view-counter.ts';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, Math.floor(Math.random() * 3)));

/** R2 stand-in: etags, conditional puts, random latency. */
class FakeBucket implements VideoBucket {
	private objects = new Map<string, { body: string; version: number }>();
	puts = 0;
	set(key: string, value: unknown) {
		const version = (this.objects.get(key)?.version ?? 0) + 1;
		this.objects.set(key, { body: JSON.stringify(value), version });
	}
	read(key: string): any {
		const o = this.objects.get(key);
		return o ? JSON.parse(o.body) : null;
	}
	delete(key: string) {
		this.objects.delete(key);
	}
	async get(key: string) {
		await tick();
		const o = this.objects.get(key);
		if (!o) return null;
		const { body, version } = o;
		return { etag: `v${version}`, json: async <T>() => JSON.parse(body) as T };
	}
	async put(key: string, value: string, options?: { onlyIf?: { etagMatches?: string } }) {
		await tick();
		const current = this.objects.get(key);
		const expected = options?.onlyIf?.etagMatches;
		if (expected !== undefined && expected !== `v${current?.version ?? 0}`) return null;
		this.puts++;
		this.objects.set(key, { body: value, version: (current?.version ?? 0) + 1 });
		return {};
	}
}

/** Durable Object storage stand-in for one object, with its alarm. */
class FakeStorage implements CounterStorage {
	data = new Map<string, unknown>();
	alarmAt: number | null = null;
	async get<T>(key: string) { await tick(); return structuredClone(this.data.get(key)) as T | undefined; }
	async put<T>(key: string, value: T) { await tick(); this.data.set(key, structuredClone(value)); }
	async deleteAll() { await tick(); this.data.clear(); }
	async getAlarm() { await tick(); return this.alarmAt; }
	async setAlarm(t: number) { await tick(); this.alarmAt = t; }
	async deleteAlarm() { await tick(); this.alarmAt = null; }
}

class Clock { now = 1_000_000; }

/** One shard object. Like a Durable Object, its alarm never runs twice at once. */
class Shard {
	storage = new FakeStorage();
	counter: ViewCounter;
	private running = false;
	broadcasts: number[] = [];
	constructor(bucket: FakeBucket, clock: Clock) {
		this.counter = new ViewCounter(this.storage, bucket, {
			now: () => clock.now,
			onFlushed: async (_id, views) => { this.broadcasts.push(views); },
		});
	}
	async fireIfDue(now: number) {
		if (this.running || this.storage.alarmAt === null || this.storage.alarmAt > now) return;
		this.running = true;
		this.storage.alarmAt = null; // the runtime clears an alarm as it fires
		try { await this.counter.alarm(); } finally { this.running = false; }
	}
}

async function drain(shards: Shard[], clock: Clock) {
	for (let i = 0; i < 1000; i++) {
		const pending = shards.map((s) => s.storage.alarmAt).filter((t): t is number => t !== null);
		if (pending.length === 0) return;
		clock.now = Math.max(clock.now, Math.min(...pending));
		await Promise.all(shards.map((s) => s.fireIfDue(clock.now)));
	}
	throw new Error('alarms never settled');
}

test('mergeViewCounter seeds the base from the legacy count and is idempotent', () => {
	const video: Record<string, unknown> = { id: 'v', views: 40 };
	assert.equal(mergeViewCounter(video, '0', 5), true);
	assert.deepEqual(video.viewCounter, { base: 40, shards: { '0': 5 } });
	assert.equal(video.views, 45);
	// Replaying the same or an older total changes nothing
	assert.equal(mergeViewCounter(video, '0', 5), false);
	assert.equal(mergeViewCounter(video, '0', 3), false);
	assert.equal(video.views, 45);
	// Views added outside the counter fold into the base
	video.views = 47;
	assert.equal(mergeViewCounter(video, '1', 2), true);
	assert.deepEqual(video.viewCounter, { base: 42, shards: { '0': 5, '1': 2 } });
	assert.equal(video.views, 49);
});

/**
 * Counter views survive concurrent blind writers (endpoints that still
 * read-modify-write the whole video). Views counted outside the counter
 * (fallback / older API version, compare-and-swap) survive other CAS writers;
 * a blind writer can revert those, which is why the blind writers themselves
 * move to compare-and-swap (AV-2).
 */
for (const scenario of [
	{ name: 'with concurrent blind edits', edits: 40, legacy: 0 },
	{ name: 'with concurrent fallback increments', edits: 0, legacy: 30 },
]) test(`1000 parallel views over 4 shards ${scenario.name} lose nothing`, async () => {
	const bucket = new FakeBucket();
	const clock = new Clock();
	bucket.set('vid', { id: 'vid', title: 'original', views: 100 });
	const shards = [0, 1, 2, 3].map(() => new Shard(bucket, clock));

	const VIEWS = 1000;
	const LEGACY = scenario.legacy;
	const EDITS = scenario.edits;

	const views = Array.from({ length: VIEWS }, (_, i) => async () => {
		await tick();
		await shards[i % 4].counter.increment('vid', String(i % 4));
	});
	// An endpoint that still does a blind read-modify-write of the whole video
	let lastTitle = 'original';
	const edits = Array.from({ length: EDITS }, (_, i) => async () => {
		await tick();
		const object = await bucket.get('vid');
		const video = await object!.json<Record<string, unknown>>();
		await tick();
		video.title = `edit ${i}`;
		await bucket.put('vid', JSON.stringify(video));
		lastTitle = `edit ${i}`;
	});
	// Fallback / older API version: compare-and-swap views + 1
	const legacy = Array.from({ length: LEGACY }, () => async () => {
		for (;;) {
			await tick();
			const object = await bucket.get('vid');
			const video = await object!.json<Record<string, number>>();
			video.views += 1;
			if (await bucket.put('vid', JSON.stringify(video), { onlyIf: { etagMatches: object!.etag } })) return;
		}
	});
	// Flushes fire while all of that is going on; virtual time moves 1s per tick,
	// so the whole burst spans less than the first re-assert delay
	let busy = true;
	const flusher = (async () => {
		while (busy) {
			clock.now += 1000;
			await Promise.all(shards.map((s) => s.fireIfDue(clock.now)));
			await tick();
		}
	})();

	await Promise.all([...views, ...edits, ...legacy].sort(() => Math.random() - 0.5).map((f) => f()));
	busy = false;
	await flusher;
	await drain(shards, clock);

	const stored = bucket.read('vid');
	assert.equal(stored.views, 100 + VIEWS + LEGACY, 'every view is counted exactly once');
	assert.equal(stored.title, lastTitle, 'edits are not reverted by the counter');
	const shardSum = Object.values(stored.viewCounter.shards as Record<string, number>).reduce((a, b) => a + b, 0);
	assert.equal(shardSum, VIEWS);
	assert.ok(shards.every((s) => s.storage.alarmAt === null), 'nothing left to flush');
});

test('a blind write that reverts a flush is repaired by the re-assert', async () => {
	const bucket = new FakeBucket();
	const clock = new Clock();
	bucket.set('vid', { id: 'vid', views: 10 });
	const shard = new Shard(bucket, clock);
	for (let i = 0; i < 5; i++) await shard.counter.increment('vid', '0');

	// An editor reads before the flush and writes after it
	const stale = bucket.read('vid');
	clock.now += FLUSH_DELAY_MS;
	await shard.fireIfDue(clock.now);
	assert.equal(bucket.read('vid').views, 15);
	bucket.set('vid', { ...stale, title: 'edited' });
	assert.equal(bucket.read('vid').views, 10, 'the stale write reverted the flush');

	clock.now += VERIFY_DELAYS_MS[0];
	await shard.fireIfDue(clock.now);
	assert.equal(bucket.read('vid').views, 15, 'the re-assert put the views back');
	assert.equal(bucket.read('vid').title, 'edited', 'and kept the edit');
	await drain([shard], clock);
	assert.equal(bucket.read('vid').views, 15);
});

test('a hot video costs one R2 write per shard per flush window, not one per view', async () => {
	const bucket = new FakeBucket();
	const clock = new Clock();
	bucket.set('vid', { id: 'vid', views: 0 });
	const shard = new Shard(bucket, clock);
	await Promise.all(Array.from({ length: 500 }, () => shard.counter.increment('vid', '0')));
	await drain([shard], clock);
	assert.equal(bucket.read('vid').views, 500);
	assert.equal(bucket.puts, 1);
	assert.deepEqual(shard.broadcasts, [500], 'viewers get the flushed count once');
});

test('a deleted video drops its counter state', async () => {
	const bucket = new FakeBucket();
	const clock = new Clock();
	bucket.set('vid', { id: 'vid', views: 3 });
	const shard = new Shard(bucket, clock);
	await shard.counter.increment('vid', '0');
	bucket.delete('vid');
	await drain([shard], clock);
	assert.equal(bucket.read('vid'), null, 'a flush never re-creates a deleted video');
	assert.equal(shard.storage.data.size, 0);
	assert.equal(shard.storage.alarmAt, null);
});

test('a failed flush keeps the views and retries', async () => {
	const bucket = new FakeBucket();
	const clock = new Clock();
	bucket.set('vid', { id: 'vid', views: 0 });
	const shard = new Shard(bucket, clock);
	await shard.counter.increment('vid', '0');
	const realGet = bucket.get.bind(bucket);
	bucket.get = async () => { throw new Error('R2 down'); };
	clock.now += FLUSH_DELAY_MS;
	await shard.fireIfDue(clock.now);
	assert.notEqual(shard.storage.alarmAt, null, 'retry scheduled');
	bucket.get = realGet;
	await drain([shard], clock);
	assert.equal(bucket.read('vid').views, 1);
});

test('a restarted object resumes from storage', async () => {
	const bucket = new FakeBucket();
	const clock = new Clock();
	bucket.set('vid', { id: 'vid', views: 0 });
	const shard = new Shard(bucket, clock);
	for (let i = 0; i < 3; i++) await shard.counter.increment('vid', '2');
	// Evicted before its alarm: a fresh instance over the same storage
	shard.counter = new ViewCounter(shard.storage, bucket, { now: () => clock.now });
	await shard.counter.increment('vid', '2');
	await drain([shard], clock);
	assert.equal(bucket.read('vid').views, 4);
	assert.deepEqual(bucket.read('vid').viewCounter.shards, { '2': 4 });
});
