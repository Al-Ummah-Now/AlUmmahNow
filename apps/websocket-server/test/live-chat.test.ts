/** Live chat channels (wiki E17 §5.3): server-fed, joined only as far as the stream is open, closed with it. */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { forgetFeatureSwitches } from '@al-ummah/shared-types';
import { __setJwksForTests } from '../src/auth.ts';
import { WebSocketDurableObject } from '../src/websocket.ts';
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
beforeEach(() => forgetFeatureSwitches());

type Row = Record<string, unknown>;
const open: Row = { owner_id: 'owner', channel_id: 'ch1', visibility: 'public', status: 'live', made_for_kids: 0, recording_withheld: 0, allow_chat: 1, chat_replay: 1 };

function db(streams: Record<string, Row>, access: Record<string, string> = {}, chatOn = true) {
  const state = { streams, broken: false, banned: new Set<string>(), afterRead: null as null | (() => void) };
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const s = {
      bind: (...v: unknown[]) => ((args = v), s),
      first: async () => {
        if (state.broken) throw new Error('D1 down');
        if (sql.includes('live_stream_metadata')) {
          const row = state.streams[String(args[0])] ?? null;
          const after = state.afterRead;
          state.afterRead = null;
          after?.();
          return row;
        }
        if (sql.includes('videos_bans')) return state.banned.has(String(args[0])) ? { x: 1 } : null;
        if (sql.includes('channel_access')) return access[`${args[0]}:${args[1]}`] ? { role: access[`${args[0]}:${args[1]}`] } : null;
        return null;
      },
      all: async () => ({ results: sql.includes('feature_switches') ? [{ key: 'liveChat', enabled: chatOn ? 1 : 0, version: 1, updated_at: 'x', updated_by: 'x' }] : [] }),
      run: async () => ({}),
    };
    return s;
  };
  return Object.assign(state, { prepare });
}

async function socket(SEARCH_DB: unknown, userId?: string, exp?: number) {
  const ctx = new FakeCtx();
  const durable = new WebSocketDurableObject(ctx as any, { Issuer: ISSUER, ALLOWED_CLIENT_IDS: WEB_CLIENT, ENVIRONMENT: 'production', SEARCH_DB } as any) as any;
  const connect = async (user?: string) => {
    await durable.fetch(new Request('https://realtime.test/ws', { headers: { Upgrade: 'websocket' } }));
    const ws = [...durable.sockets.keys()].at(-1) as FakeSocket;
    const send = async (message: Row) => {
      await durable.webSocketMessage(ws, JSON.stringify(message));
      return ws.last();
    };
    if (user) await send({ type: 'authenticate', token: await signer.sign({ properties: { id: user } }, exp ? { exp } : {}) });
    return { ws, send };
  };
  return { durable, connect, ...(await connect(userId)) };
}

const join = (s: { send: (m: Row) => Promise<any> }, id: string) => s.send({ type: 'subscribe', channel: `live:${id}` });

test('anyone may join a public stream with chat, signed in or not', async () => {
  const d = db({ s1: open });
  assert.equal((await join(await socket(d), 's1')).type, 'subscribed');
  assert.equal((await join(await socket(d, 'ali'), 's1')).type, 'subscribed');
});

test('a stream that is not open is refused, and so is one that is not known or cannot be read', async () => {
  const d = db({
    private: { ...open, visibility: 'private' }, hidden: { ...open, visibility: 'hidden' }, deleted: { ...open, visibility: 'deleted' }, odd: { ...open, visibility: 'x' },
    cancelled: { ...open, status: 'cancelled' }, kids: { ...open, made_for_kids: 1 }, off: { ...open, allow_chat: 0 }, noReplay: { ...open, status: 'ended', chat_replay: 0 },
  });
  for (const user of [undefined, 'ali']) {
    const s = await socket(d, user);
    for (const id of ['private', 'hidden', 'deleted', 'odd', 'cancelled', 'kids', 'off', 'noReplay', 'unknown', '']) assert.notEqual((await join(s, id)).type, 'subscribed', `${user} ${id}`);
  }
  d.broken = true;
  assert.equal((await join(await socket(d, 'owner'), 'private')).code, 'FORBIDDEN');
});

test('a private stream is its team’s; kids content and chat turned off are nobody’s', async () => {
  const d = db({ private: { ...open, visibility: 'private' }, kids: { ...open, made_for_kids: 1 }, off: { ...open, allow_chat: 0 } }, { 'ch1:mod': 'moderator', 'ch1:editor': 'editor' });
  for (const [user, type] of [['owner', 'subscribed'], ['mod', 'subscribed'], ['editor', 'error'], ['ali', 'error']] as const) assert.equal((await join(await socket(d, user), 'private')).type, type, user);
  for (const id of ['kids', 'off']) assert.equal((await join(await socket(d, 'owner'), id)).code, 'FORBIDDEN', id);
});

