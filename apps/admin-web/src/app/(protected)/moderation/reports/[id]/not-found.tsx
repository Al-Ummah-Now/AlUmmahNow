import Link from '@/components/AppLink';
import { getI18n } from '@/i18n/server';
import { cardClass, linkClass } from '@/components/ui';

export default async function ReportNotFound() {
  const { t } = await getI18n();

  return (
    <div className={`${cardClass} text-center`} data-testid="report-not-found">
      <h1 className="text-2xl font-bold text-fg mb-2">{t('notFound.reportTitle')}</h1>
      <p className="text-fg-muted mb-6">{t('notFound.reportDescription')}</p>
      <Link href="/moderation" className={linkClass}>
        {t('report.backToQueue')}
      </Link>
    </div>
  );
}
