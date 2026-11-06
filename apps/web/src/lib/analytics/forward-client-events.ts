import { NextRequest, NextResponse } from 'next/server';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-server';
import { ClientEventKind, MAX_BODY_BYTES, normalizeClientEvents } from './client-events';

export type { ClientEventKind };

/**
 * Next route handler body shared by /api/analytics/ab-test and /api/analytics/performance:
 * validates the beacon and forwards it to api-videos POST /api/analytics/events,
 * which queues it for the processor. Beacons never fail the page: invalid or
 * undeliverable batches are logged and acknowledged.
 */
export async function forwardClientEvents(request: NextRequest, kind: ClientEventKind): Promise<NextResponse> {
  let raw: string;
  try {
    raw = await request.text();
  } catch (error) {
    logger.warn('[ClientAnalytics] Unreadable beacon body', { kind, error });
    return NextResponse.json({ success: false, error: 'Invalid body' }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: 'Payload too large' }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const normalized = normalizeClientEvents(payload);
  if (normalized.events.length === 0) {
    return NextResponse.json({ success: true, accepted: 0 }, { status: 202 });
  }

  const apiUrl = getApiUrl();
  if (!apiUrl) {
    logger.warn('[ClientAnalytics] API_URL not configured, dropping beacon', { kind });
    return NextResponse.json({ success: true, accepted: 0 }, { status: 202 });
  }

  try {
    const authorization = request.headers.get('authorization');
    const response = await fetch(`${apiUrl}/api/analytics/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization && { Authorization: authorization }),
      },
      body: JSON.stringify({ kind, ...normalized }),
    });
    if (!response.ok) {
      logger.warn('[ClientAnalytics] API rejected beacon', { kind, status: response.status });
      return NextResponse.json({ success: true, accepted: 0 }, { status: 202 });
    }
    return NextResponse.json({ success: true, accepted: normalized.events.length }, { status: 202 });
  } catch (error) {
    logger.error('[ClientAnalytics] Failed to forward beacon', { kind, error });
    return NextResponse.json({ success: true, accepted: 0 }, { status: 202 });
  }
}
