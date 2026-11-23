'use client';

/**
 * Client service for the unified online Event Calendar (`GET /api/events`, `.ics` feeds, and
 * Epic 17 live-stream reminder toggles; Epic 22 E22-S6).
 */
import type {
  CalendarEventItem,
  EventCalendarKind,
  EventCalendarListResponse,
  EventCalendarType,
} from '@al-ummah/shared-types';
import { getClientAuthHeaders } from '@/lib/auth/client-token';
import { logger } from '@/lib/logger-client';
import { getApiUrl } from '@/lib/runtime-config';

export interface EventsListParams {
  channelId?: string;
  eventType?: EventCalendarType | null;
  kind?: EventCalendarKind | null;
  subscribedOnly?: boolean;
  from?: string;
  to?: string;
  cursor?: string | null;
  limit?: number;
}

export type EventsListOutcome =
  | { status: 'ok'; items: CalendarEventItem[]; nextCursor: string | null }
  | { status: 'off' }
  | { status: 'error' };

export const EventsService = {
  async list(params: EventsListParams = {}): Promise<EventsListOutcome> {
    const q = new URLSearchParams();
    if (params.channelId) q.set('channelId', params.channelId);
    if (params.eventType) q.set('eventType', params.eventType);
    if (params.kind) q.set('kind', params.kind);
    if (params.subscribedOnly) q.set('subscribedOnly', 'true');
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.cursor) q.set('cursor', params.cursor);
    q.set('limit', String(params.limit ?? 24));

    try {
      const headers = await getClientAuthHeaders();
      const query = q.toString();
      const res = await fetch(`${getApiUrl()}/api/events${query ? `?${query}` : ''}`, {
        headers: { ...headers, Accept: 'application/json' },
        cache: 'no-store',
      });
      if (res.status === 404) return { status: 'off' };
      if (!res.ok) {
        logger.warn('[EventsService] Unexpected status', { status: res.status });
        return { status: 'error' };
      }
      const body = (await res.json()) as Partial<EventCalendarListResponse>;
      if (!body.success || !body.result || !Array.isArray(body.result.items)) {
        return { status: 'error' };
      }
      return {
        status: 'ok',
        items: body.result.items,
        nextCursor: body.result.nextCursor ?? null,
      };
    } catch (error) {
      logger.warn('[EventsService] Request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 'error' };
    }
  },

  async setReminder(streamId: string, remind: boolean): Promise<boolean> {
    try {
      const headers = await getClientAuthHeaders();
      const res = await fetch(`${getApiUrl()}/api/live-streams/${encodeURIComponent(streamId)}/reminders`, {
        method: remind ? 'POST' : 'DELETE',
        headers,
      });
      return res.ok;
    } catch (error) {
      logger.warn('[EventsService] Reminder toggle failed', {
        streamId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  },

  icsUrl(channelId: string | null, locale: 'en' | 'ar'): string {
    const path = channelId ? `/api/channels/${encodeURIComponent(channelId)}/events.ics` : '/api/events.ics';
    return `${getApiUrl()}${path}?lang=${locale}`;
  },
};
