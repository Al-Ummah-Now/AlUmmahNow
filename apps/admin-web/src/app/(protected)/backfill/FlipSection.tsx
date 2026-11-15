'use client';

/**
 * "Play R2 first" per channel and everywhere, through the provider settings (the same settings as the
 * Delivery page). Bunny stays the fallback, and a video without a ready R2 copy keeps playing Bunny.
 * Per video is in the run's video list (verified videos only).
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MediaProviderId } from '@al-ummah/shared-types';
import { flipBackfill, getChannelVerification } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { useConfirm } from '@/components/content/actions';
import { smallButtonClass } from '@/components/content/parts';
import { ErrorAlert, cardClass, fieldClass, secondaryButtonClass } from '@/components/ui';
import { PROVIDER_LABEL } from '@/lib/media/providers-form';
import { logger } from '@/lib/logger-client';
import { useFormats } from './labels';

export function FlipSection({ globalOrder }: { globalOrder: MediaProviderId[] | null }) {
  const { t } = useLanguage();
  const f = useFormats();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [channelId, setChannelId] = useState('');
  const [verification, setVerification] = useState<{ videos: number; verified: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const channelField = useId();
  const r2First = globalOrder?.[0] === 'r2';

  const check = async () => {
    setError(null);
    const res = await getChannelVerification(channelId.trim());
    if (!res.ok) {
      logger.error('[backfill] channel verification failed', { status: res.status });
      setError(t('mediaBackfill.channelCheckFailed'));
      return null;
    }
    setVerification(res.data);
    return res.data;
  };

  const flipChannel = async (undo: boolean) => {
    const v = verification ?? (await check());
    if (!v) return;
    const ok = await confirm({ testId: 'backfill-confirm-flipsection-1',
      title: undo ? t('mediaBackfill.channelUndoTitle') : t('mediaBackfill.channelFlipTitle'),
      body: undo ? t('mediaBackfill.channelUndoBody') : t('mediaBackfill.channelFlipBody', { verified: f.integer(v.verified), videos: f.integer(v.videos) }),
      confirmLabel: undo ? t('mediaBackfill.flipUndo') : t('mediaBackfill.flipChannel'),
    });
    if (!ok) return;
    setBusy(true);
    const res = await flipBackfill({ target: 'channel', channelId: channelId.trim(), undo });
    setBusy(false);
    if (!res.ok) {
      logger.error('[backfill] channel flip failed', { status: res.status });
      setError(t('mediaBackfill.flipFailed', { reason: res.error }));
      return;
    }
    setNotice(undo ? t('mediaBackfill.channelUndone') : t('mediaBackfill.channelFlipped'));
    router.refresh();
  };

  const flipGlobal = async (undo: boolean) => {
    const ok = await confirm({ testId: 'backfill-confirm-flipsection-2',
      title: undo ? t('mediaBackfill.globalUndoTitle') : t('mediaBackfill.globalFlipTitle'),
      body: undo ? t('mediaBackfill.globalUndoBody') : t('mediaBackfill.globalFlipBody'),
      confirmLabel: undo ? t('mediaBackfill.flipUndo') : t('mediaBackfill.flipGlobal'),
      typeToConfirm: undo ? undefined : 'R2',
    });
    if (!ok) return;
    setBusy(true);
    const res = await flipBackfill({ target: 'global', undo });
    setBusy(false);
    if (!res.ok) {
      logger.error('[backfill] global flip failed', { status: res.status });
      setError(t('mediaBackfill.flipFailed', { reason: res.error }));
      return;
    }
    setNotice(undo ? t('mediaBackfill.globalUndone') : t('mediaBackfill.globalFlipped'));
    router.refresh();
  };

  return (
    <section className={cardClass} aria-labelledby="backfill-flip-title" data-testid="backfill-flip">
      {dialog}
      <h2 id="backfill-flip-title" className="text-xl font-semibold text-fg">{t('mediaBackfill.flipTitle')}</h2>
      <p className="text-sm text-fg-muted mt-1 mb-4">{t('mediaBackfill.flipHint')}</p>
      {error && <ErrorAlert testId="backfill-flip-error">{error}</ErrorAlert>}
      {notice && <p role="status" className="mb-3 text-sm text-fg" data-testid="backfill-flip-notice">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="font-semibold text-fg mb-2">{t('mediaBackfill.flipChannelTitle')}</h3>
          <label htmlFor={channelField} className="text-sm font-medium text-fg">{t('mediaBackfill.channelId')}</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input id={channelField} value={channelId} onChange={(e) => { setChannelId(e.target.value); setVerification(null); }} className={`${fieldClass} flex-1 min-w-0`} dir="ltr" autoComplete="off" data-testid="backfill-flip-channel" />
            <button type="button" disabled={!channelId.trim() || busy} onClick={check} className={smallButtonClass}>{t('mediaBackfill.channelCheck')}</button>
          </div>
          {verification && (
            <p className="mt-2 text-sm text-fg" role="status" data-testid="backfill-channel-verification">
              {t('mediaBackfill.channelVerified', { verified: f.integer(verification.verified), videos: f.integer(verification.videos) })}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={!channelId.trim() || busy} onClick={() => flipChannel(false)} className={secondaryButtonClass} data-testid="backfill-flip-channel-go">{t('mediaBackfill.flipChannel')}</button>
            <button type="button" disabled={!channelId.trim() || busy} onClick={() => flipChannel(true)} className={secondaryButtonClass}>{t('mediaBackfill.flipUndo')}</button>
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-fg mb-2">{t('mediaBackfill.flipGlobalTitle')}</h3>
          <p className="text-sm text-fg" data-testid="backfill-global-order">
            {globalOrder ? t('mediaBackfill.globalOrder', { order: globalOrder.map((p) => t(PROVIDER_LABEL[p])).join(' → ') }) : t('mediaBackfill.globalOrderUnknown')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!r2First && <button type="button" disabled={busy} onClick={() => flipGlobal(false)} className={secondaryButtonClass} data-testid="backfill-flip-global">{t('mediaBackfill.flipGlobal')}</button>}
            {r2First && <button type="button" disabled={busy} onClick={() => flipGlobal(true)} className={secondaryButtonClass} data-testid="backfill-unflip-global">{t('mediaBackfill.flipUndo')}</button>}
          </div>
        </div>
      </div>
    </section>
  );
}
