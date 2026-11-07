'use client';

import { useEffect } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, primaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

export default function ProtectedError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLanguage();

  useEffect(() => {
    logger.error('[admin-web] Unhandled page error', { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg mb-6">{t('errors.title')}</h1>
      <ErrorAlert testId="page-error">{t('common.unknownError')}</ErrorAlert>
      <button type="button" onClick={reset} className={primaryButtonClass}>
        {t('common.retry')}
      </button>
    </div>
  );
}
