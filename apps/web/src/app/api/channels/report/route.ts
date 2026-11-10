/**
 * Sink for channel list and channel team failures seen in the browser
 * (lib/channels/report.ts). Records them with the server logger, which ships
 * to the centralized log service; the admin Errors pipeline (PR #589) hooks
 * into reportChannelListFailure. Only short machine-readable fields are kept,
 * never user content. Always answers 204 so reporting never breaks the page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger-server';
import { normalizeChannelFailure, MAX_CHANNEL_REPORT_BYTES } from '@/lib/channels/report-shape';

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length <= MAX_CHANNEL_REPORT_BYTES) {
      const event = normalizeChannelFailure(JSON.parse(raw));
      if (event) logger.error('[channels] Client channel request failed', event);
    }
  } catch (error) {
    logger.warn('[channels] Unreadable channel failure report', { error: error instanceof Error ? error.message : String(error) });
  }
  return new NextResponse(null, { status: 204 });
}
