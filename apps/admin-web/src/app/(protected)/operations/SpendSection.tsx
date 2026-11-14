import type { ReactNode } from 'react';
import Link from '@/components/AppLink';
import type { Translator } from '@/i18n/translate';
import { cardClass, linkClass } from '@/components/ui';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { OPS_TREND_KEYS, type OpsCostPart, type OpsCosts, type OpsEnv, type OpsTrendKey } from '@/lib/api/ops-types';
import { budgetMeter, dailyBudget, idleStatus, type MeterTone, type OpsFormats } from './model';

const TREND_COLOR: Record<OpsTrendKey, string> = {
  production: 'var(--spend-production)',
  stage: 'var(--spend-stage)',
  qa: 'var(--spend-qa)',
  bunny: 'var(--spend-bunny)',
  containers: 'var(--spend-containers)',
  ai: 'var(--spend-ai)',
};
const PARTS: OpsCostPart[] = ['cloudflare', 'bunny', 'containers', 'ai', 'plan'];
const PART_COLOR: Record<OpsCostPart, string> = {
  cloudflare: 'var(--spend-qa)',
  bunny: 'var(--spend-bunny)',
  containers: 'var(--spend-containers)',
  ai: 'var(--spend-ai)',
  plan: 'var(--spend-stage)',
};
const TONE_FILL: Record<MeterTone, string> = { ok: 'var(--accent)', warn: 'var(--warning-fg)', danger: 'var(--danger-fg)' };
const TONE_TEXT: Record<MeterTone, string> = { ok: 'text-fg', warn: 'text-warning-fg', danger: 'text-danger-fg' };

