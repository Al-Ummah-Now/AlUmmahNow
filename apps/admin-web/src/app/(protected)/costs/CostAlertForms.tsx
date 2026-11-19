'use client';

/**
 * Costs → Alerts: the admin's own alert emails (opt-in, admin-api PUT /api/costs/subscriptions/me)
 * and, for super admins, the alert settings everyone shares (PUT /api/costs/settings), checked
 * here against the same limits admin-api applies (model.ts validateSettingsForm).
 */
import { useId, useState } from 'react';
import { COST_ALERT_KINDS, numberFormat, RESEND_PLANS, type CostAlertKind, type CostAlertSettings, type ResendPlan } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { EmailLanguageChoice, type EmailLanguage } from '@/components/EmailLanguageChoice';
import { fieldClass } from '@/components/ui';
import { saveCostSettings, saveMyCostAlerts } from '@/lib/api/costs';
import type { CostSubscription } from '@/lib/api/costs-types';
import { opsFormats } from '../operations/model';
import { hourName, settingsToForm, toggleKind, validateSettingsForm, weekdayNames, type SettingsField, type SettingsForm } from './model';
import { FeedbackLine, useCostAction } from './useCostAction';
import { NumberField } from '@/components/forms/NumberField';

const labelClass = 'block text-sm font-medium text-fg';
const helpClass = 'mt-1 block text-xs text-fg-muted';
const primaryClass =
  'cost-primary inline-flex min-h-11 items-center justify-center rounded px-5 py-2.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const checkClass = 'mt-0.5 size-5 shrink-0 accent-[var(--accent)]';

export function MyCostAlerts({ me, accountEmail, digest }: { me: CostSubscription; accountEmail: string | null; digest: Pick<CostAlertSettings, 'digestEnabled' | 'digestWeekday' | 'digestHour'> }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const [kinds, setKinds] = useState<CostAlertKind[]>(me.kinds);
  const [lang, setLang] = useState<EmailLanguage>(me.locale);
  const { run, busy, feedback } = useCostAction('alerts');
  const email = me.email ?? accountEmail;
  const help = (k: CostAlertKind) =>
    k === 'digest'
      ? digest.digestEnabled
        ? t('costs.alerts.help.digest', { day: weekdayNames(locale)[digest.digestWeekday] ?? '', hour: hourName(digest.digestHour, locale) })
        : t('costs.alerts.help.digestOff')
      : t(`costs.alerts.help.${k}`);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await run('save', () => saveMyCostAlerts(kinds, lang), (saved) => (saved.kinds.length ? t('costs.alerts.saved') : t('costs.alerts.savedNone')));
  }

  return (
    <section className="cost-panel min-w-0 p-5 sm:p-6" aria-labelledby="costs-my-alerts-title" data-testid="costs-my-alerts">
      <h2 id="costs-my-alerts-title" className="text-lg font-semibold text-fg">{t('costs.alerts.title')}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t('costs.alerts.note')}</p>
      {email && (
        <p className="cost-pill mt-3 max-w-full" data-testid="costs-alerts-email">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 text-fg-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18v12H3zM3 7l9 6 9-6" />
          </svg>
          <span className="min-w-0 break-words text-fg">{t('costs.alerts.to', { email })}</span>
        </p>
      )}
      <form onSubmit={submit} className="mt-4 space-y-4" data-testid="costs-my-alerts-form">
        <fieldset>
          <legend className={`${labelClass} mb-2`}>{t('costs.alerts.legend')}</legend>
          <ul className="space-y-2">
            {COST_ALERT_KINDS.map((k) => (
              <li key={k}>
                <label className="cost-tile flex cursor-pointer items-start gap-3 p-3 hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    className={checkClass}
                    checked={kinds.includes(k)}
                    onChange={(e) => setKinds((current) => toggleKind(current, k, e.target.checked))}
                    aria-describedby={`${ids}-${k}-help`}
                    data-testid={`costs-kind-${k}`}
                  />
                  <span>
                    <span className="block font-medium text-fg">{t(`costs.alerts.kinds.${k}`)}</span>
                    <span id={`${ids}-${k}-help`} className="block text-xs text-fg-muted">{help(k)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <EmailLanguageChoice value={lang} onChange={setLang} testId="costs-alerts-locale" />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryClass} disabled={busy !== null} data-testid="costs-alerts-save">
            {t('costs.alerts.save')}
          </button>
        </div>
        <FeedbackLine feedback={feedback} testId="costs-alerts-feedback" />
      </form>
    </section>
  );
}

function ThresholdField({ field, label, help, value, error, onChange, step, ids }: { field: SettingsField; label: string; help?: string; value: string; error?: string; onChange: (v: string) => void; step: string; ids: string }) {
  const id = `${ids}-${field}`;
  const describedBy = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <NumberField decimal
        id={id}
        dir="ltr"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        data-step={step}
        className={`${fieldClass} mt-1 w-full tabular-nums ${error ? 'border-danger-border' : ''}`}
        data-testid={`costs-threshold-${field}`}
      />
      {help && <span id={`${id}-help`} className={helpClass}>{help}</span>}
      {error && <span id={`${id}-error`} className="mt-1 block text-xs text-danger-fg" data-testid={`costs-threshold-${field}-error`}>{error}</span>}
    </div>
  );
}

