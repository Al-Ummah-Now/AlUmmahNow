/**
 * Rendering helpers for stored notifications (Story 29.10). Notifications
 * carry a translation key + params; text is produced here in the viewer's
 * language, never on the server.
 */

import type { NotificationItem } from '@al-ummah/shared-types';
import type { AppTranslations } from '@/lib/i18n/types';
import type { NotificationEvent, RealtimeNotificationKey } from '@/interfaces/websocket';
import { resolveNotificationText } from '@/lib/websocket/notification-text';
import { fillTemplate } from '@/lib/i18n/translations/library-notifications';

export const NOTIFICATION_CENTER_KEYS: readonly RealtimeNotificationKey[] = [
  'newVideo',
  'liveStarted',
  'commentReply',
  'newComment',
  'newSubscriber',
  'uploadReady',
  'uploadFailed',
];

export function isCenterKey(key: unknown): key is RealtimeNotificationKey {
  return typeof key === 'string' && (NOTIFICATION_CENTER_KEYS as readonly string[]).includes(key);
}

export function renderNotification(item: Pick<NotificationItem, 'notificationKey' | 'notificationType' | 'params'>, t: AppTranslations) {
  const event: NotificationEvent = {
    type: 'notification',
    notificationId: '',
    userId: '',
    notificationKey: item.notificationKey as RealtimeNotificationKey,
    notificationType: item.notificationType,
    params: item.params,
  };
  return resolveNotificationText(event, t);
}

/** Short relative time ("5 min ago") in the viewer's language. */
export function relativeTime(iso: string, t: AppTranslations, locale: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor((now - time) / 60000);
  const texts = t.notificationCenter;
  if (minutes < 1) return texts.justNow;
  if (minutes < 60) return fillTemplate(texts.minutesAgo, { count: minutes.toLocaleString(locale) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fillTemplate(texts.hoursAgo, { count: hours.toLocaleString(locale) });
  const days = Math.floor(hours / 24);
  if (days < 30) return fillTemplate(texts.daysAgo, { count: days.toLocaleString(locale) });
  return new Date(time).toLocaleDateString(locale);
}

/** Server action URLs are locale-less ("/video/123"); prefix the viewer's locale. */
export function localizeActionUrl(url: string | null | undefined, lang: string): string | null {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return null;
  if (/^\/(en|ar)(\/|$|\?)/.test(url)) return url;
  return `/${lang}${url}`;
}

/** Same-tab signal so the header badge follows changes made on the notifications page. */
export const UNREAD_EVENT = 'aun:notifications-unread';

export function publishUnreadCount(count: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: { count } }));
}
