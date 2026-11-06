/**
 * A/B test analytics beacon (services/experiments/analytics.ts).
 * Forwards exposure/conversion batches to api-videos, which queues them for the processor.
 */
import { NextRequest } from 'next/server';
import { forwardClientEvents } from '@/lib/analytics/forward-client-events';

export async function POST(request: NextRequest) {
  return forwardClientEvents(request, 'ab_test');
}