export function CostThresholds({ settings }: { settings: CostAlertSettings }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const [form, setForm] = useState<SettingsForm>(() => settingsToForm(settings));
  const [touched, setTouched] = useState(false);
  const { run, busy, feedback, setFeedback } = useCostAction('settings');
  const { errors } = validateSettingsForm(form);
  const shown = touched ? errors : {};
  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: SettingsField) => (shown[k] ? t(shown[k]!.key, shown[k]!.params) : undefined);
  const f = opsFormats(locale);
  const days = weekdayNames(locale);
  const count = numberFormat(locale);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);
    const checked = validateSettingsForm(form);
    if (!checked.value) {
      setFeedback({ kind: 'error', text: t('costs.thresholds.invalid') });
      return;
    }
    const saved = await run('save', () => saveCostSettings(checked.value!), () => t('costs.thresholds.saved'));
    if (saved) {
      setForm(settingsToForm(saved));
      setTouched(false);
    }
  }

  const planLabel = (p: ResendPlan) => {
    const plan = RESEND_PLANS[p];
    return t(`costs.thresholds.plans.${p}`, { price: f.usd(plan.monthlyUsd), included: count.format(plan.included) });
  };

  const groupClass = 'cost-tile space-y-4 p-4';
  const groupTitle = 'mb-1 text-sm font-semibold text-fg';

  return (
    <section className="cost-panel min-w-0 p-5 sm:p-6" aria-labelledby="costs-thresholds-title" data-testid="costs-thresholds">
      <h2 id="costs-thresholds-title" className="text-lg font-semibold text-fg">{t('costs.thresholds.title')}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t('costs.thresholds.note')}</p>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4" data-testid="costs-thresholds-form">
        <fieldset className={groupClass}>
          <legend className="sr-only">{t('costs.thresholds.budgetTitle')}</legend>
          <p aria-hidden="true" className={groupTitle}>{t('costs.thresholds.budgetTitle')}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ThresholdField ids={ids} field="budgetUsd" label={t('costs.thresholds.budgetUsd')} value={form.budgetUsd} error={err('budgetUsd')} onChange={(v) => set('budgetUsd', v)} step="1" />
            <ThresholdField ids={ids} field="budgetLevels" label={t('costs.thresholds.budgetLevels')} help={t('costs.thresholds.budgetLevelsHelp')} value={form.budgetLevels} error={err('budgetLevels')} onChange={(v) => set('budgetLevels', v)} step="1" />
          </div>
          <label className="flex items-start gap-3 text-sm text-fg">
            <input type="checkbox" className={checkClass} checked={form.projectedAlert} onChange={(e) => set('projectedAlert', e.target.checked)} data-testid="costs-threshold-projectedAlert" />
            {t('costs.thresholds.projectedAlert')}
          </label>
        </fieldset>

        <fieldset className={groupClass}>
          <legend className="sr-only">{t('costs.thresholds.spikeTitle')}</legend>
          <p aria-hidden="true" className={groupTitle}>{t('costs.thresholds.spikeTitle')}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ThresholdField ids={ids} field="spikeFactor" label={t('costs.thresholds.spikeFactor')} help={t('costs.thresholds.spikeFactorHelp')} value={form.spikeFactor} error={err('spikeFactor')} onChange={(v) => set('spikeFactor', v)} step="0.1" />
            <ThresholdField ids={ids} field="spikeMinUsd" label={t('costs.thresholds.spikeMinUsd')} help={t('costs.thresholds.spikeMinUsdHelp')} value={form.spikeMinUsd} error={err('spikeMinUsd')} onChange={(v) => set('spikeMinUsd', v)} step="0.1" />
            <ThresholdField ids={ids} field="spikeTotalMinUsd" label={t('costs.thresholds.spikeTotalMinUsd')} help={t('costs.thresholds.spikeTotalMinUsdHelp')} value={form.spikeTotalMinUsd} error={err('spikeTotalMinUsd')} onChange={(v) => set('spikeTotalMinUsd', v)} step="0.1" />
          </div>
        </fieldset>

        <fieldset className={groupClass}>
          <legend className="sr-only">{t('costs.thresholds.digestTitle')}</legend>
          <p aria-hidden="true" className={groupTitle}>{t('costs.thresholds.digestTitle')}</p>
          <label className="flex items-start gap-3 text-sm text-fg">
            <input type="checkbox" className={checkClass} checked={form.digestEnabled} onChange={(e) => set('digestEnabled', e.target.checked)} data-testid="costs-threshold-digestEnabled" />
            {t('costs.thresholds.digestEnabled')}
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${ids}-weekday`} className={labelClass}>{t('costs.thresholds.digestWeekday')}</label>
              <select id={`${ids}-weekday`} value={form.digestWeekday} onChange={(e) => set('digestWeekday', Number(e.target.value))} className={`${fieldClass} mt-1 w-full`} data-testid="costs-threshold-digestWeekday">
                {days.map((name, i) => <option key={i} value={i}>{name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${ids}-hour`} className={labelClass}>{t('costs.thresholds.digestHour')}</label>
              <select id={`${ids}-hour`} value={form.digestHour} onChange={(e) => set('digestHour', Number(e.target.value))} className={`${fieldClass} mt-1 w-full`} data-testid="costs-threshold-digestHour">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourName(h, locale)}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        <div className={groupClass}>
          <label htmlFor={`${ids}-plan`} className={labelClass}>{t('costs.thresholds.resendPlan')}</label>
          <select id={`${ids}-plan`} value={form.resendPlan} onChange={(e) => set('resendPlan', e.target.value as ResendPlan)} aria-describedby={`${ids}-plan-help`} className={`${fieldClass} w-full`} data-testid="costs-threshold-resendPlan">
            {(Object.keys(RESEND_PLANS) as ResendPlan[]).map((p) => <option key={p} value={p}>{planLabel(p)}</option>)}
          </select>
          <span id={`${ids}-plan-help`} className={helpClass}>{t('costs.thresholds.resendPlanHelp')}</span>
        </div>

        <button type="submit" className={primaryClass} disabled={busy !== null} data-testid="costs-thresholds-save">
          {t('costs.thresholds.save')}
        </button>
        <FeedbackLine feedback={feedback} testId="costs-thresholds-feedback" />
      </form>
    </section>
  );
}
