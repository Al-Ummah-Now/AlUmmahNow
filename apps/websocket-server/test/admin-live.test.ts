/**
 * Admin live channels (docs/admin/LIVE_OPS.md Part B): role check at subscribe,
 * no client publishing, coalescing to one update per second per topic, and the
 * shared producer helper.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  adminLevelOf,
  adminLiveItem,
  canSubscribeAdminLive,
  coalesceAdminLiveEvents,
  publishAdminLive,
  type AdminLiveEvent,
} from '@al-ummah/shared-types';
import { __setJwksForTests, canPublish } from '../src/auth.ts';
import { AdminCoalescer, eventsOf, type CoalescerStorage } from '../src/admin-coalescer.ts';
import { WebSocketDurableObject } from '../src/websocket.ts';
import type { BroadcastItem } from '../src/shards.ts';
import { ISSUER, WEB_CLIENT, makeSigner, type Signer } from './helpers.ts';
import { FakeCtx, FakeSocket, installWorkerGlobals, restoreWorkerGlobals } from './fakes.ts';

let signer: Signer;

before(async () => {
  signer = await makeSigner();
  __setJwksForTests(ISSUER, signer.getKey);
  installWorkerGlobals();
});

after(() => {
  __setJwksForTests(ISSUER, undefined);
  restoreWorkerGlobals();
});

function makeDO() {
  const env = { Issuer: ISSUER, ALLOWED_CLIENT_IDS: WEB_CLIENT, ENVIRONMENT: 'production' };
  const ctx = new FakeCtx();
  return new WebSocketDurableObject(ctx as any, env as any) as any;
}

async function connect(durable: any): Promise<FakeSocket> {
  await durable.fetch(new Request('https://realtime.test/ws', { headers: { Upgrade: 'websocket' } }));
  return [...durable.sockets.keys()].at(-1) as FakeSocket;
}

async function signIn(durable: any, ws: FakeSocket, roles?: string[], exp?: number) {
  const token = await signer.sign({ properties: { id: 'user-123', email: 'a@example.com', ...(roles ? { roles } : {}) } }, exp ? { exp } : {});
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token }));
  assert.equal(ws.last().type, 'authenticated');
}

async function subscribe(durable: any, ws: FakeSocket, channel: string) {
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'subscribe', channel }));
  return ws.last();
}

// ---- Subscribe and publish rules ----

test('a signed-in user without an admin role cannot join admin channels', async () => {
  const durable = makeDO();
  const ws = await connect(durable);
  await signIn(durable, ws);
  assert.equal((await subscribe(durable, ws, 'admin:jobs')).code, 'FORBIDDEN');
  assert.equal((await subscribe(durable, ws, 'admin:moderation')).code, 'FORBIDDEN');
  assert.equal(durable.subscriberCount('admin:jobs'), 0);
});

test('a signed-out socket cannot join admin channels', async () => {
  const durable = makeDO();
  const ws = await connect(durable);
  assert.equal((await subscribe(durable, ws, 'admin:jobs')).code, 'AUTH_REQUIRED');
});

test('a moderator joins the moderation topic but not admin-only topics', async () => {
  const durable = makeDO();
  const ws = await connect(durable);
  await signIn(durable, ws, ['Moderator']);
  assert.deepEqual(await subscribe(durable, ws, 'admin:moderation'), { type: 'subscribed', channel: 'admin:moderation' });
  assert.equal((await subscribe(durable, ws, 'admin:jobs')).code, 'FORBIDDEN');
  assert.equal((await subscribe(durable, ws, 'admin:errors')).code, 'FORBIDDEN');
});

test('an admin joins every admin topic; an unknown topic is refused', async () => {
  const durable = makeDO();
  const ws = await connect(durable);
  await signIn(durable, ws, ['Super Admin']);
  for (const topic of ['jobs', 'media', 'queues', 'uploads', 'errors', 'moderation', 'live', 'ops']) {
    assert.equal((await subscribe(durable, ws, `admin:${topic}`)).type, 'subscribed', topic);
  }
  assert.equal((await subscribe(durable, ws, 'admin:secrets')).code, 'FORBIDDEN');
});

test('nobody can publish into an admin channel from a socket', async () => {
  assert.equal(canPublish('admin:jobs'), false);
  const durable = makeDO();
  const ws = await connect(durable);
  await signIn(durable, ws, ['Admin']);
  await subscribe(durable, ws, 'admin:jobs');
  const sendsBefore = ws.sends;
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'message', channel: 'admin:jobs', data: { kind: 'job' } }));
  assert.equal(ws.last().code, 'FORBIDDEN');
  assert.equal(ws.sends, sendsBefore + 1); // only the error, nothing delivered
});

test('admin channels are dropped when the token expires and after re-auth without the role', async () => {
  const durable = makeDO();
  const ws = await connect(durable);
  // The token lives 10 minutes, so the real clock never expires it during sign-in and subscribe
  // (with a 1 s token, a slow runner crossed the second and the test flaked); expiry is then
  // driven only through the injected clock, at and after the token's exp
  const exp = Math.floor(Date.now() / 1000) + 600;
  await signIn(durable, ws, ['Admin'], exp);
  assert.equal((await subscribe(durable, ws, 'admin:jobs')).type, 'subscribed');
  assert.equal(durable.expireAuthIfNeeded(ws, { nowSeconds: exp - 1 }), false, 'still valid a second before exp');
  assert.equal(durable.subscriberCount('admin:jobs'), 1);
  assert.equal(durable.expireAuthIfNeeded(ws, { nowSeconds: exp }), true, 'expired at exp');
  assert.equal(durable.subscriberCount('admin:jobs'), 0);
  assert.equal(durable.sockets.get(ws).adminLevel, undefined);

  // Signs in again as an admin, then refreshes with a token whose role was removed
  await signIn(durable, ws, ['Admin']);
  await subscribe(durable, ws, 'admin:jobs');
  assert.equal(durable.subscriberCount('admin:jobs'), 1);
  await signIn(durable, ws, []);
  assert.equal(durable.subscriberCount('admin:jobs'), 0);
  assert.ok(!durable.sockets.get(ws).channels.includes('admin:jobs'));
});

// ---- Coalescer ----

class FakeAlarmStorage implements CoalescerStorage {
  data = new Map<string, unknown>();
  alarmAt: number | null = null;
  async get<T>(key: string) { return structuredClone(this.data.get(key)) as T | undefined; }
  async put<T>(key: string, value: T) { this.data.set(key, structuredClone(value)); }
  async getAlarm() { return this.alarmAt; }
  async setAlarm(at: number) { this.alarmAt = at; }
}

function makeCoalescer() {
  const storage = new FakeAlarmStorage();
  const sent: BroadcastItem[] = [];
  let clock = 10_000;
  const c = new AdminCoalescer(storage, async (item) => { sent.push(item); }, () => clock);
  return { c, storage, sent, advance: (ms: number) => { clock += ms; }, now: () => clock };
}

const data = (item: BroadcastItem) => (item.message as { data: { events: AdminLiveEvent[]; resync?: boolean; topic: string } }).data;

test('a quiet topic sends at once; a burst within the second goes out as one update, latest per key', async () => {
  const { c, storage, sent, advance, now } = makeCoalescer();
  assert.equal(await c.add('admin:jobs', [{ kind: 'job', key: 'job:1', status: 'queued' }]), 'sent');
  assert.equal(sent.length, 1);
  assert.equal(data(sent[0]).topic, 'jobs');

  advance(100);
  assert.equal(await c.add('admin:jobs', [{ kind: 'job', key: 'job:1', status: 'running' }]), 'held');
  advance(100);
  await c.add('admin:jobs', [{ kind: 'job', key: 'job:2', status: 'queued' }]);
  advance(100);
  await c.add('admin:jobs', [{ kind: 'job', key: 'job:1', status: 'succeeded' }]);
  assert.equal(sent.length, 1);
  assert.equal(storage.alarmAt, now() - 300 + 1000); // first flush + 1 s

  advance(700);
  assert.equal(await c.alarm(), true);
  assert.equal(sent.length, 2);
  assert.deepEqual(data(sent[1]).events.map((e) => [e.key, e.status]), [['job:1', 'succeeded'], ['job:2', 'queued']]);

  // Nothing pending: an alarm is a no-op, and the next event after a second goes out at once
  storage.alarmAt = null;
  assert.equal(await c.alarm(), true);
  assert.equal(sent.length, 2);
  advance(1000);
  assert.equal(await c.add('admin:jobs', [{ kind: 'counts', open: 3 }]), 'sent');
});

test('more keys than one update holds turn into resync', async () => {
  const { c, sent, advance } = makeCoalescer();
  await c.add('admin:errors', [{ kind: 'error', key: 'e:0' }]);
  advance(10);
  await c.add('admin:errors', Array.from({ length: 60 }, (_, i) => ({ kind: 'error', key: `e:${i + 1}` })));
  advance(1000);
  await c.alarm();
  assert.equal(data(sent[1]).events.length, 50);
  assert.equal(data(sent[1]).resync, true);
});

test('an object that is not a coalescer leaves its alarm to the view counter', async () => {
  const { c } = makeCoalescer();
  assert.equal(await c.alarm(), false);
});

test('the coalescer refuses channels that are not admin topics', async () => {
  const { c } = makeCoalescer();
  await assert.rejects(() => c.add('user:1', [{ kind: 'x' }]));
  await assert.rejects(() => c.add('admin:nope', [{ kind: 'x' }]));
});

test('eventsOf reads only well-formed admin updates', () => {
  assert.deepEqual(eventsOf(adminLiveItem('jobs', [{ kind: 'job', key: 'job:1' }])), [{ kind: 'job', key: 'job:1' }]);
  assert.equal(eventsOf({ channel: 'admin:jobs', message: { type: 'notification', data: {} } }), null);
  assert.deepEqual(eventsOf({ channel: 'admin:jobs', message: { type: 'admin.update', data: { events: [{ nokind: 1 }, { kind: 'ok' }] } } }), [{ kind: 'ok' }]);
});

// ---- Shared helpers ----

test('admin levels follow the site roles', () => {
  assert.equal(adminLevelOf(['Super Admin']), 'admin');
  assert.equal(adminLevelOf(['admin']), 'admin');
  assert.equal(adminLevelOf(['Moderator']), 'moderator');
  assert.equal(adminLevelOf(['creator']), null);
  assert.equal(adminLevelOf(undefined), null);
  assert.equal(canSubscribeAdminLive('moderator', 'admin:moderation'), true);
  assert.equal(canSubscribeAdminLive('moderator', 'admin:media'), false);
  assert.equal(canSubscribeAdminLive('admin', 'admin:media'), true);
  assert.equal(canSubscribeAdminLive('admin', 'user:1'), false);
  assert.equal(canSubscribeAdminLive(null, 'admin:moderation'), false);
});

test('coalesceAdminLiveEvents keeps first-seen order with the latest value', () => {
  const { events, overflow } = coalesceAdminLiveEvents([{ kind: 'a', v: 1 }, { kind: 'b' }], [{ kind: 'a', v: 2 }]);
  assert.deepEqual(events, [{ kind: 'a', v: 2 }, { kind: 'b' }]);
  assert.equal(overflow, false);
});

test('publishAdminLive posts one item to the realtime /broadcast and never throws', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const ok = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true } as Response;
  }) as unknown as typeof fetch;
  const env = { WEBSOCKET_URL: 'wss://realtime.qa.example/ws', INTERNAL_API_KEY: { get: async () => 'k' } };
  assert.equal(await publishAdminLive(env, 'jobs', { kind: 'job', key: 'job:1' }, ok), true);
  assert.equal(calls[0].url, 'https://realtime.qa.example/broadcast');
  assert.equal((calls[0].init.headers as Record<string, string>)['X-API-Key'], 'k');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.items[0].channel, 'admin:jobs');
  assert.deepEqual(body.items[0].message.data.events, [{ kind: 'job', key: 'job:1' }]);

  const boom = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  assert.equal(await publishAdminLive(env, 'jobs', { kind: 'job' }, boom), false);
  assert.equal(await publishAdminLive({ WEBSOCKET_URL: 'https://x' }, 'jobs', { kind: 'job' }, ok), false);
  assert.equal(await publishAdminLive({}, 'jobs', { kind: 'job' }, ok), false);
  assert.equal(calls.length, 1);
});

test('an oversized event is cut to kind and key so a window always fits in storage', () => {
  const big = { kind: 'job', key: 'job:9', failure: { stderr: 'x'.repeat(5000) } };
  const { events } = coalesceAdminLiveEvents([], [big, { kind: 'live', n: 1 }]);
  assert.deepEqual(events[0], { kind: 'job', key: 'job:9', truncated: true });
  assert.deepEqual(events[1], { kind: 'live', n: 1 });
});
