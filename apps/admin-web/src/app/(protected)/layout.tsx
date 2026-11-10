import { requireAdminRole } from '@/lib/auth';
import { AdminNav } from '@/components/AdminNav';
import { getContactCounts } from '@/lib/api/admin';
import { canUseContactInbox, canUseProcessing } from '@/lib/roles';
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
      contactNew = (await getContactCounts()).new;
    } catch (e) {
      logger.warn('[layout] Contact counts unavailable', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <>
      <AdminNav userEmail={session.user.email} authIssuer={process.env.Issuer} contactNew={contactNew} canProcess={canUseProcessing(session.user.role)} />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 focus:outline-none">
        {children}
      </main>
    </>
  );
}
