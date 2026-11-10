'use client';

/** Settings (kill switch, daily cap, preselect threshold) and the paged, dry-run-first backfill. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { runCategoryBackfill, updateCategorizeConfig } from '@/lib/api/admin';
import type { CategoryBackfillPage, CategorizeConfigView } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

export function CategorizeSettings({ initial }: { initial: CategorizeConfigView }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [cap, setCap] = useState(String(initial.dailyNeuronCap));
  const [threshold, setThreshold] = useState(String(initial.threshold));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const capNumber = Number(cap);
      const thresholdNumber = Number(threshold);
      const result = await updateCategorizeConfig({
        enabled,
        ...(cap !== '' && Number.isFinite(capNumber) ? { dailyNeuronCap: Math.round(capNumber) } : {}),
        ...(threshold !== '' && Number.isFinite(thresholdNumber) ? { threshold: thresholdNumber } : {}),
      });
      if (!result.ok) {
        logger.warn('[category-suggestions] Settings save refused', { status: result.status });
        setError(result.status === 400 ? result.error : t('categorySuggestions.actionFailed'));
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      logger.error('[category-suggestions] Settings save failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('categorySuggestions.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${cardClass} space-y-4`} aria-labelledby="categorize-settings-title" data-testid="categorize-settings">
      <h2 id="categorize-settings-title" className="font-semibold text-fg">{t('categorySuggestions.settingsTitle')}</h2>
      {error && <ErrorAlert testId="categorize-settings-error">{error}</ErrorAlert>}
      <label htmlFor="categorize-enabled" className="flex items-start gap-3">
        <input id="categorize-enabled" type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} className="mt-1 h-4 w-4" data-testid="categorize-enabled" />
        <span>
          <span className="block font-medium text-fg">{t('categorySuggestions.enabled')}</span>
          <span className="block text-sm text-fg-muted">{t('categorySuggestions.enabledHint')}</span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">{t('categorySuggestions.cap')}</span>
          <input type="number" min={0} step={1000} value={cap} onChange={(e) => { setCap(e.target.value); setSaved(false); }} className={fieldClass} data-testid="categorize-cap" />
          <span className="text-fg-muted">{t('categorySuggestions.capHint')}</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">{t('categorySuggestions.threshold')}</span>
          <input type="number" min={0.3} max={0.95} step={0.05} value={threshold} onChange={(e) => { setThreshold(e.target.value); setSaved(false); }} className={fieldClass} data-testid="categorize-threshold" />
          <span className="text-fg-muted">{t('categorySuggestions.thresholdHint')}</span>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className={primaryButtonClass} disabled={busy} onClick={save} data-testid="categorize-save">
          {busy ? t('categorySuggestions.working') : t('categorySuggestions.save')}
        </button>
        {saved && <span role="status" className="text-fg-muted text-sm">{t('categorySuggestions.saved')}</span>}
      </div>
    </section>
  );
}

export function CategoryBackfill() {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [dryRun, setDryRun] = useState(true);
  const [page, setPage] = useState<CategoryBackfillPage | null>(null);
  const [totals, setTotals] = useState({ scanned: 0, queued: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = (v: number) => formatNumber(v, locale);

  async function run(cursor?: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await runCategoryBackfill({ dryRun, ...(cursor ? { cursor } : {}) });
      if (!result.ok) {
        logger.warn('[category-suggestions] Backfill refused', { status: result.status });
        setError(t('categorySuggestions.actionFailed'));
        return;
      }
      setPage(result.data);
      setTotals((s) => (cursor ? { scanned: s.scanned + result.data.scanned, queued: s.queued + result.data.queued } : { scanned: result.data.scanned, queued: result.data.queued }));
      if (!dryRun) router.refresh();
    } catch (e) {
      logger.error('[category-suggestions] Backfill failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('categorySuggestions.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${cardClass} space-y-4`} aria-labelledby="category-backfill-title" data-testid="category-backfill">
      <div>
        <h2 id="category-backfill-title" className="font-semibold text-fg">{t('categorySuggestions.backfillTitle')}</h2>
        <p className="text-sm text-fg-muted mt-1">{t('categorySuggestions.backfillHint')}</p>
      </div>
      {error && <ErrorAlert testId="category-backfill-error">{error}</ErrorAlert>}
      <label htmlFor="category-backfill-dry" className="flex items-center gap-3 text-sm text-fg">
        <input id="category-backfill-dry" type="checkbox" checked={dryRun} onChange={(e) => { setDryRun(e.target.checked); setPage(null); }} className="h-4 w-4" data-testid="category-backfill-dry" />
        {t('categorySuggestions.dryRun')}
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => run()} data-testid="category-backfill-run">
          {busy ? t('categorySuggestions.working') : dryRun ? t('categorySuggestions.dryRun') : t('categorySuggestions.runBackfill')}
        </button>
        {page?.nextCursor && (
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => run(page.nextCursor ?? undefined)} data-testid="category-backfill-next">
            {t('categorySuggestions.continueBackfill')}
          </button>
        )}
      </div>
      {page && (
        <div role="status" className="text-sm space-y-1" data-testid="category-backfill-result" data-dry-run={String(page.dryRun)} data-queued={page.queued} data-done={String(page.done)}>
          <p className="text-fg">
            {t('categorySuggestions.backfillResult', {
              scanned: n(page.scanned),
              candidates: n(page.candidates),
              withCategory: n(page.withCategory),
              alreadyHandled: n(page.alreadyHandled),
              queued: n(page.queued),
            })}
          </p>
          <p className="text-fg-muted">{t('categorySuggestions.backfillTotals', { scanned: n(totals.scanned), queued: n(totals.queued) })}</p>
          {page.done && <p className="text-fg-muted">{t('categorySuggestions.backfillDone')}</p>}
        </div>
      )}
    </section>
  );
}