test('a withheld recording is the team’s; a banned member is refused what is not public', async () => {
  const d = db({ held: { ...open, status: 'ended', recording_withheld: 1 }, private: { ...open, visibility: 'private' }, s1: open }, { 'ch1:mod': 'moderator' });
  assert.equal((await join(await socket(d, 'ali'), 'held')).code, 'FORBIDDEN');
  assert.equal((await join(await socket(d, 'mod'), 'held')).type, 'subscribed');
  d.banned.add('mod').add('owner');
  for (const user of ['mod', 'owner']) {
    assert.equal((await join(await socket(d, user), 'private')).code, 'FORBIDDEN', user);
    assert.equal((await join(await socket(d, user), 's1')).type, 'subscribed', user);
  }
});

test('a ban or a lost role: every socket of the person leaves the live chats, on this shard', async () => {
  const access: Record<string, string> = { 'ch1:mod': 'moderator' };
  const d = db({ private: { ...open, visibility: 'private' }, s1: open }, access);
  const s = await socket(d, 'mod');
  const second = await s.connect('mod');
  const other = await s.connect('owner');
  await join(s, 'private');
  await join(second, 's1');
  await join(other, 'private');
  delete access['ch1:mod'];
  s.durable.deliver('user:mod', { type: 'access_changed', channel: 'user:mod', data: {} });
  assert.equal(s.durable.deliver('live:private', { type: 'live_chat_message' }), 1, 'the owner stays');
  assert.equal(s.durable.subscriberCount('live:s1'), 0);
  assert.equal((await join(s, 'private')).code, 'FORBIDDEN');
  assert.equal((await join(second, 's1')).type, 'subscribed', 'a public chat can be joined again');
  // Ordinary notifications change nothing
  s.durable.deliver('user:mod', { type: 'notification', channel: 'user:mod', data: {} });
  assert.equal(s.durable.subscriberCount('live:s1'), 1);
});

test('a close that comes while the stream is being read is not missed', async () => {
  const d = db({ s1: open });
  const s = await socket(d);
  d.afterRead = () => {
    // The record was written, and its close sent, before this socket was on the channel
    d.streams.s1 = { ...open, visibility: 'private' };
    s.durable.deliver('live:s1', { type: 'live_chat_closed', channel: 'live:s1', data: {} });
  };
  assert.equal((await join(s, 's1')).code, 'FORBIDDEN');
  assert.equal(s.durable.subscriberCount('live:s1'), 0);
});

test('is refused while the switch is off', async () => {
  const answer = await join(await socket(db({ s1: open }, {}, false), 'ali'), 's1');
  assert.deepEqual([answer.code, answer.feature], ['feature_off', 'liveChat']);
});

test('nobody publishes into it from a socket, the owner included', async () => {
  const s = await socket(db({ s1: open }), 'owner');
  await join(s, 's1');
  assert.equal((await s.send({ type: 'message', channel: 'live:s1', data: { text: 'x' } })).code, 'FORBIDDEN');
});

test('live_chat_closed is delivered, then everyone is off the channel; who still may joins again', async () => {
  const d = db({ s1: open });
  const s = await socket(d, 'owner');
  const viewer = await s.connect();
  await join(s, 's1');
  await join(viewer, 's1');
  assert.equal(s.durable.deliver('live:s1', { type: 'live_chat_message', channel: 'live:s1', data: {} }), 2);
  d.streams.s1 = { ...open, visibility: 'private' };
  assert.equal(s.durable.deliver('live:s1', { type: 'live_chat_closed', channel: 'live:s1', data: {} }), 2);
  assert.equal(viewer.ws.last().type, 'live_chat_closed');
  assert.equal(s.durable.subscriberCount('live:s1'), 0);
  assert.equal(s.durable.deliver('live:s1', { type: 'live_chat_message', channel: 'live:s1', data: {} }), 0);
  assert.equal((await join(viewer, 's1')).code, 'FORBIDDEN');
  assert.equal((await join(s, 's1')).type, 'subscribed');
});

test('a socket whose sign-in has expired leaves the chat; signed-out viewers of a public one stay', async () => {
  const d = db({ private: { ...open, visibility: 'private' }, s1: open });
  const s = await socket(d, 'owner');
  const viewer = await s.connect();
  await join(s, 'private');
  await join(viewer, 's1');
  s.durable.sockets.get(s.ws).authExpiresAt = 1;
  assert.equal(s.durable.deliver('live:private', { type: 'live_chat_message' }), 0);
  assert.equal(s.durable.subscriberCount('live:private'), 0);
  assert.equal(s.durable.deliver('live:s1', { type: 'live_chat_message' }), 1);
});
