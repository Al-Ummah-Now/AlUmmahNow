/**
 * Sockets survive hibernation, and are spread over shards (SCALABILITY-AUDIT WS-1..6).
 *
 * The fake namespace runs each object's calls one at a time with random
 * delays, and can drop an object's instance at any point (hibernation): the
 * next call builds a new instance over the sockets the runtime kept.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { __setJwksForTests } from '../src/auth.ts';
import { WebSocketDurableObject } from '../src/websocket.ts';
import { socketShardName } from '../src/shards.ts';
import app from '../src/index.ts';
import { ISSUER, WEB_CLIENT, makeSigner, type Signer } from './helpers.ts';
import { FakeCtx, FakeNamespace, FakeSocket, installWorkerGlobals, restoreWorkerGlobals } from './fakes.ts';

let signer: Signer;
const tokenFor = (id: string) => signer.sign({ properties: { id, email: `${id}@example.com` } });

before(async () => {
	signer = await makeSigner();
	__setJwksForTests(ISSUER, signer.getKey);
	installWorkerGlobals();
});
after(() => {
	__setJwksForTests(ISSUER, undefined);
	restoreWorkerGlobals();
});

const baseEnv = { Issuer: ISSUER, ALLOWED_CLIENT_IDS: WEB_CLIENT, ENVIRONMENT: 'production' };
const send = (o: WebSocketDurableObject, ws: FakeSocket, msg: unknown) =>
	(o as any).webSocketMessage(ws, JSON.stringify(msg)) as Promise<void>;

test('after hibernation a fresh instance still knows every socket, user and channel', async () => {
	const ctx = new FakeCtx();
	let durable = new WebSocketDurableObject(ctx as any, baseEnv as any) as any;
	await durable.fetch(new Request('https://realtime.test/ws', { headers: { Upgrade: 'websocket' } }));
	const ws = ctx.accepted[0].ws;
	await send(durable, ws, { type: 'authenticate', token: await tokenFor('alice') });
	await send(durable, ws, { type: 'subscribe', channel: 'video:v1' });

	// The runtime evicts the instance; the socket stays open
	durable = new WebSocketDurableObject(ctx as any, baseEnv as any) as any;
	assert.equal(durable.subscriberCount('user:alice'), 1);
	assert.equal(durable.subscriberCount('video:v1'), 1);

	const before = ws.sent.length;
	await durable.fetch(new Request('http://internal/broadcast', {
		method: 'POST',
		body: JSON.stringify({ items: [
			{ channel: 'user:alice', message: { type: 'notification', data: { n: 1 } } },
			{ channel: 'video:v1', message: { type: 'view_count_updated', data: { viewCount: 3 } } },
		] }),
	}));
	assert.deepEqual(ws.sent.slice(before).map((m) => m.type), ['notification', 'view_count_updated']);

	// The socket can keep talking, still as alice
	await send(durable, ws, { type: 'unsubscribe', channel: 'video:v1' });
	assert.equal(ws.last().type, 'unsubscribed');
	durable = new WebSocketDurableObject(ctx as any, baseEnv as any) as any;
	assert.equal(durable.subscriberCount('video:v1'), 0);
	assert.equal(durable.sockets.get(ws).userId, 'alice');
});

test('the per-socket rate limit is kept across hibernation', async () => {
	const ctx = new FakeCtx();
	const env = { ...baseEnv, RATE_LIMIT_MESSAGES: 5 };
	let durable = new WebSocketDurableObject(ctx as any, env as any) as any;
	await durable.fetch(new Request('https://realtime.test/ws', { headers: { Upgrade: 'websocket' } }));
	const ws = ctx.accepted[0].ws;
	for (let i = 0; i < 5; i++) {
		durable = new WebSocketDurableObject(ctx as any, env as any) as any; // hibernate between messages
		await send(durable, ws, { type: 'ping', timestamp: i });
	}
	await send(durable, ws, { type: 'ping', timestamp: 6 });
	assert.equal(ws.last().code, 'RATE_LIMIT');
});

test('the rate limit binding is per user, so more sockets do not buy more messages', async () => {
	const counts = new Map<string, number>();
	const limiter = { limit: async ({ key }: { key: string }) => {
		counts.set(key, (counts.get(key) ?? 0) + 1);
		return { success: (counts.get(key) ?? 0) <= 2 };
	} };
	const ctx = new FakeCtx();
	const durable = new WebSocketDurableObject(ctx as any, { ...baseEnv, WS_MESSAGE_LIMITER: limiter } as any) as any;
	for (let i = 0; i < 2; i++) {
		await durable.fetch(new Request('https://realtime.test/ws', { headers: { Upgrade: 'websocket' } }));
	}
	const [a, b] = ctx.accepted.map((x) => x.ws);
	await send(durable, a, { type: 'authenticate', token: await tokenFor('bob') });
	await send(durable, b, { type: 'authenticate', token: await tokenFor('bob') });
	await send(durable, a, { type: 'ping', timestamp: 1 });
	await send(durable, b, { type: 'ping', timestamp: 1 });
	await send(durable, a, { type: 'ping', timestamp: 2 });
	assert.equal(a.last().code, 'RATE_LIMIT');
	assert.equal(counts.get('u:bob'), 3, 'both sockets draw from one per-user budget');
});

test('an errored socket is dropped from every index (same cleanup as close)', async () => {
	const ctx = new FakeCtx();
	const durable = new WebSocketDurableObject(ctx as any, baseEnv as any) as any;
	await durable.fetch(new Request('https://realtime.test/ws', { headers: { Upgrade: 'websocket' } }));
	const ws = ctx.accepted[0].ws;
	await send(durable, ws, { type: 'authenticate', token: await tokenFor('carol') });
	await send(durable, ws, { type: 'subscribe', channel: 'video:v9' });
	await durable.webSocketError(ws, new Error('boom'));
	assert.equal(durable.subscriberCount('user:carol'), 0);
	assert.equal(durable.subscriberCount('video:v9'), 0);
	const stats = await (await durable.fetch(new Request('http://internal/stats'))).json();
	assert.deepEqual([stats.connections, stats.sessions, stats.channels], [0, 0, 0]);
});

test('a broadcast to a big channel serialises the message once', async () => {
	const ctx = new FakeCtx();
	const durable = new WebSocketDurableObject(ctx as any, baseEnv as any) as any;
	for (let i = 0; i < 300; i++) {
		await durable.fetch(new Request('https://realtime.test/ws', { headers: { Upgrade: 'websocket' } }));
	}
	for (const { ws } of ctx.accepted) await send(durable, ws, { type: 'subscribe', channel: 'video:hot' });
	const message = { type: 'message', channel: 'video:hot', data: { big: 'x'.repeat(1000) } };
	const stringify = JSON.stringify;
	let calls = 0;
	JSON.stringify = ((...args: Parameters<typeof stringify>) => {
		if (args[0] === message) calls++;
		return stringify(...args);
	}) as typeof JSON.stringify;
	try {
		assert.equal(durable.deliver('video:hot', message), 300);
	} finally {
		JSON.stringify = stringify;
	}
	assert.equal(calls, 1);
});

test('400 sockets over shards, parallel broadcasts with random hibernation: every message arrives exactly once', async () => {
	const SHARDS = 4;
	const USERS = 400;
	const ns = new FakeNamespace((ctx, env) => new WebSocketDurableObject(ctx as any, env));
	const env = { ...baseEnv, WEBSOCKET_DO: ns, SOCKET_SHARDS: SHARDS, MAX_CONNECTIONS_PER_DO: 120, INTERNAL_API_KEY: 'k' };
	ns.env = env;
	const shardOf = new Map<FakeSocket, string>();
	const hibernateSomewhere = () => {
		if (Math.random() < 0.3) ns.hibernate(socketShardName(Math.floor(Math.random() * SHARDS)));
	};

	// Parallel connects through the Worker; a full shard (cap 120) hands over to the next
	const responses = await Promise.all(
		Array.from({ length: USERS }, () => app.fetch(new Request('https://realtime.test/ws', { headers: { Upgrade: 'websocket' } }), env as any)),
	);
	assert.ok(responses.every((r) => r.status === 101), 'every socket got a shard');
	for (const [name, entry] of ns.objects) {
		assert.ok(entry.ctx.accepted.length <= 120, `${name} over its cap`);
		for (const { ws } of entry.ctx.accepted) { shardOf.set(ws, name); }
	}
	assert.equal(shardOf.size, USERS);

	// Every socket signs in as its own user and follows one hot video, all in parallel
	const sockets = [...shardOf.keys()];
	const tokens = await Promise.all(sockets.map((_, i) => tokenFor(`u${i}`)));
	await Promise.all(sockets.map(async (ws, i) => {
		hibernateSomewhere();
		await ns.call(shardOf.get(ws)!, (o) => send(o, ws, { type: 'authenticate', token: tokens[i] }));
		hibernateSomewhere();
		await ns.call(shardOf.get(ws)!, (o) => send(o, ws, { type: 'subscribe', channel: 'video:hot' }));
	}));

	// One private notification per user plus one event on the hot video, in parallel
	const post = (body: unknown) => app.fetch(new Request('https://realtime.test/broadcast', {
		method: 'POST', headers: { 'X-API-Key': 'k', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
	}), env as any);
	const results = await Promise.all([
		...sockets.map((_, i) => { hibernateSomewhere(); return post({ channel: `user:u${i}`, message: { type: 'notification', data: { to: `u${i}` } } }); }),
		post({ items: [{ channel: 'video:hot', message: { type: 'message', channel: 'video:hot', data: { n: 1 } } }] }),
	]);
	assert.ok(results.every((r) => r.status === 200));

	sockets.forEach((ws, i) => {
		const notes = ws.sent.filter((m) => m.type === 'notification');
		assert.deepEqual(notes.map((m) => (m.data as any).to), [`u${i}`], `socket ${i} gets exactly its own notification`);
		assert.equal(ws.sent.filter((m) => m.type === 'message' && m.channel === 'video:hot').length, 1);
	});

	const stats = await (await app.fetch(new Request('https://realtime.test/stats'), env as any)).json() as any;
	assert.equal(stats.connections, USERS);
	assert.equal(stats.sessions, USERS);
	assert.equal(stats.channelDetails['video:hot'], USERS);
	assert.equal(stats.shards, SHARDS);

	const presence = await (await app.fetch(new Request('https://realtime.test/presence/u7', { headers: { 'X-API-Key': 'k' } }), env as any)).json() as any;
	assert.deepEqual(presence, { userId: 'u7', online: true, sessions: 1 });
	const unauth = await app.fetch(new Request('https://realtime.test/presence/u7'), env as any);
	assert.equal(unauth.status, 401);
});

test('errors go to the admin Errors page: a 5xx carries an ERR- reference and no internals', async () => {
  // Every binding read throws (except the reporter's own vars): the route crashes
  const reporterKeys = new Set(['ERRORS_INGEST_URL', 'INTERNAL_API_KEY', 'ENVIRONMENT', 'CF_VERSION_METADATA']);
  const brokenEnv = new Proxy({}, { get: (_t, k) => { if (typeof k === 'string' && reporterKeys.has(k)) return undefined; throw new TypeError('Cannot read properties of undefined (secret internals)'); } });
  const res = await app.request('/stats', {}, brokenEnv as never);
    assert.equal(res.status, 500);
    const body = await res.json();
    const text = JSON.stringify(body);
    // Reported either by onError (crash: reference in the body) or by the 5xx middleware (header)
    const ref = res.headers.get('X-Error-Ref');
    assert.match(ref ?? '', /^ERR-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    if (body.reference) assert.equal(body.reference, ref);
    assert.doesNotMatch(text, /secret internals|TypeError/);
});