function Stat({ label, value, sub, tone = 'ok', testId }: { label: string; value: string; sub?: ReactNode; tone?: MeterTone; testId: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${TONE_TEXT[tone]}`} data-testid={testId}>{value}</dd>
      {sub != null && sub !== false && sub !== '' ? <dd className="mt-1 text-xs text-fg-muted tabular-nums">{sub}</dd> : null}
    </div>
  );
}

function BudgetMeterBar({ c, t, f }: { c: OpsCosts; t: Translator; f: OpsFormats }) {
  const m = budgetMeter(c.budget);
  const cap = c.budget.capUsd;
  return (
    <div className="mt-5" data-testid="ops-budget">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-fg-muted">
          <span className={`text-3xl font-bold tabular-nums ${TONE_TEXT[m.tone]}`} data-testid="ops-budget-spent">{f.usd(c.budget.mtd)}</span>{' '}
          {t('operations.spend.ofBudget', { cap: f.usd(cap) })}
        </p>
        <p className={`text-sm tabular-nums ${TONE_TEXT[m.projectedTone]}`} data-testid="ops-budget-projected-text">
          {t('operations.spend.projectedShort', { value: f.usd(c.budget.projected), percent: f.percent(c.budget.projectedShare) })}
        </p>
      </div>
      <div
        role="meter"
        aria-label={t('operations.spend.meter')}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={c.budget.mtd}
        aria-valuetext={t('operations.spend.meterText', { spent: f.usd(c.budget.mtd), cap: f.usd(cap), projected: f.usd(c.budget.projected) })}
        className="relative h-4 w-full overflow-hidden rounded-full border border-border bg-surface-2"
        data-testid="ops-budget-meter"
        data-level={c.budget.level}
        data-projected-level={c.budget.projectedLevel}
      >
        {/* Projected month end: a hatched band ahead of what is spent */}
        <div
          className="absolute inset-y-0 start-0"
          style={{
            width: `${m.projectedPct}%`,
            background: `repeating-linear-gradient(135deg, color-mix(in srgb, ${TONE_FILL[m.projectedTone]} 38%, transparent) 0 6px, transparent 6px 11px)`,
          }}
          data-testid="ops-budget-projected"
        />
        <div
          className="absolute inset-y-0 start-0 rounded-full"
          style={{ width: `${m.spentPct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${TONE_FILL[m.tone]} 70%, var(--surface)), ${TONE_FILL[m.tone]})` }}
        />
        {m.ticks.map((tick) => (
          <span key={tick} aria-hidden="true" className="absolute inset-y-0 w-px bg-fg-muted" style={{ insetInlineStart: `${tick}%` }} />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-xs text-fg-muted tabular-nums" aria-hidden="true">
        {m.ticks.map((tick) => (
          <span key={tick} className="absolute -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: `${tick}%` }}>
            {f.usd((cap * tick) / 100)}
          </span>
        ))}
        <span className="absolute end-0">{f.usd(cap)}</span>
      </div>
      <p className="mt-1 text-xs text-fg-muted">{t('operations.spend.ticks')}</p>
    </div>
  );
}

function PartsBar({ c, t, f }: { c: OpsCosts; t: Translator; f: OpsFormats }) {
  const total = PARTS.reduce((s, p) => s + c.budget.parts[p].mtd, 0);
  return (
    <div className="mt-6" data-testid="ops-parts">
      <h3 className="mb-2 text-sm font-medium text-fg">{t('operations.spend.partsTitle')}</h3>
      {total > 0 && (
        <div className="mb-3 flex h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          {PARTS.map((p) => (
            <span key={p} style={{ width: `${(c.budget.parts[p].mtd / total) * 100}%`, background: PART_COLOR[p] }} />
          ))}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
        {PARTS.map((p) => (
          <div key={p} data-testid={`ops-part-${p}`}>
            <dt className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ background: PART_COLOR[p] }} />
              {t(`operations.spend.parts.${p}`)}
            </dt>
            <dd className="text-sm font-medium text-fg tabular-nums">{f.usd(c.budget.parts[p].mtd)}</dd>
            <dd className="text-xs text-fg-muted tabular-nums">{t('operations.spend.partProjected', { value: f.usd(c.budget.parts[p].projected) })}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DriversTable({ c, t, f }: { c: OpsCosts; t: Translator; f: OpsFormats }) {
  if (c.drivers.length === 0) return <p className="text-fg-muted" data-testid="ops-drivers-empty">{t('operations.spend.driversEmpty')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="ops-drivers">
        <caption className="sr-only">{t('operations.spend.driversTitle')}</caption>
        <thead>
          <tr className="text-fg-muted">
            <th scope="col" className="p-2 text-start font-medium">{t('operations.resources.name')}</th>
            <th scope="col" className="p-2 text-start font-medium">{t('operations.spend.env')}</th>
            <th scope="col" className="p-2 text-end font-medium">{t('operations.spend.mtd')}</th>
            <th scope="col" className="p-2 text-end font-medium">{t('operations.spend.idle')}</th>
            <th scope="col" className="p-2 text-end font-medium">{t('operations.spend.last14')}</th>
          </tr>
        </thead>
        <tbody>
          {c.drivers.map((d) => {
            const max = Math.max(0, ...d.daily.values);
            const label = d.daily.values.map((v, i) => `${f.day(d.daily.days[i])}: ${f.usd(v)}`).join(', ');
            return (
              <tr key={d.id} className="border-t border-border" data-testid="ops-driver-row" data-env={d.env}>
                <th scope="row" className="p-2 text-start font-normal text-fg">
                  {/* Isolated: a Latin name next to a Latin kind label would merge into one run in Arabic */}
                  <bdi className="break-all">{d.name}</bdi>
                  <span className="ms-2 text-xs text-fg-muted"><bdi>{t(`operations.tabs.${d.kind}`)}</bdi></span>
                  {d.spike && (
                    <span className="ms-2 inline-block rounded-full border border-danger-border bg-danger-bg px-2 py-0.5 text-xs text-danger-fg" data-testid="ops-driver-spike">
                      {t('operations.spend.jump', { value: f.usd(d.spike.cost), baseline: f.usd(d.spike.baseline) })}
                    </span>
                  )}
                </th>
                <td className="p-2">
                  <span className="inline-flex items-center gap-1.5 text-fg-muted">
                    <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: TREND_COLOR[d.env] }} />
                    {t(`operations.envs.${d.env}`)}
                  </span>
                </td>
                <td className="p-2 text-end tabular-nums text-fg">{f.usd(d.mtdUsd)}</td>
                <td className="p-2 text-end tabular-nums text-fg-muted">{d.idleMonthlyUsd > 0 ? t('operations.spend.perMonth', { value: f.usd(d.idleMonthlyUsd) }) : '—'}</td>
                <td className="p-2 text-end">
                  <span className="inline-flex h-6 items-end gap-0.5" role="img" aria-label={label}>
                    {d.daily.values.map((v, i) => (
                      <span key={d.daily.days[i]} className="w-1.5 rounded-t-sm" style={{ height: `${max > 0 && v > 0 ? Math.max(8, (v / max) * 100) : 4}%`, background: TREND_COLOR[d.env], opacity: v > 0 ? 1 : 0.3 }} />
                    ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Spend (owner, 2026-11-14): everything against the one $500/month budget, warnings at 50% and
 * 80%, the projected month end, the projected idle cost against its $50 target, the daily spend
 * per env and source, and the drivers. Data: admin-api GET /api/ops/costs.
 */
export function SpendSection({ c, t, f, locale }: { c: OpsCosts; t: Translator; f: OpsFormats; locale: string }) {
  const m = budgetMeter(c.budget);
  const idle = idleStatus(c.idle);
  const left = Math.max(0, c.budget.capUsd - c.budget.mtd);
  const envs: OpsEnv[] = ['production', 'stage', 'qa'];
  const idleByEnv = envs
    .filter((e) => (c.idle.byEnv[e] ?? 0) > 0)
    .map((e) => `${t(`operations.envs.${e}`)} ${f.usd(c.idle.byEnv[e] ?? 0)}`)
    .join(' · ');
  const series = OPS_TREND_KEYS.map((key) => ({
    key,
    label: t(`operations.spend.trendKeys.${key}`),
    color: TREND_COLOR[key],
    values: c.trend.series.find((s) => s.key === key)?.values ?? c.trend.days.map(() => 0),
  })).filter((s) => s.values.some((v) => v > 0));

  return (
    <section id="spend" className={`${cardClass} mb-6 scroll-mt-6`} aria-labelledby="ops-spend-title" data-testid="ops-spend">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="ops-spend-title" className="text-lg font-semibold text-fg">{t('operations.spend.title')}</h2>
          <p className="text-sm text-fg-muted">{t('operations.spend.note')}</p>
        </div>
        {c.spikes.length > 0 && (
          <Link href="/errors" className={`${linkClass} text-sm`} data-testid="ops-spend-jumps">
            {t('operations.spend.jumpsOpen', { count: c.spikes.length })}
          </Link>
        )}
      </div>

      <BudgetMeterBar c={c} t={t} f={f} />

      <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('operations.spend.spent')} value={f.usd(c.budget.mtd)} sub={t('operations.spend.share', { percent: f.percent(c.budget.share) })} tone={m.tone} testId="ops-spend-mtd" />
        <Stat label={t('operations.spend.projected')} value={f.usd(c.budget.projected)} sub={t('operations.spend.share', { percent: f.percent(c.budget.projectedShare) })} tone={m.projectedTone} testId="ops-spend-projected" />
        <Stat
          label={t('operations.spend.idleTitle')}
          value={f.usd(c.idle.monthlyUsd)}
          sub={
            <>
              <span className={idle.under ? 'text-success-fg' : 'text-danger-fg'} data-testid="ops-idle-status">
                {idle.under ? t('operations.spend.idleUnder', { target: f.usd(c.idle.targetUsd) }) : t('operations.spend.idleOver', { target: f.usd(c.idle.targetUsd), over: f.usd(idle.overBy) })}
              </span>
              {idleByEnv && <span className="block">{idleByEnv}</span>}
            </>
          }
          tone={idle.under ? 'ok' : 'danger'}
          testId="ops-idle"
        />
        <Stat label={t('operations.spend.left')} value={f.usd(left)} sub={t('operations.spend.leftSub', { month: f.month(c.budget.month) })} testId="ops-spend-left" />
      </dl>

      <PartsBar c={c} t={t} f={f} />

      <div className="mt-6">
        <StackedBarChart
          title={t('operations.spend.trendTitle')}
          days={c.trend.days}
          series={series}
          locale={locale}
          format={f.usd}
          dayLabel={f.day}
          reference={{ value: dailyBudget(c.budget.capUsd, c.budget.month), label: t('operations.spend.dailyBudget', { value: f.usd(dailyBudget(c.budget.capUsd, c.budget.month)) }) }}
          labels={{ chart: t('operations.spend.trendTitle'), table: t('operations.charts.table'), day: t('operations.spend.day'), total: t('operations.spend.total'), empty: t('operations.charts.empty') }}
          testId="ops-spend-trend"
        />
      </div>

      <div className="mt-6">
        <h3 className="mb-1 text-sm font-medium text-fg">{t('operations.spend.driversTitle')}</h3>
        <p className="mb-2 text-xs text-fg-muted">{t('operations.spend.driversNote')}</p>
        <DriversTable c={c} t={t} f={f} />
      </div>
    </section>
  );
}
