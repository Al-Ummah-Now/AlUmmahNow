import { createLogger } from '@al-ummah/logger';
import { MessageProcessor } from '../messageProcessor';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { broadcast, buildRealtimeMessage, getApiKey } from '../lib/websocket-notify';

describe('realtime notifications', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function env(overrides: Partial<QueueEnvironment> = {}): QueueEnvironment {
    return {
      MESSAGE_QUEUE: { send: jest.fn() },
      MESSAGES_BUCKET: { put: jest.fn(), get: jest.fn().mockResolvedValue(null), list: jest.fn() },
      community_posts: { put: jest.fn(), get: jest.fn(), list: jest.fn() },
      REPORTS_DB: {} as QueueEnvironment['REPORTS_DB'],
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
      WEBSOCKET_URL: 'https://ws.example',
      INTERNAL_API_KEY: { get: async () => 'secret' },
      ...overrides,
    };
  }

  function sentBodies(): Array<{ channel: string; message: { type: string; channel: string; data: Record<string, unknown> } }> {
    return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
  }

  it('resolves secrets store, text and plain string keys', async () => {
    expect(await getApiKey('plain')).toBe('plain');
    expect(await getApiKey({ get: async () => 'a' })).toBe('a');
    expect(await getApiKey({ text: async () => 'b' })).toBe('b');
    expect(await getApiKey(undefined)).toBe('');
  });

  it('repeats the type inside data for subscription callbacks', () => {
    const message = buildRealtimeMessage('video:v1', 'view_count_updated', { videoId: 'v1', views: 3 });
    expect(message).toMatchObject({ type: 'view_count_updated', channel: 'video:v1', data: { type: 'view_count_updated', videoId: 'v1', views: 3 } });
  });

  it('posts to /broadcast with the API key header', async () => {
    await broadcast(env(), 'live-streams', 'live_stream_updated', { liveStreamId: 'l1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ws.example/broadcast');
    expect((init as RequestInit).headers).toMatchObject({ 'X-API-Key': 'secret' });
  });

  it('skips broadcasting when realtime is not configured', async () => {
    expect(await broadcast(env({ WEBSOCKET_URL: undefined }), 'live-streams', 'x', {})).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pushes upload completion to the video channel and the uploader', async () => {
    const processor = new MessageProcessor(createLogger('processor-test', { logLevel: 'error' }));
    const message: AlUmmahMessage = {
      id: 'm1',
      type: MessageType.VideoProcessingCompleted,
      timestamp: Date.now(),
      payload: { videoId: 'v1', userId: 'u1', title: 'Tafsir' },
    };
    const result = await processor.processMessage(message, env());
    expect(result.success).toBe(true);

    const bodies = sentBodies();
    expect(bodies.map(b => b.channel).sort()).toEqual(['user:u1', 'user:u1', 'video:v1']);
    const notification = bodies.find(b => b.message.type === 'notification')!;
    expect(notification.message.data).toMatchObject({
      type: 'notification',
      notificationType: 'upload',
      notificationKey: 'uploadReady',
      params: { videoTitle: 'Tafsir' },
      userId: 'u1',
    });
  });

  it('pushes live stream status changes on the live-streams channel', async () => {
    const processor = new MessageProcessor(createLogger('processor-test', { logLevel: 'error' }));
    const result = await processor.processMessage({
      id: 'm2',
      type: MessageType.LiveStreamUpdate,
      timestamp: Date.now(),
      payload: { liveStreamId: 'l1', channelId: 'c1', status: 'live' },
    }, env());
    expect(result.success).toBe(true);
    const channels = sentBodies().map(b => b.channel).sort();
    expect(channels).toEqual(['channel:c1', 'live-streams']);
    expect(sentBodies()[0].message.data).toMatchObject({ liveStreamId: 'l1', status: 'live', event: 'updated' });
  });

  it('treats search telemetry sent as VideoView as a no-op instead of failing', async () => {
    const processor = new MessageProcessor(createLogger('processor-test', { logLevel: 'error' }));
    const result = await processor.processMessage({
      id: 'm3',
      type: MessageType.VideoView,
      timestamp: Date.now(),
      payload: { searchQuery: 'quran', totalResults: 3 },
    }, env());
    expect(result.success).toBe(true);
  });
});
