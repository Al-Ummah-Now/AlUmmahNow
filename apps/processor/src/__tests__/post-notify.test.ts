/**
 * New community post → subscribers notified (Story 29.4, handlers/post-notify.ts): CommunityPostCreated
 * queues a `new_post` fan-out only for a post that is really live; the fan-out stores one `newPost`
 * row per subscriber (bell all or highlights, `posts` category on, author excluded), never twice.
 */
import { createLogger } from '@al-ummah/logger';
import { MessageProcessor } from '../messageProcessor';
import { notifySubscribersOfPost, postIsLiveForSubscribers } from '../handlers/post-notify';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { createSqliteD1 } from './sqlite-d1';

const log = { debug: () => undefined, warn: () => undefined };

const post = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1', channelId: 'ch', userId: 'owner', type: 'text', content: 'Jumuʿah reminder: <b>read Surat al-Kahf</b> today', status: 'published',
  visibility: 'public', createdAt: '2026-11-14T10:00:00.000Z', channelName: 'Masjid', channelNameLocalized: { en: 'Masjid', ar: 'المسجد' },
  ...overrides,
});

function bucket(stored: Record<string, unknown> | null) {
  return { get: jest.fn(async () => (stored ? { json: async () => stored } : null)) };
}

describe('postIsLiveForSubscribers', () => {
  it('only a published, visible, cleared post that is not in the future', () => {
    expect(postIsLiveForSubscribers(post() as never)).toBe(true);
    expect(postIsLiveForSubscribers(post({ visibility: 'subscribers' }) as never)).toBe(true);
    expect(postIsLiveForSubscribers(post({ status: 'scheduled' }) as never)).toBe(false);
    expect(postIsLiveForSubscribers(post({ status: 'deleted' }) as never)).toBe(false);
    expect(postIsLiveForSubscribers(post({ isHidden: true }) as never)).toBe(false);
    expect(postIsLiveForSubscribers(post({ review: { status: 'checking' } }) as never)).toBe(false);
    expect(postIsLiveForSubscribers(post({ review: { status: 'approved' } }) as never)).toBe(true);
    expect(postIsLiveForSubscribers(post({ visibility: 'members' }) as never)).toBe(false);
    expect(postIsLiveForSubscribers(post({ createdAt: '2099-01-01T00:00:00.000Z' }) as never)).toBe(false);
  });
});

describe('notifySubscribersOfPost', () => {
  it('queues one new_post fan-out with the channel names and a plain excerpt', async () => {
    const queue = { send: jest.fn(async () => undefined) };
    const outcome = await notifySubscribersOfPost({ community_posts: bucket(post()), MESSAGE_QUEUE: queue }, 'ch', 'p1', log);
    expect(outcome).toBe('queued');
    expect(queue.send).toHaveBeenCalledTimes(1);
    const message = (queue.send.mock.calls[0] as unknown as [AlUmmahMessage])[0];
    expect(message.type).toBe(MessageType.NotificationFanout);
    expect(message.payload).toEqual({
      kind: 'new_post',
      channelId: 'ch',
      entityId: 'p1',
      isHighlight: true,
      params: { channelName: 'Masjid', channelName_en: 'Masjid', channelName_ar: 'المسجد', postExcerpt: 'Jumuʿah reminder: read Surat al-Kahf today' },
      actionUrl: '/post/p1',
      actorUserId: 'owner',
    });
  });

  it('sends nothing for a scheduled or missing post', async () => {
    const queue = { send: jest.fn(async () => undefined) };
    expect(await notifySubscribersOfPost({ community_posts: bucket(post({ status: 'scheduled' })), MESSAGE_QUEUE: queue }, 'ch', 'p1', log)).toBe('not_live');
    expect(await notifySubscribersOfPost({ community_posts: bucket(null), MESSAGE_QUEUE: queue }, 'ch', 'p1', log)).toBe('missing');
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('a failed read throws so the queue retries (then DLQ and admin Errors)', async () => {
    const failing = { get: jest.fn(async () => { throw new Error('R2 unavailable'); }) };
    await expect(notifySubscribersOfPost({ community_posts: failing, MESSAGE_QUEUE: { send: jest.fn() } }, 'ch', 'p1', log)).rejects.toThrow('R2 unavailable');
  });
});

describe('CommunityPostCreated end to end', () => {
  function setup() {
    const db = createSqliteD1();
    const insert = db.raw.prepare('INSERT INTO channel_subscribers VALUES (?, ?, ?, 0, 0)');
    insert.run('ch', 'all-bell', 'all');
    insert.run('ch', 'highlights-bell', 'highlights');
    insert.run('ch', 'muted', 'none');
    insert.run('ch', 'posts-off', 'all');
    insert.run('ch', 'owner', 'all');
    db.raw.prepare("INSERT INTO notification_settings (user_id, category, enabled, updated_at) VALUES ('posts-off', 'posts', 0, 0)").run();
    const queued: AlUmmahMessage[] = [];
    const queue = {
      send: jest.fn(async (m: AlUmmahMessage) => { queued.push(m); }),
      sendBatch: jest.fn(async () => undefined),
    };
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 }) as Response) as unknown as typeof fetch;
    const env = {
      MESSAGE_QUEUE: queue,
      MESSAGES_BUCKET: { put: jest.fn(), get: jest.fn().mockResolvedValue(null), list: jest.fn() },
      community_posts: bucket(post()),
      NOTIFICATIONS_DB: db,
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
      WEBSOCKET_URL: 'https://ws.example',
      INTERNAL_API_KEY: 'secret',
    } as unknown as QueueEnvironment;
    return { db, env, queued, processor: new MessageProcessor(createLogger('post-notify-test', { logLevel: 'error' })) };
  }

  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('notifies all and highlights bells with the posts category on, never the author; a repeat adds nothing', async () => {
    const t = setup();
    const created: AlUmmahMessage = { id: 'c1', type: MessageType.CommunityPostCreated, timestamp: Date.now(), payload: { postId: 'p1', channelId: 'ch', actor: { userId: 'owner' } } };
    expect((await t.processor.processMessage(created, t.env)).success).toBe(true);
    // The repeat (at-least-once delivery, or a cron and a Publish now racing) queues again; the store de-duplicates
    expect((await t.processor.processMessage({ ...created, id: 'c2' }, t.env)).success).toBe(true);
    const fanouts = t.queued.filter((m) => m.type === MessageType.NotificationFanout);
    expect(fanouts).toHaveLength(2);
    for (const m of fanouts) expect((await t.processor.processMessage(m, t.env)).success).toBe(true);

    const rows = t.db.raw.prepare("SELECT user_id, category, notification_key, action_url FROM notifications WHERE dedupe_key = 'post:p1' ORDER BY user_id").all();
    expect(rows).toEqual([
      { user_id: 'all-bell', category: 'posts', notification_key: 'newPost', action_url: '/post/p1' },
      { user_id: 'highlights-bell', category: 'posts', notification_key: 'newPost', action_url: '/post/p1' },
    ]);
  });
});
