/** People watching a live stream now (live-viewers.ts, AlUmmahNow#30). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { LiveViewers, MAX_PER_NET, MAX_VIEWERS, VIEWER_TTL_MS, isViewerId } from '../src/live-viewers.ts';
import { WebSocketDurableObject } from '../src/websocket.ts';
import app from '../src/index.ts';
import { FakeNamespace, installWorkerGlobals, restoreWorkerGlobals } from './fakes.ts';

const T0 = Date.parse('2026-11-14T20:00:00.000Z');

test('counts each tab once while it beats, drops it after missed beats or when it leaves', () => {
  const v = new LiveViewers();
  assert.equal(v.beat('viewer-aaaa', T0), 1);
  assert.equal(v.beat('viewer-aaaa', T0 + 20_000), 1);
  assert.equal(v.beat('viewer-bbbb', T0 + 20_000), 2);
  assert.equal(v.beat('viewer-cccc', T0 + 21_000, true), 2, 'leaving before ever counting changes nothing');
  assert.equal(v.beat('viewer-bbbb', T0 + 22_000, true), 1);
  assert.equal(v.count(T0 + 20_000 + VIEWER_TTL_MS), 1, 'still within the time to live');
  assert.equal(v.count(T0 + 20_001 + VIEWER_TTL_MS), 0);
});

test('expiry respects the latest beat, not the first', () => {
  const v = new LiveViewers();
  v.beat('viewer-aaaa', T0);
  v.beat('viewer-bbbb', T0 + 10_000);
  v.beat('viewer-aaaa', T0 + 30_000);
  assert.equal(v.count(T0 + 10_001 + VIEWER_TTL_MS), 1, 'b expired, a renewed later stays');
});

test('memory is bounded', () => {
  const v = new LiveViewers();
  for (let i = 0; i < MAX_VIEWERS + 10; i++) v.beat(`viewer-${String(i).padStart(8, '0')}`, T0, false, Math.floor(i / MAX_PER_NET).toString(16).padStart(8, '0'));
  assert.equal(v.count(T0), MAX_VIEWERS);
});

test('one network counts at most MAX_PER_NET viewers; those already counted keep their place', () => {
  const v = new LiveViewers();
  for (let i = 0; i < MAX_PER_NET + 20; i++) v.beat(`viewer-${String(i).padStart(8, '0')}`, T0, false, 'aaaaaaaaaaaaaaaa');
  assert.equal(v.count(T0), MAX_PER_NET);
  assert.equal(v.beat('viewer-00000000', T0 + 1000, false, 'aaaaaaaaaaaaaaaa'), MAX_PER_NET, 'a counted viewer beats again');
  assert.equal(v.beat('viewer-other-net', T0 + 1000, false, 'bbbbbbbbbbbbbbbb'), MAX_PER_NET + 1);
  v.beat('viewer-00000001', T0 + 2000, true);
  assert.equal(v.beat('viewer-newcomer1', T0 + 2000, false, 'aaaaaaaaaaaaaaaa'), MAX_PER_NET + 1, 'room once one leaves');
});

test('viewer ids are short random tokens', () => {
  assert.ok(isViewerId('3f2a9c1e-7b4d-4a8e-9c0d-1e2f3a4b5c6d'));
  for (const bad of ['', 'short', 'x'.repeat(65), 'has space here', 42, null]) assert.equal(isViewerId(bad), false);
});

before(() => installWorkerGlobals());
after(() => restoreWorkerGlobals());

test('the liveviewers object answers beats and counts through the DO binding only', async () => {
  const ns = new FakeNamespace<any>((ctx, env) => new WebSocketDurableObject(ctx as any, env));
  const name = 'liveviewers:stream-1';
  const beat = (body: unknown) => ns.call(name, (o: any) => o.fetch(new Request('http://internal/live-viewers/beat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })));
  assert.equal((await (await beat({ viewerId: 'viewer-aaaa' })).json()).viewers, 1);
  assert.equal((await (await beat({ viewerId: 'viewer-bbbb' })).json()).viewers, 2);
  assert.equal((await (await beat({ viewerId: 'viewer-aaaa', leaving: true })).json()).viewers, 1);
  assert.equal((await beat({ viewerId: 'bad' })).status, 400);
  const count = await ns.call(name, (o: any) => o.fetch(new Request('http://internal/live-viewers/count')));
  assert.equal((await count.json()).viewers, 1);
  // The public Worker never forwards these paths
  const outside = await app.fetch(new Request('https://realtime.test/live-viewers/count'), { WEBSOCKET_DO: ns } as any);
  assert.notEqual(outside.status, 200);
});
