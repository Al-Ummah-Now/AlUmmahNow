'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { retryAdminJob, startLegacyRestore } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { logger } from '@/lib/logger-client';
import { primaryButtonClass, secondaryButtonClass } from './ui';
import { useRefreshWhile } from './content/jobs';

const smallButton =
  'px-2 py-1 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';

/** Queues a failed admin job again (admin-api checks the permissions of the action it re-runs). */
export function JobRetry({ id }: { id: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        data-testid={`job-retry-${id}`}
        className={smallButton}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          const result = await retryAdminJob(id).catch(() => ({ ok: false as const, status: 0, error: 'request failed' }));
          setBusy(false);
          if (!result.ok) {
            logger.warn('[jobs] Retry failed', { id, status: result.status });
            setFailed(true);
            return;
          }
          router.refresh();
        }}
      >
        {busy ? t('adminJobs.retrying') : t('adminJobs.retry')}
      </button>
      {failed && (
        <span role="alert" className="text-danger-fg text-xs">
          {t('adminJobs.retryFailed')}
        </span>
      )}
    </span>
  );
}

/**
 * While a job is queued or running, re-reads the page when a job changes
 * (admin:jobs live updates); polls every few seconds only while the socket is down.
 */
export function RefreshWhileActive({ active }: { active: boolean }) {
  useRefreshWhile(active);
  return null;
}

/** "Run" for the legacy profile restore: asks first, then queues the job for the current dry run. */
export function LegacyRestoreRun({ profiles, fields }: { profiles: number; fields: number }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy' | 'started'>('idle');
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (step === 'confirm') confirmRef.current?.focus();
  }, [step]);

  if (step === 'started') {
    return (
      <p role="status" className="text-fg" data-testid="legacy-restore-started">
        {t('legacyProfiles.started')}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {step === 'idle' ? (
        <button type="button" className={primaryButtonClass} data-testid="legacy-restore-run" onClick={() => { setError(null); setStep('confirm'); }}>
          {t('legacyProfiles.run')}
        </button>
      ) : (
        <div role="group" aria-labelledby="legacy-restore-confirm" className="flex flex-wrap items-center gap-3">
          <p id="legacy-restore-confirm" className="text-fg w-full">{t('legacyProfiles.confirm', { profiles, fields })}</p>
          <button
            ref={confirmRef}
            type="button"
            className={primaryButtonClass}
            disabled={step === 'busy'}
            data-testid="legacy-restore-confirm"
            onClick={async () => {
              setStep('busy');
              const result = await startLegacyRestore().catch((e) => ({ ok: false as const, status: 0, error: e instanceof Error ? e.message : 'request failed' }));
              if (!result.ok) {
                logger.warn('[legacy-profiles] Start failed', { status: result.status });
                setError(result.error);
                setStep('idle');
                return;
              }
              setStep('started');
              router.refresh();
            }}
          >
            {step === 'busy' ? t('legacyProfiles.starting') : t('legacyProfiles.confirmRun')}
          </button>
          <button type="button" className={secondaryButtonClass} disabled={step === 'busy'} onClick={() => setStep('idle')}>
            {t('legacyProfiles.cancel')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger-fg text-sm" data-testid="legacy-restore-error">
          {t('legacyProfiles.startFailed', { error })}
        </p>
      )}
    </div>
  );
}
