import { requireAdminRole } from '@/lib/auth';
import { AdminNav } from '@/components/AdminNav';
import { getContactCounts, getErrorCounts } from '@/lib/api/admin';
import { canReadErrors, canUseContactInbox, canUseProcessing, canManageVideosUsers, canUseStaleUploads } from '@/lib/roles';
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

  return (
    <>
      <ErrorReportingIdentity userId={session.user.id} />
      <AdminNav
        userEmail={session.user.email}
        authIssuer={process.env.Issuer}
        contactNew={contactNew}
        canProcess={canUseProcessing(session.user.role)}
        canManageUsers={canManageVideosUsers(session.user.role)}
        canStaleUploads={canUseStaleUploads(session.user.role)}
        errorsBadge={errorsBadge}
      />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 focus:outline-none">
        {children}
      </main>
    </>
  );
}
