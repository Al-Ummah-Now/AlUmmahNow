'use client';

/**
 * Costs → Databases, super admins only (ops:manage): the D1 limits the capacity alerts judge
 * against (admin-api PUT /api/costs/d1-limits) and each capacity alert's value and switch (PUT
 * /api/ops/thresholds/:id). Both are audited by admin-api. Shares are typed as percentages.
 */
import { useId, useState } from 'react';
import { numberFormat, parseDigits } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';
import { NumberField } from '@/components/forms/NumberField';
import { saveCapacityRule, saveD1Limits } from '@/lib/api/costs';
import type { CapacityRule, CostDatabases } from '@/lib/api/costs-types';
import { FeedbackLine, useCostAction } from './useCostAction';
import { RULE_RANGE, ruleInputOf, ruleValueFromInput } from './model';

const labelClass = 'block text-sm font-medium text-fg';
const helpClass = 'mt-1 block text-xs text-fg-muted';
const buttonClass =
  'cost-primary inline-flex min-h-11 items-center justify-center rounded px-5 py-2.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const checkClass = 'size-5 shrink-0 accent-[var(--accent)]';

export function DatabaseSettings({ data }: { data: CostDatabases }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const [perDb, setPerDb] = useState(String(Math.round(data.limits.maxDbBytes / 1e9)));
  const [account, setAccount] = useState(String(Math.round(data.limits.accountBytes / 1e9)));
  const limits = useCostAction('d1-limits');
  const count = numberFormat(locale);

  async function saveLimits(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const db = Number(parseDigits(perDb.trim()));
    const acct = Number(parseDigits(account.trim()));
    if (!Number.isInteger(db) || db < 1 || db > 1000 || !Number.isInteger(acct) || acct < 1 || acct > 100_000) {
      limits.setFeedback({ kind: 'error', text: t('costs.databases.limits.invalid', { min: count.format(1), dbMax: count.format(1000), accountMax: count.format(100_000) }) });
      return;
    }
    await limits.run('save', () => saveD1Limits(db, acct), () => t('costs.databases.limits.saved'));
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2" data-testid="costs-databases-settings">
      <form onSubmit={saveLimits} noValidate className="cost-tile space-y-3 p-4" data-testid="costs-d1-limits">
        <p className="text-sm font-semibold text-fg">{t('costs.databases.limits.title')}</p>
        <p className={helpClass}>{t('costs.databases.limits.note')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${ids}-perdb`} className={labelClass}>{t('costs.databases.limits.perDb')}</label>
            <NumberField id={`${ids}-perdb`} dir="ltr" value={perDb} onChange={(e) => setPerDb(e.target.value)} className={`${fieldClass} mt-1 w-full tabular-nums`} data-testid="costs-d1-limit-perdb" />
          </div>
          <div>
            <label htmlFor={`${ids}-account`} className={labelClass}>{t('costs.databases.limits.account')}</label>
            <NumberField id={`${ids}-account`} dir="ltr" value={account} onChange={(e) => setAccount(e.target.value)} className={`${fieldClass} mt-1 w-full tabular-nums`} data-testid="costs-d1-limit-account" />
          </div>
        </div>
        <button type="submit" className={buttonClass} disabled={limits.busy !== null} data-testid="costs-d1-limits-save">{t('costs.databases.limits.save')}</button>
        <FeedbackLine feedback={limits.feedback} testId="costs-d1-limits-feedback" />
      </form>

      <div className="cost-tile space-y-3 p-4" data-testid="costs-capacity-rules">
        <p className="text-sm font-semibold text-fg">{t('costs.databases.rules.title')}</p>
        <ul className="space-y-3">
          {data.rules.map((r) => <RuleRow key={r.id} rule={r} />)}
        </ul>
      </div>
    </div>
  );
}

function RuleRow({ rule }: { rule: CapacityRule }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const [value, setValue] = useState(ruleInputOf(rule));
  const [enabled, setEnabled] = useState(rule.enabled === 1);
  const { run, busy, feedback, setFeedback } = useCostAction(`capacity-rule-${rule.id}`);
  const range = RULE_RANGE[rule.metric];
  const nf = numberFormat(locale);
  const label = t(`costs.databases.rules.${rule.metric}`, { hours: nf.format(rule.window_hours), pct: numberFormat(locale, { style: 'percent' }).format(0.7) });

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const stored = ruleValueFromInput(rule.metric, value);
    if (stored === null) {
      setFeedback({ kind: 'error', text: t('costs.databases.rules.invalid', { min: nf.format(range.min), max: nf.format(range.max) }) });
      return;
    }
    await run('save', () => saveCapacityRule(rule.id, stored, enabled), () => t('costs.databases.rules.saved'));
  }

  return (
    <li>
      <form onSubmit={save} noValidate className="flex flex-wrap items-end gap-3" data-testid={`costs-capacity-rule-${rule.id}`}>
        <div className="min-w-48 flex-1">
          <label htmlFor={`${ids}-v`} className={labelClass}>{label}</label>
          <NumberField decimal id={`${ids}-v`} dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} className={`${fieldClass} mt-1 w-full tabular-nums`} data-testid={`costs-capacity-rule-${rule.id}-value`} />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
          <input type="checkbox" className={checkClass} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid={`costs-capacity-rule-${rule.id}-enabled`} />
          {t('costs.databases.rules.enabled')}
        </label>
        <button type="submit" className={buttonClass} disabled={busy !== null} data-testid={`costs-capacity-rule-${rule.id}-save`}>{t('costs.databases.rules.save')}</button>
      </form>
      <FeedbackLine feedback={feedback} testId={`costs-capacity-rule-${rule.id}-feedback`} />
    </li>
  );
}
