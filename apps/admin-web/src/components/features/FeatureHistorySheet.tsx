'use client';

/**
 * Every change to one feature, newest first, 50 at a time (wiki AUN-FEATURES §3): who, when (local
 * time with the zone, UTC on hover), from what to what, and whether it came from the Features page
 * or from Undo. A side sheet at the inline end; full width on a phone.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { featureDefinition, type FeatureKey } from '@al-ummah/shared-types';
import type { FeatureHistoryEntry, FeatureHistoryPage } from '@/lib/api/features';
import { useLanguage } from '@/i18n/I18nProvider';
import { LocalTime } from '@/components/LocalTime';
import { ErrorAlert } from '@/components/ui';
import { smallButtonClass } from '@/components/content/parts';
import { Icon } from '@/components/shell/icons';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';

function StateChip({ value }: { value: boolean | null }) {
  const { t } = useLanguage();
  const label = value === null ? t('features.sheet.from') : t(value ? 'features.state.on' : 'features.state.off');
  const tone = value === null ? 'bg-chip-dismissed-bg text-fg-muted' : value ? 'bg-chip-resolved-bg text-chip-resolved-fg' : 'bg-chip-dismissed-bg text-chip-dismissed-fg';
  return <span className={`rounded px-2 py-0.5 text-sm font-medium ${tone}`}>{label}</span>;
}

export function FeatureHistorySheet({ featureKey, load: fetchPage, onClose }: { featureKey: FeatureKey | null; load: (key: FeatureKey, cursor?: string | null) => Promise<FeatureHistoryPage>; onClose: () => void }) {
  const { t, locale } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [entries, setEntries] = useState<FeatureHistoryEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const open = featureKey !== null;

  const load = useCallback(
    async (key: FeatureKey, cursor: string | null) => {
      try {
        const page = await fetchPage(key, cursor);
        setEntries((prev) => (cursor ? [...prev, ...page.entries] : page.entries));
        setNext(page.nextCursor);
        setState('ready');
      } catch (error) {
        logger.warn('[features] History load failed', { key, error: error instanceof Error ? error.message : String(error) });
        reportError(error, { shown: true, extra: { where: 'features-history', key } });
        setState('error');
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (open && featureKey) {
      setEntries([]);
      setNext(null);
      setState('loading');
      void load(featureKey, null);
    }
  }, [open, featureKey, load]);

  const name = featureKey ? featureDefinition(featureKey).name[locale] : '';
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby={`${ids}-title`}
      className="m-0 ms-auto h-dvh max-h-none w-full max-w-full border-0 border-s border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-fg/50 sm:w-[30rem]"
      data-testid="feature-history-sheet"
      data-key={featureKey ?? ''}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm text-fg-muted">{t('features.history')}</p>
            <h2 id={`${ids}-title`} className="text-lg font-semibold [text-wrap:balance]">
              {name}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t('features.sheet.close')} className="-me-2 inline-flex size-11 shrink-0 items-center justify-center rounded text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" data-testid="feature-history-close">
            <Icon name="close" />
          </button>
        </header>
        {/* Focusable so keyboard users can scroll the list once Show more is gone (axe scrollable-region-focusable) */}
        <div className="flex-1 overflow-y-auto px-5 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus" tabIndex={0} role="region" aria-labelledby={`${ids}-title`} aria-busy={state === 'loading' || undefined}>
          {state === 'loading' && (
            <ul className="space-y-4" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="space-y-2">
                  <div className="h-5 w-40 animate-pulse rounded bg-fg/10" />
                  <div className="h-4 w-56 animate-pulse rounded bg-fg/10" />
                </li>
              ))}
            </ul>
          )}
          {state === 'error' && <ErrorAlert testId="feature-history-error">{t('features.sheet.loadFailed')}</ErrorAlert>}
          {state === 'ready' && entries.length === 0 && <p className="text-fg-muted" data-testid="feature-history-empty">{t('features.sheet.empty')}</p>}
          {entries.length > 0 && (
            <ol className="relative space-y-0" data-testid="feature-history-list">
              {entries.map((e) => (
                <li key={e.id} className="relative border-s-2 border-border ps-5 pb-5 last:pb-1" data-testid="feature-history-entry" data-source={e.source}>
                  <span aria-hidden="true" className={`absolute -start-[7px] top-1.5 size-3 rounded-full border-2 border-surface ${e.newEnabled ? 'bg-success-fg' : 'bg-fg-muted'}`} />
                  <p className="flex flex-wrap items-center gap-2" aria-label={t('features.sheet.change', { from: e.oldEnabled === null ? t('features.sheet.from') : t(e.oldEnabled ? 'features.state.on' : 'features.state.off'), to: t(e.newEnabled ? 'features.state.on' : 'features.state.off') })}>
                    <StateChip value={e.oldEnabled} />
                    <Icon name="chevron" className="size-4 text-fg-muted rtl:rotate-180" />
                    <StateChip value={e.newEnabled} />
                    {e.source === 'undo' && <span className="rounded border border-border px-2 py-0.5 text-xs text-fg-muted">{t('features.sheet.sourceUndo')}</span>}
                  </p>
                  <p className="mt-1.5 text-sm text-fg">
                    <span dir="auto">{t('features.sheet.by', { name: e.actor.name })}</span>
                  </p>
                  <p className="text-sm text-fg-muted">
                    <LocalTime value={e.createdAt} />
                  </p>
                </li>
              ))}
            </ol>
          )}
          {next && featureKey && (
            <button
              type="button"
              className={`${smallButtonClass} mt-2 w-full`}
              disabled={more}
              onClick={async () => {
                setMore(true);
                await load(featureKey, next);
                setMore(false);
              }}
              data-testid="feature-history-more"
            >
              {t('features.sheet.more')}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
