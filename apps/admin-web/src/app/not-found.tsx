import Link from 'next/link';
import { getI18n } from '@/i18n/server';
import { PublicShell } from '@/components/PublicShell';
import { primaryButtonClass } from '@/components/ui';

export default async function NotFound() {
  const { t } = await getI18n();

  return (
    <PublicShell>
      <div className="text-center max-w-md" data-testid="not-found">
        <h1 className="text-3xl font-bold text-fg mb-4">{t('notFound.title')}</h1>
        <p className="text-fg-muted mb-8">{t('notFound.description')}</p>
        <Link href="/dashboard" className={primaryButtonClass}>
          {t('common.goToDashboard')}
        </Link>
      </div>
    </PublicShell>
  );
}
