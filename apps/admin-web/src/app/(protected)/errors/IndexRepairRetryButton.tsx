'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { retryIndexRepairs } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

/**
 * Retry for index repairs that failed after their retries (Errors page, "Index
 * repairs"): puts one repair (`target`) or every failed one back in the repair
 * job's queue (admin-api /api/processing/index-repairs/retry → api-videos
 * lib/search/repairs.ts), which re-reads the object from storage and rewrites
 * its index rows.
 */
export function IndexRepairRetryButton({ target }: { target?: { entity: string; id: string } }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function retry() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await retryIndexRepairs(target);
      if (!result.ok) {
        logger.warn('[errors] Index repair retry refused', { ...target, status: result.status });
        setMessage({ text: result.status === 401 ? t('errors.notAuthenticated') : t('errorsPage.repairRetryFailed'), error: true });
        return;
      }
      setMessage({ text: t('errorsPage.repairRetryQueued'), error: false });
      router.refresh();
    } catch (e) {
      logger.error('[errors] Index repair retry request failed', { ...target, error: e instanceof Error ? e.message : String(e) });
      setMessage({ text: t('errorsPage.repairRetryFailed'), error: true });
    } finally {
      setBusy(false);
    }
  }

  const testId = target ? `index-repair-retry-${target.entity}-${target.id}` : 'index-repair-retry-all';
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className={secondaryButtonClass} onClick={() => void retry()} disabled={busy} data-testid={testId}>
        {busy ? t('errorsPage.repairRetrying') : target ? t('errorsPage.repairRetry') : t('errorsPage.repairRetryAll')}
      </button>
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={`text-xs ${message.error ? 'text-danger-fg' : 'text-fg-muted'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
