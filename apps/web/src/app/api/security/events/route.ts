/**
 * Security event sink (Story 1.2, AC 2).
 *
 * Receives batches from the browser SecurityEventLogger (blocked/suspicious
 * event listeners, rejected messages, CSP violations seen client-side) and
 * records them with the server logger, which ships to the centralized log
 * service. Always answers 204 so reporting can never break the page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger-server';
import { MAX_REPORT_BYTES, normalizeSecurityEvents } from '@/lib/security/security-report';

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_REPORT_BYTES) {
      logger.warn('[Security] Oversized security report dropped', { bytes: raw.length });
      return new NextResponse(null, { status: 204 });
    }
    const events = normalizeSecurityEvents(JSON.parse(raw));
    for (const event of events) {
      const log = event.severity === 'high' || event.severity === 'critical' ? logger.error : logger.warn;
      log('[Security] Client security event', event);
    }
  } catch (error) {
    logger.warn('[Security] Unreadable security report', { error: error instanceof Error ? error.message : String(error) });
  }
  return new NextResponse(null, { status: 204 });
}
