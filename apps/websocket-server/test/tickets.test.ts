/**
 * #230: short-lived (~60 s), single-use, user-bound WebSocket tickets.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.ts';
import { __setJwksForTests } from '../src/auth.ts';
import { clearRevocationCache } from '../src/token-revocation.ts';
import { TicketStore, WS_TICKET_DO_NAME, WS_TICKET_PREFIX, WS_TICKET_TTL_SECONDS, isWebSocketTicket } from '../src/tickets.ts';
import { WebSocketDurableObject } from '../src/websocket.ts';
import { ISSUER, WEB_CLIENT, makeSigner } from './helpers.ts';

const nowS = () => Math.floor(Date.now() / 1000);

describe('TicketStore', () => {
  it('mints an opaque wst_ ticket bound to user & roles, valid for 60 s and strictly single-use', () => {
    const store = new TicketStore();
    const now = 1_800_000_000_000;
    const nowSec = Math.floor(now / 1000);
    const minted = store.mint({ sub: 'usr_1', email: 'u@example.com', roles: ['Super Admin'], authExpiresAt: nowSec + 900, sid: 'sid_1', authTime: nowSec - 10 }, now);
    assert.ok(minted);
    assert.ok(isWebSocketTicket(minted.ticket));
    assert.ok(minted.ticket.startsWith(WS_TICKET_PREFIX));
    // Opaque: never embeds user id, email or JWT dots
    assert.equal(minted.ticket.includes('.'), false);
    assert.equal(minted.ticket.includes('usr_1'), false);
    assert.equal(minted.expiresAt, nowSec + WS_TICKET_TTL_SECONDS);
    assert.equal(minted.authExpiresAt, nowSec + 900);

    // First redeem succeeds
    const claims = store.redeem(minted.ticket, now + 5_000);
    assert.deepEqual(claims, {
      sub: 'usr_1',
      email: 'u@example.com',
      roles: ['Super Admin'],
      authExpiresAt: nowSec + 900,
      sid: 'sid_1',
      authTime: nowSec - 10,
    });

    // Second redeem fails (single-use)
    assert.equal(store.redeem(minted.ticket, now + 6_000), null);
  });

  it('rejects an expired ticket (> 60 s) and caps ticket expiry at the access token exp', () => {
    const store = new TicketStore();
    const now = 1_800_000_000_000;
    const nowSec = Math.floor(now / 1000);

    const normal = store.mint({ sub: 'usr_1', authExpiresAt: nowSec + 900 }, now)!;
    assert.equal(store.redeem(normal.ticket, now + WS_TICKET_TTL_SECONDS * 1000), null);

    const shortLived = store.mint({ sub: 'usr_1', authExpiresAt: nowSec + 20 }, now)!;
    assert.equal(shortLived.expiresAt, nowSec + 20);
    assert.equal(store.redeem(shortLived.ticket, now + 20_000), null);

    // Already expired access token cannot mint a ticket
    assert.equal(store.mint({ sub: 'usr_1', authExpiresAt: nowSec - 1 }, now), null);
  });
});

describe('POST /internal/ws-ticket and WebSocket ticket auth', () => {
  let signer: Awaited<ReturnType<typeof makeSigner>>;

  beforeEach(async () => {
    clearRevocationCache();
    signer = await makeSigner();
    __setJwksForTests(ISSUER, signer.getKey);
  });

  function makeEnv(extra: Record<string, unknown> = {}) {
    const ticketDo = new WebSocketDurableObject({ storage: new Map(), getWebSockets: () => [] } as never, {} as never);
    const WEBSOCKET_DO = {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        fetch: (req: Request) => {
          if (id === WS_TICKET_DO_NAME) return ticketDo.fetch(req);
          throw new Error(`unexpected DO id ${id}`);
        },
      }),
    };
    return {
      env: {
        Issuer: ISSUER,
        ALLOWED_CLIENT_IDS: WEB_CLIENT,
        ENVIRONMENT: 'production',
        INTERNAL_API_KEY: 'internal-secret-key',
        WEBSOCKET_DO,
        ...extra,
      },
      ticketDo,
    };
  }

  it('requires INTERNAL_API_KEY and a valid Bearer token, then mints a single-use ticket that authenticates a socket once', async () => {
    const { env } = makeEnv();
    const accessToken = await signer.sign({ sid: 'sid_live', auth_time: nowS() - 30 });

    // Missing or wrong API key -> 401
    const noKey = await app.request('/internal/ws-ticket', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }, env as never);
    assert.equal(noKey.status, 401);
    const badKey = await app.request('/internal/ws-ticket', { method: 'POST', headers: { 'X-API-Key': 'wrong', Authorization: `Bearer ${accessToken}` } }, env as never);
    assert.equal(badKey.status, 401);

    // Missing or bad bearer token -> 401
    const noAuth = await app.request('/internal/ws-ticket', { method: 'POST', headers: { 'X-API-Key': 'internal-secret-key' } }, env as never);
    assert.equal(noAuth.status, 401);

    // Valid request -> opaque wst_ ticket with Cache-Control: no-store
    const ok = await app.request(
      '/internal/ws-ticket',
      { method: 'POST', headers: { 'X-API-Key': 'internal-secret-key', Authorization: `Bearer ${accessToken}` } },
      env as never,
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const body = (await ok.json()) as { ticket: string; expiresAt: number; authExpiresAt: number };
    assert.ok(body.ticket.startsWith(WS_TICKET_PREFIX));
    assert.notEqual(body.ticket, accessToken);
    assert.ok(body.expiresAt <= nowS() + WS_TICKET_TTL_SECONDS + 1);

    // First WebSocket authenticates with the ticket
    const sockets = new Set<any>();
    const shard = new WebSocketDurableObject(
      {
        acceptWebSocket: (ws: any) => sockets.add(ws),
        getWebSockets: () => [...sockets],
        storage: { get: async () => undefined, put: async () => {}, delete: async () => {}, list: async () => new Map() },
      } as never,
      env as never,
    );
    const makeSocket = () => {
      const sent: any[] = [];
      let attachment: unknown = null;
      return {
        sent,
        send: (raw: string) => sent.push(JSON.parse(raw)),
        close: () => {},
        serializeAttachment: (v: unknown) => { attachment = structuredClone(v); },
        deserializeAttachment: () => attachment,
      };
    };
    const ws1 = makeSocket();
    (shard as any).sockets.set(ws1, { sessionId: 's1', authenticated: false, connectedAt: Date.now(), channels: [], rl: { count: 0, resetAt: 0 } });
    await shard.webSocketMessage(ws1 as never, JSON.stringify({ type: 'authenticate', token: body.ticket }));
    assert.ok(ws1.sent.some((m) => m.type === 'authenticated' && m.userId === 'user-123'));

    // Replaying the same ticket on a second socket fails with AUTH_FAILED
    const ws2 = makeSocket();
    (shard as any).sockets.set(ws2, { sessionId: 's2', authenticated: false, connectedAt: Date.now(), channels: [], rl: { count: 0, resetAt: 0 } });
    await shard.webSocketMessage(ws2 as never, JSON.stringify({ type: 'authenticate', token: body.ticket }));
    assert.ok(ws2.sent.some((m) => m.type === 'error' && m.code === 'AUTH_FAILED'));
  });

  it('rejects a minted ticket if the sign-in is revoked before redemption', async () => {
    const entries: Record<string, unknown> = {};
    const TOKEN_REVOCATIONS = { get: async (k: string) => entries[k] ?? null } as unknown as KVNamespace;
    const { env } = makeEnv({ TOKEN_REVOCATIONS });
    const accessToken = await signer.sign({ sid: 'sid_revoked_midflight', auth_time: nowS() - 30 });

    const ok = await app.request(
      '/internal/ws-ticket',
      { method: 'POST', headers: { 'X-API-Key': 'internal-secret-key', Authorization: `Bearer ${accessToken}` } },
      env as never,
    );
    assert.equal(ok.status, 200);
    const { ticket } = (await ok.json()) as { ticket: string };

    // User signs out before the browser redeems the ticket
    clearRevocationCache();
    entries['s:sid_revoked_midflight'] = { v: 1, before: nowS() + 1 };

    const shard = new WebSocketDurableObject(
      { acceptWebSocket: () => {}, getWebSockets: () => [], storage: { get: async () => undefined, put: async () => {}, delete: async () => {}, list: async () => new Map() } } as never,
      env as never,
    );
    const sent: any[] = [];
    const ws = { send: (raw: string) => sent.push(JSON.parse(raw)), close: () => {}, serializeAttachment: () => {}, deserializeAttachment: () => null };
    (shard as any).sockets.set(ws, { sessionId: 's3', authenticated: false, connectedAt: Date.now(), channels: [], rl: { count: 0, resetAt: 0 } });
    await shard.webSocketMessage(ws as never, JSON.stringify({ type: 'authenticate', token: ticket }));
    assert.ok(sent.some((m) => m.type === 'error' && m.code === 'AUTH_FAILED'));
  });
});
