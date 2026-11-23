'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/I18nProvider';
import { smallButtonClass } from '@/components/content/parts';
import { Icon } from '@/components/shell/icons';

/** The Features list couldn't be read: say so and offer Retry (reloads the page's data). */
export function FeaturesLoadError() {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tries, setTries] = useState(0);
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-danger-fg" data-testid="features-load-error" data-tries={tries}>
      <p className="flex items-center gap-2">
        <Icon name="alert" className="size-4 shrink-0" />
        {t('features.loadFailed')}
      </p>
      <button
        type="button"
        className={smallButtonClass}
        disabled={pending}
        onClick={() => {
          setTries((n) => n + 1);
          start(() => router.refresh());
        }}
        data-testid="features-retry"
      >
        {pending ? t('common.loading') : t('common.retry')}
      </button>
    </div>
  );
}
