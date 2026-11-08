/**
 * Durable Object behaviour: identity comes only from a verified token.
 * Runs with `cloudflare:workers` stubbed (see register-cf-stub.mjs).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { __setJwksForTests } from '../src/auth.ts';
import { WebSocketDurableObject } from '../src/websocket.ts';
import { ISSUER, WEB_CLIENT, makeSigner, unsignedToken, type Signer } from './helpers.ts';

class FakeSocket {
  sent: Array<Record<string, unknown>> = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() {}
  last() { return this.sent[this.sent.length - 1]; }
}

const RealResponse = globalThis.Response;
let signer: Signer;

before(async () => {
  signer = await makeSigner();
  __setJwksForTests(ISSUER, signer.getKey);
  // Workers allow `new Response(null, { status: 101, webSocket })`; Node does not.
  (globalThis as any).Response = class {
    status: number; webSocket: unknown; body: unknown;
    constructor(body: unknown, init: { status?: number; webSocket?: unknown } = {}) {
      this.body = body; this.status = init.status ?? 200; this.webSocket = init.webSocket;
    }
  };
  (globalThis as any).WebSocketPair = class {
    0 = new FakeSocket(); 1 = new FakeSocket();
  };
});

after(() => {
  __setJwksForTests(ISSUER, undefined);
  (globalThis as any).Response = RealResponse;
});

function makeDO() {
  const kv = new Map<string, string>();
  const env = {
    Issuer: ISSUER,
    ALLOWED_CLIENT_IDS: WEB_CLIENT,
    ENVIRONMENT: 'production',
    PRESENCE_KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v); },
      delete: async (k: string) => { kv.delete(k); },
    },
  };
  const ctx = { acceptWebSocket() {} };
  const durable = new WebSocketDurableObject(ctx as any, env as any) as any;
  return { durable, kv };
}

async function connect(durable: any, query: string): Promise<FakeSocket> {
  await durable.fetch(new Request(`https://realtime.test/ws${query}`, { headers: { Upgrade: 'websocket' } }));
  // The server side of the pair is the one registered in connections.
  return [...durable.connections.keys()].at(-1) as FakeSocket;
}

test('query userId without a token does not authenticate or grant access', async () => {
  const { durable } = makeDO();
  const ws = await connect(durable, '?userId=victim');
  const conn = durable.connections.get(ws);
  assert.equal(conn.userId, undefined);
  assert.equal(conn.authenticated, false);

  await durable.webSocketMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'user:victim' }));
  assert.equal(ws.last().code, 'AUTH_REQUIRED');
  assert.equal(durable.channelManager.getChannelSubscribers('user:victim').size, 0);
});

test('query userId is ignored even with a valid token; identity comes from the token', async () => {
  const { durable } = makeDO();
  const ws = await connect(durable, '?userId=victim');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign() }));
  const conn = durable.connections.get(ws);
  assert.equal(conn.authenticated, true);
  assert.equal(conn.userId, 'user-123');
  assert.equal(ws.sent.find((m) => m.type === 'authenticated')?.userId, 'user-123');
  assert.ok(durable.channelManager.getChannelSubscribers('user:user-123').size === 1);
  assert.equal(durable.channelManager.getChannelSubscribers('user:victim').size, 0);
});

test('unsigned token in production is rejected over the socket', async () => {
  const { durable } = makeDO();
  const ws = await connect(durable, '');
  const token = unsignedToken({ mode: 'access', type: 'user', properties: { id: 'victim' }, iss: ISSUER, aud: WEB_CLIENT, exp: 9999999999 });
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token }));
  assert.equal(ws.last().code, 'AUTH_FAILED');
  assert.equal(durable.connections.get(ws).authenticated, false);
});

test('deprecated ?token= with a forged token is rejected', async () => {
  const { durable } = makeDO();
  const forger = await makeSigner();
  const ws = await connect(durable, `?token=${await forger.sign()}&userId=user-123`);
  assert.equal(durable.connections.get(ws).authenticated, false);
  assert.equal(ws.last().code, 'AUTH_FAILED');
});

test("an authenticated user cannot join another user's channel or post into it", async () => {
  const { durable } = makeDO();
  const ws = await connect(durable, '');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign() }));
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'user:victim' }));
  assert.equal(ws.last().code, 'FORBIDDEN');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'message', channel: 'user:victim', data: { fake: true } }));
  assert.equal(ws.last().code, 'FORBIDDEN');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'video:v1' }));
  assert.equal(ws.last().type, 'subscribed');
});

test('a connection cannot switch to another user by re-authenticating', async () => {
  const { durable } = makeDO();
  const ws = await connect(durable, '');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign() }));
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign({ properties: { id: 'other', email: 'o@example.com' } }) }));
  assert.equal(ws.last().code, 'AUTH_FAILED');
  assert.equal(durable.connections.get(ws).userId, 'user-123');
});

test('internal /broadcast still reaches subscribers', async () => {
  const { durable } = makeDO();
  const ws = await connect(durable, '');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign() }));
  const res = await durable.fetch(new Request('http://internal/broadcast', {
    method: 'POST',
    body: JSON.stringify({ channel: 'user:user-123', message: { type: 'notification', data: { hi: 1 } } }),
  }));
  assert.equal(res.status, 200);
  assert.equal(ws.last().type, 'notification');
});
