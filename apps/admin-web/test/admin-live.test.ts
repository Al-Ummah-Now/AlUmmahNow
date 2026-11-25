/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles read arbitrary frames */
/**
 * The admin's live socket (docs/admin/LIVE_OPS.md §B.5): authenticate, subscribe
 * one topic at a time, deliver updates, back off and reconnect, re-authenticate
 * on AUTH_EXPIRED, treat a refused topic as not live (the page keeps polling).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AdminLiveClient,
  BACKOFF_MAX_MS,
  HIDDEN_CLOSE_MS,
  IDLE_CLOSE_MS,
  REAUTH_MAX_WAIT_MS,
  backoffMs,
  socketUrlOf,
  type ClientDeps,
  type RealtimeTicket,
  type SocketLike,
} from '../src/lib/live/admin-live-client';
import { realtimeUrlFor, tokenExpiry } from '../src/lib/live/realtime-ticket';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: any[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public url: string) {}
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({}); }
  receive(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  drop() { this.readyState = 3; this.onclose?.({}); }
  last() { return this.sent[this.sent.length - 1]; }
}

function harness(tickets: Array<RealtimeTicket | null> = []) {
  let clock = 1_000_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const sockets: FakeSocket[] = [];
  let ticketCalls = 0;
  const deps: ClientDeps = {
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    fetchTicket: async () => {
      ticketCalls++;
      return tickets.length ? tickets.shift()! : { url: 'https://realtime.qa.example', token: `t${ticketCalls}`, expiresAt: Math.floor(clock / 1000) + 900 };
    },
    setTimeout: (fn, ms) => {
      const id = nextId++;
      // Like a browser: a delay past a signed 32-bit int fires at once
      timers.set(id, { at: clock + (ms > 2 ** 31 - 1 ? 0 : ms), fn });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id as number); },
    now: () => clock,
    random: () => 1,
  };
  const client = new AdminLiveClient(deps);
  /** Moves the clock, firing due timers in order. */
  const advance = async (ms: number) => {
    const until = clock + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].fn();
      await flush();
    }
    clock = until;
  };
  return { client, sockets, advance, ticketCalls: () => ticketCalls, pending: () => timers.size };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Opens and signs in the newest socket; answers subscribes until `topics` are live. */
async function goLive(sockets: FakeSocket[], topics: string[]) {
  await flush();
  const s = sockets[sockets.length - 1];
  s.open();
  assert.equal(s.last().type, 'authenticate');
  s.receive({ type: 'authenticated', userId: 'u', sessionId: 's' });
  for (const topic of topics) {
    assert.deepEqual(s.last(), { type: 'subscribe', channel: `admin:${topic}` });
    s.receive({ type: 'subscribed', channel: `admin:${topic}` });
  }
  return s;
}

