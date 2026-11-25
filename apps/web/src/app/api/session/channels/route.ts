import { NextResponse, type NextRequest } from 'next/server';
import { getActiveSessionInfo } from '@/lib/actions/multi-account';
import { SessionManager } from '@/lib/auth/session-manager';

/**
 * Re-reads the active account's channels into the session cookie and returns the session the
 * header shows (hooks/useMultiAccount). A route and not a Server Action: a cookie written by an
 * action makes Next render the whole page again and stream it with the action's answer. That
 * stream was still open when the channel edit form left the page after saving, and Firefox
 * showed the error screen ("Error in input stream").
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // The middleware does not run for /api routes: refresh the token here
  const session = await SessionManager.ensureFreshActiveSession();
  if (!session) return NextResponse.json({ session: null }, { headers: NO_STORE });
  await SessionManager.loadUserChannels(session.userId);
  return NextResponse.json({ session: await getActiveSessionInfo() }, { headers: NO_STORE });
}
