/**
 * Paged notification fan-out (SCALABILITY-AUDIT PR-5, PR-6, PR-7, PR-10).
 *
 * A channel with thousands of subscribers fans out one page per queue
 * message; follow-up pages are delivered in parallel, duplicated, and some
 * attempts fail between storing and pushing. Every subscriber must end with
 * exactly one notification and at least one push, and each message must stay
 * within a small, fixed number of subrequests.
 */
import { createLogger } from '@al-ummah/logger';
import { forgetFeatureSwitches } from '@al-ummah/shared-types';
import { MessageProcessor } from '../messageProcessor';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { FANOUT_PAGE } from '../lib/notifications-store';
import { createSqliteD1 } from './sqlite-d1';

const pause = () => new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * 3)));

function setup(subscribers: number) {
  const db = createSqliteD1();
  const insert = db.raw.prepare('INSERT INTO channel_subscribers VALUES (?, ?, ?, 0, 0)');
  for (let i = 0; i < subscribers; i++) insert.run('big', `u${String(i).padStart(6, '0')}`, i % 10 === 0 ? 'highlights' : 'all');
  insert.run('big', 'owner', 'all');

  const queued: AlUmmahMessage[] = [];
  const social: AlUmmahMessage[] = []; // SocialEvent announcements go to the social consumer, not MessageProcessor
  const pushDispatched: string[] = [];
  let sendBatchCalls = 0;
  let failNextSendBatch = 0;
  const queue = {
    send: jest.fn(async (m: AlUmmahMessage) => { await pause(); (m.type === MessageType.SocialEvent ? social : queued).push(m); }),
    sendBatch: jest.fn(async (batch: Array<{ body: AlUmmahMessage }>) => {
      await pause();
      sendBatchCalls++;
      if (failNextSendBatch > 0) { failNextSendBatch--; throw new Error('queue unavailable'); }
      for (const { body } of batch) {
        for (const r of (body.payload as { recipients: Array<{ userId: string }> }).recipients) pushDispatched.push(r.userId);
      }
    }),
  };
  const realtime: string[] = [];
  let realtimeCalls = 0;
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    await pause();
    realtimeCalls++;
    const body = JSON.parse(String(init?.body));
    for (const item of body.items ?? [body]) realtime.push(item.channel);
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch;

  const env = {
    MESSAGE_QUEUE: queue,
    MESSAGES_BUCKET: { put: jest.fn(), get: jest.fn().mockResolvedValue(null), list: jest.fn() },
    community_posts: { put: jest.fn(), get: jest.fn(), list: jest.fn() },
    REPORTS_DB: {} as QueueEnvironment['REPORTS_DB'],
    NOTIFICATIONS_DB: db,
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'error',
    WEBSOCKET_URL: 'https://ws.example',
    INTERNAL_API_KEY: 'secret',
  } as unknown as QueueEnvironment;

  const processor = new MessageProcessor(createLogger('fanout-test', { logLevel: 'error' }));
  /** Runs a message like the queue: a failed attempt is retried (up to 3 times). */
  const deliver = async (m: AlUmmahMessage) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await processor.processMessage(m, env);
      if (result.success) return;
    }
    throw new Error(`message ${m.id} dead-lettered`);
  };
  return {
    db, env, queued, social, deliver, realtime, pushDispatched,
    stats: () => ({ sendBatchCalls, realtimeCalls }),
    failSendBatch: (n: number) => { failNextSendBatch = n; },
  };
}

const fanout = (): AlUmmahMessage => ({
  id: 'fanout-1',
  type: MessageType.NotificationFanout,
  timestamp: Date.now(),
  payload: { kind: 'new_video', channelId: 'big', entityId: 'v1', isHighlight: true, actorUserId: 'owner', actionUrl: '/video/v1' },
});