describe('admin live client', () => {
  it('backs off from 1 s, doubling, capped at 30 s, with jitter', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => backoffMs(n, () => 1)), [1000, 2000, 4000, 8000, 16000, BACKOFF_MAX_MS, BACKOFF_MAX_MS]);
    assert.equal(backoffMs(0, () => 0), 500);
  });

  it('turns a realtime base URL into its socket URL', () => {
    assert.equal(socketUrlOf('https://realtime.qa.alummahnow.net'), 'wss://realtime.qa.alummahnow.net/ws');
    assert.equal(socketUrlOf('http://localhost:3087/'), 'ws://localhost:3087/ws');
    assert.equal(socketUrlOf('wss://x/ws'), 'wss://x/ws');
  });

  it('authenticates, subscribes topics one at a time, and delivers their updates', async () => {
    const h = harness();
    const updates: any[] = [];
    const live: boolean[] = [];
    h.client.subscribe('jobs', (u) => updates.push(u), (l) => live.push(l));
    h.client.subscribe('errors', () => {}, () => {});
    const s = await goLive(h.sockets, ['jobs', 'errors']);
    assert.equal(s.url, 'wss://realtime.qa.example/ws');
    assert.deepEqual(live, [false, true]);
    assert.equal(h.client.isLive('jobs'), true);

    s.receive({ type: 'admin.update', channel: 'admin:jobs', data: { type: 'admin.update', topic: 'jobs', events: [{ kind: 'job', key: 'job:1' }] } });
    s.receive({ type: 'admin.update', channel: 'admin:errors', data: { type: 'admin.update', topic: 'errors', events: [{ kind: 'changed' }] } });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].events[0].key, 'job:1');
  });

  it('marks topics down when the socket drops, then reconnects with backoff and subscribes again', async () => {
    const h = harness();
    const live: boolean[] = [];
    h.client.subscribe('jobs', () => {}, (l) => live.push(l));
    const first = await goLive(h.sockets, ['jobs']);
    first.drop();
    assert.deepEqual(live, [false, true, false]);
    await h.advance(999);
    assert.equal(h.sockets.length, 1);
    await h.advance(1);
    await goLive(h.sockets, ['jobs']);
    assert.equal(h.sockets.length, 2);
    assert.deepEqual(live, [false, true, false, true]);
  });

  it('keeps retrying while the ticket is refused (signed out), slower each time', async () => {
    const h = harness([null, null, null]);
    h.client.subscribe('jobs', () => {}, () => {});
    await flush();
    assert.equal(h.sockets.length, 0);
    await h.advance(1000);
    assert.equal(h.ticketCalls(), 2);
    await h.advance(1999);
    assert.equal(h.ticketCalls(), 2);
    await h.advance(1);
    assert.equal(h.ticketCalls(), 3);
  });

  it('re-authenticates with a fresh token on AUTH_EXPIRED and subscribes again', async () => {
    const h = harness();
    const live: boolean[] = [];
    h.client.subscribe('jobs', () => {}, (l) => live.push(l));
    const s = await goLive(h.sockets, ['jobs']);
    s.receive({ type: 'error', code: 'AUTH_EXPIRED' });
    assert.equal(h.client.isLive('jobs'), false);
    await flush();
    assert.deepEqual(s.last(), { type: 'authenticate', token: 't2' });
    s.receive({ type: 'authenticated' });
    assert.deepEqual(s.last(), { type: 'subscribe', channel: 'admin:jobs' });
    s.receive({ type: 'subscribed', channel: 'admin:jobs' });
    assert.deepEqual(live, [false, true, false, true]);
    assert.equal(h.sockets.length, 1, 'same socket');
  });

  it('never sends a token about to expire: no socket, a backed-off retry, then a fresh token', async () => {
    const h = harness([{ url: 'https://realtime.qa.example', token: 'stale', expiresAt: Math.floor(1_000_000 / 1000) + 2 }]);
    h.client.subscribe('jobs', () => {}, () => {});
    await flush();
    assert.equal(h.sockets.length, 0, 'a stale ticket opens no socket');
    assert.equal(h.ticketCalls(), 1);
    await h.advance(999);
    assert.equal(h.ticketCalls(), 1, 'waits the reconnect backoff');
    await h.advance(1);
    assert.equal(h.ticketCalls(), 2);
    const s = await goLive(h.sockets, ['jobs']);
    assert.equal(s.sent[0].token, 't2');
  });

  it('AUTH_EXPIRED right after re-authenticating backs off instead of looping (16-live-updates storm)', async () => {
    const h = harness();
    h.client.subscribe('jobs', () => {}, () => {});
    const s = await goLive(h.sockets, ['jobs']);
    // The worker keeps refusing the token: first retry at once, then 1 s, 2 s, …
    s.receive({ type: 'error', code: 'AUTH_EXPIRED' });
    await flush();
    assert.equal(h.ticketCalls(), 2);
    s.receive({ type: 'authenticated' });
    s.receive({ type: 'error', code: 'AUTH_EXPIRED' });
    await flush();
    assert.equal(h.ticketCalls(), 2, 'no immediate second re-authentication');
    await h.advance(1000);
    assert.equal(h.ticketCalls(), 3);
    s.receive({ type: 'authenticated' });
    s.receive({ type: 'error', code: 'AUTH_EXPIRED' });
    await h.advance(1999);
    assert.equal(h.ticketCalls(), 3);
    await h.advance(1);
    assert.equal(h.ticketCalls(), 4);
    // Once a subscription holds, the next expiry re-authenticates at once again
    s.receive({ type: 'authenticated' });
    s.receive({ type: 'subscribed', channel: 'admin:jobs' });
    s.receive({ type: 'error', code: 'AUTH_EXPIRED' });
    await flush();
    assert.equal(h.ticketCalls(), 5);
  });

  it('a rate-limited subscribe starts over on a new socket with a backoff that a sign-in does not reset (#1599)', async () => {
    const h = harness();
    const live: boolean[] = [];
    h.client.subscribe('moderation', () => {}, (l) => live.push(l));
    await flush();
    const first = h.sockets[0];
    first.open();
    first.receive({ type: 'authenticated', userId: 'u', sessionId: 's' });
    assert.deepEqual(first.last(), { type: 'subscribe', channel: 'admin:moderation' });
    // The server dropped the subscribe: without a retry the topic would never go live
    first.receive({ type: 'error', code: 'RATE_LIMIT' });
    await h.advance(999);
    assert.equal(h.sockets.length, 1, 'waits 1 s');
    await h.advance(1);
    await flush();
    const second = h.sockets[1];
    second.open();
    second.receive({ type: 'authenticated', userId: 'u', sessionId: 's' });
    second.receive({ type: 'error', code: 'RATE_LIMIT' });
    // Signed in again but still limited: 2 s now, not back to 1 s
    await h.advance(1999);
    assert.equal(h.sockets.length, 2);
    await h.advance(1);
    await goLive(h.sockets, ['moderation']);
    assert.equal(h.sockets.length, 3);
    assert.equal(live.at(-1), true);
  });

  it('a topic the role may not follow stays not live; the others still subscribe', async () => {
    const h = harness();
    const jobsLive: boolean[] = [];
    h.client.subscribe('jobs', () => {}, (l) => jobsLive.push(l));
    h.client.subscribe('moderation', () => {}, () => {});
    await flush();
    const s = h.sockets[0];
    s.open();
    s.receive({ type: 'authenticated' });
    assert.deepEqual(s.last(), { type: 'subscribe', channel: 'admin:jobs' });
    s.receive({ type: 'error', code: 'FORBIDDEN' });
    assert.deepEqual(s.last(), { type: 'subscribe', channel: 'admin:moderation' });
    s.receive({ type: 'subscribed', channel: 'admin:moderation' });
    assert.equal(h.client.isLive('jobs'), false);
    assert.equal(h.client.isLive('moderation'), true);
    assert.deepEqual(jobsLive, [false]);
  });

  it('super admins also get what only they may see, on its own channel, as the page\'s topic', async () => {
    const h = harness();
    const updates: any[] = [];
    const live: boolean[] = [];
    const off = h.client.subscribe('media', (u) => updates.push(u), (l) => live.push(l));
    const s = await goLive(h.sockets, ['media', 'restricted']);
    assert.deepEqual(live, [false, true]);
    s.receive({ type: 'admin.update', channel: 'admin:restricted', data: { type: 'admin.update', topic: 'restricted', events: [{ kind: 'job', key: 'media|job:v1', of: 'media', status: 'failed' }, { kind: 'job', key: 'jobs|job:j1', of: 'jobs' }] } });
    assert.deepEqual(updates, [{ type: 'admin.update', topic: 'media', events: [{ kind: 'job', key: 'job:v1', status: 'failed' }] }]);
    off();
    assert.deepEqual(s.sent.slice(-2), [{ type: 'unsubscribe', channel: 'admin:media' }, { type: 'unsubscribe', channel: 'admin:restricted' }]);
  });

  it('anyone else is refused that channel; the page is live all the same', async () => {
    const h = harness();
    const live: boolean[] = [];
    h.client.subscribe('jobs', () => {}, (l) => live.push(l));
    const s = await goLive(h.sockets, ['jobs']);
    assert.deepEqual(s.last(), { type: 'subscribe', channel: 'admin:restricted' });
    s.receive({ type: 'error', code: 'FORBIDDEN' });
    assert.deepEqual([h.client.isLive('jobs'), live], [true, [false, true]]);
  });

  it('closes when no page follows anything, and after 5 minutes hidden; reopens when visible', async () => {
    const h = harness();
    const off = h.client.subscribe('jobs', () => {}, () => {});
    const s = await goLive(h.sockets, ['jobs']);
    off();
    assert.deepEqual(s.last(), { type: 'unsubscribe', channel: 'admin:jobs' });
    await h.advance(IDLE_CLOSE_MS);
    assert.equal(s.closed, true);

    h.client.subscribe('jobs', () => {}, () => {});
    await goLive(h.sockets, ['jobs']);
    h.client.setVisible(false);
    await h.advance(HIDDEN_CLOSE_MS);
    assert.equal(h.sockets[1].closed, true);
    await h.advance(60_000);
    assert.equal(h.sockets.length, 2, 'no reconnect while hidden');
    h.client.setVisible(true);
    await goLive(h.sockets, ['jobs']);
    assert.equal(h.sockets.length, 3);
  });

  it('re-authenticates a minute before the token expires', async () => {
    const h = harness();
    h.client.subscribe('jobs', () => {}, () => {});
    const s = await goLive(h.sockets, ['jobs']);
    await h.advance(900_000 - 60_000 - 1);
    assert.notEqual(s.sent.filter((m) => m.type === 'authenticate').length, 2);
    await h.advance(1);
    assert.deepEqual(s.sent.filter((m) => m.type === 'authenticate').map((m) => m.token), ['t1', 't2']);
  });
});

