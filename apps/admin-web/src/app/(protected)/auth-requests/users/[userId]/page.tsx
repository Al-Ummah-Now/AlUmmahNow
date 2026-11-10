import Link from 'next/link';
import { getI18n } from '@/i18n/server';
import { getAdminSession } from '@/lib/auth';
import { linkClass } from '@/components/ui';
import { UserAuthRequestsPanel } from '@/components/auth-requests/UserAuthRequestsPanel';
import { UserCreatorTierPanel } from '@/components/creators/UserCreatorTierPanel';
import { canManageCreators } from '@/lib/roles';

export const dynamic = 'force-dynamic';

/** One user's requests to auth, and the "Request action from Auth" button. */
export default async function UserAuthRequestsPage({ params }: { params: Promise<{ userId: string }> }) {
  const { t } = await getI18n();
  const { userId } = await params;
  const id = decodeURIComponent(userId);
  const session = await getAdminSession();
  const role = session?.user.role;
  return (
    <div>
      <Link href="/auth-requests" className={`${linkClass} text-sm`}>{t('authRequests.title')}</Link>
      <div className="mt-2 mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('authRequests.userTitle')}</h1>
        <p className="text-fg-muted mt-2" dir="ltr">{t('authRequests.userSubtitle', { id })}</p>
      </div>
      <UserCreatorTierPanel userId={id} canManage={canManageCreators(role)} />
      <UserAuthRequestsPanel subjectUserId={id} canRequest={role === 'admin' || role === 'super_admin'} />
    </div>
  );
}
