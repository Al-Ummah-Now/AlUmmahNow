'use client';

/**
 * Retire a Bunny library: a separate action with its own typed confirmation. Only videos a backfill verified
 * are scheduled, they are deleted from Bunny only after the grace period, and each one is checked again
 * (verified at its current rendition) right before its delete. The primary library cannot be retired, and
 * Bunny's library settings (Block Direct Url File Access included) are never changed.
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BACKFILL_LIMITS, parseDigits, type BunnyRemoval } from '@al-ummah/shared-types';
import { cancelBunnyRemovals, listBunnyRemovals, retryBunnyRemoval, scheduleBunnyRemovals, type BunnyLibraryView } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate } from '@/i18n/translate';
import { useConfirm } from '@/components/content/actions';
import { Chip, smallButtonClass, tableWrapClass, tdClass, thClass } from '@/components/content/parts';
import { ErrorAlert, cardClass, fieldClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { REMOVAL_LABEL, REMOVAL_TONE, dangerLargeButtonClass } from './labels';
import { useFormats } from './useFormats';
import { NumberField } from '@/components/forms/NumberField';

const DEFAULT_GRACE_DAYS = 30;

export function RetireSection({ libraries }: { libraries: BunnyLibraryView[] | null }) {
  const { t } = useLanguage();
  const f = useFormats();
  return (
    <section className={cardClass} aria-labelledby="backfill-retire-title" data-testid="backfill-retire">
      <h2 id="backfill-retire-title" className="text-xl font-semibold text-fg">{t('mediaBackfill.retireTitle')}</h2>
      <p className="text-sm text-fg-muted mt-1 mb-4">{t('mediaBackfill.retireHint', { min: f.integer(BACKFILL_LIMITS.minGraceDays), max: f.integer(BACKFILL_LIMITS.maxGraceDays) })}</p>
      {!libraries && <ErrorAlert testId="backfill-libraries-error">{t('mediaBackfill.librariesFailed')}</ErrorAlert>}
      <div className="grid gap-4 lg:grid-cols-2">
        {libraries?.map((lib) => <Library key={lib.libraryId} lib={lib} />)}
      </div>
    </section>
  );
}

function Library({ lib }: { lib: BunnyLibraryView }) {
  const { t, locale } = useLanguage();
  const f = useFormats();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [grace, setGrace] = useState(String(DEFAULT_GRACE_DAYS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removals, setRemovals] = useState<BunnyRemoval[] | null>(null);
  const graceId = useId();
  const id = String(lib.libraryId);

  const schedule = async () => {
    const days = Number(parseDigits(grace));
    if (!Number.isInteger(days) || days < BACKFILL_LIMITS.minGraceDays || days > BACKFILL_LIMITS.maxGraceDays) {
      setError(t('mediaBackfill.graceInvalid', { min: f.integer(BACKFILL_LIMITS.minGraceDays), max: f.integer(BACKFILL_LIMITS.maxGraceDays) }));
      return;
    }
    const ok = await confirm({ testId: 'backfill-confirm-retiresection-1',
      title: t('mediaBackfill.retireConfirmTitle', { id }),
      body: t('mediaBackfill.retireConfirmBody', { verified: f.integer(lib.verified), days: f.integer(days) }),
      confirmLabel: t('mediaBackfill.retireConfirm'),
      typeToConfirm: id,
      typeToConfirmLabel: t('mediaBackfill.retireTypeLabel', { id }),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    const res = await scheduleBunnyRemovals(lib.libraryId, days, id);
    setBusy(false);
    if (!res.ok) {
      logger.error('[backfill] schedule removals failed', { libraryId: lib.libraryId, status: res.status });
      setError(t('mediaBackfill.retireFailed', { reason: res.error }));
      return;
    }
    setNotice(t('mediaBackfill.retireScheduled', { count: f.integer(res.data.scheduled), date: formatDate(res.data.deleteAfter, locale, true) }));
    router.refresh();
  };

  const cancel = async () => {
    const ok = await confirm({ testId: 'backfill-confirm-retiresection-2', title: t('mediaBackfill.retireCancelTitle'), body: t('mediaBackfill.retireCancelBody'), confirmLabel: t('mediaBackfill.retireCancel') });
    if (!ok) return;
    setBusy(true);
    const res = await cancelBunnyRemovals(lib.libraryId);
    setBusy(false);
    if (!res.ok) {
      logger.error('[backfill] cancel removals failed', { libraryId: lib.libraryId, status: res.status });
      setError(t('mediaBackfill.actionFailed'));
      return;
    }
    setNotice(t('mediaBackfill.retireCancelled', { count: f.integer(res.data.cancelled) }));
    router.refresh();
  };

  const show = async () => {
    const res = await listBunnyRemovals(lib.libraryId);
    if (!res.ok) {
      logger.error('[backfill] removals failed to load', { libraryId: lib.libraryId, status: res.status });
      setError(t('mediaBackfill.removalsFailed'));
      return;
    }
    setRemovals(res.data.removals);
  };

  const retry = async (videoId: string) => {
    const res = await retryBunnyRemoval(videoId);
    if (!res.ok) {
      logger.error('[backfill] removal retry failed', { videoId, status: res.status });
      setError(t('mediaBackfill.retryFailed'));
      return;
    }
    await show();
  };

  return (
    <div className="rounded-lg border border-border p-4" data-testid="backfill-library" data-library={id}>
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-fg">{t('mediaBackfill.library', { id })}</h3>
        <Chip tone={lib.primary ? 'info' : 'neutral'}>{lib.primary ? t('mediaBackfill.libraryPrimary') : t('mediaBackfill.libraryLegacy')}</Chip>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><dt className="text-fg-muted text-xs">{t('mediaBackfill.libVerified')}</dt><dd className="font-medium text-fg">{f.integer(lib.verified)}</dd></div>
        <div><dt className="text-fg-muted text-xs">{t('mediaBackfill.libScheduled')}</dt><dd className="font-medium text-fg">{f.integer(lib.scheduled)}</dd></div>
        <div><dt className="text-fg-muted text-xs">{t('mediaBackfill.libRemoved')}</dt><dd className="font-medium text-fg">{f.integer(lib.removed)}</dd></div>
        <div><dt className="text-fg-muted text-xs">{t('mediaBackfill.libFailed')}</dt><dd className="font-medium text-fg">{f.integer(lib.failed)}</dd></div>
      </dl>
      {lib.nextDeleteAfter && <p className="mt-2 text-sm text-fg">{t('mediaBackfill.nextDelete', { date: formatDate(lib.nextDeleteAfter, locale, true) })}</p>}
      {error && <div className="mt-3"><ErrorAlert>{error}</ErrorAlert></div>}
      {notice && <p role="status" className="mt-3 text-sm text-fg">{notice}</p>}

      {lib.primary ? (
        <p className="mt-3 text-sm text-fg-muted">{t('mediaBackfill.primaryNotRetirable')}</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={graceId} className="text-sm font-medium text-fg">{t('mediaBackfill.graceDays')}</label>
            <NumberField id={graceId} min={BACKFILL_LIMITS.minGraceDays} max={BACKFILL_LIMITS.maxGraceDays} value={grace} onChange={(e) => setGrace(e.target.value)} className={`${fieldClass} w-28`} data-testid="backfill-grace" />
          </div>
          <button type="button" disabled={busy || lib.verified === 0} onClick={schedule} className={dangerLargeButtonClass} data-testid="backfill-retire-go">{t('mediaBackfill.retire')}</button>
          {lib.scheduled > 0 && <button type="button" disabled={busy} onClick={cancel} className={secondaryButtonClass} data-testid="backfill-retire-cancel">{t('mediaBackfill.retireCancel')}</button>}
        </div>
      )}

      {(lib.scheduled > 0 || lib.removed > 0 || lib.failed > 0) && (
        <button type="button" onClick={show} className={`${smallButtonClass} mt-3`}>{t('mediaBackfill.showRemovals')}</button>
      )}
      {removals && (
        removals.length === 0 ? <p className="mt-3 text-sm text-fg-muted">{t('mediaBackfill.removalsEmpty')}</p> : (
          <div className={`${tableWrapClass} mt-3`}>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('mediaBackfill.removalsTitle', { id })}</caption>
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={thClass}>{t('mediaBackfill.colVideo')}</th>
                  <th scope="col" className={thClass}>{t('mediaBackfill.colState')}</th>
                  <th scope="col" className={thClass}>{t('mediaBackfill.colWhen')}</th>
                </tr>
              </thead>
              <tbody>
                {removals.map((r) => (
                  <tr key={r.videoId} className="border-b border-border last:border-0" data-testid="backfill-removal" data-state={r.status}>
                    <td className={`${tdClass} font-mono text-xs`} dir="ltr">{r.videoId}</td>
                    <td className={tdClass}>
                      <Chip tone={REMOVAL_TONE[r.status]}>{t(REMOVAL_LABEL[r.status])}</Chip>
                      {r.error && <div className="text-danger-fg text-xs mt-1 break-words">{r.error}</div>}
                      {r.status === 'failed' && <button type="button" onClick={() => retry(r.videoId)} className={`${smallButtonClass} mt-2`}>{t('mediaBackfill.retry')}</button>}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap`}>{formatDate(r.removedAt ?? r.deleteAfter, locale, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