describe('admin live client: long-lived tokens', () => {
  it('a 30-day token re-authenticates after a day, not in a loop (timer overflow, v2026.11.19.3)', async () => {
    const thirtyDays = 30 * 24 * 60 * 60;
    const ticket = (n: number) => ({ url: 'https://realtime.qa.example', token: `long${n}`, expiresAt: Math.floor(1_000_000 / 1000) + thirtyDays });
    const h = harness([ticket(1), ticket(2), ticket(3)]);
    h.client.subscribe('jobs', () => {}, () => {});
    const s = await goLive(h.sockets, ['jobs']);
    await h.advance(60_000);
    assert.equal(h.ticketCalls(), 1, 'no re-authentication within the first minute');
    assert.deepEqual(s.sent.filter((m) => m.type === 'authenticate').map((m) => m.token), ['long1']);
    await h.advance(REAUTH_MAX_WAIT_MS - 60_000);
    assert.deepEqual(s.sent.filter((m) => m.type === 'authenticate').map((m) => m.token), ['long1', 'long2']);
    assert.equal(h.client.isLive('jobs'), true);
  });
});

describe('realtime ticket', () => {
  it('derives the realtime host of the environment from the admin API host', () => {
    assert.equal(realtimeUrlFor({ ADMIN_API_URL: 'https://admin.api.qa.alummahnow.net' }), 'https://realtime.qa.alummahnow.net');
    assert.equal(realtimeUrlFor({ ADMIN_API_URL: 'https://admin.api.alummahnow.net' }), 'https://realtime.alummahnow.net');
    assert.equal(realtimeUrlFor({ ADMIN_API_URL: 'https://admin.api.stage.alummahnow.net' }), 'https://realtime.stage.alummahnow.net');
    assert.equal(realtimeUrlFor({ ADMIN_API_URL: 'http://127.0.0.1:3090' }), 'http://localhost:3087');
    assert.equal(realtimeUrlFor({ REALTIME_URL: 'http://127.0.0.1:9000/', ADMIN_API_URL: 'https://admin.api.alummahnow.net' }), 'http://127.0.0.1:9000');
  });

  it('reads a token expiry without verifying it', () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1234 })).toString('base64url');
    assert.equal(tokenExpiry(`h.${payload}.s`), 1234);
    assert.equal(tokenExpiry('garbage'), undefined);
  });
});

