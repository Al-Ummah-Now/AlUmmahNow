import { resolveNotificationText } from '../notification-text';
import { EN_TRANSLATIONS, AR_TRANSLATIONS } from '@/lib/i18n/translations';
import { WebSocketManager } from '../WebSocketManager';
import type { NotificationEvent } from '@/interfaces/websocket';

jest.mock('@/lib/logger-client', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('resolveNotificationText', () => {
  const base: NotificationEvent = {
    type: 'notification',
    notificationId: 'n1',
    userId: 'u1',
    notificationType: 'comment',
  };

  it('renders keyed notifications in English with params', () => {
    const text = resolveNotificationText(
      { ...base, notificationKey: 'newComment', params: { videoTitle: 'Tafsir' } },
      EN_TRANSLATIONS
    );
    expect(text).toEqual({ title: 'New Comment', message: 'Someone commented on your video “Tafsir”' });
  });

  it('renders keyed notifications in Arabic', () => {
    const text = resolveNotificationText(
      { ...base, notificationType: 'subscription', notificationKey: 'newSubscriber', params: { channelName: 'قناة' } },
      AR_TRANSLATIONS
    );
    expect(text.title).toBe(AR_TRANSLATIONS.notifications.realtime.newSubscriberTitle);
    expect(text.message).toContain('قناة');
  });

  it("names the channel in the viewer's language (channelName_<lang>), else the default name", () => {
    const params = { channelName: 'Al Ummah Now', channelName_en: 'Al Ummah Now', channelName_ar: 'الأمة الآن', videoTitle: 'V' };
    const event = { ...base, notificationType: 'upload' as const, notificationKey: 'newVideo' as const, params };
    expect(resolveNotificationText(event, AR_TRANSLATIONS, 'ar').message).toContain('الأمة الآن');
    expect(resolveNotificationText(event, AR_TRANSLATIONS, 'ar').message).not.toContain('Al Ummah Now');
    expect(resolveNotificationText(event, EN_TRANSLATIONS, 'en').message).toContain('Al Ummah Now');
    // An older notification without per-language names keeps its name
    const old = { ...event, params: { channelName: 'Al Ummah Now', videoTitle: 'V' } };
    expect(resolveNotificationText(old, AR_TRANSLATIONS, 'ar').message).toContain('Al Ummah Now');
  });

  it('falls back to legacy text or the per-type label', () => {
    expect(resolveNotificationText({ ...base, title: 'T', message: 'M' }, EN_TRANSLATIONS)).toEqual({ title: 'T', message: 'M' });
    expect(resolveNotificationText({ ...base, notificationType: 'upload' }, EN_TRANSLATIONS).title)
      .toBe(EN_TRANSLATIONS.notifications.uploadNotification);
  });
});

describe('WebSocketManager routing', () => {
  function deliver(manager: WebSocketManager, message: unknown) {
    (manager as unknown as { handleMessage: (m: unknown) => void }).handleMessage(message);
  }

  it('routes server broadcasts by their explicit channel', () => {
    const manager = new WebSocketManager({ url: 'wss://example/ws', reconnectInterval: 1000, maxReconnectAttempts: 1, heartbeatInterval: 30000 });
    const onLive = jest.fn();
    const onVideo = jest.fn();
    manager.subscribe('live-streams', onLive);
    manager.subscribe('video:v1', onVideo);

    deliver(manager, {
      type: 'live_stream_updated',
      channel: 'live-streams',
      timestamp: 1,
      data: { type: 'live_stream_updated', liveStreamId: 'l1', status: 'live' },
    });
    deliver(manager, {
      type: 'view_count_updated',
      channel: 'video:v1',
      timestamp: 2,
      data: { type: 'view_count_updated', videoId: 'v1', viewCount: 7 },
    });

    expect(onLive).toHaveBeenCalledWith(expect.objectContaining({ liveStreamId: 'l1' }));
    expect(onLive).toHaveBeenCalledTimes(1);
    expect(onVideo).toHaveBeenCalledWith(expect.objectContaining({ viewCount: 7 }));
    expect(onVideo).toHaveBeenCalledTimes(1);
  });

  it('delivers notifications once to each subscriber', () => {
    const manager = new WebSocketManager({ url: 'wss://example/ws', reconnectInterval: 1000, maxReconnectAttempts: 1, heartbeatInterval: 30000 });
    const onUser = jest.fn();
    manager.subscribe('user:u1', onUser);
    deliver(manager, {
      type: 'notification',
      channel: 'user:u1',
      timestamp: 1,
      data: { type: 'notification', notificationId: 'n1', userId: 'u1', notificationType: 'comment', notificationKey: 'newComment' },
    });
    expect(onUser).toHaveBeenCalledTimes(1);
  });
});

describe('WebSocketManager subscriptions', () => {
  function attachSocket(manager: WebSocketManager) {
    const sent: Array<Record<string, unknown>> = [];
    const ws = { readyState: WebSocket.OPEN, send: (raw: string) => sent.push(JSON.parse(raw)) };
    (manager as unknown as { ws: unknown }).ws = ws;
    return sent;
  }
  function deliver(manager: WebSocketManager, message: unknown) {
    (manager as unknown as { handleMessage: (m: unknown) => void }).handleMessage(message);
  }
  const subscribes = (sent: Array<Record<string, unknown>>) => sent.filter(m => m.type === 'subscribe');

  it('holds subscriptions made before authentication and sends them once authenticated', () => {
    const manager = new WebSocketManager({ url: 'wss://example/ws', reconnectInterval: 1000, maxReconnectAttempts: 1, heartbeatInterval: 30000 });
    const sent = attachSocket(manager);
    manager.subscribe('video:v1', jest.fn());
    expect(subscribes(sent)).toHaveLength(0);

    deliver(manager, { type: 'authenticated', data: { userId: 'u1' } });
    // The server schema reads `channel` from the top level of the frame
    expect(subscribes(sent)).toEqual([expect.objectContaining({ type: 'subscribe', channel: 'video:v1' })]);
  });

  it('signed-out sockets join video feeds after the server acknowledges them (#301)', () => {
    const manager = new WebSocketManager({ url: 'wss://example/ws', reconnectInterval: 1000, maxReconnectAttempts: 1, heartbeatInterval: 30000 });
    const sent = attachSocket(manager);
    manager.subscribe('video:v1', jest.fn());
    manager.subscribe('notifications', jest.fn());
    expect(subscribes(sent)).toHaveLength(0);

    deliver(manager, { type: 'connection_acknowledged' });
    expect(subscribes(sent).map(m => m.channel)).toEqual(['video:v1']);

    manager.subscribe('video:v2', jest.fn());
    manager.subscribe('channel:c1', jest.fn());
    expect(subscribes(sent).map(m => m.channel)).toEqual(['video:v1', 'video:v2']);
  });

  it('a socket with a token waits for authentication even after the acknowledgement', () => {
    const manager = new WebSocketManager({ url: 'wss://example/ws', reconnectInterval: 1000, maxReconnectAttempts: 1, heartbeatInterval: 30000, getAuthToken: async () => 'token' });
    const sent = attachSocket(manager);
    manager.subscribe('video:v1', jest.fn());
    deliver(manager, { type: 'connection_acknowledged' });
    expect(subscribes(sent)).toHaveLength(0);
  });

  it('sends new subscriptions immediately once authenticated and resubscribes after re-auth', () => {
    const manager = new WebSocketManager({ url: 'wss://example/ws', reconnectInterval: 1000, maxReconnectAttempts: 1, heartbeatInterval: 30000 });
    const sent = attachSocket(manager);
    deliver(manager, { type: 'authenticated', data: { userId: 'u1' } });
    manager.subscribe('channel:c1', jest.fn());
    expect(subscribes(sent).map(m => m.channel)).toEqual(['channel:c1']);

    deliver(manager, { type: 'authenticated', data: { userId: 'u1' } });
    expect(subscribes(sent).map(m => m.channel)).toEqual(['channel:c1', 'channel:c1']);
  });

  describe('live chats (wiki E17 §5.3)', () => {
    const make = (config = {}) => new WebSocketManager({ url: 'wss://example/ws', reconnectInterval: 1000, maxReconnectAttempts: 1, heartbeatInterval: 30000, ...config });

    it('signed-out sockets join and leave a public live chat, and its subscribers learn when it is confirmed', () => {
      const manager = make();
      const sent = attachSocket(manager);
      const onFrame = jest.fn();
      const onVideo = jest.fn();
      const off = manager.subscribe('live:s1', onFrame);
      manager.subscribe('video:v1', onVideo);
      deliver(manager, { type: 'connection_acknowledged' });
      expect(subscribes(sent).map((m) => m.channel)).toEqual(['live:s1', 'video:v1']);
      expect(onFrame).not.toHaveBeenCalled();
      deliver(manager, { type: 'subscribed', channel: 'live:s1' });
      deliver(manager, { type: 'subscribed', channel: 'video:v1' });
      expect(onFrame.mock.calls).toEqual([[{ type: 'realtime_joined' }]]);
      expect(onVideo).not.toHaveBeenCalled();
      off();
      expect(sent.filter((m) => m.type === 'unsubscribe').map((m) => m.channel)).toEqual(['live:s1']);
    });

    it('a closed chat and a change of what this person may see are asked for again', () => {
      const manager = make();
      const sent = attachSocket(manager);
      deliver(manager, { type: 'authenticated', data: { userId: 'u1' } });
      const onFrame = jest.fn();
      const other = jest.fn();
      manager.subscribe('live:s1', onFrame);
      manager.subscribe('live:s2', other);
      deliver(manager, { type: 'subscribed', channel: 'live:s1' });
      deliver(manager, { type: 'live_chat_closed', channel: 'live:s1', data: { type: 'live_chat_closed', streamId: 's1' } });
      expect(onFrame.mock.calls.map(([f]) => f.type)).toEqual(['realtime_joined', 'live_chat_closed', 'realtime_left']);
      expect(subscribes(sent).map((m) => m.channel)).toEqual(['live:s1', 'live:s2', 'live:s1']);
      expect(other).not.toHaveBeenCalled();
      deliver(manager, { type: 'subscribed', channel: 'live:s1' });
      deliver(manager, { type: 'access_changed', channel: 'user:u1', data: { type: 'access_changed' } });
      expect(onFrame.mock.calls.map(([f]) => f.type).slice(3)).toEqual(['realtime_joined', 'realtime_left']);
      expect(subscribes(sent).map((m) => m.channel).slice(3)).toEqual(['live:s1', 'live:s2']);
    });

    it('an expired token leaves every chat until the new one joins them again', async () => {
      const manager = make({ getAuthToken: async () => null });
      const sent = attachSocket(manager);
      deliver(manager, { type: 'authenticated', data: { userId: 'u1' } });
      const onFrame = jest.fn();
      manager.subscribe('live:s1', onFrame);
      deliver(manager, { type: 'subscribed', channel: 'live:s1' });
      deliver(manager, { type: 'error', error: 'Token expired', code: 'AUTH_EXPIRED' });
      await new Promise((r) => setTimeout(r, 0));
      // No new token: it stays left, so the page polls
      expect(onFrame.mock.calls.map(([f]) => f.type)).toEqual(['realtime_joined', 'realtime_left']);
      deliver(manager, { type: 'authenticated', data: { userId: 'u1' } });
      deliver(manager, { type: 'subscribed', channel: 'live:s1' });
      expect(onFrame.mock.calls.map(([f]) => f.type)).toEqual(['realtime_joined', 'realtime_left', 'realtime_joined']);
      expect(subscribes(sent)).toHaveLength(2);
    });

    it('a dropped socket leaves every chat; the next one confirms again', () => {
      const manager = make();
      const sockets: Array<{ onopen: () => void; onclose: (e: object) => void; readyState: number; send: () => void }> = [];
      const real = globalThis.WebSocket;
      globalThis.WebSocket = class { static OPEN = 1; readyState = 1; onopen = () => undefined; onclose = () => undefined; send = () => undefined; constructor() { sockets.push(this as never); } } as never;
      try {
        void manager.connect();
        sockets[0].onopen();
        const onFrame = jest.fn();
        manager.subscribe('live:s1', onFrame);
        deliver(manager, { type: 'subscribed', channel: 'live:s1' });
        sockets[0].onclose({ wasClean: true, code: 1006, reason: '' });
        expect(onFrame.mock.calls.map(([f]) => f.type)).toEqual(['realtime_joined', 'realtime_left']);
      } finally {
        globalThis.WebSocket = real;
      }
    });
  });

  describe('token expiry on an open socket (#437)', () => {
    function attachSocket(manager: WebSocketManager) {
      const sent: Array<Record<string, unknown>> = [];
      const ws = { readyState: WebSocket.OPEN, send: (raw: string) => sent.push(JSON.parse(raw)) };
      (manager as unknown as { ws: unknown }).ws = ws;
      return sent;
    }
    function deliver(manager: WebSocketManager, message: unknown) {
      (manager as unknown as { handleMessage: (m: unknown) => void }).handleMessage(message);
    }

    it('re-authenticates with a fresh token on AUTH_EXPIRED and resubscribes', async () => {
      let n = 0;
      const manager = new WebSocketManager({ url: 'wss://example/ws', reconnectInterval: 1000, maxReconnectAttempts: 1, heartbeatInterval: 30000, getAuthToken: async () => `token-${++n}` });
      const sent = attachSocket(manager);
      deliver(manager, { type: 'authenticated', data: { userId: 'u1' } });
      manager.subscribe('notifications', jest.fn());
      deliver(manager, { type: 'error', error: 'Token expired; authenticate again', code: 'AUTH_EXPIRED' });
      await new Promise((r) => setTimeout(r, 0));
      expect(sent.filter((m) => m.type === 'authenticate').map((m) => m.token)).toEqual(['token-1']);
      deliver(manager, { type: 'authenticated', data: { userId: 'u1' } });
      expect(sent.filter((m) => m.type === 'subscribe' && m.channel === 'notifications')).toHaveLength(2);
    });
  });
});
