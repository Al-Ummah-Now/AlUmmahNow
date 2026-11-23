/**
 * Server-side initial read of `GET /api/events` for `/[locale]/events` (Epic 22, E22-S6).
 *
 * When `eventCalendar` is off (`404 feature_off`),
 * returns `{ status: 'off' }` so the route calls `notFound()` ("Hidden when off").
 */
import type { CalendarEventItem, EventCalendarListResponse } from '@al-ummah/shared-types';
import { buildApiUrl } from '@/lib/api/api-client';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { logger } from '@/lib/logger-server';

export type InitialEventsResult =
  | { status: 'ok'; items: CalendarEventItem[]; nextCursor: string | null }
  | { status: 'off' }
  | { status: 'error'; items: CalendarEventItem[]; nextCursor: null };

export async function loadInitialEvents(fetchImpl: typeof fetch = fetch): Promise<InitialEventsResult> {
  try {
    const auth = await getServerAuthContext();
    const res = await fetchImpl(buildApiUrl('/api/events?limit=24'), {
      headers: { Accept: 'application/json', ...(auth?.accessToken && { Authorization: `Bearer ${auth.accessToken}` }) },
      cache: 'no-store',
    });
    if (res.status === 404) {
      return { status: 'off' };
    }
    const body = (await res.json().catch(() => null)) as Partial<EventCalendarListResponse> | null;
    if (!res.ok || !body?.success || !body.result || !Array.isArray(body.result.items)) {
      logger.warn('[Events] Initial calendar fetch unreadable', { status: res.status });
      return { status: 'error', items: [], nextCursor: null };
    }
    return {
      status: 'ok',
      items: body.result.items,
      nextCursor: body.result.nextCursor ?? null,
    };
  } catch (error) {
    logger.warn('[Events] Initial calendar fetch failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'error', items: [], nextCursor: null };
  }
}