describe('Delivery page live figures from admin:media', () => {
  it('a live event becomes the figures; the queue age comes from the server clock', async () => {
    const { mediaLiveFromEvent } = await import('../src/app/(protected)/delivery/live-event');
    assert.deepEqual(
      mediaLiveFromEvent({ kind: 'live', key: 'live', transcoding: 2, queued: 5, rangeMin: 2, rangeMax: 4, ceiling: 10, oldestQueuedAt: '2026-11-12T10:00:00.000Z', at: '2026-11-12T10:01:30.000Z' }),
      { transcoding: 2, queued: 5, rangeMin: 2, rangeMax: 4, ceiling: 10, oldestQueuedAt: '2026-11-12T10:00:00.000Z', oldestQueuedSeconds: 90, at: '2026-11-12T10:01:30.000Z' },
    );
    assert.deepEqual(
      mediaLiveFromEvent({ kind: 'live', key: 'live', transcoding: 0, queued: 0, at: '2026-11-12T10:00:00.000Z' }),
      { transcoding: 0, queued: 0, rangeMin: null, rangeMax: null, ceiling: null, oldestQueuedAt: null, oldestQueuedSeconds: null, at: '2026-11-12T10:00:00.000Z' },
    );
    assert.equal(mediaLiveFromEvent({ kind: 'job', key: 'job:v1', status: 'ready' }), null);
    assert.equal(mediaLiveFromEvent({ kind: 'live', key: 'live', truncated: true }), null);
    assert.equal(mediaLiveFromEvent({ kind: 'live', key: 'live', transcoding: '2', queued: 1, at: 'x' }), null);
  });
});
