import { NextResponse, type NextRequest } from 'next/server';
import { getActiveSessionInfo } from '@/lib/actions/multi-account';
import { SessionManager } from '@/lib/auth/session-manager';

/**
 * The session the header shows (hooks/useMultiAccount), read on every page. A route and not a
 * Server Action: Next runs Server Actions in one queue with navigations, and React commits a
 * navigation only once the actions dispatched beside it have answered. The header's read went out
 * on every page and again during moves, so each playlist or up-next move waited one more round
 * trip after its page had arrived (Player E2E, 2026-11-28: 4 to 9 s per read on the CI dev server,
 * chained; the move committed after 10 s or was replaced by a page load). A fetch is not queued.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // The middleware does not run for /api routes: refresh the token here, as it did for the action
  const session = await SessionManager.ensureFreshActiveSession();
  if (!session) return NextResponse.json({ session: null }, { headers: NO_STORE });
  return NextResponse.json({ session: await getActiveSessionInfo() }, { headers: NO_STORE });
}
