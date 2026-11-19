/**
 * #1633: a subscribe or unsubscribe message brings the channel's indexed subscriber count (Explore,
 * search, suggestions) and popularity in line with the live D1 count.
 */
import { join } from 'path';
import { createLogger } from '@al-ummah/logger';
import { channelPopularity, syncSearchDocument, type SearchDb } from '@al-ummah/shared-types';
import { MessageProcessor } from '../messageProcessor';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { createSqliteD1 } from './sqlite-d1';

const SEARCH_MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'api-videos', 'migrations', 'search');

function setup() {
  const notifications = createSqliteD1();
  const search = createSqliteD1(SEARCH_MIGRATIONS_DIR);
  const env = {
    MESSAGE_QUEUE: { send: jest.fn().mockResolvedValue(undefined) },
    DLQ: { send: jest.fn().mockResolvedValue(undefined) },
    MESSAGES_BUCKET: { put: jest.fn().mockResolvedValue(undefined) },
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'debug',
    NOTIFICATIONS_DB: notifications,
    SEARCH_DB: search,
  } as unknown as QueueEnvironment;
  return { env, notifications, search };
}

const indexed = (search: ReturnType<typeof createSqliteD1>, id: string) => {
  const row = search.raw.prepare('SELECT payload, popularity FROM search_channels WHERE id = ?').get(id) as { payload: string; popularity: number };
  return { subscribersCount: JSON.parse(row.payload).subscribersCount, popularity: Number(row.popularity) };
};

const message = (type: MessageType, channelId: string): AlUmmahMessage => ({
  id: `m-${type}-${channelId}`,
  type,
  timestamp: new Date().toISOString(),
  payload: { userId: 'u1', targetChannelId: channelId },
});

describe('subscriber counts in the search index (#1633)', () => {
  it('a Subscribe and then an Unsubscribe message move the indexed count with the live one', async () => {
    const { env, notifications, search } = setup();
    // Indexed when created: the R2 object's frozen count (0), 4 videos
    await syncSearchDocument(search as unknown as SearchDb, 'channel', 'ch1', { id: 'ch1', name: 'Seerah Notes', subscribers: [], videosCount: 4 }, { now: Date.now() });
    const processor = new MessageProcessor(createLogger('processor-test', { logLevel: 'warn' }));

    notifications.raw.prepare('INSERT INTO channel_subscriber_counts (channel_id, subscribers) VALUES (?, ?)').run('ch1', 2);
    expect((await processor.processMessage(message(MessageType.Subscribe, 'ch1'), env)).success).toBe(true);
    expect(indexed(search, 'ch1')).toEqual({ subscribersCount: 2, popularity: channelPopularity(2, 4) });

    notifications.raw.prepare('UPDATE channel_subscriber_counts SET subscribers = 1 WHERE channel_id = ?').run('ch1');
    expect((await processor.processMessage(message(MessageType.Unsubscribe, 'ch1'), env)).success).toBe(true);
    expect(indexed(search, 'ch1').subscribersCount).toBe(1);
  });

  it('a channel that is not indexed yet, or has no live row, is left alone', async () => {
    const { env } = setup();
    const processor = new MessageProcessor(createLogger('processor-test', { logLevel: 'warn' }));
    expect((await processor.processMessage(message(MessageType.Subscribe, 'not-indexed'), env)).success).toBe(true);
  });
});
