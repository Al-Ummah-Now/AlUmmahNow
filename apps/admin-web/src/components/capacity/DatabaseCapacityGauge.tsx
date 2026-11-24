/**
 * A compact D1 capacity row for the Operations and Status pages (wiki AUN-D1-SCALING D1-1): the
 * fullest database, the one soonest to 70% of its limit and the account total, linking to the
 * Costs page's Databases section. A server component; renders nothing without data.
 */
import Link from '@/components/AppLink';
import { linkClass } from '@/components/ui';
import type { Translator } from '@/i18n/translate';
import type { CostDatabases } from '@/lib/api/costs-types';
import type { OpsFormats } from '@/app/(protected)/operations/model';
import { ShareBar } from '@/app/(protected)/costs/DatabasesSection';

export function DatabaseCapacityGauge({ data, t, f, testId }: { data: CostDatabases | null; t: Translator; f: OpsFormats; testId: string }) {
  if (!data || (data.databases.length === 0 && !data.account)) return null;
  const sized = data.databases.filter((d) => d.share !== null);
  const fullest = sized.length ? sized.reduce((a, b) => ((b.share ?? 0) > (a.share ?? 0) ? b : a)) : null;
  const soonest = data.databases.find((d) => d.daysTo70 !== null && d.daysTo70 > 0) ?? null;
  const open = data.databases.some((d) => d.alerts.length > 0) || (data.account?.alerts.length ?? 0) > 0;
  const calm = !open && (fullest?.share ?? 0) < 0.5 && !soonest;
  return (
    <section className="cost-panel mb-6 p-4 sm:p-5" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${testId}-title`} className="text-lg font-semibold text-fg">{t('costs.databases.gauge.title')}</h2>
        <Link href="/costs#databases" className={`${linkClass} text-sm`}>{t('costs.databases.gauge.open')}</Link>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {fullest && (
          <div className="cost-tile p-3" data-testid={`${testId}-fullest`}>
            <p className="text-sm text-fg"><bdi>{t('costs.databases.gauge.worst', { name: fullest.name, share: f.percent(fullest.share ?? 0) })}</bdi></p>
            <ShareBar share={fullest.share} label={f.percent(fullest.share ?? 0)} />
          </div>
        )}
        {data.account && (
          <div className="cost-tile p-3" data-testid={`${testId}-account`}>
            <p className="text-sm text-fg">{t('costs.databases.account')}: <span className="tabular-nums">{f.percent(data.account.share)}</span></p>
            <ShareBar share={data.account.share} label={f.percent(data.account.share)} />
          </div>
        )}
        <div className="cost-tile p-3 text-sm text-fg" data-testid={`${testId}-forecast`}>
          {soonest
            ? <bdi>{t('costs.databases.gauge.soonest', { name: soonest.name, days: f.count(Math.round(soonest.daysTo70 ?? 0)), pct: f.percent(0.7) })}</bdi>
            : calm ? t('costs.databases.gauge.none') : t('costs.databases.daysNone')}
          {open && <p className="mt-1 text-xs font-medium text-warning-fg">{t('costs.databases.alertOpen')}</p>}
        </div>
      </div>
    </section>
  );
}
