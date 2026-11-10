/**
 * The Durable Object class hosts both counters (video and post views): each
 * object's increments and alarms reach the right one.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketDurableObject } from '../src/websocket.ts';
import { FakeCtx, installWorkerGlobals, restoreWorkerGlobals } from './fakes.ts';

before(() => installWorkerGlobals());
after(() => restoreWorkerGlobals());

class Storage {
	data = new Map<string, unknown>();
	alarmAt: number | null = null;
	async get<T>(key: string) { return structuredClone(this.data.get(key)) as T | undefined; }
	async put<T>(key: string, value: T) { this.data.set(key, structuredClone(value)); }
	async delete(key: string) { return this.data.delete(key); }
	async deleteAll() { this.data.clear(); }
	async getAlarm() { return this.alarmAt; }
	async setAlarm(at: number) { this.alarmAt = at; }
	async deleteAlarm() { this.alarmAt = null; }
}

function d1() {
	const sql = new DatabaseSync(':memory:');
	sql.exec(`CREATE TABLE analytics_daily (entity_type TEXT, entity_id TEXT, day TEXT, metric TEXT, dim TEXT, value REAL,
		PRIMARY KEY (entity_type, entity_id, day, metric, dim)) WITHOUT ROWID`);
	return {
		sql,
		prepare: (query: string) => ({ bind: (...values: unknown[]) => ({ query, values }) }),
		async batch(statements: { query: string; values: (string | number)[] }[]) {
			for (const s of statements) sql.prepare(s.query).run(...s.values);
			return [];
		},
	};
}

function bucket(objects: Map<string, string>) {
	let version = 0;
	return {
		async get(key: string) {
			const body = objects.get(key);
			return body === undefined ? null : { etag: `v${version}`, json: async () => JSON.parse(body) };
		},
		async put(key: string, value: string, options: { onlyIf?: { etagMatches?: string } }) {
			if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== `v${version}`) return null;
			version++;
			objects.set(key, value);
			return {};
		},
	};
}

function makeDO(env: Record<string, unknown>) {
	const ctx = new FakeCtx() as FakeCtx & { storage: Storage };
	ctx.storage = new Storage();
	const durable = new WebSocketDurableObject(ctx as any, { ENVIRONMENT: 'production', ...env } as any) as any;
	return { durable, storage: ctx.storage };
}

const post = (body: unknown, path: string) =>
	new Request(`http://view-counter${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('a post view object counts, then its alarm flushes into analytics_daily', async () => {
	const db = d1();
	const { durable, storage } = makeDO({ NOTIFICATIONS_DB: db });
	for (let i = 0; i < 3; i++) {
		const response = await durable.fetch(post({ postId: 'p1', shard: 2 }, '/post-views/increment'));
		assert.equal(response.status, 200);
		assert.equal((await response.json()).unflushed, i + 1);
	}
	assert.notEqual(storage.alarmAt, null);
	await durable.alarm();
	const row = db.sql.prepare(`SELECT entity_type, entity_id, metric, dim, value FROM analytics_daily`).get() as Record<string, unknown>;
	assert.deepEqual({ ...row }, { entity_type: 'post', entity_id: 'p1', metric: 'views', dim: 'counter:2', value: 3 });
});

test('a video view object still flushes into the video JSON', async () => {
	const objects = new Map([['v1', JSON.stringify({ id: 'v1', views: 10 })]]);
	const { durable } = makeDO({ VIDEOS: bucket(objects), NOTIFICATIONS_DB: d1() });
	const response = await durable.fetch(post({ videoId: 'v1', shard: 0 }, '/views/increment'));
	assert.equal(response.status, 200);
	await durable.alarm();
	assert.equal(JSON.parse(objects.get('v1')!).views, 11);
});

test('a bad post view request is a 400', async () => {
	const { durable } = makeDO({ NOTIFICATIONS_DB: d1() });
	assert.equal((await durable.fetch(post({ postId: '', shard: 0 }, '/post-views/increment'))).status, 400);
	assert.equal((await durable.fetch(post({ postId: 'p', shard: 'x' }, '/post-views/increment'))).status, 400);
});
