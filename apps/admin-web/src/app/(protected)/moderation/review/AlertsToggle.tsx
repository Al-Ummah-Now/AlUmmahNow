'use client';

import { useState } from 'react';
import { setReviewAlerts } from '@/lib/api/review';
import { useLanguage } from '@/i18n/I18nProvider';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

/** Instant alerts for this reviewer (in-app + push; VR6). */
export function AlertsToggle({ initial }: { initial: boolean }) {
  const { t } = useLanguage();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    const result = await setReviewAlerts(!on);
    if (result.ok) setOn(!on);
    else logger.warn('[review] Alerts not changed', { status: result.status });
    setBusy(false);
  };
  return (
    <button type="button" onClick={() => void toggle()} disabled={busy} aria-pressed={on} title={t('review.alertsHelp')} className={on ? primaryButtonClass : secondaryButtonClass} data-testid="review-alerts">
      {on ? t('review.alertsOn') : t('review.alertsOff')}
    </button>
  );
}
