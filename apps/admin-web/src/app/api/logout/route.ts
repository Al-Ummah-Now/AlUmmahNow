import { NextResponse } from 'next/server';
import { clearAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  await clearAdminSession();
  logger.info('[auth] Admin logged out');

  // 303 so the browser follows with a GET; the default 307 would re-POST
  // the logout form body to the home page.
  return NextResponse.redirect(new URL('/', request.url), 303);
}
