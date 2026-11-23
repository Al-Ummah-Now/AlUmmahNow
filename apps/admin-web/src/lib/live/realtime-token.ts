/** GET /api/realtime/token, with its dependencies injected so its decisions are unit tested. */
import { type NextRequest, NextResponse } from 'next/server';
import { hasAdminAccess } from '../roles';
import { dropSession, readSession, storeSession } from '../session-cookie';
import { shouldRefresh } from '../token-refresh';
import type { VerifiedRefresh } from '../verified-refresh';
import type { MintedAdminTicket } from './realtime-ticket';

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const notSignedIn = () => json({ error: 'not signed in' }, 401);
const forbidden = () => json({ error: 'forbidden' }, 403);

export interface RealtimeTokenDeps {
  /** getAdminSessionState (lib/auth.ts): the verified session, or that there is an expired one */
  state: () => Promise<{ session: { user: { role?: string }; accessToken: string } | null; expired: boolean }>;
  issuer: string | undefined;
  refresh: (issuer: string, refreshToken: string) => Promise<VerifiedRefresh>;
  mint: (accessToken: string) => Promise<MintedAdminTicket | null>;
  log?: { debug(message: string, fields: Record<string, unknown>): void };
}

export async function handleRealtimeToken(request: NextRequest, deps: RealtimeTokenDeps): Promise<NextResponse> {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return forbidden();

  const ticket = async (accessToken: string) => {
    const minted = await deps.mint(accessToken);
    return minted ? json(minted) : json({ error: 'realtime unavailable' }, 503);
  };

  const { session, expired } = await deps.state();
  if (session && !hasAdminAccess(session.user.role)) return forbidden();
  // Still good for the socket's next minutes
  if (session && !shouldRefresh(session.accessToken, Math.floor(Date.now() / 1000))) return ticket(session.accessToken);
  if (!session && !expired) return notSignedIn();

  // Nothing to refresh with, or the auth server cannot now: a valid access token can still mint a ticket
  const current = () => (session ? ticket(session.accessToken) : notSignedIn());
  const found = readSession(request.cookies);
  if (!found?.tokens.refreshToken || !deps.issuer) return current();
  const result = await deps.refresh(deps.issuer, found.tokens.refreshToken);
  if (result.kind === 'transient') {
    deps.log?.debug('[realtime token] Refresh failed for now', { reason: result.reason });
    return current();
  }
  if (result.kind !== 'refreshed') {
    // Signed out, revoked or without its roles: no ticket, and the session goes (as on a page)
    const response = result.kind === 'no_access' ? forbidden() : notSignedIn();
    dropSession(response.cookies);
    return response;
  }
  // A review-only account keeps its (verified) session but gets no ticket
  const response = hasAdminAccess(result.role) ? await ticket(result.tokens.accessToken) : forbidden();
  storeSession(response.cookies, found, result.tokens, request.headers.get('host'));
  return response;
}
