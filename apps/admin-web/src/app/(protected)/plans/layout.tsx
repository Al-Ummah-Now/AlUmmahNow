import { requireAdminRole } from '@/lib/auth';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { canManagePlans } from '@/lib/plan-values';

export const dynamic = 'force-dynamic';

export default async function PlansLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminRole();
  const { t } = await getI18n();
  if (!canManagePlans(session.user.role)) return <ErrorAlert testId="plans-admin-only">{t('plans.adminOnly')}</ErrorAlert>;
  return <>{children}</>;
}
