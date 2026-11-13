import { type NextRequest, NextResponse } from 'next/server';
import { getAuthClient } from '@/lib/auth';
import {
  DEFAULT_RETURN_PATH,
  PKCE_COOKIE,
  STATE_COOKIE,
  pkceCookieValue,
  newStateNonce,
  parseMaxAge,
  parsePrompt,
  safeReturnPath,
  stateCookieOptions,
  withLoginParams,
} from '@/lib/login-flow';

/**
 * GET /api/auth/start?return=/path&prompt=none|login&max_age=<s>
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
  // Step-up (admin-api step_up_required): a sign-in no older than max_age
  const maxAge = parseMaxAge(url.searchParams.get('max_age'));

  const client = await getAuthClient();
  const { url: authorizeUrl, challenge } = await client.authorize(`${protocol}://${host}/api/callback`, 'code', { pkce: true });
  const nonce = newStateNonce();

  const response = NextResponse.redirect(withLoginParams(authorizeUrl, prompt, returnTo, nonce, maxAge), 302);
  response.cookies.set(STATE_COOKIE, nonce, stateCookieOptions(protocol === 'https'));
  // PKCE (S256): the verifier stays with this browser, bound to the state
  if (challenge?.verifier) response.cookies.set(PKCE_COOKIE, pkceCookieValue(nonce, challenge.verifier), stateCookieOptions(protocol === 'https'));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