describe('paged fan-out', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('4500 subscribers: one page per message, follow-ups duplicated and in parallel, attempts failing: everyone exactly once', async () => {
    const SUBSCRIBERS = 4500;
    const t = setup(SUBSCRIBERS);
    t.failSendBatch(2); // two attempts die after storing, before the push is handed off

    await t.deliver(fanout());
    let rounds = 0;
    while (t.queued.length) {
      const batch = t.queued.splice(0);
      // At-least-once: every follow-up arrives twice, concurrently
      await Promise.all([...batch, ...batch].map((m) => t.deliver(m)));
      if (++rounds > 20) throw new Error('fan-out never finished');
    }

    const users = t.db.raw.prepare("SELECT user_id, COUNT(*) AS n FROM notifications WHERE dedupe_key = 'video:v1' GROUP BY user_id").all() as Array<{ user_id: string; n: number }>;
    expect(users).toHaveLength(SUBSCRIBERS); // highlights bell included, the uploader excluded
    expect(users.every((u) => Number(u.n) === 1)).toBe(true);
    expect(t.db.raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE pushed_at IS NULL").get()?.n).toBe(0);

    // Every subscriber got its push and realtime event (a duplicate page may repeat a few: at least once)
    const pushed = new Set(t.pushDispatched);
    const live = new Set(t.realtime);
    expect(pushed.size).toBe(SUBSCRIBERS);
    expect(live.size).toBe(SUBSCRIBERS);
    expect(live.has('user:owner')).toBe(false);
  }, 30_000); // real work for 4500 subscribers: Jest's 5 s default flaked on CI runners (#1237)

  it('a page costs a fixed number of calls however big the channel is', async () => {
    const t = setup(FANOUT_PAGE * 3);
    await t.deliver(fanout());
    // One page: realtime in REALTIME_BATCH chunks (2 for 1000), push in one queue batch call
    expect(t.stats().realtimeCalls).toBe(2);
    expect(t.stats().sendBatchCalls).toBe(1);
    expect(t.queued).toHaveLength(1);
    // The first page (only) announces the upload to social auto-post
    expect(t.social.map((m) => m.payload)).toEqual([{ channelId: 'big', event: 'video', entityId: 'v1' }]);
    // The next page starts after the FANOUT_PAGE-th subscriber in key order
    const boundary = t.db.raw.prepare("SELECT user_id FROM channel_subscribers WHERE channel_id = 'big' ORDER BY user_id LIMIT 1 OFFSET ?").get(FANOUT_PAGE - 1)?.user_id;
    expect((t.queued[0].payload as { afterUserId?: string }).afterUserId).toBe(boundary);
  });

  it('a NotificationCreate stored by a failed attempt is pushed by the retry', async () => {
    const t = setup(0);
    t.failSendBatch(1);
    const m: AlUmmahMessage = {
      id: 'create-1',
      type: MessageType.NotificationCreate,
      timestamp: Date.now(),
      payload: { notificationId: 'n1', recipientUserId: 'owner', notificationKey: 'newSubscriber', dedupeKey: 'sub:x' },
    };
    await t.deliver(m);
    expect(t.pushDispatched).toEqual(['owner']);
    // A later redelivery finds it pushed: nothing is sent again
    await t.deliver(m);
    expect(t.pushDispatched).toEqual(['owner']);
    expect(t.db.raw.prepare('SELECT COUNT(*) AS n FROM notifications').get()?.n).toBe(1);
  });

  describe('a video made for kids (wiki E20 §5.5)', () => {
    const kids = (): AlUmmahMessage => { const m = fanout(); return { ...m, payload: { ...(m.payload as object), madeForKids: true } } as AlUmmahMessage; };
    const switches = (answer: () => unknown[]) => ({
      prepare: () => { const s: any = { bind: () => s, first: async () => null, all: async () => ({ results: answer() }) }; return s; },
    });
    const run = async (answer?: () => unknown[], message = kids()) => {
      forgetFeatureSwitches();
      const t = setup(5);
      if (answer) (t.env as unknown as Record<string, unknown>).SEARCH_DB = switches(answer);
      const result = await t.deliver(message).then(() => 'ok', () => 'failed');
      return { t, result, stored: (t.db.raw.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n };
    };
    const row = (enabled: number) => [{ key: 'ageRules', enabled, version: 1, updated_by: 'x', updated_at: 'x' }];

    it('age rules on: social hears about it once, no subscriber is notified', async () => {
      const r = await run(() => row(1));
      expect([r.result, r.stored, r.t.social.length, r.t.pushDispatched.length, r.t.queued.length]).toEqual(['ok', 0, 1, 0, 0]);
    });

    it('a live start: neither subscribers nor those who asked for a reminder', async () => {
      const live = kids();
      const r = await run(() => row(1), { ...live, payload: { ...(live.payload as object), kind: 'live_started' } } as AlUmmahMessage);
      expect([r.result, r.stored, r.t.social.length, r.t.queued.length]).toEqual(['ok', 0, 1, 0]);
    });

    it('age rules off: subscribers are notified as before', async () => {
      const r = await run(() => row(0));
      expect(r.result).toBe('ok');
      expect(r.stored).toBeGreaterThan(0);
    });

    it('switch unreadable: nobody is notified and the message is retried', async () => {
      const r = await run(() => { throw new Error('D1 down'); });
      expect([r.result, r.stored, r.t.pushDispatched.length, r.t.social.length]).toEqual(['failed', 0, 0, 0]);
    });

    it('any other video never reads the switch', async () => {
      const r = await run(() => { throw new Error('D1 down'); }, fanout());
      expect(r.result).toBe('ok');
      expect(r.stored).toBeGreaterThan(0);
    });
  });
});
