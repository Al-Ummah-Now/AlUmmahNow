/**
 * Topic router (SCALABILITY-AUDIT WS-2): a broadcast reaches only the shards
 * holding the channel, through the channel's directory object, and falls back
 * to every shard whenever the directories cannot be trusted.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { __setJwksForTests } from '../src/auth.ts';
import { WebSocketDurableObject } from '../src/websocket.ts';
import { SHARD_HEADER, socketShardName, topicName } from '../src/shards.ts';
import app from '../src/index.ts';
import { adminLiveItem } from '@al-ummah/shared-types';
import { ISSUER, WEB_CLIENT, makeSigner, type Signer } from './helpers.ts';
import { FakeNamespace, FakeSocket, installWorkerGlobals, restoreWorkerGlobals } from './fakes.ts';

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

const SHARDS = 4;
const shardNames = Array.from({ length: SHARDS }, (_, i) => socketShardName(i));

/** A shard on the code before the router: no readiness probe, no directory joins. */
class OldShard {
	inner: WebSocketDurableObject;
	constructor(ctx: any, env: any) { this.inner = new WebSocketDurableObject(ctx, env); }
	async fetch(request: Request): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path.startsWith('/topic/')) return new Response('Expected WebSocket upgrade', { status: 426 });
		const headers = new Headers(request.headers);
		headers.delete(SHARD_HEADER);
		return this.inner.fetch(new Request(request.url, { method: request.method, headers, body: request.method === 'POST' ? await request.text() : undefined }));
	}
	webSocketMessage(ws: WebSocket, m: string) { return (this.inner as any).webSocketMessage(ws, m); }
	webSocketClose(ws: WebSocket, c: number, r: string, w: boolean) { return this.inner.webSocketClose(ws, c, r, w); }
}

