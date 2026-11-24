/**
 * Push fan-out (Epic 9.4): stored notifications are queued in PushDispatch
 * batches; dispatch resolves devices, honours per-device categories, and
 * prunes tokens the provider rejected.
 */
import { createLogger } from '@al-ummah/logger';
import { forgetFeatureSwitches, MessageType, PUSH_DISPATCH_BATCH, PUSH_RETRY_DELAYS_SECONDS, type PushDispatchPayload } from '@al-ummah/shared-types';
import { MessageProcessor } from '../messageProcessor';
import { AlUmmahMessage, QueueEnvironment } from '../types';
import { deviceWants, dispatchPush, enqueuePush } from '../push/dispatch';
import { LogOnlyPushProvider, resolvePushProviders, type PushMessage, type PushProvider, type PushProviders, type PushResult, type PushTarget } from '../push/provider';
import { createSqliteD1 } from './sqlite-d1';

class RecordingProvider implements PushProvider {
  readonly name = 'recording';
  sent: Array<{ target: PushTarget; message: PushMessage }> = [];
  constructor(private readonly answer: (target: PushTarget) => PushResult = () => ({ ok: true })) {}
  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    this.sent.push({ target, message });
    return this.answer(target);
  }
  async sendAlert(): Promise<PushResult> {
    throw new Error('ordinary notifications never send review alerts');
  }
}

const all = (p: PushProvider): PushProviders => ({ apns: p, fcm: p, wns: p, webpush: p });

