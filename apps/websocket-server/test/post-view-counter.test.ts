/**
 * Per-post view counter (src/post-view-counter.ts): views are batched into a
 * few D1 writes, none is lost, and no flush counts twice.
 *
 * D1 is real SQLite (node:sqlite) with the analytics_daily table, wrapped with
 * random async delays; storage is a Durable Object storage stand-in. Time is
 * virtual, and alarms fire only when due.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
	POST_FLUSH_DELAY_MS,
	POST_RETRY_DELAY_MS,
	PostViewCounter,
	postCounterDim,
	type CounterDb,
	type PostCounterStorage,
} from '../src/post-view-counter.ts';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, Math.floor(Math.random() * 3)));

/** D1 stand-in on node:sqlite: prepare/bind/batch, with a switch to fail. */
class FakeD1 implements CounterDb {
	readonly sql = new DatabaseSync(':memory:');
	batches = 0;
	failNext = 0;
	/** Fail after committing (as if the response was lost): the caller retries. */
	loseNextResponse = 0;
	constructor() {
		this.sql.exec(`CREATE TABLE analytics_daily (
			entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, day TEXT NOT NULL, metric TEXT NOT NULL,
			dim TEXT NOT NULL DEFAULT '', value REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (entity_type, entity_id, day, metric, dim)) WITHOUT ROWID`);
	}
	prepare(query: string) {
		return { bind: (...values: unknown[]) => ({ query, values }) };
	}
	async batch(statements: unknown[]) {
		await tick();
		if (this.failNext > 0) {
			this.failNext--;
			throw new Error('D1 unavailable');
		}
		this.sql.exec('BEGIN');
		for (const s of statements as { query: string; values: (string | number)[] }[]) this.sql.prepare(s.query).run(...s.values);
		this.sql.exec('COMMIT');
		this.batches++;
		if (this.loseNextResponse > 0) {
			this.loseNextResponse--;
			throw new Error('network error after commit');
		}
		return [];
	}
	/** What readers see: the sum over every dim (lib/post-views.ts in api-videos). */
	views(postId: string, day?: string): number {
		const row = this.sql
			.prepare(`SELECT COALESCE(SUM(value), 0) AS n FROM analytics_daily WHERE entity_type = 'post' AND entity_id = ? AND metric = 'views'${day ? ' AND day = ?' : ''}`)
			.get(...(day ? [postId, day] : [postId])) as { n: number };
		return Number(row.n);
	}
	directView(postId: string, day: string) {
		this.sql
			.prepare(`INSERT INTO analytics_daily VALUES ('post', ?, ?, 'views', '', 1)
				ON CONFLICT (entity_type, entity_id, day, metric, dim) DO UPDATE SET value = value + excluded.value`)
			.run(postId, day);
	}
}

class FakeStorage implements PostCounterStorage {
	data = new Map<string, unknown>();
	alarmAt: number | null = null;
	async get<T>(key: string) { await tick(); return structuredClone(this.data.get(key)) as T | undefined; }
	async put<T>(key: string, value: T) { await tick(); this.data.set(key, structuredClone(value)); }
	async delete(key: string) { await tick(); return this.data.delete(key); }
	async getAlarm() { return this.alarmAt; }
	async setAlarm(at: number) { this.alarmAt = at; }
}

const DAY1 = Date.UTC(2026, 10, 10, 12, 0, 0);

function setup(clock = { now: DAY1 }) {
	const db = new FakeD1();
	const shards = [0, 1, 2, 3].map((n) => {
		const storage = new FakeStorage();
		return { n: String(n), storage, counter: new PostViewCounter(storage, db, { now: () => clock.now }) };
	});
	/** Fires every due alarm (the runtime clears an alarm before running it). */
	async function fireDue() {
		for (const s of shards) {
			if (s.storage.alarmAt !== null && s.storage.alarmAt <= clock.now) {
				s.storage.alarmAt = null;
				await s.counter.alarm();
			}
		}
	}
	return { db, shards, clock, fireDue };
}

test('1000 parallel views over 4 shards: exact count, a handful of D1 writes', async () => {
	const { db, shards, clock, fireDue } = setup();
	await Promise.all(Array.from({ length: 1000 }, (_, i) => shards[i % 4].counter.increment('p1', shards[i % 4].n)));
	assert.equal(db.views('p1'), 0, 'nothing written per view');
	clock.now += POST_FLUSH_DELAY_MS;
	await fireDue();
	assert.equal(db.views('p1'), 1000);
	assert.equal(db.batches, 4, 'one D1 batch per shard');
	for (const s of shards) {
		const row = db.sql.prepare(`SELECT value FROM analytics_daily WHERE dim = ?`).get(postCounterDim(s.n)) as { value: number };
		assert.equal(row.value, 250);
	}
});

