import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mediaSmoke, selfTestVerdict, SELFTEST_WAIT_MS, START_LIMIT_MS } from '../media-smoke.ts';

const T0 = Date.parse('2026-11-15T03:00:00Z');

/** A clock the smoke's sleeps move forward (no real waiting). */
function clock() {
	let t = T0;
	return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

/** /priv/_selftest answers from `selftest(now)`; other /priv/ paths `priv`, /pub/ `pub`. */
const fetchWith = (priv: number, pub: number, selftest: (now: number) => object | null, now: () => number) =>
	(async (url: string | URL | Request) => {
		const u = String(url);
		if (u.includes('/priv/_selftest')) {
			const body = selftest(now());
			return body ? Response.json(body) : new Response('', { status: 502 });
		}
		return new Response('', { status: u.includes('/priv/') ? priv : pub });
	}) as typeof fetch;
const cfWith = (apps: { name: string; state?: string }[]) => ({ request: async () => apps }) as never;
const startsIn = (ms: number) => (now: number) => ({ ok: true, startMs: ms, at: new Date(now).toISOString() });

describe('media smoke', () => {
	it('passes when the Worker guards /priv/, R2 serves /pub/, the transcoder exists and a container starts', async () => {
		const c = clock();
		const r = await mediaSmoke('stage', { ...c, fetch: fetchWith(403, 404, startsIn(2100), c.now), cf: cfWith([{ name: 'al-ummah-now-media-stage-transcoder-stage', state: 'ready' }]) });
		assert.deepEqual(r.map((x) => x.ok), [true, true, true, true]);
		assert.match(r[3].detail, /started in 2100 ms/);
	});
	it('fails when /priv/ reaches R2 (the route is gone), the host is down, or the container app is missing', async () => {
		const c = clock();
		const r = await mediaSmoke('production', { ...c, fetch: fetchWith(404, 522, () => null, c.now), cf: cfWith([]) });
		assert.deepEqual(r.map((x) => x.ok), [false, false, false, false]);
		assert.match(r[2].detail, /al-ummah-now-media-transcoder not found/);
	});
	it('fails a container that never starts (2026-11-15: the image without review.mjs), after waiting out the rollout', async () => {
		const c = clock();
		const crash = (now: number) => ({ ok: false, startMs: 900, at: new Date(now).toISOString(), error: 'container start failed' });
		const r = await mediaSmoke('production', { ...c, fetch: fetchWith(403, 404, crash, c.now), cf: cfWith([{ name: 'al-ummah-now-media-transcoder' }]) });
		assert.equal(r[3].ok, false);
		assert.match(r[3].detail, /did not start: container start failed/);
		assert.ok(c.now() - T0 >= SELFTEST_WAIT_MS, 'it waited for the rollout before failing');
	});
	it('waits through crashes while the rollout replaces instances, then passes', async () => {
		const c = clock();
		const rollout = (now: number) => (now - T0 < 60_000 ? { ok: false, startMs: 800, at: new Date(now).toISOString(), error: 'just exited' } : startsIn(3000)(now));
		const r = await mediaSmoke('production', { ...c, fetch: fetchWith(403, 404, rollout, c.now), cf: cfWith([{ name: 'al-ummah-now-media-transcoder' }]) });
		assert.equal(r[3].ok, true);
	});
});

describe('selfTestVerdict', () => {
	const at = (ms: number) => new Date(T0 + ms).toISOString();
	it('asks again for a run older than the deploy, or a failed start inside the wait', () => {
		assert.deepEqual(selfTestVerdict({ ok: true, startMs: 1000, at: at(-5000), cached: true }, T0, 0), { done: false });
		assert.deepEqual(selfTestVerdict({ ok: false, startMs: 1000, at: at(1000), error: 'x' }, T0, 1000), { done: false });
		assert.deepEqual(selfTestVerdict(null, T0, 1000), { done: false });
	});
	it('fails a slow cold start at once, and passes a capacity-full skip (busy is not broken)', () => {
		const slow = selfTestVerdict({ ok: true, startMs: START_LIMIT_MS + 1, at: at(1000) }, T0, 1000);
		assert.equal(slow.done && slow.ok, false);
		const busy = selfTestVerdict({ ok: true, startMs: 50, at: at(1000), skipped: 'capacity full: every instance is transcoding' }, T0, 1000);
		assert.deepEqual(busy, { done: true, ok: true, detail: 'not tested: capacity full: every instance is transcoding' });
	});
});
