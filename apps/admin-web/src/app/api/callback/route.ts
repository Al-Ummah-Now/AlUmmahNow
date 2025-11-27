import { NextRequest, NextResponse } from 'next/server';
import { getAuthClient, setAdminSession } from '@/lib/auth';
import { subjects } from '@/interfaces/subjects';

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
      console.error('Token exchange failed:', exchanged.err);
      return NextResponse.redirect(new URL('/login?error=exchange_failed', request.url));
    }

    // Verify the access token to get user info
    const verified = await client.verify(subjects, exchanged.tokens!.access, {
      refresh: exchanged.tokens!.refresh,
    });

    if (verified.err || !verified.subject) {
      console.error('Token verification failed:', verified.err);
      return NextResponse.redirect(new URL('/login?error=verification_failed', request.url));
    }

    const userInfo = verified.subject.properties;

    // For now, we'll allow all authenticated users
    // Role checking will be done via the admin-api which validates against the auth server
    // In production, you'd want to fetch user roles here and check them

    // Create admin session
    await setAdminSession({
      user: {
        id: userInfo.id,
        email: userInfo.email,
      },
      accessToken: exchanged.tokens!.access,
      refreshToken: exchanged.tokens!.refresh,
    });

    return NextResponse.redirect(new URL('/dashboard', request.url));
  } catch (error) {
    console.error('Auth callback error:', error);
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
  }
}