test('views during a flush are flushed next window, never lost or doubled', async () => {
	const { db, shards, clock, fireDue } = setup();
	const s = shards[0];
	for (let i = 0; i < 10; i++) await s.counter.increment('p2', s.n);
	clock.now += POST_FLUSH_DELAY_MS;
	s.storage.alarmAt = null;
	await Promise.all([s.counter.alarm(), ...Array.from({ length: 25 }, () => s.counter.increment('p2', s.n))]);
	assert.notEqual(s.storage.alarmAt, null, 'a next flush is scheduled');
	clock.now += POST_FLUSH_DELAY_MS;
	await fireDue();
	assert.equal(db.views('p2'), 35);
	assert.equal(s.storage.alarmAt, null, 'idle once everything is in D1');
});

test('a failed flush retries; a flush whose response was lost cannot count twice', async () => {
	const { db, shards, clock, fireDue } = setup();
	const s = shards[0];
	for (let i = 0; i < 7; i++) await s.counter.increment('p3', s.n);
	db.failNext = 1;
	clock.now += POST_FLUSH_DELAY_MS;
	await fireDue();
	assert.equal(db.views('p3'), 0);
	assert.equal(s.storage.alarmAt, clock.now + POST_RETRY_DELAY_MS);

	db.loseNextResponse = 1;
	clock.now += POST_RETRY_DELAY_MS;
	await fireDue();
	assert.equal(db.views('p3'), 7, 'committed');
	clock.now += POST_RETRY_DELAY_MS;
	await fireDue();
	assert.equal(db.views('p3'), 7, 'the retry max-merges, it does not add');
});

test('a restarted object resumes from storage; direct fallback views add up with counter views', async () => {
	const clock = { now: DAY1 };
	const { db, shards, fireDue } = setup(clock);
	const s = shards[1];
	for (let i = 0; i < 5; i++) await s.counter.increment('p4', s.n);
	db.directView('p4', '2026-11-10');
	db.directView('p4', '2026-11-10');
	// Evicted before the alarm: a new instance on the same storage
	s.counter = new PostViewCounter(s.storage, db, { now: () => clock.now });
	await s.counter.increment('p4', s.n);
	clock.now += POST_FLUSH_DELAY_MS;
	await fireDue();
	assert.equal(db.views('p4'), 8);
});

test('views across midnight land on their own day; finished days leave storage', async () => {
	const clock = { now: Date.UTC(2026, 10, 10, 23, 59, 55) };
	const { db, shards, fireDue } = setup(clock);
	const s = shards[2];
	for (let i = 0; i < 3; i++) await s.counter.increment('p5', s.n);
	clock.now += 6_000; // past midnight, before the flush
	for (let i = 0; i < 4; i++) await s.counter.increment('p5', s.n);
	clock.now += POST_FLUSH_DELAY_MS;
	await fireDue();
	assert.equal(db.views('p5', '2026-11-10'), 3);
	assert.equal(db.views('p5', '2026-11-11'), 4);
	const state = s.storage.data.get('postViewCounter') as { days: Record<string, number> };
	assert.deepEqual(Object.keys(state.days), ['2026-11-11']);
	// More views today keep growing today's row (max-merge of the cumulative total)
	for (let i = 0; i < 2; i++) await s.counter.increment('p5', s.n);
	clock.now += POST_FLUSH_DELAY_MS;
	await fireDue();
	assert.equal(db.views('p5', '2026-11-11'), 6);
});

test('an object only ever counts its own post and shard', async () => {
	const { shards } = setup();
	await shards[0].counter.increment('p6', '0');
	await assert.rejects(shards[0].counter.increment('other', '0'));
	await assert.rejects(shards[0].counter.increment('p6', '1'));
});

test('no NOTIFICATIONS_DB: keeps the views and retries later', async () => {
	const storage = new FakeStorage();
	const clock = { now: DAY1 };
	const counter = new PostViewCounter(storage, undefined, { now: () => clock.now });
	await counter.increment('p7', '0');
	storage.alarmAt = null;
	await counter.alarm();
	assert.equal(storage.alarmAt, clock.now + POST_RETRY_DELAY_MS);
	assert.equal((storage.data.get('postViewCounter') as { days: Record<string, number> }).days['2026-11-10'], 1);
});

test('a view stored before the alarm could be set is still a success (no double count by the API fallback)', async () => {
	const storage = new FakeStorage();
	storage.setAlarm = async () => { throw new Error('alarm unavailable'); };
	const counter = new PostViewCounter(storage, new FakeD1(), { now: () => DAY1 });
	assert.deepEqual(await counter.increment('p8', '0'), { unflushed: 1 });
});
