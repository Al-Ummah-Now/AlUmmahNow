'use client';

/**
 * Pieces the Payments page's panels share: one change at a time with its
 * outcome announced, the provider's display name, status chips and the
 * copy button.
 */
import { useCallback, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { Chip } from '@/components/content/parts';
import { AdminClientError } from '@/lib/list/api-client';
import { describeActionError } from '@/lib/list/describe-error';
import { reportError } from '@/lib/errors/reporter';
import { logger } from '@/lib/logger-client';
import type { Tone } from '@/lib/payments';

export const sectionTitle = 'text-lg font-semibold text-fg';
export const labelClass = 'block text-sm font-medium text-fg mb-1';
export const hintClass = 'text-xs text-fg-muted mt-1';

export { providerName } from './provider-name';

export function ToneChip({ tone, children, testId }: { tone: Tone; children: React.ReactNode; testId?: string }) {
  return (
    <Chip tone={tone} testId={testId}>
      {children}
    </Chip>
  );
}

/**
 * Runs one change at a time. A refusal (4xx) is shown in the admin's words; a
 * failure on our side (5xx, network) is also reported to the Errors page.
 */
export function useBillingAction(where: string) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, change: () => Promise<string | null | void>): Promise<boolean> => {
      setBusy(key);
      setError(null);
      setNotice(null);
      try {
        const message = await change();
        if (message) setNotice(message);
        return true;
      } catch (e) {
        const status = e instanceof AdminClientError ? e.status : 0;
        if (status === 0 || status >= 500) reportError(e, { shown: true, status, extra: { where } });
        else logger.debug('[payments] Change refused', { where, status, code: e instanceof AdminClientError ? e.code : undefined });
        setError(describeActionError(t, e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [t, where],
  );

  return { busy, error, notice, run, setError, setNotice };
}

export function CopyButton({ value, className, testId }: { value: string; className: string; testId?: string }) {
  const { t } = useLanguage();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={className}
        data-testid={testId}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState('copied');
          } catch (e) {
            logger.debug('[payments] Copy failed', { error: e instanceof Error ? e.message : String(e) });
            setState('failed');
          }
        }}
      >
        {t('payments.provider.copy')}
      </button>
      <span aria-live="polite" className="text-xs text-fg-muted">
        {state === 'copied' ? t('payments.provider.copied') : state === 'failed' ? t('payments.provider.copyFailed') : ''}
      </span>
    </span>
  );
}
