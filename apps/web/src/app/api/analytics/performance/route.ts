/**
 * Performance beacon (services/monitoring/web-vitals.ts and video-performance.ts).
 * Forwards web vitals / player metrics to api-videos, which queues them for the processor.
 */
import { NextRequest } from 'next/server';
import { forwardClientEvents } from '@/lib/analytics/forward-client-events';

export async function POST(request: NextRequest) {
  return forwardClientEvents(request, 'performance');
}
