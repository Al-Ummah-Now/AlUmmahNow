'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { numberFormat, TRANSCODE_LIMIT_FLOOR, type TranscodeLimitView, type TranscodeRange } from '@al-ummah/shared-types';
import { setTranscodeLimit } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { reportError } from '@/lib/errors/reporter';
import { deliveryFormats } from '../delivery/format';
import { checkRangeInput, R2_SETTINGS_ID, type RangeInputError } from './limit-form';

import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
const ERROR_KEY: Record<Exclude<RangeInputError, 'unchanged'>, MessageKey> = {
  min_range: 'mediaDelivery.limitErrorMin',
  max_range: 'mediaDelivery.limitErrorMax',
  min_above_max: 'mediaDelivery.limitErrorMinAboveMax',
};

/**
 * Cloudflare R2 settings on Video providers: concurrent R2 transcodes as an autoscaling min–max range
 * (admins; audited, Undo in the toast). apps/media's dispatcher applies a change within a minute.
 * Delivery shows "N running · M waiting · range min–max" and links here.
 */
export function R2Settings({ initial }: { initial: TranscodeLimitView | null }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const { run } = useUndoableAction();
  const [view, setView] = useState<TranscodeLimitView | null>(initial);
  // The fields show the admin's digits («٢», not "2"); either digit set may be typed (limit-form.ts)
  const digits = (n: number) => numberFormat(locale, { useGrouping: false }).format(n);
  const [minText, setMinText] = useState(initial ? digits(initial.min) : '');
  const [maxText, setMaxText] = useState(initial ? digits(initial.max) : '');
  const [error, setError] = useState<{ text: string; field: 'min' | 'max' | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { min: useId(), max: useId(), help: useId(), cost: useId(), error: useId() };
  const f = deliveryFormats(locale);

  const heading = (
    <>
      <h2 id={`${R2_SETTINGS_ID}-title`} className="text-xl font-semibold text-fg mb-1">{t('mediaProviders.r2SettingsTitle')}</h2>
      <p className="text-fg-muted text-sm mb-4">{t('mediaProviders.r2SettingsIntro')}</p>
      <h3 id="delivery-limit-title" className="text-base font-semibold text-fg mb-1">{t('mediaDelivery.limitTitle')}</h3>
    </>
  );

  if (!view) {
    return (
      <section id={R2_SETTINGS_ID} className={`${cardClass} mb-6 scroll-mt-24`} aria-labelledby={`${R2_SETTINGS_ID}-title`} data-testid="r2-settings">
        {heading}
        <ErrorAlert testId="delivery-limit-unavailable">{t('mediaDelivery.limitUnavailable')}</ErrorAlert>
      </section>
    );
  }

  const ceiling = view.ceiling;
  const ceilingText = ceiling === null ? '—' : f.integer(ceiling);
  const floorText = f.integer(TRANSCODE_LIMIT_FLOOR);
  const updated = view.updatedAt ? new Date(view.updatedAt) : null;
  const range = (r: TranscodeRange) => ({ min: f.integer(r.min), max: f.integer(r.max) });

  const apply = async (next: TranscodeRange, undo: boolean): Promise<TranscodeLimitView> => {
    const result = await setTranscodeLimit(next, undo);
    if (!result.ok || !result.data) throw new Error(result.ok ? 'empty answer' : `HTTP ${result.status}: ${result.error}`);
    setView(result.data);
    setMinText(digits(result.data.min));
    setMaxText(digits(result.data.max));
    router.refresh();
    return result.data;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const checked = checkRangeInput(minText, maxText, ceiling, view);
    if (!checked.ok) {
      setError({
        text: checked.error === 'unchanged' ? t('mediaDelivery.limitUnchanged') : t(ERROR_KEY[checked.error], { floor: floorText, ceiling: ceilingText }),
        field: checked.field,
      });
      return;
    }
    setError(null);
    setSaving(true);
    const before = { min: view.min, max: view.max };
    try {
      await run({
        action: () => apply(checked.value, false),
        undo: () => apply(before, true),
        message: (saved) => t('mediaDelivery.limitSaved', range(saved)),
        undoneMessage: t('mediaDelivery.limitUndone', range(before)),
      });
    } catch (err) {
      reportError(err, { shown: true, extra: { what: 'transcode-limit' } });
      setError({ text: t('mediaDelivery.limitErrorSave'), field: null });
    } finally {
      setSaving(false);
    }
  };

  const describedBy = (field: 'min' | 'max') => `${ids.help} ${ids.cost}${error && (error.field === field || error.field === null) ? ` ${ids.error}` : ''}`;
  const field = (which: 'min' | 'max', label: MessageKey, value: string, set: (v: string) => void) => (
    <div>
      <label htmlFor={ids[which]} className="block text-sm font-medium text-fg mb-1">{t(label)}</label>
      <input
        id={ids[which]}
        // Text, not type="number": a number field holds only 0–9 and refuses ٠–٩ on an Arabic page
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          set(e.target.value);
          if (error) setError(null);
        }}
        aria-describedby={describedBy(which)}
        aria-invalid={error?.field === which ? true : undefined}
        className={`${fieldClass} w-28 tabular-nums`}
        data-testid={`delivery-limit-${which}`}
      />
    </div>
  );

  const cost = t('mediaDelivery.limitCost', {
    hour: f.usd(view.slotUsdPerHour),
    month: f.usd(view.slotUsdPerMonth),
    max: f.integer(view.effective.max),
    maxHour: f.usd(view.maxUsdPerHour),
  });

  return (
    <section id={R2_SETTINGS_ID} className={`${cardClass} mb-6 scroll-mt-24`} aria-labelledby={`${R2_SETTINGS_ID}-title`} data-testid="r2-settings">
      {heading}
      <div data-testid="delivery-limit">
        <p className="text-fg-muted text-sm mb-2">{t('mediaDelivery.limitIntro')}</p>
        <p className="text-fg-muted text-sm mb-4" data-testid="delivery-limit-billing">{t('mediaDelivery.limitBilling')}</p>
        <form onSubmit={save} noValidate className="flex flex-wrap items-end gap-3" data-testid="delivery-limit-form">
          {field('min', 'mediaDelivery.limitMinLabel', minText, setMinText)}
          {field('max', 'mediaDelivery.limitMaxLabel', maxText, setMaxText)}
          <button type="submit" className={primaryButtonClass} disabled={saving} aria-busy={saving || undefined} data-testid="delivery-limit-save">
            {saving ? t('mediaDelivery.limitSaving') : t('mediaDelivery.limitSave')}
          </button>
        </form>
        {error && (
          <p id={ids.error} role="alert" className="mt-2 text-sm text-danger-fg" data-testid="delivery-limit-error" data-field={error.field ?? ''}>{error.text}</p>
        )}
        <p id={ids.help} className="mt-3 text-sm text-fg-muted" data-testid="delivery-limit-help">
          {`${t('mediaDelivery.limitHelp', { floor: floorText, ceiling: ceilingText })} `}
          <span data-testid="delivery-limit-enforced">{t('mediaDelivery.limitEnforced', { ...range(view.effective), ceiling: ceilingText })}</span>{' '}
          <span data-testid="delivery-limit-updated">
            {view.isDefault || !updated || Number.isNaN(updated.getTime())
              ? t('mediaDelivery.limitDefault')
              : fillNodes(t('mediaDelivery.limitUpdated'), { time: <LocalTime value={updated} withTime /> })}
          </span>
        </p>
        <p id={ids.cost} className="mt-1 text-sm text-fg-muted" data-testid="delivery-limit-cost">{cost}</p>
      </div>
    </section>
  );
}
