/** Live playback quality buckets (qoe-live.ts): minute sums, "now", flush cadence, retention, recent view. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { QoeLive, FLUSH_MS, PLAYING_TTL_MS, RETENTION_MS, minuteOf, type QoeBeat, type QoeStorage } from '../src/qoe-live.ts';
import { WebSocketDurableObject } from '../src/websocket.ts';
import { __setJwksForTests } from '../src/auth.ts';
import app from '../src/index.ts';
import { ISSUER, WEB_CLIENT, makeSigner, type Signer } from './helpers.ts';
import { FakeNamespace, FakeSocket, installWorkerGlobals, restoreWorkerGlobals } from './fakes.ts';

class MemStorage implements QoeStorage {
  data = new Map<string, unknown>();
  alarmAt: number | null = null;
  puts = 0;
  async get<T>(k: string) { return structuredClone(this.data.get(k)) as T | undefined; }
  async put<T>(entries: Record<string, T>) { this.puts++; for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v)); }
  async list<T>({ prefix = '', start, end, limit }: { prefix?: string; start?: string; end?: string; limit?: number }) {
    const keys = [...this.data.keys()].filter((k) => k.startsWith(prefix) && (!start || k >= start) && (!end || k < end)).sort().slice(0, limit ?? Infinity);
    return new Map(keys.map((k) => [k, structuredClone(this.data.get(k)) as T]));
  }
  async delete(keys: string[]) { let n = 0; for (const k of keys) if (this.data.delete(k)) n++; return n; }
  async getAlarm() { return this.alarmAt; }
  async setAlarm(at: number) { this.alarmAt = at; }
}

const T0 = Date.parse('2026-11-12T10:00:10.000Z');
const beat = (over: Partial<QoeBeat> & { d?: QoeBeat['d'] } = {}): QoeBeat => ({ sessionId: 'session-aaaa', source: 'r2', serving: 'r2', playing: true, d: {}, ...over });

function setup() {
  const storage = new MemStorage();
  const events: any[] = [];
  let clock = T0;
  const q = new QoeLive(storage, async (e) => { events.push(e); }, () => clock);
  return { q, storage, events, advance: (ms: number) => { clock += ms; }, now: () => clock };
}

test('beats sum into the minute per source; one write and one event per flush, not per beat', async () => {
  const { q, storage, events } = setup();
  await q.addBeats([
    beat({ sessionId: 'session-r2-1', d: { attempt: 1, started: 1, startupMs: 800, watchMs: 30_000, kbpsWatchS: 3000 * 30 } }),
    beat({ sessionId: 'session-r2-2', d: { attempt: 1, errored: 1 } }),
    beat({ sessionId: 'session-bn-1', source: 'bunny', serving: 'bunny', d: { attempt: 1, started: 1, startupMs: 1200, rebufferMs: 500, rebuffers: 1, watchMs: 20_000 } }),
    beat({ sessionId: 'session-r2-3', serving: 'bunny', d: { fallback: 1 } }),
    { nonsense: true },
  ]);
  assert.equal(storage.alarmAt, T0 + FLUSH_MS);
  const writesBefore = storage.puts;
  await q.alarm();
  assert.equal(storage.puts, writesBefore + 1, 'one storage write for the flush');
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.kind, 'qoe');
  assert.equal(e.minute, '2026-11-12T10:00');
  assert.deepEqual(
    [e.r2.attempts, e.r2.plays, e.r2.startupMsSum, e.r2.errorSessions, e.r2.fallbacks, e.r2.kbpsWatchS],
    [2, 1, 800, 1, 1, 90_000],
  );
  assert.deepEqual([e.bunny.plays, e.bunny.rebufferMs, e.bunny.rebuffers], [1, 500, 1]);
  // Now counts the source serving the play: the fallen-back R2 session plays on Bunny
  assert.deepEqual(e.now, { bunny: 2, r2: 2 });
  assert.ok(JSON.stringify(e).length < 2048, 'fits a live event');
});

test('a beat flushed after its minute turned is still published under its own minute (#1125)', async () => {
  const { q, events, advance } = setup();
  // 10:00:57: the beat lands in minute 10:00; the flush runs at 10:01:02
  advance(47_000);
  await q.addBeats([beat({ d: { attempt: 1, started: 1 } })]);
  advance(FLUSH_MS);
  await q.alarm();
  assert.equal(events.length, 1);
  assert.equal(events[0].minute, '2026-11-12T10:00', 'the minute that holds the play');
  assert.equal(events[0].r2.plays, 1);
  assert.deepEqual(events[0].now, { bunny: 0, r2: 1 });
});

test('beats in two minutes before one flush: one event per minute, oldest first', async () => {
  const { q, events, advance } = setup();
  advance(48_000); // 10:00:58
  await q.addBeats([beat({ sessionId: 'session-a', d: { attempt: 1, started: 1 } })]);
  advance(3_000); // 10:01:01
  await q.addBeats([beat({ sessionId: 'session-b', d: { attempt: 1, started: 1 } })]);
  advance(FLUSH_MS);
  await q.alarm();
  assert.deepEqual(events.map((e) => [e.minute, e.r2.plays]), [['2026-11-12T10:00', 1], ['2026-11-12T10:01', 1]]);
  // Distinct keys: the admin coalescer keeps the latest event per key, so one shared key would drop 10:00
  assert.deepEqual(events.map((e) => e.key), ['qoe:2026-11-12T10:00', 'qoe:2026-11-12T10:01']);
  assert.deepEqual(events.at(-1).now, { bunny: 0, r2: 2 });
});

test('nothing new: no event; an expiring session changes "now" and sends one; then the alarm stops', async () => {
  const { q, storage, events, advance } = setup();
  await q.addBeats([beat({ d: { attempt: 1, started: 1 } })]);
  await q.alarm();
  advance(FLUSH_MS);
  await q.alarm();
  assert.equal(events.length, 1);
  advance(PLAYING_TTL_MS);
  storage.alarmAt = null;
  await q.alarm();
  assert.equal(events.length, 2);
  assert.deepEqual(events[1].now, { bunny: 0, r2: 0 });
  assert.equal(storage.alarmAt, null, 'nothing left to expire');
});

test('an ended or paused session leaves "now" at once', async () => {
  const { q } = setup();
  await q.addBeats([beat({ sessionId: 'session-a1' }), beat({ sessionId: 'session-b1', source: 'bunny', serving: 'bunny' })]);
  assert.deepEqual(q.now(), { bunny: 1, r2: 1 });
  await q.addBeats([beat({ sessionId: 'session-a1', ended: true }), beat({ sessionId: 'session-b1', source: 'bunny', serving: 'bunny', playing: false })]);
  assert.deepEqual(q.now(), { bunny: 0, r2: 0 });
});

test('recent: the last 60 minutes oldest first, with gaps as empty minutes; survives a new instance', async () => {
  const { q, storage, advance, now } = setup();
  await q.addBeats([beat({ d: { attempt: 1, started: 1 } })]);
  await q.alarm();
  advance(3 * 60_000);
  await q.addBeats([beat({ d: { attempt: 1 } })]);
  await q.alarm();
  const fresh = new QoeLive(storage, async () => {}, now);
  const r = await fresh.recent(60);
  assert.equal(r.minutes.length, 60);
  assert.equal(r.minutes[59].minute, minuteOf(now()));
  assert.equal(r.minutes[59].r2.attempts, 1);
  assert.equal(r.minutes[56].minute, '2026-11-12T10:00');
  assert.equal(r.minutes[56].r2.plays, 1);
  assert.equal(r.minutes[57].r2.attempts, 0);
});

test('minutes older than 48 hours are pruned', async () => {
  const { q, storage, advance } = setup();
  await q.addBeats([beat({ d: { attempt: 1 } })]);
  await q.alarm();
  assert.ok(storage.data.has('m:2026-11-12T10:00'));
  advance(RETENTION_MS + 2 * 3600_000);
  await q.addBeats([beat({ d: { attempt: 1 } })]);
  await q.alarm();
  assert.equal(storage.data.has('m:2026-11-12T10:00'), false);
});

test('a bad client cannot skew a minute much: values are bounded', async () => {
  const { q, events } = setup();
  await q.addBeats([beat({ d: { watchMs: 1e12, startupMs: 1e9, started: 1, rebuffers: -5 } })]);
  await q.alarm();
  assert.equal(events[0].r2.watchMs, 600_000);
  assert.equal(events[0].r2.startupMsSum, 120_000);
  assert.equal(events[0].r2.rebuffers, 0);
});

test('an object that never took beats leaves its alarm to others', async () => {
  const { q } = setup();
  assert.equal(await q.alarm(), false);
});

// ---- Through the Durable Object: beats in, admin:media event out ----

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

test('the qoe-live object sends its minute to admins on admin:media', async () => {
  const ns = new FakeNamespace<any>((ctx, env) => new WebSocketDurableObject(ctx as any, env));
  const env = { Issuer: ISSUER, ALLOWED_CLIENT_IDS: WEB_CLIENT, ENVIRONMENT: 'production', WEBSOCKET_DO: ns, SOCKET_SHARDS: 2, INTERNAL_API_KEY: 'k' };
  ns.env = env;
  const res = await app.fetch(new Request('https://realtime.test/ws', { headers: { Upgrade: 'websocket' } }), env as any);
  assert.equal(res.status, 101);
  let admin: FakeSocket | undefined;
  let shard = '';
  for (const [name, entry] of ns.objects) for (const { ws } of entry.ctx.accepted) { admin = ws; shard = name; }
  const dispatch = (msg: unknown) => ns.call(shard, (o: any) => o.webSocketMessage(admin, JSON.stringify(msg)));
  await dispatch({ type: 'authenticate', token: await signer.sign({ properties: { id: 'a1', email: 'a@example.com', roles: ['Admin'] } }) });
  await dispatch({ type: 'subscribe', channel: 'admin:media' });
  assert.equal(admin!.last().type, 'subscribed');

  const posted = await ns.call('qoe-live', (o: any) => o.fetch(new Request('http://internal/qoe/beats', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beats: [beat({ d: { attempt: 1, started: 1, startupMs: 900 } })] }),
  })));
  assert.equal((await posted.json()).accepted, 1);
  await ns.call('qoe-live', (o: any) => o.alarm());
  const update = admin!.sent.find((m) => m.type === 'admin.update') as any;
  assert.ok(update, 'admin got the update');
  assert.equal(update.data.topic, 'media');
  assert.equal(update.data.events[0].kind, 'qoe');
  assert.equal(update.data.events[0].r2.plays, 1);

  const recent = await ns.call('qoe-live', (o: any) => o.fetch(new Request('http://internal/qoe/recent?minutes=5')));
  const body = await recent.json();
  assert.equal(body.minutes.length, 5);
  assert.equal(body.minutes[4].r2.startupMsSum, 900);
});
