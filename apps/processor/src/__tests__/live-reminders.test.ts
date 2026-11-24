/** Reminder fan-outs (wiki E17 §5.5): one notification per person, settings honoured, nothing once the stream is not what it was. */
import { DatabaseSync } from 'node:sqlite';
import { forgetFeatureSwitches, type NotificationFanoutPayload } from '@al-ummah/shared-types';
import { createLogger } from '@al-ummah/logger';
import { MessageProcessor } from '../messageProcessor';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { createSqliteD1 } from './sqlite-d1';

const START = 1_800_000_000_000;

describe('reminder fan-out', () => {
  const originalFetch = global.fetch;
  let db: ReturnType<typeof createSqliteD1>;
  let search: DatabaseSync;
  let queue: AlUmmahMessage[];
  let on: boolean;
  let premieres: boolean;
  let pushed: string[];

  beforeEach(() => {
    forgetFeatureSwitches();
    db = createSqliteD1();
    search = new DatabaseSync(':memory:');
    search.exec('CREATE TABLE live_stream_metadata (stream_id TEXT PRIMARY KEY, kind TEXT, status TEXT, visibility TEXT, made_for_kids INTEGER, scheduled_start_at INTEGER)');
    search.prepare("INSERT INTO live_stream_metadata VALUES ('s1', 'live', 'live', 'public', 0, ?)").run(START);
    queue = [];
    on = true;
    premieres = true;
    pushed = [];
    global.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      for (const item of body.items ?? [body]) if (item.message.type === 'notification') pushed.push(item.channel);
      return { ok: true, status: 200 };
    }) as never;
    const add = (u: string) => db.raw.prepare("INSERT INTO live_reminders (stream_id, user_id, created_at) VALUES ('s1', ?, 1)").run(u);
    ['both', 'reminded', 'muted'].forEach(add);
    db.raw.prepare("INSERT INTO live_reminders (stream_id, user_id, created_at) VALUES ('other', 'elsewhere', 1)").run();
    for (const u of ['both', 'subscriber']) db.raw.prepare("INSERT INTO channel_subscribers VALUES ('ch1', ?, 'all', 0, 0)").run(u);
    db.raw.prepare("INSERT INTO notification_settings (user_id, category, enabled, updated_at) VALUES ('muted', 'live', 0, 1)").run();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const env = () =>
    ({
      MESSAGE_QUEUE: { send: async (m: AlUmmahMessage) => void queue.push(m) },
      MESSAGES_BUCKET: { put: jest.fn(), get: jest.fn().mockResolvedValue(null), list: jest.fn() },
      REPORTS_DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }), batch: async () => [] },
      NOTIFICATIONS_DB: db,
      SEARCH_DB: {
        prepare: (sql: string) => {
          let args: never[] = [];
          const s: any = { bind: (...v: never[]) => ((args = v), s), first: async () => search.prepare(sql).get(...args) ?? null, all: async () => ({ results: sql.includes('feature_switches') ? ['liveReminders', 'livePremieres'].map((key) => ({ key, enabled: (key === 'liveReminders' ? on : premieres) ? 1 : 0, version: 1, updated_by: 'x', updated_at: 'x' })) : search.prepare(sql).all(...args) }) };
          return s;
        },
      },
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
      WEBSOCKET_URL: 'https://ws.example',
      INTERNAL_API_KEY: 'secret',
    }) as unknown as QueueEnvironment;
  const run = async (payload: Partial<NotificationFanoutPayload>) => {
    const p = new MessageProcessor(createLogger('reminders-test', { logLevel: 'error' }));
    const result = await p.processMessage({ id: 'm1', type: MessageType.NotificationFanout, timestamp: 1, payload: { channelId: 'ch1', entityId: 's1', isHighlight: true, actorUserId: 'owner', ...payload } as never }, env());
    expect(result.success).toBe(true);
  };
  const stored = () => db.raw.prepare('SELECT user_id, notification_key, dedupe_key FROM notifications ORDER BY user_id').all().map((r) => Object.values(r as object));
  const stream = (over: Record<string, unknown>) => { for (const [k, v] of Object.entries(over)) search.prepare(`UPDATE live_stream_metadata SET ${k} = ?`).run(v as never); };

  it('a start reaches subscribers, then those who asked: one notification and one push each', async () => {
    await run({ kind: 'live_started' });
    const next = queue.filter((m) => m.type === MessageType.NotificationFanout);
    expect(next).toHaveLength(1);
    expect(next[0].payload).toMatchObject({ kind: 'live_started', audience: 'reminders', entityId: 's1' });
    expect(pushed.sort()).toEqual(['user:both', 'user:subscriber']);
    await run(next[0].payload as never);
    expect(stored()).toEqual([
      ['both', 'liveStarted', 'live:s1'],
      ['reminded', 'liveStarted', 'live:s1'],
      ['subscriber', 'liveStarted', 'live:s1'],
    ]);
    expect(pushed.sort()).toEqual(['user:both', 'user:reminded', 'user:subscriber']);
    // Repeated by the queue: nothing more, and it does not start the reminders again
    await run(next[0].payload as never);
    expect(pushed).toHaveLength(3);
    expect(queue.filter((m) => m.type === MessageType.NotificationFanout)).toHaveLength(1);
    expect(queue.filter((m) => m.type === MessageType.SocialEvent)).toHaveLength(1);
  });

  it('the heads-up goes to those who asked, once per start time, without the category they muted', async () => {
    stream({ status: 'scheduled' });
    const soon = { kind: 'live_soon' as const, audience: 'reminders' as const, startsAt: START };
    await run(soon);
    await run(soon);
    expect(stored()).toEqual([
      ['both', 'liveSoon', `live-soon:s1:${START}`],
      ['reminded', 'liveSoon', `live-soon:s1:${START}`],
    ]);
    expect(pushed.sort()).toEqual(['user:both', 'user:reminded']);
    expect(queue.some((m) => m.type === MessageType.SocialEvent)).toBe(false);
    stream({ scheduled_start_at: START + 1000 });
    await run(soon);
    expect(stored()).toHaveLength(2);
    await run({ ...soon, startsAt: START + 1000 });
    expect(stored()).toHaveLength(4);
  });

  it.each([
    ['private', { visibility: 'private' }],
    ['hidden', { visibility: 'hidden' }],
    ['made for kids', { made_for_kids: 1 }],
    ['cancelled', { status: 'cancelled' }],
    ['ended', { status: 'ended' }],
  ])('a stream that is %s reminds nobody', async (_name, over) => {
    stream(over);
    await run({ kind: 'live_started', audience: 'reminders' });
    await run({ kind: 'live_soon', audience: 'reminders', startsAt: START });
    expect(stored()).toEqual([]);
  });

  it('a premiere reminds nobody once premieres are switched off, between two pages too', async () => {
    stream({ kind: 'premiere' });
    premieres = false;
    await run({ kind: 'live_started', audience: 'reminders', afterUserId: 'both' });
    stream({ status: 'scheduled' });
    await run({ kind: 'live_soon', audience: 'reminders', startsAt: START });
    expect(stored()).toEqual([]);
    premieres = true;
    forgetFeatureSwitches();
    await run({ kind: 'live_soon', audience: 'reminders', startsAt: START });
    expect(stored()).toHaveLength(2);
  });

  it('nothing while the switch is off', async () => {
    on = false;
    await run({ kind: 'live_started', audience: 'reminders' });
    expect(stored()).toEqual([]);
  });
});
