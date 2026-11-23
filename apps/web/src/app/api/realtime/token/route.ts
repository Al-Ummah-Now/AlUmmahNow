import { NextResponse, type NextRequest } from 'next/server';
import { SessionManager } from '@/lib/auth/session-manager';
import { mintRealtimeTicket } from '@/lib/auth/realtime-ticket';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Mint a single-use WebSocket ticket through a stable endpoint for open tabs across releases. */
export async function GET(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  }

  const session = await SessionManager.ensureFreshActiveSession();
  if (!session?.accessToken) return NextResponse.json({ ticket: null }, { headers: NO_STORE });

  const ticket = await mintRealtimeTicket(session.accessToken);
  if (!ticket) {
    return NextResponse.json({ error: 'realtime unavailable' }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ ticket }, { headers: NO_STORE });
}
