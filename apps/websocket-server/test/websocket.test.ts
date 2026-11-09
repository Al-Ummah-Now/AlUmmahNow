/**
 * Durable Object behaviour: identity comes only from a verified token.
 * Runs with `cloudflare:workers` stubbed (see register-cf-stub.mjs).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { __setJwksForTests } from '../src/auth.ts';
import { clearRevocationCache } from '../src/token-revocation.ts';
import { WebSocketDurableObject } from '../src/websocket.ts';
import { ISSUER, WEB_CLIENT, makeSigner, unsignedToken, type Signer } from './helpers.ts';
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

function makeDO(extraEnv: Record<string, unknown> = {}) {
  const env = {
    Issuer: ISSUER,
    ALLOWED_CLIENT_IDS: WEB_CLIENT,
    ENVIRONMENT: 'production',
    ...extraEnv,
  };
  const ctx = new FakeCtx();
  const durable = new WebSocketDurableObject(ctx as any, env as any) as any;
  return { durable, ctx, env };
}

async function connect(durable: any, query: string): Promise<FakeSocket> {
  await durable.fetch(new Request(`https://realtime.test/ws${query}`, { headers: { Upgrade: 'websocket' } }));
  // The server side of the pair is the one registered in sockets.
  return [...durable.sockets.keys()].at(-1) as FakeSocket;
}

test('query userId without a token does not authenticate or grant access', async () => {
  const { durable } = makeDO();
  const ws = await connect(durable, '?userId=victim');
  const conn = durable.sockets.get(ws);
  assert.equal(conn.userId, undefined);
  assert.equal(conn.authenticated, false);

  await durable.webSocketMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'user:victim' }));
  assert.equal(ws.last().code, 'AUTH_REQUIRED');
  assert.equal(durable.subscriberCount('user:victim'), 0);
});

test('a signed-out socket can follow a video feed but nothing else', async () => {
  const { durable } = makeDO();
  const ws = await connect(durable, '');

  await durable.webSocketMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'video:v1' }));
  assert.equal(ws.last().type, 'subscribed');
  assert.equal(durable.subscriberCount('video:v1'), 1);

  for (const channel of ['notifications', 'live-streams', 'user:u1', 'channel:c1']) {
    await durable.webSocketMessage(ws, JSON.stringify({ type: 'subscribe', channel }));
    assert.equal(ws.last().code, 'AUTH_REQUIRED');
  }
});

test('query userId is ignored even with a valid token; identity comes from the token', async () => {
  const { durable } = makeDO();
  const ws = await connect(durable, '?userId=victim');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign() }));
  const conn = durable.sockets.get(ws);
  assert.equal(conn.authenticated, true);
  assert.equal(conn.userId, 'user-123');
  assert.equal(ws.sent.find((m) => m.type === 'authenticated')?.userId, 'user-123');
  assert.ok(durable.subscriberCount('user:user-123') === 1);
  assert.equal(durable.subscriberCount('user:victim'), 0);
});

test('unsigned token in production is rejected over the socket', async () => {
  const { durable } = makeDO();
  const ws = await connect(durable, '');
  const token = unsignedToken({ mode: 'access', type: 'user', properties: { id: 'victim' }, iss: ISSUER, aud: WEB_CLIENT, exp: 9999999999 });
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token }));
  assert.equal(ws.last().code, 'AUTH_FAILED');
  assert.equal(durable.sockets.get(ws).authenticated, false);
});

test('deprecated ?token= with a forged token is rejected', async () => {
  const { durable } = makeDO();
  const forger = await makeSigner();
  const ws = await connect(durable, `?token=${await forger.sign()}&userId=user-123`);
  assert.equal(durable.sockets.get(ws).authenticated, false);
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
  assert.equal(durable.sockets.get(ws).userId, 'user-123');
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

// #437: revoked sign-ins and expired tokens

const nowS = () => Math.floor(Date.now() / 1000);
const revocations = (entries: Record<string, unknown>) => ({ get: async (k: string) => entries[k] ?? null });

test('a token of a revoked sign-in cannot authenticate the socket', async () => {
  clearRevocationCache();
  const { durable } = makeDO({ TOKEN_REVOCATIONS: revocations({ 'u:user-123': { v: 1, before: nowS() + 5 } }) });
  const ws = await connect(durable, '');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign({ auth_time: nowS() - 60 }) }));
  assert.equal(ws.last().code, 'AUTH_FAILED');
  assert.equal(durable.sockets.get(ws).authenticated, false);
  clearRevocationCache();
});

test('once its token expires a socket drops private channels, keeps public ones, and re-authenticates in place', async () => {
  clearRevocationCache();
  const { durable } = makeDO();
  const ws = await connect(durable, '');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign() }));
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'video:v1' }));
  const conn = durable.sockets.get(ws);
  assert.equal(conn.authExpiresAt > nowS(), true);
  assert.equal(durable.subscriberCount('user:user-123'), 1);

  conn.authExpiresAt = nowS() - 1; // the token has expired
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'video:v2' }));
  assert.ok(ws.sent.some((m) => m.code === 'AUTH_EXPIRED'));
  assert.equal(conn.authenticated, false);
  assert.equal(durable.subscriberCount('user:user-123'), 0);
  assert.equal(durable.subscriberCount('video:v1'), 1);

  // Fresh token: back in, same session, public channels intact
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign() }));
  assert.equal(conn.authenticated, true);
  assert.equal(durable.subscriberCount('user:user-123'), 1);
  assert.equal(durable.subscriberCount('video:v1'), 1);
});

test('a silent socket with an expired token gets no private broadcasts', async () => {
  clearRevocationCache();
  const { durable } = makeDO();
  const ws = await connect(durable, '');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign() }));
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'subscribe', channel: 'video:v1' }));
  const conn = durable.sockets.get(ws);
  await durable.broadcast('user:user-123', { type: 'message', channel: 'user:user-123', data: { n: 1 } });
  assert.equal(ws.sent.filter((m) => m.type === 'message' && m.channel === 'user:user-123').length, 1);

  conn.authExpiresAt = nowS() - 1;
  await durable.broadcast('user:user-123', { type: 'message', channel: 'user:user-123', data: { n: 2 } });
  assert.equal(ws.sent.filter((m) => m.type === 'message' && m.channel === 'user:user-123').length, 1, 'no private message after expiry');
  assert.ok(ws.sent.some((m) => m.code === 'AUTH_EXPIRED'));
  assert.equal(conn.authenticated, false);
  // Public channels still flow
  await durable.broadcast('video:v1', { type: 'message', channel: 'video:v1', data: { n: 3 } });
  assert.equal(ws.sent.filter((m) => m.type === 'message' && m.channel === 'video:v1').length, 1);
});

test('a failed re-auth after expiry leaves the socket signed out', async () => {
  clearRevocationCache();
  const { durable } = makeDO();
  const ws = await connect(durable, '');
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await signer.sign() }));
  const conn = durable.sockets.get(ws);
  conn.authExpiresAt = nowS() - 1;
  const forger = await makeSigner();
  await durable.webSocketMessage(ws, JSON.stringify({ type: 'authenticate', token: await forger.sign() }));
  assert.equal(conn.authenticated, false);
  assert.equal(durable.subscriberCount('user:user-123'), 0);
});
