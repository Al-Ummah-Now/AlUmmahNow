import { requireAdminRole } from '@/lib/auth';
import { cookies } from 'next/headers';
import { AdminShell } from '@/components/shell/AdminShell';
import { NAV_COOKIE } from '@/components/shell/nav-model';
import { getContactCounts, getErrorCounts } from '@/lib/api/admin';
import { canReadErrors, canUseContactInbox, canUseProcessing, canManageVideosUsers, canUseStaleUploads, canManageMedia, canReadOps } from '@/lib/roles';
import { ErrorReportingIdentity } from '@/lib/errors/ErrorReportingProvider';
import { errorsBadgeCount } from './errors/filters';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Verify authentication and admin role (redirects if not authorized)
  const session = await requireAdminRole();

  // Contact messages nav item and its "new" badge (admins and super admins only)
  let contactNew: number | null = null;
  if (canUseContactInbox(session.user.role)) {
    contactNew = 0;
    try {
      const counts = await getContactCounts();
      // New messages and messages whose email failed: both need an admin
      contactNew = counts.new + counts.send_failed;
    } catch (e) {
      logger.warn('[layout] Contact counts unavailable', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Errors nav item: new groups plus open needs-action items (errors:read)
  let errorsBadge: number | null = null;
  if (canReadErrors(session.user.role)) {
    errorsBadge = 0;
    try {
      errorsBadge = errorsBadgeCount(await getErrorCounts());
    } catch (e) {
      logger.warn('[layout] Error counts unavailable', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const role = session.user.role;
  const navCookie = (await cookies()).get(NAV_COOKIE)?.value;

  return (
    <>
      <ErrorReportingIdentity userId={session.user.id} />
      <AdminShell
        userEmail={session.user.email}
        authIssuer={process.env.Issuer}
        initialRail={navCookie === 'rail'}
        access={{
          contact: contactNew !== null,
          processing: canUseProcessing(role),
          errors: errorsBadge !== null,
          manageUsers: canManageVideosUsers(role),
          staleUploads: canUseStaleUploads(role),
          media: canManageMedia(role),
          ops: canReadOps(role),
        }}
        badges={{ contact: contactNew, errors: errorsBadge }}
      >
        {children}
      </AdminShell>
    </>
  );
}
