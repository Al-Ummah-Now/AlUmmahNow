/**
 * Visit beacon (lib/analytics/site-visit.ts): classifies the landing path and referrer here, then
 * forwards one allow-listed event to api-videos like the other client analytics (consent applies).
 */
import { NextRequest } from 'next/server';
import { forwardClientEvents } from '@/lib/analytics/forward-client-events';
import { classifyVisit } from '@/lib/analytics/site-visit';

export async function POST(request: NextRequest) {
  let raw: { path?: unknown; referrer?: unknown } = {};
  try {
    raw = (await request.json()) as typeof raw;
  } catch {
    raw = {};
  }
  const path = typeof raw.path === 'string' && raw.path.startsWith('/') ? raw.path.slice(0, 512) : '/';
  const referrer = typeof raw.referrer === 'string' ? raw.referrer.slice(0, 2048) : '';
  const event = classifyVisit(path, referrer, request.headers.get('host') ?? '');
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  const classified = new NextRequest(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ events: [event] }),
  });
  return forwardClientEvents(classified, 'visit');
}
