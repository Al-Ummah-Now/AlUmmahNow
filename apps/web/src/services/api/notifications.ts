'use client';

/**
 * Notification center API client (Story 29.10).
 *
 * Endpoints (api-videos, all authenticated):
 * - GET    /api/notifications                      ?limit&cursor&unreadOnly
 * - GET    /api/notifications/unread-count          { unreadCount, unseenCount, menuOpen }
 * - POST   /api/notifications/seen                  { ids? } the menu was opened
 * - POST   /api/notifications/read                 { ids }
 * - POST   /api/notifications/unread               { ids }
 * - POST   /api/notifications/read-all
 * - DELETE /api/notifications/:id
 * - GET    /api/notifications/settings
 * - PUT    /api/notifications/settings             { settings?, email? }
 * - GET    /api/notifications/channels/:id/bell
 * - PUT    /api/notifications/channels/:id/bell    { bell }
 */

import { logger } from '@/lib/logger-client';
import { getApiUrl } from '@/lib/runtime-config';
import { getClientAuthHeaders } from '@/lib/auth/client-token';
import type {
  ChannelBellLevel,
  NotificationCounts,
  NotificationItem,
  NotificationMenuOpenMode,
  NotificationSeenResult,
  NotificationSettingsResult,
  NotificationSettingsUpdateRequest,
} from '@al-ummah/shared-types';

const apiBase = (): string => getApiUrl();

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
  /** The bell's badge: unread and newer than the last menu open */
  unseenCount: number;
  /** Platform setting: what opening the menu does */
  menuOpen: NotificationMenuOpenMode;
}

async function request<T>(path: string, init: RequestInit = {}, label: string): Promise<T | null> {
  try {
    const headers: Record<string, string> = { ...(await getClientAuthHeaders()) };
    if (init.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${apiBase()}${path}`, { ...init, headers });
    if (!response.ok) {
      logger.warn(`[NotificationsService] ${label} failed`, { status: response.status, path });
      return null;
    }
    const body = (await response.json()) as { result?: T };
    return (body.result ?? null) as T | null;
  } catch (error) {
    logger.error(`[NotificationsService] ${label} error`, { path, error });
    return null;
  }
}

export const NotificationsService = {
  list(params: { limit?: number; cursor?: string | null; unreadOnly?: boolean } = {}) {
    const q = new URLSearchParams({ limit: String(params.limit ?? 20) });
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.unreadOnly) q.set('unreadOnly', 'true');
    return request<NotificationPage>(`/api/notifications?${q.toString()}`, {}, 'List');
  },

  counts() {
    return request<NotificationCounts & { menuOpen: NotificationMenuOpenMode }>('/api/notifications/unread-count', {}, 'Counts');
  },

  /** The menu was opened: clears the badge; in `read` mode the server also marks `ids` read. */
  markSeen(ids: string[]) {
    return request<NotificationSeenResult>('/api/notifications/seen', { method: 'POST', body: JSON.stringify({ ids: ids.slice(0, 100) }) }, 'Mark seen');
  },

  markRead(ids: string[]) {
    return request<{ updated: number } & NotificationCounts>(
      '/api/notifications/read',
      { method: 'POST', body: JSON.stringify({ ids }) },
      'Mark read',
    );
  },

  markUnread(ids: string[]) {
    return request<{ updated: number } & NotificationCounts>(
      '/api/notifications/unread',
      { method: 'POST', body: JSON.stringify({ ids }) },
      'Mark unread',
    );
  },

  markAllRead() {
    return request<{ updated: number } & NotificationCounts>('/api/notifications/read-all', { method: 'POST' }, 'Mark all read');
  },

  remove(id: string) {
    return request<{ id: string } & NotificationCounts>(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Delete');
  },

  /** Category switches and email preferences. */
  settings(): Promise<NotificationSettingsResult | null> {
    return request<NotificationSettingsResult>('/api/notifications/settings', {}, 'Get settings');
  },

  updateSettings(changes: NotificationSettingsUpdateRequest): Promise<NotificationSettingsResult | null> {
    return request<NotificationSettingsResult>(
      '/api/notifications/settings',
      { method: 'PUT', body: JSON.stringify(changes) },
      'Update settings',
    );
  },

  channelBell(channelId: string) {
    return request<{ channelId: string; bell: ChannelBellLevel | null; subscribed: boolean }>(
      `/api/notifications/channels/${encodeURIComponent(channelId)}/bell`,
      {},
      'Get channel bell',
    );
  },

  async setChannelBell(channelId: string, bell: ChannelBellLevel): Promise<boolean> {
    const result = await request<{ bell: ChannelBellLevel }>(
      `/api/notifications/channels/${encodeURIComponent(channelId)}/bell`,
      { method: 'PUT', body: JSON.stringify({ bell }) },
      'Set channel bell',
    );
    if (result) logger.debug('[NotificationsService] Channel bell set', { channelId, bell });
    return !!result;
  },
};
