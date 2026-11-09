import { type NextRequest, NextResponse } from 'next/server';
import { getAuthClient } from '@/lib/auth';
import {
  DEFAULT_RETURN_PATH,
  STATE_COOKIE,
  newStateNonce,
  parsePrompt,
  safeReturnPath,
  stateCookieOptions,
  withLoginParams,
} from '@/lib/login-flow';

/**
 * GET /api/auth/start?return=/path&prompt=none|login
 *
 * Sends the browser to the auth server's /authorize with a fresh OAuth state
 * bound to this browser: the nonce goes into an httpOnly cookie scoped to
 * /api/callback, which only accepts a callback whose state carries it.
 * Reached from /login (a page cannot set cookies).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const prompt = parsePrompt(url.searchParams.get('prompt'));
  const returnTo = safeReturnPath(url.searchParams.get('return')) ?? DEFAULT_RETURN_PATH;

  const client = await getAuthClient();
  const { url: authorizeUrl } = await client.authorize(`${protocol}://${host}/api/callback`, 'code');
  const nonce = newStateNonce();

  const response = NextResponse.redirect(withLoginParams(authorizeUrl, prompt, returnTo, nonce), 302);
  response.cookies.set(STATE_COOKIE, nonce, stateCookieOptions(protocol === 'https'));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
