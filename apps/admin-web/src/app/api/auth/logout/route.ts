import { type NextRequest, NextResponse } from 'next/server';
import { SIGN_IN_COOKIES, singleSignOutNext } from '@/lib/single-sign-out';
import { logger } from '@/lib/logger';

/**
 * Front-channel logout: the auth server sends the browser here while it signs
 * the user out of every app. Clears admin's session and goes on with the
 * chain (or starts it, when opened directly). Registered in the auth server's
 * FRONTCHANNEL_LOGOUT_URLS for QA, stage and production.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(singleSignOutNext(process.env.Issuer!, url.searchParams, url.origin), 302);
  for (const name of SIGN_IN_COOKIES) response.cookies.delete(name);
  response.headers.set('Cache-Control', 'no-store');
  logger.info('[auth] Front-channel logout');
  return response;
}
