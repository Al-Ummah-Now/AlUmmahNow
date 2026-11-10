import { createLogger } from '@al-ummah/logger';
import { MessageProcessor } from '../messageProcessor';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { runScheduled } from '../index';
import { bellLevelsFor, fanoutNotification, insertNotification, purgeExpiredNotifications } from '../lib/notifications-store';
import { createSqliteD1 } from './sqlite-d1';

const DAY = 24 * 60 * 60 * 1000;

describe('notification center (processor)', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let db: ReturnType<typeof createSqliteD1>;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
    db = createSqliteD1();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function env(overrides: Partial<QueueEnvironment> = {}): QueueEnvironment {
    return {
      MESSAGE_QUEUE: { send: jest.fn() },
      MESSAGES_BUCKET: { put: jest.fn(), get: jest.fn().mockResolvedValue(null), list: jest.fn() },
      community_posts: { put: jest.fn(), get: jest.fn(), list: jest.fn() },
      REPORTS_DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }), batch: async () => [] } as unknown as QueueEnvironment['REPORTS_DB'],
      NOTIFICATIONS_DB: db,
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
      WEBSOCKET_URL: 'https://ws.example',
      INTERNAL_API_KEY: 'secret',
      ...overrides,
    };
  }

  function message(type: MessageType, payload: Record<string, unknown>): AlUmmahMessage {
    return { id: `m-${Math.random()}`, type, timestamp: Date.now(), payload };
  }

  const processor = () => new MessageProcessor(createLogger('processor-test', { logLevel: 'error' }));

  function rows(sql: string, ...params: unknown[]) {
    return db.raw.prepare(sql).all(...params).map((r) => ({ ...r }));
  }

  function pushedTo(): string[] {
    return fetchMock.mock.calls
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
      // A body is one event or a batch of them ({ items })
      .flatMap((b) => (Array.isArray(b.items) ? b.items : [b]))
      .filter((b) => b.message.type === 'notification')
      .map((b) => b.channel);
  }

  it('maintains the subscriber index from Subscribe/Unsubscribe events with the default bell', async () => {
    const p = processor();
    await p.processMessage(message(MessageType.Subscribe, { targetChannelId: 'ch1', subscriberChannelId: 'mine', userId: 'u1' }), env());
    await p.processMessage(message(MessageType.Subscribe, { targetChannelId: 'ch1', subscriberChannelId: 'mine', userId: 'u1' }), env());
    expect(rows('SELECT channel_id, user_id, bell FROM channel_subscribers')).toEqual([{ channel_id: 'ch1', user_id: 'u1', bell: 'highlights' }]);

    await p.processMessage(message(MessageType.Unsubscribe, { targetChannelId: 'ch1', userId: 'u1' }), env());
    expect(rows('SELECT * FROM channel_subscribers')).toEqual([]);
  });

  it('follows the stored subscriptions of an imported channel, whatever order events arrive in', async () => {
    const p = processor();
    // api-videos imported the channel; u1 subscribed, then unsubscribed (row gone)
    db.raw.prepare("INSERT INTO channel_subscription_imports VALUES ('ch1', 0, 0)").run();
    await p.processMessage(message(MessageType.Unsubscribe, { targetChannelId: 'ch1', userId: 'u1' }), env());
    // The Subscribe event arrives late: it must not bring u1 back
    await p.processMessage(message(MessageType.Subscribe, { targetChannelId: 'ch1', userId: 'u1' }), env());
    expect(rows('SELECT * FROM channel_subscribers')).toEqual([]);

    // u2 subscribed (row present); a late Unsubscribe from an earlier change must not drop them
    db.raw.prepare("INSERT INTO channel_subscriptions VALUES ('ch1', 'u2-ch', 'u2', 's2', 0)").run();
    await p.processMessage(message(MessageType.Unsubscribe, { targetChannelId: 'ch1', userId: 'u2' }), env());
    expect(rows('SELECT user_id FROM channel_subscribers')).toEqual([{ user_id: 'u2' }]);
  });

  it('erasing a user removes their subscriptions and keeps channel counts exact', async () => {
    db.raw.exec(`INSERT INTO channel_subscriptions VALUES ('a', 'gone-ch', 'gone', 's1', 0), ('a', 'x-ch', 'x', 's2', 0), ('b', 'gone-ch2', 'gone', 's3', 0);
      INSERT INTO channel_subscriber_counts VALUES ('a', 2), ('b', 1);`);
    await processor().processMessage(message(MessageType.UserDataErased, { userId: 'gone' }), env());
    expect(rows('SELECT channel_id, subscriber_channel_id FROM channel_subscriptions')).toEqual([{ channel_id: 'a', subscriber_channel_id: 'x-ch' }]);
    expect(rows('SELECT channel_id, subscribers FROM channel_subscriber_counts ORDER BY channel_id')).toEqual([
      { channel_id: 'a', subscribers: 1 },
      { channel_id: 'b', subscribers: 0 },
    ]);
  });

  it('stores a NotificationCreate once (dedupe) and pushes it with the stored id', async () => {
    const payload = {
      notificationId: 'n1',
      recipientUserId: 'owner',
      notificationKey: 'newComment',
      params: { videoTitle: 'T' },
      actionUrl: '/video/v1',
      dedupeKey: 'comment:c1',
    };
    const p = processor();
    const r1 = await p.processMessage(message(MessageType.NotificationCreate, payload), env());
    const r2 = await p.processMessage(message(MessageType.NotificationCreate, { ...payload, notificationId: 'n2' }), env());
    expect(r1.success && r2.success).toBe(true);

    const stored = rows('SELECT id, user_id, category, notification_type, notification_key, params_json, is_read FROM notifications');
    expect(stored).toEqual([
      { id: 'n1', user_id: 'owner', category: 'comments', notification_type: 'comment', notification_key: 'newComment', params_json: '{"videoTitle":"T"}', is_read: 0 },
    ]);
    expect(pushedTo()).toEqual(['user:owner']);
  });

  it('does not push again when the producer already sent the realtime event', async () => {
    await processor().processMessage(
      message(MessageType.NotificationCreate, { notificationId: 'n1', recipientUserId: 'u', notificationKey: 'newSubscriber', realtimeSent: true }),
      env(),
    );
    expect(rows('SELECT id FROM notifications')).toEqual([{ id: 'n1' }]);
    expect(pushedTo()).toEqual([]);
  });

  it('respects the per-category opt-out', async () => {
    db.raw.prepare("INSERT INTO notification_settings VALUES ('u', 'comments', 0, 0)").run();
    const stored = await insertNotification(db, { notificationId: 'x', recipientUserId: 'u', notificationKey: 'newComment' });
    expect(stored).toBeNull();
    expect(rows('SELECT * FROM notifications')).toEqual([]);
  });

  it('rejects malformed NotificationCreate without retrying', async () => {
    const result = await processor().processMessage(message(MessageType.NotificationCreate, { recipientUserId: 'u', notificationKey: 'bogus', notificationId: 'n' }), env());
    expect(result.success).toBe(false);
    expect(result.shouldRetry).toBe(false);
  });

  describe('fan-out to subscribers', () => {
    beforeEach(() => {
      const insert = db.raw.prepare('INSERT INTO channel_subscribers VALUES (?, ?, ?, 0, 0)');
      insert.run('ch1', 'all-user', 'all');
      insert.run('ch1', 'hl-user', 'highlights');
      insert.run('ch1', 'none-user', 'none');
      insert.run('ch1', 'owner', 'all');
      insert.run('ch2', 'other', 'all');
      db.raw.prepare("INSERT INTO notification_settings VALUES ('muted', 'new_videos', 0, 0)").run();
      insert.run('ch1', 'muted', 'all');
    });

    it('selects bell levels by highlight', () => {
      expect(bellLevelsFor(true)).toEqual(['all', 'highlights']);
      expect(bellLevelsFor(false)).toEqual(['all']);
    });

    it('delivers long-form uploads to all + highlights bells, excluding the uploader, none and muted users', async () => {
      await processor().processMessage(
        message(MessageType.NotificationFanout, {
          kind: 'new_video',
          channelId: 'ch1',
          entityId: 'v1',
          isHighlight: true,
          actorUserId: 'owner',
          params: { channelName: 'C', videoTitle: 'V' },
          actionUrl: '/video/v1',
        }),
        env(),
      );
      const users = rows("SELECT user_id FROM notifications WHERE notification_key = 'newVideo' ORDER BY user_id").map((r) => r.user_id);
      expect(users).toEqual(['all-user', 'hl-user']);
      expect(pushedTo().sort()).toEqual(['user:all-user', 'user:hl-user']);
    });

    it('delivers shorts only to bell = all, once per video', async () => {
      const payload = { kind: 'new_video' as const, channelId: 'ch1', entityId: 'short1', isHighlight: false, actorUserId: 'owner' };
      expect((await fanoutNotification(db, payload)).map((r) => r.user_id)).toEqual(['all-user']);
      expect(await fanoutNotification(db, payload)).toEqual([]);
    });

    it('stores live-started notifications in the live category', async () => {
      await fanoutNotification(db, { kind: 'live_started', channelId: 'ch1', entityId: 'l1', isHighlight: true, actorUserId: 'owner' });
      expect(rows("SELECT DISTINCT category, notification_key, dedupe_key FROM notifications")).toEqual([
        { category: 'live', notification_key: 'liveStarted', dedupe_key: 'live:l1' },
      ]);
    });
  });

  it('stores upload ready/failed notifications for the uploader and pushes the stored id', async () => {
    await processor().processMessage(message(MessageType.VideoProcessingCompleted, { videoId: 'v1', userId: 'up', title: 'My video' }), env());
    await processor().processMessage(message(MessageType.VideoProcessingCompleted, { videoId: 'v1', userId: 'up', title: 'My video' }), env());
    const stored = rows("SELECT id, notification_key FROM notifications WHERE user_id = 'up'");
    expect(stored).toHaveLength(1);
    expect(stored[0].notification_key).toBe('uploadReady');

    const notificationBodies = fetchMock.mock.calls
      .map(([, init]) => JSON.parse((init as RequestInit).body as string))
      .flatMap((b) => (Array.isArray(b.items) ? b.items : [b]))
      .filter((b) => b.message.type === 'notification');
    expect(notificationBodies[0].message.data.notificationId).toBe(stored[0].id);
    // the duplicate status event is not stored and therefore not pushed as a notification
    expect(notificationBodies).toHaveLength(1);
  });

  it('keeps the legacy realtime notification when no store is bound', async () => {
    await processor().processMessage(message(MessageType.VideoUploadFailed, { videoId: 'v1', userId: 'up' }), env({ NOTIFICATIONS_DB: undefined }));
    expect(pushedTo()).toEqual(['user:up']);
  });

  it('erases a user’s notification data on UserDataErased', async () => {
    await insertNotification(db, { notificationId: 'a', recipientUserId: 'gone', notificationKey: 'newSubscriber' });
    db.raw.prepare("INSERT INTO liked_videos VALUES ('gone', 'v1', 0)").run();
    const device = "INSERT INTO push_devices (install_id, user_id, platform, provider, token, created_at, updated_at) VALUES (?, ?, 'ios', 'apns', ?, 0, 0)";
    db.raw.prepare(device).run('install-gone', 'gone', 'a'.repeat(64));
    db.raw.prepare(device).run('install-kept', 'kept', 'b'.repeat(64));
    await processor().processMessage(message(MessageType.UserDataErased, { userId: 'gone' }), env());
    expect(rows('SELECT * FROM notifications')).toEqual([]);
    expect(rows('SELECT * FROM liked_videos')).toEqual([]);
    // Push tokens are personal data too (Epic 9.4)
    expect(rows('SELECT user_id FROM push_devices')).toEqual([{ user_id: 'kept' }]);
  });

  it('purges notifications older than 90 days (cron)', async () => {
    const now = Date.now();
    await insertNotification(db, { notificationId: 'old', recipientUserId: 'u', notificationKey: 'newSubscriber', createdAt: now - 91 * DAY });
    await insertNotification(db, { notificationId: 'new', recipientUserId: 'u', notificationKey: 'newSubscriber', createdAt: now - 89 * DAY });
    expect(await runScheduled(env(), now)).toBe(1);
    expect(rows('SELECT id FROM notifications')).toEqual([{ id: 'new' }]);
    expect(await purgeExpiredNotifications(db, now)).toBe(0);
    expect(await runScheduled(env({ NOTIFICATIONS_DB: undefined }), now)).toBe(0);
  });
});
