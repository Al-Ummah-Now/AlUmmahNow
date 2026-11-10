'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { scanStaleUploads, setReaperMode } from '@/lib/api/admin';
import type { ReaperMode, ReaperSweep } from '@/lib/api/types';
import type { Locale } from '@/i18n/config';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, cardClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

/**
 * The reaper's mode (dry run until an admin turns deletion on), its last
 * scan, and Scan now. Changes go through admin-api (audited).
 */
export function ReaperPanel({
  config,
  sweep,
  locale,
}: {
  config: { mode: ReaperMode; updatedAt?: string; updatedBy?: string };
  sweep: ReaperSweep | null;
  locale: Locale;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<'mode' | 'scan' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = config.mode === 'live';

  async function changeMode() {
    const next: ReaperMode = live ? 'dry-run' : 'live';
    if (next === 'live' && !window.confirm(t('staleUploads.confirmGoLive'))) return;
    setBusy('mode');
    setError(null);
    setNotice(null);
    try {
      const result = await setReaperMode(next);
      if (!result.ok) throw new Error(result.error);
      setNotice(t('staleUploads.modeChanged'));
      router.refresh();
    } catch (e) {
      logger.warn('[stale-uploads] Mode change failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('staleUploads.actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function scan() {
    setBusy('scan');
    setError(null);
    setNotice(null);
    try {
      const result = await scanStaleUploads();
      if (!result.ok) throw new Error(result.error);
      setNotice(t('staleUploads.scanned', { count: result.data.loopsStarted }));
      router.refresh();
    } catch (e) {
      logger.warn('[stale-uploads] Scan failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('staleUploads.actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="reaper-title" className={`${cardClass} grid gap-6 lg:grid-cols-[1fr_auto]`} data-testid="reaper-panel" data-mode={config.mode}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="reaper-title" className="text-xl font-semibold text-fg">{t('staleUploads.reaperTitle')}</h2>
          <span
            data-testid="reaper-mode"
            className={`px-2 py-1 text-sm rounded font-medium ${live ? 'bg-danger-bg text-danger-fg' : 'bg-chip-reviewing-bg text-chip-reviewing-fg'}`}
          >
            {live ? t('staleUploads.modeLive') : t('staleUploads.modeDryRun')}
          </span>
        </div>
        <p className="text-fg-muted max-w-2xl">{live ? t('staleUploads.modeLiveHelp') : t('staleUploads.modeDryRunHelp')}</p>
        {config.updatedAt && config.updatedBy && (
          <p className="text-fg-subtle text-sm">{t('staleUploads.modeBy', { actor: config.updatedBy, date: formatDate(config.updatedAt, locale, true) })}</p>
        )}
        <div className="border-t border-border pt-3 text-sm">
          <div className="font-medium text-fg">{t('staleUploads.lastSweep')}</div>
          {sweep ? (
            <div className="text-fg-muted" data-testid="reaper-sweep">
              <span>{formatDate(sweep.lastRunAt, locale, true)}</span>
              {' · '}
              <span>
                {t('staleUploads.sweepSummary', {
                  records: sweep.recordsScanned,
                  bunny: sweep.bunnyScanned,
                  bunnyTotal: sweep.bunnyTotal,
                  abandoned: sweep.abandonedCandidates,
                  orphans: sweep.orphanCandidates,
                  started: sweep.loopsStarted,
                })}
              </span>
              {sweep.errors > 0 && <span className="block text-danger-fg">{t('staleUploads.sweepErrors', { count: sweep.errors })}</span>}
            </div>
          ) : (
            <div className="text-fg-muted">{t('staleUploads.neverSwept')}</div>
          )}
        </div>
        {error && <ErrorAlert testId="reaper-error">{error}</ErrorAlert>}
        {notice && <p role="status" className="text-success-fg text-sm">{notice}</p>}
      </div>
      <div className="flex flex-col gap-3 lg:items-end">
        <button type="button" onClick={scan} disabled={busy !== null} className={secondaryButtonClass} data-testid="reaper-scan">
          {t('staleUploads.scanNow')}
        </button>
        <button type="button" onClick={changeMode} disabled={busy !== null} className={live ? secondaryButtonClass : primaryButtonClass} data-testid="reaper-toggle">
          {live ? t('staleUploads.goDryRun') : t('staleUploads.goLive')}
        </button>
      </div>
    </section>
  );
}