function setup({ oldShards = [] as string[] } = {}) {
	const ns = new FakeNamespace<any>((ctx, env) => {
		const name = [...ns.objects].find(([, e]) => e.ctx === ctx)?.[0] ?? '';
		return oldShards.includes(name) ? new OldShard(ctx, env) : new WebSocketDurableObject(ctx as any, env);
	});
	const env = { Issuer: ISSUER, ALLOWED_CLIENT_IDS: WEB_CLIENT, ENVIRONMENT: 'production', WEBSOCKET_DO: ns, SOCKET_SHARDS: SHARDS, INTERNAL_API_KEY: 'k' };
	ns.env = env;
	const shardOf = new Map<FakeSocket, string>();
	const dispatch = (ws: FakeSocket, msg: unknown) =>
		ns.call(shardOf.get(ws)!, (o: any) => o.webSocketMessage(ws, JSON.stringify(msg)));
	const connect = async (n: number, headers: Record<string, string> = {}) => {
		const before = new Set(shardOf.keys());
		const res = await Promise.all(Array.from({ length: n }, () =>
			app.fetch(new Request('https://realtime.test/ws', { headers: { Upgrade: 'websocket', ...headers } }), env as any)));
		assert.ok(res.every((r) => r.status === 101));
		for (const [name, entry] of ns.objects) for (const { ws } of entry.ctx.accepted) if (!shardOf.has(ws)) shardOf.set(ws, name);
		return [...shardOf.keys()].filter((ws) => !before.has(ws));
	};
	const signIn = (sockets: FakeSocket[], prefix = 'u') => Promise.all(sockets.map(async (ws, i) =>
		dispatch(ws, { type: 'authenticate', token: await tokenFor(`${prefix}${i}`) })));
	const post = async (body: unknown) => {
		const res = await app.fetch(new Request('https://realtime.test/broadcast', {
			method: 'POST', headers: { 'X-API-Key': 'k', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
		}), env as any);
		return { status: res.status, body: await res.json() as any };
	};
	const callsSince = (snapshot: Map<string, number>) =>
		new Map([...ns.calls].map(([k, v]) => [k, v - (snapshot.get(k) ?? 0)]).filter(([, v]) => (v as number) > 0) as Array<[string, number]>);
	const directory = (channel: string) => [...(ns.objects.get(topicName(channel))?.ctx.storage.data.keys() ?? [])].sort();
	return { ns, env, shardOf, dispatch, connect, signIn, post, callsSince, directory };
}

const note = (to: string) => ({ channel: `user:${to}`, message: { type: 'notification', data: { to } } });
const notesFor = (ws: FakeSocket) => ws.sent.filter((m) => m.type === 'notification').map((m) => (m.data as any).to);

test('a user notification reaches only the directory and the one shard holding the user', async () => {
	const t = setup();
	const sockets = await t.connect(40);
	await t.signIn(sockets);
	assert.equal((await t.post(note('nobody'))).status, 200); // first broadcast probes readiness

	const before = new Map(t.ns.calls);
	const r = await t.post(note('u5'));
	assert.deepEqual([r.status, r.body.delivered], [200, 1]);
	const home = t.shardOf.get(sockets[5])!;
	assert.deepEqual(Object.fromEntries(t.callsSince(before)), { [topicName('user:u5')]: 1, [home]: 1 });
	assert.deepEqual(notesFor(sockets[5]), ['u5']);
	const stats = await (await app.fetch(new Request('https://realtime.test/stats'), t.env as any)).json() as any;
	assert.equal(stats.routing, 'topic');
	assert.ok(sockets.every((ws, i) => i === 5 || notesFor(ws).length === 0));
});

test('a closed socket\'s shard is dropped from the directory on the next broadcast', async () => {
	const t = setup();
	const [ws] = await t.connect(1);
	await t.signIn([ws]);
	const home = t.shardOf.get(ws)!;
	assert.deepEqual(t.directory('user:u0'), [`s:${home}`]);

	await t.ns.call(home, (o: any) => o.webSocketClose(ws, 1000, 'bye', true));
	assert.equal((await t.post(note('u0'))).body.delivered, 0);
	assert.deepEqual(t.directory('user:u0'), []);

	const before = new Map(t.ns.calls);
	await t.post(note('u0'));
	assert.deepEqual(Object.fromEntries(t.callsSince(before)), { [topicName('user:u0')]: 1 }, 'no shard is woken any more');
});

test('during a rollout, a shard still on old code makes every broadcast go to every shard', async () => {
	const t = setup({ oldShards: [socketShardName(2)] });
	const sockets = await t.connect(60);
	await t.signIn(sockets);
	const onOld = sockets.findIndex((ws) => t.shardOf.get(ws) === socketShardName(2));
	assert.ok(onOld >= 0, 'some socket landed on the old shard');

	const r = await t.post(note(`u${onOld}`));
	assert.deepEqual([r.status, r.body.delivered], [200, 1]);
	assert.deepEqual(notesFor(sockets[onOld]), [`u${onOld}`]);
	assert.equal(t.ns.calls.get(topicName(`user:u${onOld}`)), undefined, 'no directory consulted');
	const stats = await (await app.fetch(new Request('https://realtime.test/stats'), t.env as any)).json() as any;
	assert.equal(stats.routing, 'all-shards');
});

test('an unreachable directory falls back to every shard, so nothing is lost', async () => {
	const t = setup();
	const sockets = await t.connect(20);
	await t.signIn(sockets);
	await t.post(note('warm-up'));
	t.ns.broken.add(topicName('user:u3'));
	const r = await t.post(note('u3'));
	assert.deepEqual([r.status, r.body.delivered], [200, 1]);
	assert.deepEqual(notesFor(sockets[3]), ['u3']);
});

test('a batch with more channels than shards goes once to every shard, skipping the directories', async () => {
	const t = setup();
	const sockets = await t.connect(30);
	await t.signIn(sockets);
	await t.post(note('warm-up'));
	const before = new Map(t.ns.calls);
	const r = await t.post({ items: sockets.map((_, i) => note(`u${i}`)) });
	assert.deepEqual([r.status, r.body.delivered], [200, 30]);
	assert.deepEqual(Object.fromEntries(t.callsSince(before)), Object.fromEntries(shardNames.map((n) => [n, 1])));
	sockets.forEach((ws, i) => assert.deepEqual(notesFor(ws), [`u${i}`]));
});

test('a failed join keeps the subscription; the shard stops vouching until it has joined again', async () => {
	const t = setup();
	const [ws] = await t.connect(1);
	const home = t.shardOf.get(ws)!;
	await t.post(note('warm-up')); // every shard vouches
	assert.equal(t.ns.objects.get(home)!.ctx.storage.data.get('topics-joined'), true);

	t.ns.broken.add(topicName('video:j'));
	await t.dispatch(ws, { type: 'subscribe', channel: 'video:j' });
	assert.equal(ws.last().type, 'subscribed');
	assert.equal(t.ns.objects.get(home)!.ctx.storage.data.get('topics-joined'), undefined);
	const probe = () => t.ns.get(t.ns.idFromName(home)).fetch(new Request('http://internal/topic/ready', { headers: { [SHARD_HEADER]: home } }));
	assert.equal((await (await probe()).json()).ready, false, 'the directory is still down');

	t.ns.broken.delete(topicName('video:j'));
	assert.equal((await (await probe()).json()).ready, true);
	assert.deepEqual(t.directory('video:j'), [`s:${home}`]);
});

test('a client cannot pick the shard name a socket joins directories under', async () => {
	const t = setup();
	const [ws] = await t.connect(1, { [SHARD_HEADER]: 'sockets:63' });
	await t.signIn([ws]);
	assert.deepEqual(t.directory('user:u0'), [`s:${t.shardOf.get(ws)}`]);
});

test('subscribe/unsubscribe churn racing broadcasts and hibernation: every confirmed subscriber gets the next message once', async () => {
	const t = setup();
	const sockets = await t.connect(48);
	await t.post(note('warm-up'));
	const channel = 'video:churn';
	const hibernate = () => { if (Math.random() < 0.3) t.ns.hibernate(shardNames[Math.floor(Math.random() * SHARDS)]); };
	for (let round = 0; round < 6; round++) {
		await Promise.all([
			...sockets.map((ws) => {
				hibernate();
				return t.dispatch(ws, { type: Math.random() < 0.5 ? 'subscribe' : 'unsubscribe', channel });
			}),
			...Array.from({ length: 4 }, (_, i) =>
				t.post({ channel, message: { type: 'message', channel, data: { round, i } } })),
		]);
	}
	const subscribed = sockets.filter((ws) =>
		[...ws.sent].reverse().find((m) => m.channel === channel && (m.type === 'subscribed' || m.type === 'unsubscribed'))?.type === 'subscribed');
	const r = await t.post({ channel, message: { type: 'message', channel, data: { final: true } } });
	assert.equal(r.body.delivered, subscribed.length);
	for (const ws of sockets) {
		const finals = ws.sent.filter((m) => m.type === 'message' && (m.data as any)?.final).length;
		assert.equal(finals, subscribed.includes(ws) ? 1 : 0);
	}
});

test('a directory keeps a shard that joined again while a broadcast found it empty', async () => {
	const { FakeCtx } = await import('./fakes.ts');
	const ctx = new FakeCtx();
	const env: any = { ...{ Issuer: ISSUER, ENVIRONMENT: 'production' } };
	const directory = new WebSocketDurableObject(ctx as any, env) as any;
	const join = () => directory.fetch(new Request('http://internal/topic/join', { method: 'POST', body: JSON.stringify({ shard: 'sockets:0' }) }));
	env.WEBSOCKET_DO = {
		idFromName: (name: string) => ({ name }),
		get: () => ({
			fetch: async () => {
				// The shard's last subscriber left, and a new one subscribes (and joins) before this answer lands
				await join();
				return Response.json({ delivered: 0, held: [] });
			},
		}),
	};
	await join();
	const route = await directory.fetch(new Request('http://internal/topic/route', {
		method: 'POST', body: JSON.stringify({ channel: 'video:x', items: [{ channel: 'video:x', message: { type: 'message' } }] }),
	}));
	assert.equal(route.status, 200);
	assert.deepEqual([...ctx.storage.data.keys()], ['s:sockets:0']);

	// Without a rejoin, the same answer drops the shard
	env.WEBSOCKET_DO.get = () => ({ fetch: async () => Response.json({ delivered: 0, held: [] }) });
	await directory.fetch(new Request('http://internal/topic/route', {
		method: 'POST', body: JSON.stringify({ channel: 'video:x', items: [{ channel: 'video:x', message: { type: 'message' } }] }),
	}));
	assert.deepEqual([...ctx.storage.data.keys()], []);
});

test('an admin update goes through its coalescer to admin sockets only; a burst waits for the next second', async () => {
	const t = setup();
	const [admin, user] = await t.connect(2);
	await t.dispatch(admin, { type: 'authenticate', token: await signer.sign({ properties: { id: 'a1', email: 'a1@example.com', roles: ['Admin'] } }) });
	await t.dispatch(user, { type: 'authenticate', token: await tokenFor('u1') });
	await t.dispatch(admin, { type: 'subscribe', channel: 'admin:jobs' });
	await t.dispatch(user, { type: 'subscribe', channel: 'admin:jobs' });
	assert.equal(user.last().code, 'FORBIDDEN');

	const update = (status: string) => ({ items: [adminLiveItem('jobs', [{ kind: 'job', key: 'job:1', status }])] });
	const first = await t.post(update('queued'));
	assert.deepEqual([first.status, first.body.coalesced], [200, 1]);
	const updates = () => admin.sent.filter((m) => m.type === 'admin.update');
	assert.equal(updates().length, 1);
	assert.deepEqual((updates()[0].data as any).events, [{ kind: 'job', key: 'job:1', status: 'queued' }]);

	await t.post(update('running'));
	assert.equal(updates().length, 1); // held until the coalescer's alarm
	assert.ok(t.ns.objects.has('coalesce:admin:jobs'));
	assert.equal(user.sent.filter((m) => m.type === 'admin.update').length, 0);

	// A batch mixing user and admin items: both kinds go out
	const mixed = await t.post({ items: [note('u1'), adminLiveItem('errors', [{ kind: 'counts', open: 2 }])] });
	assert.equal(mixed.status, 200);
	assert.deepEqual(notesFor(user), ['u1']);
});

test('a malformed admin update is refused', async () => {
	const t = setup();
	const r = await t.post({ channel: 'admin:jobs', message: { type: 'notification', data: {} } });
	assert.equal(r.status, 400);
});