describe('push fan-out', () => {
  let db: ReturnType<typeof createSqliteD1>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    db = createSqliteD1();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function device(installId: string, userId: string, opts: { provider?: string; token?: string; categories?: string[]; app?: string } = {}) {
    db.raw
      .prepare(
        `INSERT INTO push_devices (install_id, user_id, app, platform, provider, token, locale, categories, created_at, updated_at)
         VALUES (?, ?, ?, 'ios', ?, ?, 'ar', ?, 0, 0)`,
      )
      .run(installId, userId, opts.app ?? 'viewer', opts.provider ?? 'apns', opts.token ?? `tok-${installId}`, opts.categories ? JSON.stringify(opts.categories) : null);
  }
  const installs = () => db.raw.prepare('SELECT install_id FROM push_devices ORDER BY install_id').all().map((r: any) => r.install_id);

  const payload = (userIds: string[], notificationKey: PushDispatchPayload['notificationKey'] = 'newVideo'): PushDispatchPayload => ({
    recipients: userIds.map((userId) => ({ userId, notificationId: `n-${userId}` })),
    notificationKey,
    params: { title: 'Lecture' },
    actionUrl: '/watch/v1',
  });

  it('sends each recipient their own notification id, with key + params for on-device localisation', async () => {
    device('i-a1', 'a');
    device('i-a2', 'a', { provider: 'fcm' });
    device('i-b1', 'b');
    device('i-c1', 'c');
    const p = new RecordingProvider();
    const summary = await dispatchPush(db, payload(['a', 'b']), all(p));
    expect(summary).toEqual({ devices: 3, sent: 3, skipped: 0, failed: 0, pruned: 0, retry: [], retryErrors: {} });
    expect(p.sent.map((s) => [s.target.installId, s.message.notificationId]).sort()).toEqual([
      ['i-a1', 'n-a'],
      ['i-a2', 'n-a'],
      ['i-b1', 'n-b'],
    ]);
    expect(p.sent[0].message).toMatchObject({ notificationKey: 'newVideo', category: 'new_videos', params: { title: 'Lecture' }, actionUrl: '/watch/v1' });
    expect(p.sent[0].target.locale).toBe('ar');
  });

  it('sends ordinary notifications to the viewer and Studio apps, never to the staff Admin app (#1264)', async () => {
    device('i-viewer', 'a');
    device('i-studio', 'a', { app: 'studio' });
    device('i-admin', 'a', { app: 'admin' });
    const p = new RecordingProvider();
    const summary = await dispatchPush(db, payload(['a']), all(p));
    expect(summary).toMatchObject({ devices: 2, sent: 2 });
    expect(p.sent.map((s) => [s.target.installId, s.target.app]).sort()).toEqual([
      ['i-studio', 'studio'],
      ['i-viewer', 'viewer'],
    ]);
  });

  it('a row written before the app column existed is the viewer app', () => {
    db.raw.prepare("INSERT INTO push_devices (install_id, user_id, platform, provider, token, created_at, updated_at) VALUES ('old', 'u', 'ios', 'apns', 't', 0, 0)").run();
    expect(db.raw.prepare("SELECT app FROM push_devices WHERE install_id = 'old'").get()).toEqual({ app: 'viewer' });
    expect(() => device('bad', 'u', { app: 'tv' })).toThrow(/CHECK/);
  });

  it('skips devices narrowed to other categories', async () => {
    device('i-tv', 'a', { categories: ['live'] });
    device('i-phone', 'a');
    const p = new RecordingProvider();
    const summary = await dispatchPush(db, payload(['a']), all(p));
    expect(summary).toMatchObject({ sent: 1, skipped: 1 });
    expect(p.sent.map((s) => s.target.installId)).toEqual(['i-phone']);
    expect((await dispatchPush(db, payload(['a'], 'liveStarted'), all(new RecordingProvider()))).sent).toBe(2);
  });

  it('suppresses optional pushes during daily or fresh prayer quiet windows while letting account notices through and ignoring stale prayer windows (E22-D6)', async () => {
    device('i-quiet-phone', 'quiet-user');
    device('i-quiet-tablet', 'quiet-user', { provider: 'fcm' });
    device('i-prayer', 'prayer-user');
    device('i-stale-prayer', 'stale-prayer-user');
    device('i-awake', 'awake-user');

    const nightUtc = Date.UTC(2026, 10, 23, 20, 30);
    const staleSyncUtc = nightUtc - 8 * 24 * 60 * 60 * 1000;

    // quiet-user (2 devices): 22:00 (1320) – 06:00 (360) Asia/Riyadh (UTC+3). At 20:30 UTC it is 23:30 Riyadh.
    db.raw
      .prepare(
        `INSERT INTO notification_quiet_hours (user_id, enabled, timezone, start_minute, end_minute, prayer_quiet_enabled, prayer_windows_json, prayer_windows_updated_at, updated_at)
         VALUES ('quiet-user', 1, 'Asia/Riyadh', 1320, 360, 0, '[]', NULL, 0)`,
      )
      .run();
    // prayer-user: daily off, fresh prayer window 23:20–23:50 Riyadh (1400..1430)
    db.raw
      .prepare(
        `INSERT INTO notification_quiet_hours (user_id, enabled, timezone, start_minute, end_minute, prayer_quiet_enabled, prayer_windows_json, prayer_windows_updated_at, updated_at)
         VALUES ('prayer-user', 0, 'Asia/Riyadh', 1320, 360, 1, '[{"startMinute":1400,"endMinute":1430}]', ?, 0)`,
      )
      .run(nightUtc - 3600_000);
    // stale-prayer-user: prayer window matches time of day, but synced 8 days ago (> 7d max age) -> ignored!
    db.raw
      .prepare(
        `INSERT INTO notification_quiet_hours (user_id, enabled, timezone, start_minute, end_minute, prayer_quiet_enabled, prayer_windows_json, prayer_windows_updated_at, updated_at)
         VALUES ('stale-prayer-user', 0, 'Asia/Riyadh', 1320, 360, 1, '[{"startMinute":1400,"endMinute":1430}]', ?, 0)`,
      )
      .run(staleSyncUtc);

    // Default options fail closed (quietHoursEnabled defaults to false -> no suppression)
    const defaultOffProvider = new RecordingProvider();
    const defaultOffSummary = await dispatchPush(
      db,
      payload(['quiet-user', 'prayer-user', 'stale-prayer-user', 'awake-user'], 'newVideo'),
      all(defaultOffProvider),
      nightUtc,
    );
    expect(defaultOffSummary).toMatchObject({ devices: 5, sent: 5, skipped: 0, retry: [] });

    const optProvider = new RecordingProvider();
    const optSummary = await dispatchPush(
      db,
      payload(['quiet-user', 'prayer-user', 'stale-prayer-user', 'awake-user'], 'newVideo'),
      all(optProvider),
      nightUtc,
      { quietHoursEnabled: true },
    );
    expect(optSummary).toMatchObject({ devices: 5, sent: 2, skipped: 3, retry: [] });
    expect(optProvider.sent.map((s) => s.target.installId).sort()).toEqual(['i-awake', 'i-stale-prayer']);

    // When quietHours switch is explicitly false, stored quiet-hour rows do not suppress pushes
    const switchOffProvider = new RecordingProvider();
    const switchOffSummary = await dispatchPush(
      db,
      payload(['quiet-user', 'prayer-user', 'awake-user'], 'newVideo'),
      all(switchOffProvider),
      nightUtc,
      { quietHoursEnabled: false },
    );
    expect(switchOffSummary).toMatchObject({ devices: 4, sent: 4, skipped: 0 });

    // Account notices (accountWarning) bypass quiet hours and prayer windows even when quietHoursEnabled is true
    const acctProvider = new RecordingProvider();
    const acctSummary = await dispatchPush(
      db,
      payload(['quiet-user', 'prayer-user', 'awake-user'], 'accountWarning'),
      all(acctProvider),
      nightUtc,
      { quietHoursEnabled: true },
    );
    expect(acctSummary).toMatchObject({ devices: 4, sent: 4, skipped: 0 });

    // Outside quiet hours (09:00 UTC = 12:00 Riyadh): everyone receives optional pushes
    const noonUtc = Date.UTC(2026, 10, 24, 9, 0);
    const noonProvider = new RecordingProvider();
    const noonSummary = await dispatchPush(
      db,
      payload(['quiet-user', 'prayer-user', 'awake-user'], 'newVideo'),
      all(noonProvider),
      noonUtc,
      { quietHoursEnabled: true },
    );
    expect(noonSummary).toMatchObject({ devices: 4, sent: 4, skipped: 0 });
  });

  it('chunks quiet-hour lookups safely across full batches (> 90 unique recipients)', async () => {
    const nightUtc = Date.UTC(2026, 10, 23, 20, 30);
    const users = Array.from({ length: PUSH_DISPATCH_BATCH }, (_, idx) => `u-${idx}`);
    for (const u of users) {
      device(`inst-${u}`, u);
      db.raw
        .prepare(
          `INSERT INTO notification_quiet_hours (user_id, enabled, timezone, start_minute, end_minute, prayer_quiet_enabled, prayer_windows_json, prayer_windows_updated_at, updated_at)
           VALUES (?, 1, 'Asia/Riyadh', 1320, 360, 0, '[]', NULL, 0)`,
        )
        .run(u);
    }
    const p = new RecordingProvider();
    const summary = await dispatchPush(db, payload(users, 'newVideo'), all(p), nightUtc, { quietHoursEnabled: true });
    expect(summary).toMatchObject({ devices: PUSH_DISPATCH_BATCH, sent: 0, skipped: PUSH_DISPATCH_BATCH });
  });

  it('routes by provider and deletes devices whose token was rejected', async () => {
    device('i-dead', 'a', { provider: 'fcm' });
    device('i-ok', 'a');
    const apns = new RecordingProvider();
    const fcm = new RecordingProvider(() => ({ ok: false, invalidToken: true, error: 'UNREGISTERED' }));
    const summary = await dispatchPush(db, payload(['a']), { ...all(apns), fcm });
    expect(summary).toMatchObject({ sent: 1, failed: 1, pruned: 1 });
    expect(installs()).toEqual(['i-ok']);
  });

  it('keeps a device on transient failures and when the provider throws', async () => {
    device('i-flaky', 'a');
    device('i-boom', 'b', { provider: 'wns' });
    const apns = new RecordingProvider(() => ({ ok: false, invalidToken: false, error: '503' }));
    const wns: PushProvider = { name: 'wns', send: async () => { throw new Error('network'); }, sendAlert: async () => ({ ok: true }) };
    const summary = await dispatchPush(db, payload(['a', 'b']), { ...all(apns), wns });
    expect(summary).toMatchObject({ failed: 2, pruned: 0 });
    expect(installs()).toEqual(['i-boom', 'i-flaky']);
  });

  it('does not prune a device that re-registered a fresh token meanwhile', async () => {
    device('i-a', 'a', { token: 'old' });
    const fcmLike = new RecordingProvider(() => {
      db.raw.prepare("UPDATE push_devices SET token = 'fresh' WHERE install_id = 'i-a'").run();
      return { ok: false, invalidToken: true, error: 'Unregistered' };
    });
    await dispatchPush(db, payload(['a']), all(fcmLike));
    expect(installs()).toEqual(['i-a']);
  });

  it('enqueues PushDispatch messages of at most PUSH_DISPATCH_BATCH recipients', async () => {
    const send = jest.fn();
    const rows = Array.from({ length: PUSH_DISPATCH_BATCH * 2 + 5 }, (_, i) => ({ id: `n${i}`, user_id: `u${i}` }));
    expect(await enqueuePush({ MESSAGE_QUEUE: { send } }, rows, { notificationKey: 'liveStarted' })).toBe(3);
    const bodies = send.mock.calls.map(([m]) => m as AlUmmahMessage);
    expect(bodies.every((m) => m.type === MessageType.PushDispatch)).toBe(true);
    expect(bodies.map((m) => (m.payload as unknown as PushDispatchPayload).recipients.length)).toEqual([100, 100, 5]);
    expect(await enqueuePush({ MESSAGE_QUEUE: { send } }, [], { notificationKey: 'liveStarted' })).toBe(0);
    expect(await enqueuePush({}, rows, { notificationKey: 'liveStarted' })).toBe(0);
  });

  it('deviceWants: null or unreadable means every category', () => {
    expect(deviceWants(null, 'live')).toBe(true);
    expect(deviceWants('["live"]', 'live')).toBe(true);
    expect(deviceWants('["live"]', 'replies')).toBe(false);
    expect(deviceWants('garbage', 'replies')).toBe(true);
  });

  it('every provider is log-only until its credentials land', async () => {
    const providers = resolvePushProviders();
    expect(Object.values(providers).every((p) => p instanceof LogOnlyPushProvider)).toBe(true);
    device('i-a', 'a');
    expect((await dispatchPush(db, payload(['a']), providers)).sent).toBe(1);
  });

  describe('processor wiring', () => {
    function env(send: jest.Mock): QueueEnvironment {
      return {
        MESSAGE_QUEUE: { send },
        MESSAGES_BUCKET: { put: jest.fn(), get: jest.fn().mockResolvedValue(null), list: jest.fn() },
        community_posts: { put: jest.fn(), get: jest.fn(), list: jest.fn() },
        REPORTS_DB: {} as QueueEnvironment['REPORTS_DB'],
        NOTIFICATIONS_DB: db,
        ENVIRONMENT: 'test',
        LOG_LEVEL: 'error',
      };
    }
    const message = (type: MessageType, payload: object): AlUmmahMessage => ({ id: `m-${Math.random()}`, type, timestamp: Date.now(), payload: payload as Record<string, unknown> });

    it('a stored notification is queued for push; a duplicate or disabled one is not', async () => {
      const send = jest.fn();
      const p = new MessageProcessor(createLogger('push-test', { logLevel: 'error' }), all(new RecordingProvider()));
      const create = { notificationId: 'n1', recipientUserId: 'u1', notificationKey: 'newSubscriber', dedupeKey: 'd1' };
      await p.processMessage(message(MessageType.NotificationCreate, create), env(send));
      await p.processMessage(message(MessageType.NotificationCreate, { ...create, notificationId: 'n2' }), env(send));
      expect(send).toHaveBeenCalledTimes(1);
      const queued = send.mock.calls[0][0] as AlUmmahMessage;
      expect(queued.type).toBe(MessageType.PushDispatch);
      expect((queued.payload as unknown as PushDispatchPayload).recipients).toEqual([{ userId: 'u1', notificationId: 'n1' }]);
    });

    it('fan-out queues push for every stored subscriber, and PushDispatch delivers it', async () => {
      const send = jest.fn();
      const provider = new RecordingProvider();
      const p = new MessageProcessor(createLogger('push-test', { logLevel: 'error' }), all(provider));
      for (const u of ['s1', 's2']) {
        db.raw.prepare("INSERT INTO channel_subscribers VALUES ('ch1', ?, 'all', 0, 0)").run(u);
        device(`i-${u}`, u);
      }
      await p.processMessage(message(MessageType.NotificationFanout, { kind: 'live_started', channelId: 'ch1', entityId: 'live1', isHighlight: true }), env(send));
      // Push is queued once; the others announce the live stream to social auto-post and go on to those who asked to be reminded
      const sent = send.mock.calls.map((c) => c[0] as AlUmmahMessage);
      expect(sent.map((m) => m.type).sort()).toEqual([MessageType.NotificationFanout, MessageType.PushDispatch, MessageType.SocialEvent].sort());
      expect((sent.find((m) => m.type === MessageType.NotificationFanout)!.payload as { audience?: string }).audience).toBe('reminders');
      const queued = sent.find((m) => m.type === MessageType.PushDispatch)!;
      const result = await p.processMessage(queued, env(send));
      expect(result.success).toBe(true);
      expect(provider.sent.map((s) => s.target.installId).sort()).toEqual(['i-s1', 'i-s2']);
      expect(provider.sent[0].message.category).toBe('live');
    });

    it('transient failures are retried later for just those devices, then dead-lettered with Replay', async () => {
      device('i-ok', 'a');
      device('i-busy', 'a', { provider: 'webpush' });
      device('i-gone', 'b', { provider: 'webpush' });
      const provider = new RecordingProvider((t) =>
        t.installId === 'i-busy' ? { ok: false, invalidToken: false, retryable: true, error: '503 busy' }
          : t.installId === 'i-gone' ? { ok: false, invalidToken: true, error: '410 gone' }
            : { ok: true },
      );
      const send = jest.fn();
      const dlq = jest.fn();
      const e = { ...env(send), DLQ: { send: dlq } };
      const p = new MessageProcessor(createLogger('push-test', { logLevel: 'error' }), all(provider));
      const first = message(MessageType.PushDispatch, payload(['a', 'b']));
      expect((await p.processMessage(first, e)).success).toBe(true);
      expect(installs()).toEqual(['i-busy', 'i-ok']);

      // Every retry goes to the failed device only, with the next delay; no user ids in it
      let current = first;
      for (const [attempt, delay] of PUSH_RETRY_DELAYS_SECONDS.entries()) {
        expect(send).toHaveBeenCalledTimes(attempt + 1);
        const [retry, options] = send.mock.calls[attempt] as [AlUmmahMessage, { delaySeconds: number }];
        expect(options).toEqual({ delaySeconds: delay });
        expect(retry.payload).toEqual({ recipients: [], notificationKey: 'newVideo', params: { title: 'Lecture' }, actionUrl: '/watch/v1', devices: [{ installId: 'i-busy', notificationId: 'n-a' }], attempt: attempt + 1 });
        expect(JSON.stringify(retry)).not.toMatch(/"userId"/);
        provider.sent = [];
        expect((await p.processMessage(retry, e)).success).toBe(true);
        expect(provider.sent.map((s) => [s.target.installId, s.message.notificationId])).toEqual([['i-busy', 'n-a']]);
        current = retry;
      }
      expect(send).toHaveBeenCalledTimes(PUSH_RETRY_DELAYS_SECONDS.length);
      expect(dlq).toHaveBeenCalledTimes(1);
      const dead = dlq.mock.calls[0][0] as AlUmmahMessage;
      expect(dead.type).toBe(MessageType.PushDispatch);
      expect(dead.id).toBe(`${current.id}-dlq`);
      expect(dead.failureReason).toBe('Push not delivered to 1 device(s) after 4 attempt(s): webpush 503 busy');
      // A Replay from the Errors page starts the retries over
      expect((dead.payload as unknown as PushDispatchPayload).attempt).toBe(0);
    });

    it('a provider that throws (network) is retried too; a hard failure is not', async () => {
      device('i-net', 'a');
      device('i-bad', 'b');
      const provider = new RecordingProvider((t) => {
        if (t.installId === 'i-net') throw new Error('connection reset');
        return { ok: false, invalidToken: false, error: '403 forbidden' };
      });
      const summary = await dispatchPush(db, payload(['a', 'b']), all(provider));
      expect(summary.retry).toEqual([{ installId: 'i-net', notificationId: 'n-a' }]);
      expect(summary.failed).toBe(2);
      expect(summary.retryErrors.apns).toContain('connection reset');
    });

    it('a retry skips installs that were removed or now belong to the Admin app', async () => {
      device('i-admin', 'a', { app: 'admin' });
      const provider = new RecordingProvider();
      const summary = await dispatchPush(db, { recipients: [], notificationKey: 'newVideo', devices: [{ installId: 'i-admin', notificationId: 'n' }, { installId: 'i-missing', notificationId: 'n' }], attempt: 1 }, all(provider));
      expect(summary.devices).toBe(0);
      expect(provider.sent).toEqual([]);
    });

    it('rejects a malformed PushDispatch so it lands in the DLQ', async () => {
      const p = new MessageProcessor(createLogger('push-test', { logLevel: 'error' }), all(new RecordingProvider()));
      const result = await p.processMessage(message(MessageType.PushDispatch, { recipients: 'nope' }), env(jest.fn()));
      expect(result.success).toBe(false);
    });

    it('wires processPushDispatch to the quietHours switch (off, on, FEATURES_FORCE_OFF, and broken SEARCH_DB fallback)', async () => {
      device('i-qh', 'qh-user');
      // Full-day window 00:00 (0) – 23:59 (1439) UTC + wrapping minute 1439..1 so any Date.now() is inside quiet hours
      db.raw
        .prepare(
          `INSERT INTO notification_quiet_hours (user_id, enabled, timezone, start_minute, end_minute, prayer_quiet_enabled, prayer_windows_json, prayer_windows_updated_at, updated_at)
           VALUES ('qh-user', 1, 'UTC', 0, 1439, 1, '[{"startMinute":1438,"endMinute":2}]', ?, 0)`,
        )
        .run(Date.now());

      const searchDb = createSqliteD1();
      searchDb.raw.exec(
        'CREATE TABLE feature_switches (key TEXT PRIMARY KEY, enabled INTEGER NOT NULL, version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)',
      );
      forgetFeatureSwitches();

      const provider = new RecordingProvider();
      const p = new MessageProcessor(createLogger('push-test', { logLevel: 'error' }), all(provider));

      // 1. Unbound SEARCH_DB -> fail closed (quietHours treated as off -> delivers)
      expect((await p.processMessage(message(MessageType.PushDispatch, payload(['qh-user'], 'newVideo')), env(jest.fn()))).success).toBe(true);
      expect(provider.sent).toHaveLength(1);

      // 2. SEARCH_DB bound with default switch off (no row) -> delivers
      provider.sent = [];
      forgetFeatureSwitches();
      expect(
        (
          await p.processMessage(message(MessageType.PushDispatch, payload(['qh-user'], 'newVideo')), {
            ...env(jest.fn()),
            SEARCH_DB: searchDb,
          })
        ).success,
      ).toBe(true);
      expect(provider.sent).toHaveLength(1);

      // 3. Switch turned ON in SEARCH_DB -> suppresses optional push, while accountWarning still delivers
      searchDb.raw
        .prepare("INSERT INTO feature_switches (key, enabled, version, updated_by, updated_at) VALUES ('quietHours', 1, 1, 'admin', '2026-11-23T00:00:00Z')")
        .run();
      forgetFeatureSwitches();
      provider.sent = [];
      expect(
        (
          await p.processMessage(message(MessageType.PushDispatch, payload(['qh-user'], 'newVideo')), {
            ...env(jest.fn()),
            SEARCH_DB: searchDb,
          })
        ).success,
      ).toBe(true);
      expect(provider.sent).toHaveLength(0);

      expect(
        (
          await p.processMessage(message(MessageType.PushDispatch, payload(['qh-user'], 'accountWarning')), {
            ...env(jest.fn()),
            SEARCH_DB: searchDb,
          })
        ).success,
      ).toBe(true);
      expect(provider.sent).toHaveLength(1);

      // 4. FEATURES_FORCE_OFF overrides SEARCH_DB row -> delivers
      provider.sent = [];
      forgetFeatureSwitches();
      expect(
        (
          await p.processMessage(message(MessageType.PushDispatch, payload(['qh-user'], 'newVideo')), {
            ...env(jest.fn()),
            SEARCH_DB: searchDb,
            FEATURES_FORCE_OFF: 'quietHours',
          })
        ).success,
      ).toBe(true);
      expect(provider.sent).toHaveLength(1);

      // 5. Broken SEARCH_DB (featureGate throws) -> treats quietHours as off and still delivers push
      provider.sent = [];
      forgetFeatureSwitches();
      const brokenSearchDb = {
        prepare() {
          throw new Error('D1 transient failure');
        },
        batch: async () => [],
      } as unknown as D1Database;
      expect(
        (
          await p.processMessage(message(MessageType.PushDispatch, payload(['qh-user'], 'newVideo')), {
            ...env(jest.fn()),
            SEARCH_DB: brokenSearchDb,
          })
        ).success,
      ).toBe(true);
      expect(provider.sent).toHaveLength(1);
      forgetFeatureSwitches();
    });
  });
});
