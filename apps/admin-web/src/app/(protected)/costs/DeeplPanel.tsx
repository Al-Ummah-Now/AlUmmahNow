/**
 * Costs → DeepL (AUN-CAPTIONS DEEPL-KEY): characters sent to DeepL this month (the processor's
 * ai_usage_daily rows) and the estimated DeepL bill at the key's plan's list price (Free: $0; Pro:
 * monthly base + per million characters), plus what DeepL itself reported at the last key test.
 * The AI line in By product already counts DeepL at the caption budget's rate, so this panel is not
 * added to the totals. The key is managed on Caption settings.
 */
import Link from '@/components/AppLink';
import type { Translator } from '@/i18n/translate';
import { linkClass } from '@/components/ui';
import type { CostsDashboard } from '@/lib/api/costs-types';
import type { OpsFormats } from '../operations/model';

export function DeeplPanel({ d, t, f }: { d: CostsDashboard; t: Translator; f: OpsFormats }) {
  const deepl = d.deepl;
  if (!deepl) return null;
  const plan = deepl.plan ? t(`costs.deepl.plan.${deepl.plan}`) : t('costs.deepl.noKey');
  return (
    <section className="cost-panel min-w-0 p-5 sm:p-6" aria-labelledby="costs-deepl-title" data-testid="costs-deepl">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="costs-deepl-title" className="text-lg font-semibold text-fg">{t('costs.deepl.title')}</h2>
        <Link href="/captions-settings#deepl-key" className={`${linkClass} text-sm`} data-testid="costs-deepl-manage">{t('costs.deepl.manage')}</Link>
      </div>
      <p className="mb-4 mt-1 text-sm text-fg-muted">{t('costs.deepl.note')}</p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="cost-tile p-3">
          <dt className="text-xs text-fg-muted">{t('costs.deepl.characters')}</dt>
          <dd className="mt-1 text-xl font-semibold text-fg tabular-nums" data-testid="costs-deepl-characters">{f.count(deepl.characters)}</dd>
        </div>
        <div className="cost-tile p-3">
          <dt className="text-xs text-fg-muted">{t('costs.deepl.estimate')}</dt>
          <dd className="mt-1 text-xl font-semibold text-fg tabular-nums" data-testid="costs-deepl-cost">{f.usd(deepl.costUsd)}</dd>
        </div>
        <div className="cost-tile p-3">
          <dt className="text-xs text-fg-muted">{t('costs.deepl.planLabel')}</dt>
          <dd className="mt-1 text-base font-semibold text-fg" data-testid="costs-deepl-plan">{plan}</dd>
        </div>
      </dl>
      {deepl.reported && (
        <p className="mt-3 text-xs text-fg-muted" data-testid="costs-deepl-reported">
          {deepl.reported.characterLimit !== null
            ? t('costs.deepl.reported', { used: f.count(deepl.reported.characterCount), limit: f.count(deepl.reported.characterLimit), time: f.time(deepl.reported.at) })
            : t('costs.deepl.reportedNoLimit', { used: f.count(deepl.reported.characterCount), time: f.time(deepl.reported.at) })}
        </p>
      )}
    </section>
  );
}
