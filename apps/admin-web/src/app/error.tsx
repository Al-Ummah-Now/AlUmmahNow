'use client';

import { useLanguage } from '@/i18n/I18nProvider';
import { BoundaryError } from '@/components/FriendlyError';

/** A page outside the admin layout (login, access denied) failed. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale, t } = useLanguage();
  return <BoundaryError error={error} reset={reset} locale={locale} homeLabel={t('common.goToDashboard')} />;
}
