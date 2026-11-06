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
    expect(text).toEqual({ title: 'New Comment', message: 'Someone commented on your video "Tafsir"' });
  });

  it('renders keyed notifications in Arabic', () => {
    const text = resolveNotificationText(
      { ...base, notificationType: 'subscription', notificationKey: 'newSubscriber', params: { channelName: 'قناة' } },
      AR_TRANSLATIONS
    );
    expect(text.title).toBe(AR_TRANSLATIONS.notifications.realtime.newSubscriberTitle);
    expect(text.message).toContain('قناة');
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
