'use client';

/**
 * Costs → Fixed and other costs (COST-GAPS): what the platform pays outside the collected usage
 * (Apple Developer, domains, GitHub, Linear, AI subscriptions, DeepL, ElevenLabs…). Everyone with
 * the page reads the list; super admins (ops:manage) add, change and remove items. A yearly amount
 * counts as a twelfth a month, from its start date to its end date, in the budget, the forecast
 * and the alerts. Checked here with the same validator admin-api applies (parseFixedCostInput).
 */
import { useEffect, useId, useState } from 'react';
import { FIXED_COST_LIMITS, FIXED_COST_PERIODS, fixedCostMonthShare, parseFixedCostInput, type FixedCost, type FixedCostInput, type FixedCostPeriod } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { localDate } from './model';
import { fieldClass } from '@/components/ui';
import { DateField } from '@/components/DateField';
import { NumberField } from '@/components/forms/NumberField';
import { Select } from '@/components/select/Select';
import { useConfirm } from '@/components/content/actions';
import { removeFixedCost, saveFixedCost } from '@/lib/api/costs';
import { opsFormats } from '../operations/model';
import { FeedbackLine, useCostAction } from './useCostAction';

const labelClass = 'block text-sm font-medium text-fg';
const helpClass = 'mt-1 block text-xs text-fg-muted';
const primaryClass =
  'cost-primary inline-flex min-h-11 items-center justify-center rounded px-5 py-2.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryClass =
  'inline-flex min-h-11 items-center justify-center rounded border border-border px-4 py-2 text-sm text-fg hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';

type Field = keyof FixedCostInput;
interface Form {
  name: string;
  amount: string;
  period: FixedCostPeriod;
  startDate: string;
  endDate: string;
  note: string;
}

const emptyForm = (now: number): Form => ({ name: '', amount: '', period: 'monthly', startDate: localDate(new Date(now)), endDate: '', note: '' });
const formOf = (c: FixedCost): Form => ({ name: c.name, amount: String(c.amountUsd), period: c.period, startDate: c.startDate, endDate: c.endDate ?? '', note: c.note ?? '' });
/** Eastern Arabic digits and the Arabic decimal separator typed into the amount. */
const amountOf = (text: string) => Number(text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace('٫', '.').replace(/[,\s]/g, ''));

/**
 * `now` is the page's clock (ms), the instant its figures are for: a new cost starts on that
 * instant's date on the viewer's calendar, the same day the figures above call today.
 */
