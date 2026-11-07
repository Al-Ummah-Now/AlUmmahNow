'use client';

/**
 * Header bell state (Story 29.10): unread count from the API, incremented in
 * realtime by `notification` events on the user's `user:<id>` websocket
 * channel, plus the latest notifications for the dropdown.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationItem } from '@al-ummah/shared-types';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { NotificationsService } from '@/services/api/notifications';
import { isCenterKey, publishUnreadCount, UNREAD_EVENT } from '@/lib/notifications/render';
import type { NotificationEvent } from '@/interfaces/websocket';
import { logger } from '@/lib/logger-client';

export const BELL_DROPDOWN_SIZE = 8;

export interface UseNotificationBellResult {
  unreadCount: number;
  latest: NotificationItem[];
  isLoading: boolean;
  error: boolean;
  loadLatest: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/** Turn a realtime event into a list item so the open dropdown updates too. */
export function eventToItem(event: NotificationEvent): NotificationItem | null {
  if (!isCenterKey(event.notificationKey) || !event.notificationId) return null;
  return {
    id: event.notificationId,
    category: (event.category || 'new_videos') as NotificationItem['category'],
    notificationType: event.notificationType,
    notificationKey: event.notificationKey,
    params: event.params || {},
    actionUrl: event.actionUrl ?? null,
    entityId: null,
    isRead: false,
    createdAt: new Date().toISOString(),
  };
}

export function useNotificationBell(userId: string | undefined): UseNotificationBellResult {
  const [unreadCount, setUnreadCount] = useState(0);
  const [latest, setLatest] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      setLatest([]);
      return;
    }
    let cancelled = false;
    void NotificationsService.unreadCount().then((count) => {
      if (!cancelled && count !== null) setUnreadCount(count);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Badge follows read/delete actions taken elsewhere in the tab (notifications page)
  useEffect(() => {
    const onUnread = (e: Event) => {
      const count = (e as CustomEvent<{ count: number }>).detail?.count;
      if (typeof count === 'number') setUnreadCount(count);
    };
    window.addEventListener(UNREAD_EVENT, onUnread);
    return () => window.removeEventListener(UNREAD_EVENT, onUnread);
  }, []);

  const onRealtime = useCallback((data: unknown) => {
    const event = data as NotificationEvent;
    if (!event || event.type !== 'notification') return;
    const item = eventToItem(event);
    if (!item || seen.current.has(item.id)) return;
    seen.current.add(item.id);
    logger.debug('[useNotificationBell] Realtime notification', { key: item.notificationKey });
    setUnreadCount((n) => n + 1);
    setLatest((prev) => (prev.some((p) => p.id === item.id) ? prev : [item, ...prev].slice(0, BELL_DROPDOWN_SIZE)));
  }, []);

  useWebSocketSubscription(userId ? `user:${userId}` : '', onRealtime, [userId]);

  const loadLatest = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(false);
    const page = await NotificationsService.list({ limit: BELL_DROPDOWN_SIZE });
    if (page) {
      setLatest(page.items);
      setUnreadCount(page.unreadCount);
      page.items.forEach((i) => seen.current.add(i.id));
    } else {
      setError(true);
    }
    setIsLoading(false);
  }, [userId]);

  const markRead = useCallback(async (id: string) => {
    setLatest((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    const result = await NotificationsService.markRead([id]);
    if (result) {
      setUnreadCount(result.unreadCount);
      publishUnreadCount(result.unreadCount);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setLatest((prev) => prev.map((n) => ({ ...n, isRead: true })));
    const result = await NotificationsService.markAllRead();
    if (result) {
      setUnreadCount(0);
      publishUnreadCount(0);
    }
  }, []);

  return { unreadCount, latest, isLoading, error, loadLatest, markRead, markAllRead };
}
