/**
 * Refreshes the admin session's access token ahead of expiry on every
 * authenticated route (see lib/session-middleware.ts for why this has to
 * happen here rather than during the page render).
 */
import type { NextRequest } from 'next/server';
import { refreshSessionMiddleware } from './lib/session-middleware';

export function middleware(request: NextRequest) {
  return refreshSessionMiddleware(request, { issuer: process.env.Issuer });
}

export const config = {
  // Pages that need an admin session. /login, /access-denied and the auth API
  // routes are deliberately excluded so a sign-out redirect cannot loop.
  matcher: [
    '/',
    '/dashboard/:path*',
    '/moderation/:path*',
    '/translations/:path*',
    '/indices/:path*',
  ],
};
