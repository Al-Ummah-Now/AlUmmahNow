'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setUserCreatorTier } from '@/lib/api/creators';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

export interface TierOption {
  id: string;
  name: string;
}

/**
 * A user's creator tier: a select of every tier plus "No tier", and for a
 * user who needs one a one-click "Make Creator". Saves at once through
 * admin-api (creators:manage + audit); the change applies to the user's next
 * request, without signing in again.
 */
export function TierSelect({
  userId,
  tierId,
  tiers,
  canManage,
  needsTier = false,
  testId = 'creator-tier-select',
}: {
  userId: string;
  tierId: string | null;
  tiers: TierOption[];
  canManage: boolean;
  needsTier?: boolean;
  testId?: string;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [value, setValue] = useState(tierId ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  async function save(next: string) {
    const previous = value;
    setValue(next);
    setState('saving');
    try {
      const result = await setUserCreatorTier(userId, next || null);
      if (!result.ok) throw new Error(`${result.status} ${result.error}`);
      setState('saved');
      router.refresh();
    } catch (error) {
      logger.error('[creators] Tier save failed', { userId, error: error instanceof Error ? error.message : String(error) });
      setValue(previous);
      setState('failed');
    }
  }

  const label = `${t('creators.colTier')}: ${userId}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={label}
          data-testid={testId}
          data-user-id={userId}
          value={value}
          disabled={!canManage || state === 'saving'}
          onChange={(e) => void save(e.target.value)}
          className={`${fieldClass} min-w-40`}
        >
          <option value="">{t('creators.noTier')}</option>
          {tiers.map((tier) => (
            <option key={tier.id} value={tier.id}>{tier.name}</option>
          ))}
        </select>
        {canManage && needsTier && !value && (
          <button type="button" data-testid="creator-assign-creator" className={secondaryButtonClass} disabled={state === 'saving'} onClick={() => void save('creator')}>
            {t('creators.assignCreator')}
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-xs min-h-4" data-testid={`${testId}-status`} data-state={state}>
        {state === 'saving' && <span className="text-fg-muted">{t('creators.saving')}</span>}
        {state === 'saved' && <span className="text-fg-muted">{t('creators.saved')}</span>}
        {state === 'failed' && <span className="text-danger-fg">{t('creators.saveFailed')}</span>}
      </p>
    </div>
  );
}
