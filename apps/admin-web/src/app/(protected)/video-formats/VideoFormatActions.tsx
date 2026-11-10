'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setVideoFormat, startVideoFormatBackfill } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

const smallButton =
  'px-3 py-1.5 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';

/** Start a dry run or a real backfill (queued; api-videos runs it). */
export function RunBackfill() {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await startVideoFormatBackfill(dryRun).catch((e) => {
      logger.error('[video-formats] Start request failed', { error: e instanceof Error ? e.message : String(e) });
      return { ok: false as const, status: 0, error: 'request failed' };
    });
    setBusy(false);
    if (!result.ok) {
      setError(t('videoFormats.failed'));
      return;
    }
    setMessage(t('videoFormats.started'));
    router.refresh();
  }

  return (
    <div>
      {error && <ErrorAlert testId="video-formats-start-error">{error}</ErrorAlert>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => start(true)} data-testid="video-formats-dry-run">
          {busy ? t('videoFormats.starting') : t('videoFormats.dryRun')}
        </button>
        <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => start(false)} data-testid="video-formats-apply">
          {busy ? t('videoFormats.starting') : t('videoFormats.apply')}
        </button>
      </div>
      {message && <p role="status" className="text-sm text-fg mt-3" data-testid="video-formats-started">{message}</p>}
    </div>
  );
}

/** Set one flagged video to Short or video. */
export function SetFormatButtons({ id }: { id: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function set(format: 'short' | 'video') {
    setBusy(true);
    setFailed(false);
    const result = await setVideoFormat([id], format).catch(() => ({ ok: false as const, status: 0, error: 'request failed' }));
    setBusy(false);
    if (!result.ok || result.data.results.some((r) => r.error)) {
      logger.warn('[video-formats] Set format failed', { id, format });
      setFailed(true);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button type="button" className={smallButton} disabled={busy} onClick={() => set('short')} data-testid="video-formats-set-short">
          {t('videoFormats.setShort')}
        </button>
        <button type="button" className={smallButton} disabled={busy} onClick={() => set('video')} data-testid="video-formats-set-video">
          {t('videoFormats.setVideo')}
        </button>
      </div>
      {failed && <span role="alert" className="text-xs text-danger-fg">{t('videoFormats.failed')}</span>}
    </div>
  );
}
