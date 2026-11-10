'use client';

import { useLanguage } from '@/i18n/I18nProvider';
import { BoundaryError } from '@/components/FriendlyError';

/** A page inside the admin layout failed: the nav stays, the page shows the friendly screen. */
export default function ProtectedError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale, t } = useLanguage();
  return <BoundaryError error={error} reset={reset} locale={locale} homeLabel={t('common.goToDashboard')} inline />;
}
