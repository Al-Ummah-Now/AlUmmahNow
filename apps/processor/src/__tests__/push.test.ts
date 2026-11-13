/**
 * Push fan-out (Epic 9.4): stored notifications are queued in PushDispatch
 * batches; dispatch resolves devices, honours per-device categories, and
 * prunes tokens the provider rejected.
 */
import { createLogger } from '@al-ummah/logger';
import { MessageType, PUSH_DISPATCH_BATCH, type PushDispatchPayload } from '@al-ummah/shared-types';
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
    expect(summary).toEqual({ devices: 3, sent: 3, skipped: 0, failed: 0, pruned: 0 });
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
    const wns: PushProvider = { name: 'wns', send: async () => { throw new Error('network'); } };
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
      expect(send).toHaveBeenCalledTimes(1);
      const queued = send.mock.calls[0][0] as AlUmmahMessage;
      const result = await p.processMessage(queued, env(send));
      expect(result.success).toBe(true);
      expect(provider.sent.map((s) => s.target.installId).sort()).toEqual(['i-s1', 'i-s2']);
      expect(provider.sent[0].message.category).toBe('live');
    });

    it('rejects a malformed PushDispatch so it lands in the DLQ', async () => {
      const p = new MessageProcessor(createLogger('push-test', { logLevel: 'error' }), all(new RecordingProvider()));
      const result = await p.processMessage(message(MessageType.PushDispatch, { recipients: 'nope' }), env(jest.fn()));
      expect(result.success).toBe(false);
    });
  });
});
