import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/auth';
import { DEFAULT_RETURN_PATH } from '@/lib/login-flow';

export const dynamic = 'force-dynamic';

/**
 * The root has no page of its own. Signed in: the dashboard. Not signed in:
 * straight to sign-in (the middleware normally redirects before this renders;
 * this covers a cookie whose tokens no longer verify). /login asks the auth
 * server without a prompt, so an existing sign-in is used silently.
 */
export default async function HomePage() {
  const session = await getAdminSession();
  redirect(session ? DEFAULT_RETURN_PATH : '/login');
}
