/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fake browser and worker globals */
/**
 * The Web Push service worker (#1287): the generated /push-sw.js run in a sandbox with a fake
 * worker scope. It renders pushes with the notification center's en/ar templates and opens
 * the localised page on click.
 */
import vm from 'node:vm';
import { pushServiceWorkerSource } from '../service-worker';
import { AR_TRANSLATIONS, EN_TRANSLATIONS } from '@/lib/i18n/translations';
import { resolveNotificationText } from '@/lib/websocket/notification-text';
import type { NotificationEvent } from '@/interfaces/websocket';

type Listener = (event: any) => void;

function boot(language = 'en-US') {
  const listeners: Record<string, Listener> = {};
  const shown: Array<{ title: string; options: any }> = [];
  const closed: string[] = [];
  const opened: string[] = [];
  const windows: any[] = [];
  const self: any = {
    location: { origin: 'https://alummahnow.net' },
    navigator: { language },
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
    skipWaiting: jest.fn(),
    registration: {
      showNotification: async (title: string, options: any) => void shown.push({ title, options }),
      getNotifications: async ({ tag }: { tag: string }) => [{ close: () => closed.push(tag) }],
    },
    clients: {
      claim: jest.fn(),
      matchAll: async () => windows,
      openWindow: async (url: string) => void opened.push(url),
    },
  };
  vm.runInNewContext(pushServiceWorkerSource(), { self, URL, String, Object, JSON });
  const dispatch = async (type: string, event: any) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  const push = (data: unknown) => dispatch('push', { data: data === undefined ? null : { json: () => (typeof data === 'string' ? JSON.parse(data) : data) } });
  return { listeners, shown, closed, opened, windows, push, dispatch };
}

const event = (key: NotificationEvent['notificationKey'], params: Record<string, string | number>): NotificationEvent => ({ type: 'notification', notificationId: '', userId: '', notificationKey: key, notificationType: 'system', params });

describe('push service worker', () => {
  it('shows a notification exactly as the notification center renders it, in the device language', async () => {
    const sw = boot();
    const params = { channelName: 'Channel', channelName_ar: 'القناة', videoTitle: 'Title' };
    await sw.push({ kind: 'notification', notificationId: 'n1', key: 'newVideo', lang: 'ar', params, url: '/video/v1' });
    await sw.push({ kind: 'notification', notificationId: 'n2', key: 'newVideo', lang: 'en', params, url: '/video/v1' });
    const ar = resolveNotificationText(event('newVideo', params), AR_TRANSLATIONS, 'ar');
    const en = resolveNotificationText(event('newVideo', params), EN_TRANSLATIONS, 'en');
    expect(sw.shown[0]).toMatchObject({ title: ar.title, options: { body: ar.message, lang: 'ar', dir: 'rtl', tag: 'n:n1', data: { url: '/ar/video/v1' } } });
    expect(`${sw.shown[0]!.title} ${sw.shown[0]!.options.body}`).toContain('القناة');
    expect(sw.shown[1]).toMatchObject({ title: en.title, options: { body: en.message, lang: 'en', dir: 'ltr', data: { url: '/en/video/v1' } } });
  });

  it('every key renders like the center: upload results and warnings with their reason', async () => {
    const sw = boot();
    const cases: Array<[NotificationEvent['notificationKey'], Record<string, string | number>]> = [
      ['uploadReady', { videoTitle: 'T' }],
      ['uploadFailed', { videoTitle: 'T' }],
      ['accountWarning', { reason: 'spam', count: 2 }],
      ['accountWarning', { reason: 'unknown-code', count: 1 }],
      ['commentReply', { actorName: 'A', videoTitle: 'T' }],
      ['reviewRejected', { videoTitle: 'T', reason: 'x' }],
      // A name can't end its isolate or break the line
      ['channelMoveOffered', { owner: '\u202eAmina\u2069\r\nx', channel: 'Corner\u2067\u2029\u0085', channel_ar: '\u2066الركن' }],
    ];
    for (const [lang, t] of [['en', EN_TRANSLATIONS], ['ar', AR_TRANSLATIONS]] as const) {
      for (const [key, params] of cases) {
        sw.shown.length = 0;
        await sw.push({ kind: 'notification', notificationId: 'n', key, lang, params });
        const expected = resolveNotificationText(event(key, params), t, lang);
        if (key === 'channelMoveOffered') expect(expected.message.match(/[\u202a-\u202e\u2066-\u2069\n\r\u2029\u0085]/g)!.join('')).toBe('\u2068\u2069\u2068\u2069');
        expect({ key, lang, title: sw.shown[0]!.title, body: sw.shown[0]!.options.body }).toEqual({ key, lang, title: expected.title, body: expected.message });
      }
    }
  });

  it('a push without params or with an unknown key still shows the generic line', async () => {
    const sw = boot('ar-EG');
    await sw.push({ kind: 'notification', notificationId: 'n', key: 'somethingNew', lang: 'en' });
    await sw.push(undefined);
    expect(sw.shown[0]!.title).toBe(EN_TRANSLATIONS.notifications.systemNotification);
    expect(sw.shown[1]).toMatchObject({ title: AR_TRANSLATIONS.notifications.systemNotification, options: { dir: 'rtl', data: { url: '/ar/notifications' } } });
  });

  it('review alerts show as sent and stay until handled; a clear closes them', async () => {
    const sw = boot();
    await sw.push({ kind: 'review_alert', reviewId: 'rev-1', title: 'Review queue', body: 'Video held for review', url: '/moderation/review/rev-1' });
    expect(sw.shown[0]).toMatchObject({ title: 'Review queue', options: { body: 'Video held for review', tag: 'review:rev-1', requireInteraction: true } });
    await sw.push({ kind: 'review_clear', reviewId: 'rev-1' });
    expect(sw.closed).toEqual(['review:rev-1']);
    expect(sw.shown).toHaveLength(1);
  });

  it('a click focuses an open tab on that page, else navigates an open tab, else opens one', async () => {
    const sw = boot();
    const notification = (url: string) => ({ close: jest.fn(), data: { url } });
    await sw.dispatch('notificationclick', { notification: notification('/ar/video/v1') });
    expect(sw.opened).toEqual(['https://alummahnow.net/ar/video/v1']);

    const tab = { url: 'https://alummahnow.net/ar', focus: jest.fn(), navigate: jest.fn() };
    sw.windows.push(tab);
    await sw.dispatch('notificationclick', { notification: notification('/ar/video/v1') });
    expect(tab.focus).toHaveBeenCalled();
    expect(tab.navigate).toHaveBeenCalledWith('https://alummahnow.net/ar/video/v1');

    const exact = { url: 'https://alummahnow.net/ar/video/v2', focus: jest.fn(), navigate: jest.fn() };
    sw.windows.unshift(exact);
    await sw.dispatch('notificationclick', { notification: notification('/ar/video/v2') });
    expect(exact.focus).toHaveBeenCalled();
    expect(exact.navigate).not.toHaveBeenCalled();
  });

  it('never opens another site from a push (only same-origin paths)', async () => {
    const sw = boot();
    await sw.push({ kind: 'notification', notificationId: 'n', key: 'newVideo', lang: 'en', url: '//evil.example/x' });
    await sw.push({ kind: 'notification', notificationId: 'n', key: 'newVideo', lang: 'en', url: 'https://evil.example/x' });
    expect(sw.shown.map((s) => s.options.data.url)).toEqual(['/en/notifications', '/en/notifications']);
  });
});
