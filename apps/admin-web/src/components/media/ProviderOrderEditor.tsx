'use client';

import type { MediaProviderId, PlaybackStrategy } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';
import { MEDIA_PROVIDER_IDS } from '@al-ummah/shared-types';
import { PROVIDER_LABEL, moveProvider, parseWhole, toggleProvider, weightShares, withUnlisted, type OverrideDraft } from '@/lib/media/providers-form';

export const checkClass = 'mt-1 h-4 w-4 shrink-0 accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
const iconButtonClass =
  'inline-flex h-9 w-9 items-center justify-center rounded border border-border bg-surface-2 text-fg hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

/**
 * The playback list: every provider, the ones that serve playback first in their order, with
 * move up/down and (weighted) a weight per provider. Providers that are switched off are shown
 * dimmed: they keep their place and are skipped while off.
 */
export function ProviderOrderEditor({
  idPrefix,
  order,
  onOrder,
  strategy,
  weights,
  onWeight,
  enabled,
  testId,
}: {
  idPrefix: string;
  order: MediaProviderId[];
  onOrder: (next: MediaProviderId[]) => void;
  strategy: PlaybackStrategy;
  weights: Partial<Record<MediaProviderId, string>>;
  onWeight: (provider: MediaProviderId, value: string) => void;
  enabled: MediaProviderId[];
  testId: string;
}) {
  const { t } = useLanguage();
  const numeric: Partial<Record<MediaProviderId, number>> = {};
  for (const p of order) numeric[p] = parseWhole(weights[p] ?? '', 0, 100) ?? 0;
  const shares = weightShares(order.filter((p) => enabled.includes(p)), numeric);
  return (
    <ol className="space-y-2" data-testid={testId}>
      {withUnlisted(order).map((p) => {
        const listed = order.includes(p);
        const index = order.indexOf(p);
        const name = t(PROVIDER_LABEL[p]);
        const weightInvalid = strategy === 'weighted' && listed && parseWhole(weights[p] ?? '', 0, 100) === null;
        return (
          <li
            key={p}
            className={`flex flex-wrap items-center gap-3 rounded border border-border p-3 ${listed ? 'bg-surface-2' : ''} ${enabled.includes(p) ? '' : 'opacity-70'}`}
            data-testid={`${testId}-${p}`}
            data-listed={listed}
          >
            <label className="flex min-w-[11rem] flex-1 items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={listed} onChange={(e) => onOrder(toggleProvider(order, p, e.target.checked))} className={checkClass} aria-label={t('mediaProviders.inPlayback', { provider: name })} data-testid={`${testId}-${p}-on`} />
              <span className="min-w-0">
                <span className="block font-medium text-fg">
                  {listed && <span className="me-2 tabular-nums text-fg-muted" aria-hidden="true">{index + 1}.</span>}
                  {name}
                </span>
                {!enabled.includes(p) && <span className="block text-sm text-fg-muted">{t('mediaProviders.disabled')}</span>}
                {strategy === 'weighted' && listed && enabled.includes(p) && <span className="block text-sm text-fg-muted" data-testid={`${testId}-${p}-share`}>{t('mediaProviders.weightShare', { share: String(shares[p] ?? 0) })}</span>}
              </span>
            </label>
            {strategy === 'weighted' && listed && (
              <span className="flex flex-col gap-1">
                <label htmlFor={`${idPrefix}-w-${p}`} className="sr-only">{t('mediaProviders.weight', { provider: name })}</label>
                <input
                  id={`${idPrefix}-w-${p}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  value={weights[p] ?? ''}
                  onChange={(e) => onWeight(p, e.target.value)}
                  aria-invalid={weightInvalid || undefined}
                  className={`${fieldClass} w-24`}
                  data-testid={`${testId}-${p}-weight`}
                />
              </span>
            )}
            {listed && (
              <span className="flex gap-1">
                <button type="button" className={iconButtonClass} disabled={index === 0} onClick={() => onOrder(moveProvider(order, p, -1))} aria-label={t('mediaProviders.moveUp', { provider: name })} data-testid={`${testId}-${p}-up`}>
                  <span aria-hidden="true">↑</span>
                </button>
                <button type="button" className={iconButtonClass} disabled={index === order.length - 1} onClick={() => onOrder(moveProvider(order, p, 1))} aria-label={t('mediaProviders.moveDown', { provider: name })} data-testid={`${testId}-${p}-down`}>
                  <span aria-hidden="true">↓</span>
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Ticks one or more providers (upload targets). */
export function ProviderChecklist({ value, onChange, enabled, testId, legend }: { value: MediaProviderId[]; onChange: (next: MediaProviderId[]) => void; enabled: MediaProviderId[]; testId: string; legend: string }) {
  const { t } = useLanguage();
  return (
    <fieldset data-testid={testId}>
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {MEDIA_PROVIDER_IDS.map((p) => (
          <label key={p} className={`flex items-start gap-2 rounded border border-border px-3 py-2 cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-surface-2 ${enabled.includes(p) ? '' : 'opacity-70'}`}>
            <input type="checkbox" checked={value.includes(p)} onChange={(e) => onChange(toggleProvider(value, p, e.target.checked))} className={checkClass} data-testid={`${testId}-${p}`} />
            <span>
              <span className="block text-fg">{t(PROVIDER_LABEL[p])}</span>
              {!enabled.includes(p) && <span className="block text-sm text-fg-muted">{t('mediaProviders.disabled')}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A channel's or a video's override: each part either follows the settings above or is set here.
 * Channels also choose their upload providers; a video only its playback.
 */
export function OverrideEditor({
  idPrefix,
  draft,
  onDraft,
  enabled,
  withIngest,
  testId,
  inherited,
}: {
  idPrefix: string;
  draft: OverrideDraft;
  onDraft: (next: OverrideDraft) => void;
  enabled: MediaProviderId[];
  withIngest: boolean;
  testId: string;
  /** What the video or channel follows when a part is not set */
  inherited: { ingest: MediaProviderId[]; order: MediaProviderId[]; strategy: PlaybackStrategy };
}) {
  const { t } = useLanguage();
  const strategy = draft.strategy || inherited.strategy;
  return (
    <div className="space-y-4" data-testid={testId}>
      {withIngest && (
        <div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.ingest !== null}
              onChange={(e) => onDraft({ ...draft, ingest: e.target.checked ? [...inherited.ingest] : null })}
              className={checkClass}
              data-testid={`${testId}-ingest-set`}
            />
            <span className="text-fg">{t('mediaProviders.overrideIngest')}</span>
          </label>
          {draft.ingest !== null && (
            <div className="mt-2 ms-6">
              <ProviderChecklist value={draft.ingest} onChange={(ingest) => onDraft({ ...draft, ingest })} enabled={enabled} testId={`${testId}-ingest`} legend={t('mediaProviders.colIngest')} />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-strategy`} className="text-sm font-medium text-fg">{t('mediaProviders.overrideStrategy')}</label>
        <select
          id={`${idPrefix}-strategy`}
          value={draft.strategy}
          onChange={(e) => onDraft({ ...draft, strategy: e.target.value as OverrideDraft['strategy'] })}
          className={`${fieldClass} w-full sm:w-64`}
          data-testid={`${testId}-strategy`}
        >
          <option value="">{t('mediaProviders.overrideStrategyInherit')}</option>
          <option value="priority">{t('mediaProviders.strategyPriority')}</option>
          <option value="weighted">{t('mediaProviders.strategyWeighted')}</option>
        </select>
      </div>
      <div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.order !== null}
            onChange={(e) => onDraft({ ...draft, order: e.target.checked ? [...inherited.order] : null })}
            className={checkClass}
            data-testid={`${testId}-order-set`}
          />
          <span className="text-fg">{t('mediaProviders.overrideOrder')}</span>
        </label>
        {(draft.order !== null || draft.strategy === 'weighted') && (
          <div className="mt-2 ms-6">
            <ProviderOrderEditor
              idPrefix={idPrefix}
              order={draft.order ?? inherited.order}
              onOrder={(order) => onDraft({ ...draft, order })}
              strategy={strategy}
              weights={draft.weights}
              onWeight={(p, v) => onDraft({ ...draft, weights: { ...draft.weights, [p]: v } })}
              enabled={enabled}
              testId={`${testId}-order`}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-note`} className="text-sm font-medium text-fg">{t('mediaProviders.note')}</label>
        <input id={`${idPrefix}-note`} type="text" maxLength={200} value={draft.note} onChange={(e) => onDraft({ ...draft, note: e.target.value })} className={`${fieldClass} w-full`} data-testid={`${testId}-note`} />
      </div>
    </div>
  );
}
