/**
 * Refreshes the admin session's access token ahead of expiry on every
 * authenticated route (see lib/session-middleware.ts for why this has to
 * happen here rather than during the page render).
 */
import type { NextRequest } from 'next/server';
import { refreshSessionMiddleware } from './lib/session-middleware';
import type { VerifyToken } from './lib/verified-refresh';

let verifier: Promise<VerifyToken> | null = null;
/** The auth client is loaded when the first refreshed token is verified. */
const verify: VerifyToken = async (accessToken) => {
  verifier ??= import('./lib/auth-client').then(({ adminAuth }) => adminAuth((message, fields) => console.warn(message, fields)).verifyAccessToken);
  return (await verifier)(accessToken);
};

export function middleware(request: NextRequest) {
  return refreshSessionMiddleware(request, { issuer: process.env.Issuer, verify });
}

export const config = {
  // Every page that needs an admin session, so every one of them is refreshed
  // here, where the rotated pair can be stored (AW-1). A page missing from a
  // hand-written list (as /site-theme was) refreshed during its render and
  // signed the admin out a minute later. Excluded: /login, /access-denied,
  // the API and auth routes (so a sign-out redirect cannot loop) and assets.
  matcher: ['/((?!login|access-denied|api/|_next/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
