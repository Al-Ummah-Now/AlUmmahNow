/**
 * Live playback quality (docs/admin/LIVE_OPS.md, Delivery page): a heartbeat
 * goes only to the realtime worker's qoe-live object (no D1 write); a final
 * report keeps its one daily upsert and sends its last deltas as an ended
 * session.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { VideoQoe } from '../src/endpoints/video/videoQoe';
import { readQoeLive, toObjectBeat } from '../src/lib/media/qoe-live';

function fakeEnv() {
	const beats: any[] = [];
	const sql: string[] = [];
	const VIEW_COUNTER = {
		idFromName: (name: string) => ({ name }),
		get: (id: { name: string }) => ({
			fetch: async (url: string, init?: RequestInit) => {
				assert.equal(id.name, 'qoe-live');
				if (url.includes('/qoe/beats')) {
					beats.push(...JSON.parse(String(init?.body)).beats);
					return new Response(JSON.stringify({ success: true, accepted: 1 }));
				}
				return new Response(JSON.stringify({ minutes: [], now: { bunny: 1, r2: 2 }, at: 'x' }));
			},
		}),
	};
	const SEARCH_DB = { prepare: (q: string) => ({ bind: () => ({ run: async () => { sql.push(q); return {}; } }) }) };
	return { env: { VIEW_COUNTER, SEARCH_DB }, beats, sql };
}

function app() {
	const a = new Hono();
	fromHono(a).post('/api/videos/:id/qoe', VideoQoe);
	return a;
}

const base = { sessionId: 'session-123456', source: 'r2', device: 'desktop', started: true };

describe('QoE live', () => {
	it('a heartbeat reaches the live object only, never D1', async () => {
		const { env, beats, sql } = fakeEnv();
		const res = await app().request('/api/videos/v1/qoe', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...base, kind: 'heartbeat', playing: true, live: { attempt: true, started: true, startupMs: 700, watchMs: 30000, avgKbps: 2500 } }),
		}, env);
		assert.equal(res.status, 202);
		assert.equal(sql.length, 0);
		assert.deepEqual(beats, [{
			sessionId: 'session-123456', source: 'r2', serving: 'r2', playing: true,
			d: { attempt: 1, started: 1, startupMs: 700, watchMs: 30000, rebufferMs: 0, rebuffers: 0, kbpsWatchS: 75000 },
		}]);
	});

	it('a final report keeps its daily upsert and ends the live session with its last deltas', async () => {
		const { env, beats, sql } = fakeEnv();
		const res = await app().request('/api/videos/v1/qoe', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...base, watchMs: 40000, fallback: true, live: { watchMs: 10000, fallback: true } }),
		}, env);
		assert.equal(res.status, 202);
		assert.equal(sql.filter((q) => q.includes('playback_qoe_daily')).length, 1);
		assert.equal(beats.length, 1);
		assert.equal(beats[0].ended, true);
		assert.equal(beats[0].playing, false);
		assert.equal(beats[0].serving, 'bunny', 'a fallen-back R2 session is served by Bunny');
		assert.equal(beats[0].d.fallback, 1);
	});

	it('an old client (no live deltas) only writes the daily rollup', async () => {
		const { env, beats, sql } = fakeEnv();
		await app().request('/api/videos/v1/qoe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(base) }, env);
		assert.equal(sql.length, 1);
		assert.equal(beats.length, 0);
	});

	it('beat shape: flags as 1, bitrate as kbps × seconds; reads go to the same object', async () => {
		assert.deepEqual(toObjectBeat({ sessionId: 's-12345678', source: 'bunny', serving: 'bunny', playing: false, live: { errored: true } }).d, { watchMs: 0, rebufferMs: 0, rebuffers: 0, kbpsWatchS: 0, errored: 1 });
		const { env } = fakeEnv();
		assert.deepEqual(((await readQoeLive(env)) as any).now, { bunny: 1, r2: 2 });
		assert.equal(await readQoeLive({}), null);
	});
});