export function FixedCosts({ items, mtd, projected, canManage, now }: { items: FixedCost[]; mtd: number; projected: number; canManage: boolean; now: number }) {
  const { t, locale } = useLanguage();
  const f = opsFormats(locale);
  const ids = useId();
  const month = new Date(now).toISOString().slice(0, 7);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => emptyForm(now));
  // The server renders in UTC: once in the browser, start a new cost on the viewer's own date
  useEffect(() => {
    setForm((cur) => (editing === null && !cur.name && !cur.amount ? { ...cur, startDate: localDate(new Date(now)) } : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const { run, busy, feedback } = useCostAction('fixed');
  const { confirm, dialog } = useConfirm();

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((cur) => ({ ...cur, [k]: v }));
  const startEdit = (c: FixedCost) => {
    setEditing(c.id);
    setForm(formOf(c));
    setErrors({});
  };
  const reset = () => {
    setEditing(null);
    setForm(emptyForm(now));
    setErrors({});
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = parseFixedCostInput({ name: form.name, amountUsd: amountOf(form.amount), period: form.period, startDate: form.startDate, endDate: form.endDate || null, note: form.note });
    if ('error' in parsed) {
      setErrors({ [parsed.field]: t(`costs.fixed.errors.${parsed.field}`, { max: FIXED_COST_LIMITS.nameMax, amountMax: f.usd(FIXED_COST_LIMITS.amountMax) }) });
      return;
    }
    setErrors({});
    const saved = await run(editing ? 'update' : 'create', () => saveFixedCost(editing, parsed), (c) => t(editing ? 'costs.fixed.changed' : 'costs.fixed.added', { name: c.name }));
    if (saved) reset();
  }

  async function remove(c: FixedCost) {
    const ok = await confirm({ title: t('costs.fixed.removeTitle', { name: c.name }), body: t('costs.fixed.removeBody'), confirmLabel: t('costs.fixed.remove'), danger: true, testId: 'costs-fixed-remove' });
    if (!ok) return;
    const done = await run('remove', () => removeFixedCost(c.id), () => t('costs.fixed.removed', { name: c.name }));
    if (done && editing === c.id) reset();
  }

  const field = (k: Field) => ({
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${ids}-${k}-error` : undefined,
  });
  const errorLine = (k: Field) => errors[k] && <span id={`${ids}-${k}-error`} className="mt-1 block text-xs text-danger-fg" data-testid={`costs-fixed-${k}-error`}>{errors[k]}</span>;

  return (
    <section id="fixed-costs" className="cost-panel min-w-0 scroll-mt-6 p-5 sm:p-6" aria-labelledby="costs-fixed-title" data-testid="costs-fixed">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 id="costs-fixed-title" className="text-lg font-semibold text-fg">{t('costs.fixed.title')}</h2>
          <p className="mt-1 text-sm text-fg-muted">{t('costs.fixed.note')}</p>
        </div>
        <dl className="flex flex-wrap gap-3">
          <div className="cost-tile px-4 py-2">
            <dt className="text-xs text-fg-muted">{t('costs.fixed.mtd')}</dt>
            <dd className="text-lg font-semibold text-fg tabular-nums" data-testid="costs-fixed-mtd">{f.usd(mtd)}</dd>
          </div>
          <div className="cost-tile px-4 py-2">
            <dt className="text-xs text-fg-muted">{t('costs.fixed.projected')}</dt>
            <dd className="text-lg font-semibold text-fg tabular-nums" data-testid="costs-fixed-projected">{f.usd(projected)}</dd>
          </div>
        </dl>
      </div>

      {items.length === 0 ? (
        <p className="cost-tile mt-4 px-3 py-4 text-sm text-fg-muted" data-testid="costs-fixed-empty">{canManage ? t('costs.fixed.emptyManage') : t('costs.fixed.empty')}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2" data-testid="costs-fixed-list">
          {items.map((c) => {
            const share = fixedCostMonthShare(c, month);
            return (
              <li key={c.id} className="cost-tile flex flex-col gap-2 p-3" data-testid="costs-fixed-row" data-id={c.id} data-editing={editing === c.id ? 'true' : undefined}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words font-medium text-fg"><bdi>{c.name}</bdi></span>
                  <span className="font-semibold text-fg tabular-nums" data-testid="costs-fixed-amount">
                    {t(c.period === 'yearly' ? 'costs.fixed.perYear' : 'costs.fixed.perMonth', { value: f.usd(c.amountUsd) })}
                  </span>
                </div>
                <p className="text-xs text-fg-muted tabular-nums">
                  {c.endDate ? t('costs.fixed.range', { start: f.day(c.startDate), end: f.day(c.endDate) }) : t('costs.fixed.since', { start: f.day(c.startDate) })}
                  {t('common.sep')}
                  <span data-testid="costs-fixed-share">{share > 0 ? t('costs.fixed.thisMonth', { value: f.usd(share) }) : t('costs.fixed.notThisMonth')}</span>
                </p>
                {c.note && <p className="text-xs text-fg-muted"><bdi>{c.note}</bdi></p>}
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={secondaryClass} onClick={() => startEdit(c)} disabled={busy !== null} aria-label={t('costs.fixed.editNamed', { name: c.name })} data-testid="costs-fixed-edit">
                      {t('costs.fixed.edit')}
                    </button>
                    <button type="button" className={`${secondaryClass} text-danger-fg`} onClick={() => remove(c)} disabled={busy !== null} aria-label={t('costs.fixed.removeNamed', { name: c.name })} data-testid="costs-fixed-remove">
                      {t('costs.fixed.remove')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <form onSubmit={submit} noValidate className="mt-5 border-t border-border pt-5" aria-labelledby={`${ids}-form-title`} data-testid="costs-fixed-form" data-mode={editing ? 'edit' : 'add'}>
          <h3 id={`${ids}-form-title`} className="mb-3 text-sm font-semibold text-fg">{editing ? t('costs.fixed.editTitle') : t('costs.fixed.addTitle')}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="sm:col-span-2 xl:col-span-1">
              <label htmlFor={`${ids}-name`} className={labelClass}>{t('costs.fixed.name')}</label>
              <input id={`${ids}-name`} value={form.name} maxLength={FIXED_COST_LIMITS.nameMax} onChange={(e) => set('name', e.target.value)} className={`${fieldClass} mt-1 w-full`} autoComplete="off" data-testid="costs-fixed-name" {...field('name')} />
              <span className={helpClass}>{t('costs.fixed.nameHelp')}</span>
              {errorLine('name')}
            </div>
            <div>
              <label htmlFor={`${ids}-amount`} className={labelClass}>{t('costs.fixed.amount')}</label>
              <NumberField decimal id={`${ids}-amount`} dir="ltr" autoComplete="off" value={form.amount} onChange={(e) => set('amount', e.target.value)} className={`${fieldClass} mt-1 w-full tabular-nums`} data-testid="costs-fixed-amount-input" {...field('amountUsd')} />
              {errorLine('amountUsd')}
            </div>
            <div>
              <label htmlFor={`${ids}-period`} className={labelClass}>{t('costs.fixed.period')}</label>
              <Select id={`${ids}-period`} value={form.period} onChange={(e) => set('period', e.target.value as FixedCostPeriod)} className={`${fieldClass} mt-1 w-full`} data-testid="costs-fixed-period">
                {FIXED_COST_PERIODS.map((p) => <option key={p} value={p}>{t(`costs.fixed.periods.${p}`)}</option>)}
              </Select>
              <span className={helpClass}>{t('costs.fixed.periodHelp')}</span>
            </div>
            <div>
              <label htmlFor={`${ids}-start`} className={labelClass}>{t('costs.fixed.start')}</label>
              <DateField id={`${ids}-start`} value={form.startDate} onChange={(v) => set('startDate', v ?? '')} className="mt-1 w-full" testId="costs-fixed-start" aria-describedby={errors.startDate ? `${ids}-startDate-error` : undefined} />
              {errorLine('startDate')}
            </div>
            <div>
              <label htmlFor={`${ids}-end`} className={labelClass}>{t('costs.fixed.end')}</label>
              <DateField id={`${ids}-end`} value={form.endDate} onChange={(v) => set('endDate', v ?? '')} min={form.startDate || undefined} className="mt-1 w-full" testId="costs-fixed-end" aria-describedby={errors.endDate ? `${ids}-endDate-error` : `${ids}-end-help`} />
              <span id={`${ids}-end-help`} className={helpClass}>{t('costs.fixed.endHelp')}</span>
              {errorLine('endDate')}
            </div>
            <div className="sm:col-span-2 xl:col-span-3">
              <label htmlFor={`${ids}-note`} className={labelClass}>{t('costs.fixed.noteLabel')}</label>
              <input id={`${ids}-note`} value={form.note} maxLength={FIXED_COST_LIMITS.noteMax} onChange={(e) => set('note', e.target.value)} className={`${fieldClass} mt-1 w-full`} autoComplete="off" data-testid="costs-fixed-note" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" className={primaryClass} disabled={busy !== null} data-testid="costs-fixed-save">
              {editing ? t('costs.fixed.save') : t('costs.fixed.add')}
            </button>
            {editing && (
              <button type="button" className={secondaryClass} onClick={reset} disabled={busy !== null} data-testid="costs-fixed-cancel">
                {t('costs.fixed.cancel')}
              </button>
            )}
          </div>
          <div className="mt-3"><FeedbackLine feedback={feedback} testId="costs-fixed-feedback" /></div>
        </form>
      )}
      {!canManage && <div className="mt-3"><FeedbackLine feedback={feedback} testId="costs-fixed-feedback" /></div>}
      {dialog}
    </section>
  );
}
