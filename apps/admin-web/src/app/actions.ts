'use server';

import { redirect } from 'next/navigation';
import { clearAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * Log out: clear the session cookies and return to the public home page.
 * (Not /login: that immediately re-runs the OAuth flow and would sign the
 * user straight back in through the auth server's own session.)
 */
export async function logout(): Promise<void> {
  await clearAdminSession();
  logger.info('[auth] Admin logged out');
  redirect('/');
}
