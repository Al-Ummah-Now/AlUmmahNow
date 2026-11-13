'use client';

/**
 * Header bell state (Story 29.10; seen vs read 2026-11-13).
 *
 * - The badge is the unseen count: unread notifications newer than the last time the user
 *   opened the menu. Opening the menu (`menuOpened`) clears it on the server, for every tab
 *   and device.
 * - Read state stays per notification. What opening the menu does is a platform setting
 *   (`menuOpen`): `seen` clears the badge only; `read` also marks the shown notifications read.
 * - Realtime on `user:<id>`: `notification` adds one; `notifications_state` (another tab or
 *   device opened the menu or changed read state) applies the new counts and read flags.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationItem, NotificationMenuOpenMode, NotificationStateEvent } from '@al-ummah/shared-types';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { NotificationsService, type NotificationPage } from '@/services/api/notifications';
import { isCenterKey, publishUnreadCount, UNREAD_EVENT } from '@/lib/notifications/render';
import {
  applyMenuOpened,
  applyNewNotification,
  applyStateEvent,
  EMPTY_BELL,
  idsToReadOnOpen,
  needsSeenCall,
  type BellState,
} from '@/lib/notifications/bell-state';
import type { NotificationEvent } from '@/interfaces/websocket';
import { logger } from '@/lib/logger-client';

export const BELL_DROPDOWN_SIZE = 8;

export interface UseNotificationBellResult {
  /** The badge: new since the menu was last opened */
  unseenCount: number;
  unreadCount: number;
  menuOpen: NotificationMenuOpenMode;
  latest: NotificationItem[];
  isLoading: boolean;
  error: boolean;
  /** Load the latest notifications, then record the open (clears the badge; `read` mode marks them read). */
  menuOpened: () => Promise<void>;
  loadLatest: () => Promise<NotificationPage | null>;
  markRead: (id: string) => Promise<void>;
  markUnread: (id: string) => Promise<void>;
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

/** An API from before the seen state (deploy skew) has no unseenCount: the badge is then the unread count. */
export function unseenOf(counts: { unreadCount: number; unseenCount?: number }): number {
  return typeof counts.unseenCount === 'number' ? counts.unseenCount : counts.unreadCount;
}

export function useNotificationBell(userId: string | undefined): UseNotificationBellResult {
  const [state, setState] = useState<BellState>(EMPTY_BELL);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const known = useRef<Set<string>>(new Set());
  // Read from async callbacks without re-subscribing
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    known.current = new Set();
    if (!userId) {
      setState(EMPTY_BELL);
      return;
    }
    let cancelled = false;
    void NotificationsService.counts().then((counts) => {
      if (!cancelled && counts) setState((s) => ({ ...s, unreadCount: counts.unreadCount, unseenCount: unseenOf(counts), menuOpen: counts.menuOpen ?? s.menuOpen }));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Counts follow read/delete actions taken elsewhere in the tab (notifications page)
  useEffect(() => {
    const onUnread = (e: Event) => {
      const detail = (e as CustomEvent<{ count: number; unseen?: number }>).detail;
      if (typeof detail?.count !== 'number') return;
      setState((s) => ({ ...s, unreadCount: detail.count, unseenCount: typeof detail.unseen === 'number' ? detail.unseen : Math.min(s.unseenCount, detail.count) }));
    };
    window.addEventListener(UNREAD_EVENT, onUnread);
    return () => window.removeEventListener(UNREAD_EVENT, onUnread);
  }, []);

  const onRealtime = useCallback((data: unknown) => {
    const event = data as { type?: string } | null;
    if (!event) return;
    if (event.type === 'notifications_state') {
      logger.debug('[useNotificationBell] State from another tab or device');
      setState((s) => applyStateEvent(s, event as NotificationStateEvent));
      return;
    }
    if (event.type !== 'notification') return;
    const item = eventToItem(event as NotificationEvent);
    if (!item || known.current.has(item.id)) return;
    known.current.add(item.id);
    logger.debug('[useNotificationBell] Realtime notification', { key: item.notificationKey });
    setState((s) => applyNewNotification(s, item, BELL_DROPDOWN_SIZE));
  }, []);

  useWebSocketSubscription(userId ? `user:${userId}` : '', onRealtime, [userId]);

  const loadLatest = useCallback(async (): Promise<NotificationPage | null> => {
    if (!userId) return null;
    setIsLoading(true);
    setError(false);
    const page = await NotificationsService.list({ limit: BELL_DROPDOWN_SIZE });
    setIsLoading(false);
    if (!page) {
      setError(true);
      return null;
    }
    page.items.forEach((i) => known.current.add(i.id));
    setState((s) => ({ ...s, latest: page.items, unreadCount: page.unreadCount, unseenCount: unseenOf(page), menuOpen: page.menuOpen ?? s.menuOpen }));
    return page;
  }, [userId]);

  const menuOpened = useCallback(async () => {
    const page = await loadLatest();
    if (!page) return;
    const shown = page.items;
    // The counts and mode of the page just loaded (state updates land on the next render)
    const current: BellState = { latest: shown, unreadCount: page.unreadCount, unseenCount: unseenOf(page), menuOpen: page.menuOpen ?? stateRef.current.menuOpen };
    if (!needsSeenCall(current, shown)) return;
    const ids = idsToReadOnOpen(current.menuOpen, shown);
    setState((s) => applyMenuOpened(s, shown));
    const result = await NotificationsService.markSeen(ids);
    if (result) {
      setState((s) => applyStateEvent({ ...s, menuOpen: result.menuOpen }, { unreadCount: result.unreadCount, unseenCount: result.unseenCount, readIds: result.readIds }));
      publishUnreadCount(result.unreadCount, result.unseenCount);
    }
  }, [loadLatest]);

  const markRead = useCallback(async (id: string) => {
    setState((s) => applyStateEvent(s, { readIds: [id] }));
    const result = await NotificationsService.markRead([id]);
    if (result) {
      setState((s) => applyStateEvent(s, { unreadCount: result.unreadCount, unseenCount: result.unseenCount }));
      publishUnreadCount(result.unreadCount, result.unseenCount);
    }
  }, []);

  const markUnread = useCallback(async (id: string) => {
    setState((s) => applyStateEvent(s, { unreadIds: [id] }));
    const result = await NotificationsService.markUnread([id]);
    if (result) {
      setState((s) => applyStateEvent(s, { unreadCount: result.unreadCount, unseenCount: result.unseenCount }));
      publishUnreadCount(result.unreadCount, result.unseenCount);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setState((s) => applyStateEvent(s, { allRead: true }));
    const result = await NotificationsService.markAllRead();
    if (result) {
      setState((s) => applyStateEvent(s, { unreadCount: 0, unseenCount: 0 }));
      publishUnreadCount(0, 0);
    }
  }, []);

  return {
    unseenCount: state.unseenCount,
    unreadCount: state.unreadCount,
    menuOpen: state.menuOpen,
    latest: state.latest,
    isLoading,
    error,
    menuOpened,
    loadLatest,
    markRead,
    markUnread,
    markAllRead,
  };
}
