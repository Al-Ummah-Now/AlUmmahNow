import { NextRequest, NextResponse } from 'next/server';
import { getAuthClient, setAdminSession } from '@/lib/auth';
import { subjects } from '@/interfaces/subjects';
import { hasAdminAccess } from '@/lib/roles';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', request.url));
  }

  try {
    const client = await getAuthClient();

    // Exchange code for tokens
    const exchanged = await client.exchange(
      code,
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3091'}/api/callback`,
    );

    if (exchanged.err) {
      logger.error('Token exchange failed', { error: exchanged.err });
      return NextResponse.redirect(new URL('/login?error=exchange_failed', request.url));
    }

    // Verify the access token to get user info
    const verified = await client.verify(subjects, exchanged.tokens!.access, {
      refresh: exchanged.tokens!.refresh,
    });

    if (verified.err || !verified.subject) {
      logger.error('Token verification failed', { error: verified.err });
      return NextResponse.redirect(new URL('/login?error=verification_failed', request.url));
    }

    const userInfo = verified.subject.properties;

    // Extract user roles from the verified token
    const userRoles = userInfo.roles || [];

    // Check if user has admin or moderator role
    const hasAccess = userRoles.some((role: string) => hasAdminAccess(role));

    if (!hasAccess) {
      logger.warn('Unauthorized admin access attempt', {
        userId: userInfo.id,
        email: userInfo.email,
        roles: userRoles,
      });
      return NextResponse.redirect(new URL('/access-denied', request.url));
    }

    // Determine the highest priority role
    const role = userRoles.includes('super_admin')
      ? 'super_admin'
      : userRoles.includes('admin')
      ? 'admin'
      : userRoles.includes('moderator')
      ? 'moderator'
      : undefined;

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

    return NextResponse.redirect(new URL('/dashboard', request.url));
  } catch (error) {
    logger.error('Auth callback error', { error });
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }
}
