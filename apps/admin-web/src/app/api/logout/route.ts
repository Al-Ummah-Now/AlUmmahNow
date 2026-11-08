import { NextResponse } from 'next/server';
import { SIGN_IN_COOKIES, startSingleSignOut } from '@/lib/single-sign-out';
import { logger } from '@/lib/logger';

/**
 * "Log out": clear admin's session, then end the shared sign-in on the auth
 * server, which signs out of every other app and comes back to this app's
 * home page (single sign-out, #295).
 */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  // 303 so the browser follows with a GET; the default 307 would re-POST
  // the logout form body to the auth server.
  const response = NextResponse.redirect(startSingleSignOut(process.env.Issuer!, `${origin}/`), 303);
  for (const name of SIGN_IN_COOKIES) response.cookies.delete(name);
  response.headers.set('Cache-Control', 'no-store');
  logger.info('[auth] Admin logged out, starting single sign-out');
  return response;
}
