/**
 * The OAuth callback (/api/callback), with its dependencies injected so the
 * security decisions are unit tested.
 *
 * Order matters: the state check runs FIRST. A callback whose state nonce
 * does not match this browser's state cookie (missing, forged, or from
 * another browser) is refused without exchanging the code and without
 * touching any session cookie, so a forged callback can neither replace nor
 * clear the admin session (login CSRF). The state cookie is cleared on every
 * outcome.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { highestAdminRole, normalizeRole } from './roles';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie';
import { SIGN_IN_COOKIES } from './single-sign-out';
import {
  PKCE_COOKIE,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  pkceVerifierFor,
  callbackErrorRedirect,
  returnPathFromState,
  sameOriginRedirect,
  stateMatches,
} from './login-flow';

interface Tokens {
  access: string;
  refresh: string;
}

export interface CallbackClient {
  exchange(code: string, redirectUri: string, verifier?: string): Promise<{ err: unknown; tokens?: Tokens }>;
  verify(
    subjects: unknown,
    token: string,
    options: { refresh: string },
  ): Promise<{ err?: { name?: string; message?: string } | unknown; subject?: { properties: { id: string; email: string; roles?: string[] } } }>;
}

export interface CallbackDeps {
  getClient: () => Promise<CallbackClient>;
  subjects: unknown;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
}

/** Must be byte-identical to the redirect_uri sent at /authorize (see /api/auth/start). */
function callbackUrl(request: NextRequest): string {
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}/api/callback`;
}

export async function handleCallback(request: NextRequest, deps: CallbackDeps): Promise<NextResponse> {
  const log = deps.log ?? console;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const authError = url.searchParams.get('error');

  const redirect = (path: string, status = 303) => {
    const response = NextResponse.redirect(sameOriginRedirect(path, request.url), status);
    // One-shot: the state cookie is spent whatever happens
    response.cookies.set(STATE_COOKIE, '', { path: STATE_COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: 'lax' });
    response.cookies.set(PKCE_COOKIE, '', { path: STATE_COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: 'lax' });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  // Bound to the browser that started this sign-in? Otherwise refuse, before
  // anything else: no exchange, no session cookie set or deleted.
  if (!stateMatches(state, request.cookies.get(STATE_COOKIE)?.value)) {
    log.warn('[auth] Callback refused: state does not match this browser', { hasState: !!state, hasError: !!authError });
    return redirect('/login?error=auth_failed');
  }

  // The auth server answered without a code. After a silent attempt
  // (prompt=none) that only means "no browser session": show the sign-in form.
  if (authError) {
    log.info('[auth] Sign-in returned without a code', { error: authError });
    return redirect(callbackErrorRedirect(authError, state));
  }
  if (!code) return redirect('/login?error=no_code');

  try {
    const client = await deps.getClient();
    const verifier = pkceVerifierFor(state, request.cookies.get(PKCE_COOKIE)?.value);
    const exchanged = await client.exchange(code, callbackUrl(request), verifier);
    if (exchanged.err || !exchanged.tokens) {
      const err = exchanged.err as { name?: string; message?: string } | undefined;
      log.error('[auth] Token exchange failed', { name: err?.name, message: err?.message });
      return redirect('/login?error=exchange_failed');
    }

    const verified = await client.verify(deps.subjects, exchanged.tokens.access, { refresh: exchanged.tokens.refresh });
    if (verified.err || !verified.subject) {
      const err = verified.err as { name?: string; message?: string } | undefined;
      log.error('[auth] Token verification failed', { name: err?.name, message: err?.message });
      return redirect('/login?error=verification_failed');
    }

    const userInfo = verified.subject.properties;
    const role = highestAdminRole((userInfo.roles || []).map((r: string) => normalizeRole(r)));
    if (!role) {
      log.warn('[auth] Unauthorized admin access attempt', { userId: userInfo.id });
      // Drop any session of a previously active account: after a switch to
      // this account the admin panel must not keep acting as the other one.
      const denied = redirect('/access-denied');
      for (const name of SIGN_IN_COOKIES) denied.cookies.delete(name);
      return denied;
    }

    log.info('[auth] Admin login successful', { userId: userInfo.id, role });
    const response = redirect(returnPathFromState(state));
    response.cookies.set(
      SESSION_COOKIE_NAME,
      JSON.stringify({
        user: { id: userInfo.id, email: userInfo.email, role },
        accessToken: exchanged.tokens.access,
        refreshToken: exchanged.tokens.refresh,
      }),
      sessionCookieOptions(request.headers.get('host')),
    );
    return response;
  } catch (error) {
    log.error('[auth] Callback error', { error: error instanceof Error ? error.message : String(error) });
    return redirect('/login?error=auth_failed');
  }
}
