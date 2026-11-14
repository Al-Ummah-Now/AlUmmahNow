import Link from '@/components/AppLink';
import { getI18n } from '@/i18n/server';
import { cardClass, linkClass } from '@/components/ui';

export default async function CsamCaseNotFound() {
  const { t } = await getI18n();
  return (
    <div className={`${cardClass} text-center`} data-testid="csam-case-not-found">
      <h1 className="text-2xl font-bold text-fg mb-2">{t('csamPage.notFound')}</h1>
      <Link href="/moderation/csam" className={linkClass}>{t('csamPage.back')}</Link>
    </div>
  );
}
