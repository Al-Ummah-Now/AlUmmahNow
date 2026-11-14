import { requireAdminRole } from '@/lib/auth';
import { cookies, headers } from 'next/headers';
import { AdminShell } from '@/components/shell/AdminShell';
import { NAV_COOKIE } from '@/components/shell/nav-model';
import { getContactCounts, getErrorCounts } from '@/lib/api/admin';
import { getUser } from '@/lib/api/content';
import { canReadErrors, canUseContactInbox, canUseProcessing, canManageVideosUsers, canUseStaleUploads, canManageMedia, canReadOps, isReviewOnly, isSuperAdmin } from '@/lib/roles';
import { ErrorReportingIdentity } from '@/lib/errors/ErrorReportingProvider';
import { errorsBadgeCount } from './errors/filters';
import { logger } from '@/lib/logger';
import { UndoToastProvider } from '@/components/undo/UndoToast';
import { PasskeyGraceBanner } from '@/components/PasskeyGraceBanner';
import { adminSetupUrl } from '@/lib/passkeys';
import { PATH_HEADER } from '@/lib/login-flow';

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

  // The account menu names the admin by the platform rule (display name, else first + last; the
  // email only without either): their videos profile through admin-api. Never holds up the page.
  let userName: string | undefined;
  try {
    userName = (await getUser(session.user.id)).displayName || undefined;
  } catch (e) {
    logger.debug('[layout] Profile name unavailable', { error: e instanceof Error ? e.message : String(e) });
  }

  const role = session.user.role;
  const navCookie = (await cookies()).get(NAV_COOKIE)?.value;

  // Staff passkeys, grace period: "Add a passkey by <date>" above every page (lib/passkeys.ts)
  let graceBanner: React.ReactNode = null;
  if (session.passkey.state === 'grace') {
    const h = await headers();
    const host = h.get('host') ?? 'localhost';
    const origin = `${host.includes('localhost') ? 'http' : 'https'}://${host}`;
    const setupUrl = process.env.Issuer ? adminSetupUrl(process.env.Issuer, origin, h.get(PATH_HEADER)) : null;
    graceBanner = <PasskeyGraceBanner deadline={session.passkey.deadline} setupUrl={setupUrl} />;
  }

  return (
    <UndoToastProvider>
      <ErrorReportingIdentity userId={session.user.id} />
      <AdminShell
        userEmail={session.user.email}
        userName={userName}
        userRoles={session.user.role ? [session.user.role] : []}
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
          reviewOnly: isReviewOnly(role),
          superAdmin: isSuperAdmin(role),
        }}
        badges={{ contact: contactNew, errors: errorsBadge }}
      >
        {graceBanner}
        {children}
      </AdminShell>
    </UndoToastProvider>
  );
}
