import { NextRequest, NextResponse } from 'next/server';
import { getAuthClient, setAdminSession } from '@/lib/auth';
import { subjects } from '@/interfaces/subjects';
import { highestAdminRole, normalizeRole } from "@/lib/roles";
import { logger } from '@/lib/logger';
import { SIGN_IN_COOKIES } from '@/lib/single-sign-out';
import { callbackErrorRedirect, returnPathFromState } from '@/lib/login-flow';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // The auth server answered without a code. After a silent attempt
  // (prompt=none) that only means "no browser session": show the sign-in form.
  const authError = url.searchParams.get('error');
  if (authError) {
    logger.info('Sign-in returned without a code', { error: authError });
    return NextResponse.redirect(new URL(callbackErrorRedirect(authError, state), request.url), 303);
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', request.url));
  }

  try {
    const client = await getAuthClient();

    // Exchange code for tokens
    const exchanged = await client.exchange(
      code,
      callbackUrl(request),
    );

    if (exchanged.err) {
      logger.error('Token exchange failed', { name: exchanged.err?.name, message: exchanged.err?.message });
      return NextResponse.redirect(new URL('/login?error=exchange_failed', request.url));
    }

    // Verify the access token to get user info
    const verified = await client.verify(subjects, exchanged.tokens!.access, {
      refresh: exchanged.tokens!.refresh,
    });

    if (verified.err || !verified.subject) {
      logger.error('Token verification failed', { name: verified.err?.name, message: verified.err?.message, cause: String((verified.err as { cause?: unknown } | undefined)?.cause ?? '') });
      return NextResponse.redirect(new URL('/login?error=verification_failed', request.url));
    }

    const userInfo = verified.subject.properties;

    // Extract user roles from the verified token
    const userRoles: string[] = (userInfo.roles || []).map((r: string) => normalizeRole(r));

    // Determine the highest admin role; users without one are turned away
    const role = highestAdminRole(userRoles);

    if (!role) {
      logger.warn('Unauthorized admin access attempt', {
        userId: userInfo.id,
        email: userInfo.email,
        roles: userRoles,
      });
      // Drop any session of a previously active account: after a switch to
      // this account the admin panel must not keep acting as the other one.
      const denied = NextResponse.redirect(new URL('/access-denied', request.url), 303);
      for (const name of SIGN_IN_COOKIES) denied.cookies.delete(name);
      return denied;
    }

    logger.info('Admin login successful', {
      userId: userInfo.id,
      email: userInfo.email,
      role,
    });

    // Create admin session with role information
    await setAdminSession({
      user: {
        id: userInfo.id,
        email: userInfo.email,
        role,
      },
      accessToken: exchanged.tokens!.access,
      refreshToken: exchanged.tokens!.refresh,
    });

    // Back to the page that needed the sign-in
    return NextResponse.redirect(new URL(returnPathFromState(state), request.url), 303);
  } catch (error) {
    logger.error('Auth callback error', { error });
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }
}

/**
 * Must be byte-identical to the redirect_uri sent at /authorize
 * (see app/login/page.tsx, which derives it from the Host header).
 */
function callbackUrl(request: NextRequest): string {
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const protocol = host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}/api/callback`;
}
