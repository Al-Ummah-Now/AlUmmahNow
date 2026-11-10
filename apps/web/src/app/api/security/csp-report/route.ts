/**
 * CSP violation report endpoint (Story 1.2, AC 2, 3). Referenced by the
 * `report-uri` directive generated in lib/security/csp.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger-server';
import { MAX_REPORT_BYTES, normalizeCspReports } from '@/lib/security/security-report';

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_REPORT_BYTES) {
      return new NextResponse(null, { status: 204 });
    }
    for (const report of normalizeCspReports(JSON.parse(raw))) {
      logger.debug('[Security] CSP violation', report);
    }
  } catch (error) {
    logger.warn('[Security] Unreadable CSP report', { error: error instanceof Error ? error.message : String(error) });
  }
  return new NextResponse(null, { status: 204 });
}
