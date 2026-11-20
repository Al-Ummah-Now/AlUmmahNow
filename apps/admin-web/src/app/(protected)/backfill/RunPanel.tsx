'use client';

/**
 * One backfill run: its estimate (from real sizes), the settings (concurrency, spacing, budget cap), Start /
 * Pause / Resume / Cancel, live progress (polled while it estimates or runs), and its videos with per-item
 * errors, Retry, and "Play R2 first" for verified ones. docs/media-delivery/BACKFILL.md.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { BACKFILL_LIMITS, parseDigits, type BackfillItem, type BackfillItemState, type BackfillRun } from '@al-ummah/shared-types';
import {
  backfillRunAction,
  flipBackfill,
  getBackfillRun,
  listBackfillItems,
  retryBackfillItem,
  saveBackfillSettings,
} from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate } from '@/i18n/translate';
import { useConfirm } from '@/components/content/actions';
import { Chip, smallButtonClass, tableWrapClass, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { deliveryFormats } from '../delivery/format';
import { ITEM_STATES, ITEM_STATE_LABEL, ITEM_TONE, RUN_STATUS_LABEL, RUN_TONE, SKIP_LABEL, STEP_LABEL, isLive, scopeChannelRefs, scopeText, dangerLargeButtonClass } from './labels';
import { useFormats } from './useFormats';
import { useNames } from '@/components/audit/useNames';
import { NumberField } from '@/components/forms/NumberField';
import { Select } from '@/components/select/Select';

const POLL_MS = 5000;

export function RunPanel({ initial }: { initial: BackfillRun }) {
  const { t, locale } = useLanguage();
  const f = useFormats();
  const { confirm, dialog } = useConfirm();
  const [run, setRun] = useState(initial);
  const names = useNames(scopeChannelRefs([run]));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<BackfillItemState | ''>('');
  const [items, setItems] = useState<BackfillItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState({ concurrency: String(initial.settings.concurrency), spacing: String(initial.settings.spacingSeconds), budget: String(initial.settings.budgetUsd) });
  const ids = { concurrency: useId(), spacing: useId(), budget: useId(), filter: useId() };

  useEffect(() => {
    setRun(initial);
    setSettings({ concurrency: String(initial.settings.concurrency), spacing: String(initial.settings.spacingSeconds), budget: String(initial.settings.budgetUsd) });
  }, [initial]);

  const loadItems = useCallback(
    async (more = false) => {
      const res = await listBackfillItems(run.id, { state: filter || undefined, cursor: more ? cursor : null });
      if (!res.ok) {
        logger.error('[backfill] items failed to load', { runId: run.id, status: res.status });
        setError(t('mediaBackfill.itemsFailed'));
        return;
      }
      setItems((prev) => (more ? [...prev, ...res.data.items] : res.data.items));
      setCursor(res.data.cursor);
    },
    [run.id, filter, cursor, t],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void loadItems(false), [run.id, filter]);

  // Live progress while it estimates or runs
  useEffect(() => {
    if (!isLive(run.status)) return;
    const timer = setInterval(async () => {
      const res = await getBackfillRun(run.id);
      if (res.ok) setRun(res.data.run);
      await loadItems(false);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [run.id, run.status, loadItems]);

  const act = async (action: 'start' | 'pause' | 'cancel' | 'retry-failed') => {
    if (action === 'start') {
      const ok = await confirm({ testId: 'backfill-confirm-runpanel-1',
        title: t('mediaBackfill.startTitle'),
        body: t('mediaBackfill.startBody', { cap: f.usd(run.settings.budgetUsd), estimate: f.usd(run.estimate?.totalUsd ?? 0) }),
        confirmLabel: run.status === 'paused' || run.status === 'stopped_budget' ? t('mediaBackfill.resume') : t('mediaBackfill.start'),
      });
      if (!ok) return;
    }
    if (action === 'cancel') {
      const ok = await confirm({ testId: 'backfill-confirm-runpanel-2', title: t('mediaBackfill.cancelTitle'), body: t('mediaBackfill.cancelBody'), confirmLabel: t('mediaBackfill.cancelRun') });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await backfillRunAction(run.id, action);
    setBusy(false);
    if (!res.ok) {
      logger.error('[backfill] run action failed', { runId: run.id, action, status: res.status });
      setError(res.status === 409 ? t('mediaBackfill.refused', { reason: res.error }) : t('mediaBackfill.actionFailed'));
      return;
    }
    setRun(res.data.run);
    if (action === 'retry-failed') setNotice(t('mediaBackfill.retriedCount', { count: f.integer(res.data.retried ?? 0) }));
    await loadItems(false);
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const concurrency = Number(parseDigits(settings.concurrency));
    const spacingSeconds = Number(parseDigits(settings.spacing));
    const budgetUsd = Math.round(Number(parseDigits(settings.budget)) * 100) / 100;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > BACKFILL_LIMITS.maxConcurrency || !Number.isInteger(spacingSeconds) || spacingSeconds < 0 || spacingSeconds > BACKFILL_LIMITS.maxSpacingSeconds || !(budgetUsd >= 0) || budgetUsd > BACKFILL_LIMITS.maxBudgetUsd) {
      setError(t('mediaBackfill.settingsInvalid', { maxConcurrency: f.integer(BACKFILL_LIMITS.maxConcurrency), maxSpacing: f.integer(BACKFILL_LIMITS.maxSpacingSeconds), maxBudget: f.integer(BACKFILL_LIMITS.maxBudgetUsd) }));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await saveBackfillSettings(run.id, { concurrency, spacingSeconds, budgetUsd });
    setBusy(false);
    if (!res.ok) {
      logger.error('[backfill] settings failed', { runId: run.id, status: res.status });
      setError(t('mediaBackfill.settingsFailed', { reason: res.error }));
      return;
    }
    setRun(res.data.run);
    setNotice(t('mediaBackfill.settingsSaved'));
  };

  const retry = async (videoId: string) => {
    const res = await retryBackfillItem(run.id, videoId);
    if (!res.ok || !res.data.retried) {
      logger.error('[backfill] item retry failed', { runId: run.id, videoId, status: res.ok ? 200 : res.status });
      setError(t('mediaBackfill.retryFailed'));
      return;
    }
    const fresh = await getBackfillRun(run.id);
    if (fresh.ok) setRun(fresh.data.run);
    await loadItems(false);
  };

  const flip = async (undo: boolean) => {
    const videoIds = [...selected];
    const ok = await confirm({ testId: 'backfill-confirm-runpanel-3',
      title: undo ? t('mediaBackfill.flipUndoTitle') : t('mediaBackfill.flipVideosTitle'),
      body: undo ? t('mediaBackfill.flipUndoBody', { count: f.integer(videoIds.length) }) : t('mediaBackfill.flipVideosBody', { count: f.integer(videoIds.length) }),
      confirmLabel: undo ? t('mediaBackfill.flipUndo') : t('mediaBackfill.flipVideos'),
    });
    if (!ok) return;
    setBusy(true);
    const res = await flipBackfill({ target: 'videos', videoIds, undo });
    setBusy(false);
    if (!res.ok) {
      logger.error('[backfill] video flip failed', { status: res.status, count: videoIds.length });
      setError(t('mediaBackfill.flipFailed', { reason: res.error }));
      return;
    }
    setSelected(new Set());
    setNotice(t('mediaBackfill.flipDone', { flipped: f.integer(res.data.flipped?.length ?? 0), refused: f.integer(res.data.refused?.length ?? 0) }));
  };

  const est = run.estimate;
  const canStart = (run.status === 'estimated' || run.status === 'paused' || run.status === 'stopped_budget') && run.settings.budgetUsd > 0;
  const editable = run.status !== 'cancelled' && run.status !== 'done' && run.status !== 'failed' && run.status !== 'estimating';
  const spentPct = run.settings.budgetUsd > 0 ? Math.min(100, (run.spent.totalUsd / run.settings.budgetUsd) * 100) : 0;
  const finished = run.counts.verified + run.counts.failed + run.counts.skipped + run.counts.cancelled;
  const donePct = run.counts.total > 0 ? Math.round((finished / run.counts.total) * 100) : 0;

  return (
    <section aria-labelledby="backfill-run-title" data-testid="backfill-run" data-run={run.id} data-status={run.status} className="space-y-6">
      {dialog}
      <div className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="backfill-run-title" className="text-xl font-semibold text-fg">
              {t('mediaBackfill.runTitle')} <span className="font-mono text-base text-fg-muted" dir="ltr">{run.id}</span>
            </h2>
            <p className="text-sm text-fg-muted mt-1">
              {t('mediaBackfill.scopeLine', { scope: scopeText(run, t, names) })} • {formatDate(run.createdAt, locale, true)}
            </p>
          </div>
          <Chip tone={RUN_TONE[run.status]} large testId="backfill-run-status">{t(RUN_STATUS_LABEL[run.status])}</Chip>
        </div>
        {run.stopReason && <p className="mt-3 text-sm text-fg" data-testid="backfill-stop-reason">{t('mediaBackfill.stopReason', { reason: run.stopReason })}</p>}

        {run.status === 'estimating' && <p className="mt-4 text-fg-muted" role="status">{t('mediaBackfill.estimating')}</p>}
        {est && (
          <div className="mt-5" data-testid="backfill-estimate">
            <h3 className="font-semibold text-fg mb-3">{t('mediaBackfill.estimateTitle')}</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={t('mediaBackfill.estVideos')} value={f.integer(est.videos)} />
              <Stat label={t('mediaBackfill.estTranscode')} value={`${f.integer(est.transcodeSeconds / 60)} • ${f.usd(est.transcodeUsd)}`} />
              <Stat label={t('mediaBackfill.estEgress')} value={`${f.gb(est.egressBytes / 1e9)} • ${f.usd(est.egressUsd)}`} />
              <Stat label={t('mediaBackfill.estStorage')} value={`${f.gb(est.storageBytes / 1e9)} • ${f.usd(est.storageUsdMonth)}`} />
              <Stat label={t('mediaBackfill.estOps')} value={`${f.integer(est.classAOps)} • ${f.usd(est.opsUsd)}`} />
              <Stat label={t('mediaBackfill.estTotal')} value={f.usd(est.totalUsd)} strong testId="backfill-estimate-total" />
            </dl>
            {est.ceiling && (
              <p className="mt-3 text-sm text-fg" data-testid="backfill-estimate-ceiling">
                {t('mediaBackfill.estCeiling', { ceiling: f.usd(est.ceiling.totalUsd), transcode: f.integer(est.ceiling.transcodeSeconds / 60) })}
              </p>
            )}
            <p className="mt-3 text-sm text-fg-muted">
              {est.basis.assumed ? t('mediaBackfill.basisAssumed') : t('mediaBackfill.basisMeasured', { jobs: f.integer(est.basis.jobs) })}
              {' '}{t('mediaBackfill.estVideoTime', { time: f.duration(est.videoSeconds) })}
            </p>
            {Object.keys(est.skipped).length > 0 && (
              <p className="mt-1 text-sm text-fg-muted" data-testid="backfill-skipped">
                {t('mediaBackfill.skippedLine', { list: Object.entries(est.skipped).map(([k, n]) => `${t(SKIP_LABEL[k as keyof typeof SKIP_LABEL])}: ${f.integer(n ?? 0)}`).join(' • ') })}
              </p>
            )}
          </div>
        )}

        {run.counts.total > 0 && run.status !== 'estimating' && run.status !== 'estimated' && (
          <div className="mt-5" data-testid="backfill-progress">
            <div className="flex flex-wrap justify-between gap-2 text-sm text-fg">
              <span>{t('mediaBackfill.progress', { done: f.integer(finished), total: f.integer(run.counts.total) })}</span>
              <span>{t('mediaBackfill.spent', { spent: f.usd(run.spent.totalUsd), cap: f.usd(run.settings.budgetUsd) })}</span>
            </div>
            <div className="mt-2 h-2 rounded bg-surface-2 overflow-hidden" role="progressbar" aria-label={t('mediaBackfill.progressLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={donePct}>
              <div className="h-full bg-accent" style={{ width: `${donePct}%` }} />
            </div>
            <div className="mt-2 h-2 rounded bg-surface-2 overflow-hidden" role="progressbar" aria-label={t('mediaBackfill.budgetLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(spentPct)}>
              <div className={`h-full ${spentPct >= 90 ? 'bg-danger-fg' : 'bg-fg-muted'}`} style={{ width: `${spentPct}%` }} />
            </div>
            <ul className="mt-3 flex flex-wrap gap-2 text-sm" aria-label={t('mediaBackfill.countsLabel')}>
              {ITEM_STATES.filter((s) => run.counts[s] > 0).map((s) => (
                <li key={s}><Chip tone={ITEM_TONE[s]}>{t(ITEM_STATE_LABEL[s])}: {f.integer(run.counts[s])}</Chip></li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && <ErrorAlert testId="backfill-error">{error}</ErrorAlert>}
      {notice && <p role="status" className="text-sm text-fg" data-testid="backfill-notice">{notice}</p>}

      {editable && (
        <form onSubmit={saveSettings} className={cardClass} data-testid="backfill-settings" aria-labelledby="backfill-settings-title">
          <h3 id="backfill-settings-title" className="font-semibold text-fg mb-3">{t('mediaBackfill.settingsTitle')}</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id={ids.concurrency} label={t('mediaBackfill.concurrency')} hint={t('mediaBackfill.concurrencyHint')}>
              <NumberField id={ids.concurrency} min={1} max={BACKFILL_LIMITS.maxConcurrency} value={settings.concurrency} onChange={(e) => setSettings({ ...settings, concurrency: e.target.value })} className={fieldClass} />
            </Field>
            <Field id={ids.spacing} label={t('mediaBackfill.spacing')} hint={t('mediaBackfill.spacingHint')}>
              <NumberField id={ids.spacing} min={0} max={BACKFILL_LIMITS.maxSpacingSeconds} value={settings.spacing} onChange={(e) => setSettings({ ...settings, spacing: e.target.value })} className={fieldClass} />
            </Field>
            <Field id={ids.budget} label={t('mediaBackfill.budget')} hint={t('mediaBackfill.budgetHint')}>
              <NumberField decimal id={ids.budget} min={0} step="0.01" max={BACKFILL_LIMITS.maxBudgetUsd} value={settings.budget} onChange={(e) => setSettings({ ...settings, budget: e.target.value })} className={fieldClass} data-testid="backfill-budget" />
            </Field>
          </div>
          <button type="submit" disabled={busy} className={`${secondaryButtonClass} mt-4`}>{t('mediaBackfill.saveSettings')}</button>
        </form>
      )}

      <div className="flex flex-wrap gap-3" data-testid="backfill-actions">
        {canStart && (
          <button type="button" disabled={busy} onClick={() => act('start')} className={primaryButtonClass} data-testid="backfill-start">
            {run.status === 'estimated' ? t('mediaBackfill.start') : t('mediaBackfill.resume')}
          </button>
        )}
        {run.status === 'estimated' && run.settings.budgetUsd <= 0 && <p className="text-sm text-fg-muted self-center">{t('mediaBackfill.needsBudget')}</p>}
        {run.status === 'running' && <button type="button" disabled={busy} onClick={() => act('pause')} className={secondaryButtonClass} data-testid="backfill-pause">{t('mediaBackfill.pause')}</button>}
        {run.counts.failed > 0 && <button type="button" disabled={busy} onClick={() => act('retry-failed')} className={secondaryButtonClass} data-testid="backfill-retry-failed">{t('mediaBackfill.retryFailedAll')}</button>}
        {editable && <button type="button" disabled={busy} onClick={() => act('cancel')} className={dangerLargeButtonClass} data-testid="backfill-cancel">{t('mediaBackfill.cancelRun')}</button>}
      </div>

      <section aria-labelledby="backfill-items-title" data-testid="backfill-items">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h3 id="backfill-items-title" className="text-lg font-semibold text-fg">{t('mediaBackfill.itemsTitle')}</h3>
          <div className="flex flex-wrap items-end gap-2">
            {selected.size > 0 && (
              <>
                <button type="button" disabled={busy} onClick={() => flip(false)} className={smallButtonClass} data-testid="backfill-flip-videos">{t('mediaBackfill.flipSelected', { count: f.integer(selected.size) })}</button>
                <button type="button" disabled={busy} onClick={() => flip(true)} className={smallButtonClass} data-testid="backfill-unflip-videos">{t('mediaBackfill.flipUndo')}</button>
              </>
            )}
            <label htmlFor={ids.filter} className="flex flex-col gap-1 text-sm text-fg-muted">
              {t('mediaBackfill.filter')}
              <Select id={ids.filter} value={filter} onChange={(e) => setFilter(e.target.value as BackfillItemState | '')} className={fieldClass} data-testid="backfill-filter">
                <option value="">{t('mediaBackfill.filterAll')}</option>
                {ITEM_STATES.map((s) => <option key={s} value={s}>{t(ITEM_STATE_LABEL[s])}</option>)}
              </Select>
            </label>
          </div>
        </div>
        {items.length === 0 ? (
          <div className={`${cardClass} text-center text-fg-muted`} data-testid="backfill-items-empty">{t('mediaBackfill.itemsEmpty')}</div>
        ) : (
          <div className={tableWrapClass}>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('mediaBackfill.itemsTitle')}</caption>
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={thClass}><span className="sr-only">{t('mediaBackfill.select')}</span></th>
                  <th scope="col" className={thClass}>{t('mediaBackfill.colVideo')}</th>
                  <th scope="col" className={thClass}>{t('mediaBackfill.colStateDetail')}</th>
                  <th scope="col" className={`${thClass} ${wideOnly}`}>{t('mediaBackfill.colSize')}</th>
                  <th scope="col" className={`${thClass} ${wideOnly}`}>{t('mediaBackfill.colCost')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ItemRow key={item.videoId} item={item} f={f} selected={selected.has(item.videoId)} onSelect={(on) => setSelected((prev) => { const next = new Set(prev); if (on) next.add(item.videoId); else next.delete(item.videoId); return next; })} onRetry={() => retry(item.videoId)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && <button type="button" onClick={() => loadItems(true)} className={`${secondaryButtonClass} mt-3`} data-testid="backfill-more">{t('mediaBackfill.more')}</button>}
      </section>
    </section>
  );
}

function ItemRow({ item, f, selected, onSelect, onRetry }: { item: BackfillItem; f: ReturnType<typeof deliveryFormats>; selected: boolean; onSelect: (on: boolean) => void; onRetry: () => void }) {
  const { t } = useLanguage();
  const label = item.title || item.videoId;
  const checks = item.checks;
  return (
    <tr className="border-b border-border last:border-0" data-testid="backfill-item" data-video={item.videoId} data-state={item.state}>
      <td className={tdClass}>
        {item.state === 'verified' && (
          <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={t('mediaBackfill.selectVideo', { title: label })} className="h-5 w-5" />
        )}
      </td>
      <td className={tdClass}>
        <div className="font-medium text-fg break-words" title={item.videoId}>{label}</div>
        {!item.title && <div className="font-mono text-xs text-fg-muted truncate max-w-[8rem] md:max-w-none" dir="ltr" title={item.videoId}>{item.videoId}</div>}
        <div className="md:hidden text-xs text-fg-muted mt-1">{item.sourceBytes ? f.gb(item.sourceBytes / 1e9) : ''} {item.spentUsd > 0 ? `• ${f.usd(item.spentUsd)}` : ''}</div>
      </td>
      <td className={`${tdClass} min-w-[9rem]`}>
        <Chip tone={ITEM_TONE[item.state]}>{t(ITEM_STATE_LABEL[item.state])}</Chip>
        {item.skipReason && <div className="text-xs text-fg-muted mt-1">{t(SKIP_LABEL[item.skipReason])}</div>}
        <div className="mt-1 text-sm">
        {item.error && (
          <div className="text-danger-fg break-words" data-testid="backfill-item-error">
            {item.errorStep ? `${t(STEP_LABEL[item.errorStep as keyof typeof STEP_LABEL] ?? 'mediaBackfill.stepOther')}: ` : ''}{item.error}
          </div>
        )}
        {checks && item.state === 'verified' && (
          <div className="text-xs text-fg-muted" data-testid="backfill-item-checks">
            {t('mediaBackfill.checksLine', { rungs: `\u2066${(checks.renditions.rungs ?? []).join(', ')}\u2069`, objects: f.integer(checks.objects.checked ?? 0), duration: checks.duration.r2Seconds ? f.duration(checks.duration.r2Seconds) : '—' })}
          </div>
        )}
        {item.state === 'failed' && (
          <button type="button" onClick={onRetry} className={`${smallButtonClass} mt-2`} data-testid="backfill-item-retry">{t('mediaBackfill.retry')}</button>
        )}
        </div>
      </td>
      <td className={`${tdClass} ${wideOnly} whitespace-nowrap`}>
        {item.sourceBytes ? f.gb(item.sourceBytes / 1e9) : '—'}
        <div className="text-xs text-fg-muted">{item.hasOriginal ? t('mediaBackfill.hasOriginal') : item.sourceFile ?? ''}</div>
      </td>
      <td className={`${tdClass} ${wideOnly} whitespace-nowrap`}>{f.usd(item.spentUsd)} / {f.usd(item.estUsd)}</td>
    </tr>
  );
}

function Stat({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={`${strong ? 'text-lg font-bold' : 'font-medium'} text-fg`} data-testid={testId}>{value}</dd>
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-fg">{label}</label>
      {children}
      <p className="text-xs text-fg-muted">{hint}</p>
    </div>
  );
}
