/**
 * The Costs page's read-only sections (server components): header with the data age and the
 * token notice, budget with forecast and open alerts, breakdown by product and environment with
 * the 30-day trend per env and source, and the top movers. They take translated strings and formats.
 * Spend moved here from Operations (owner, 2026-11-21): the idle cost, the parts and the per-source
 * trend; the drivers and the Cloudflare invoice lines are in details.tsx.
 */
import Link from '@/components/AppLink';

import type { Translator } from '@/i18n/translate';
import { linkClass } from '@/components/ui';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { COST_TREND_KEYS, type CostBudgetPart, type CostEnvKey, type CostMover, type CostsDashboard, type CostTrendKey } from '@/lib/api/costs-types';
import { budgetMeter, dailyBudget, idleStatus, type MeterTone, type OpsFormats } from '../operations/model';
import { dataAge, parseAlertKey, shareOf, tokenNotice, weekDelta, type Direction } from './model';
import { moneyFormat } from '@al-ummah/shared-types';
import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';

export const ENV_KEYS: CostEnvKey[] = ['production', 'stage', 'qa', 'account'];
export const ENV_COLOR: Record<CostEnvKey, string> = {
  production: 'var(--spend-production)',
  stage: 'var(--spend-stage)',
  qa: 'var(--spend-qa)',
  account: 'var(--spend-bunny)',
};
/** The stacked daily chart and the drivers: each env's Cloudflare spend, then the other sources. */
export const TREND_COLOR: Record<CostTrendKey, string> = {
  production: 'var(--spend-production)',
  stage: 'var(--spend-stage)',
  qa: 'var(--spend-qa)',
  bunny: 'var(--spend-bunny)',
  containers: 'var(--spend-containers)',
  ai: 'var(--spend-ai)',
  resend: 'var(--spend-resend)',
  fixed: 'var(--spend-fixed)',
};
const PARTS: CostBudgetPart[] = ['cloudflare', 'bunny', 'containers', 'ai', 'resend', 'plan', 'fixed'];
const PART_COLOR: Record<CostBudgetPart, string> = {
  cloudflare: 'var(--spend-qa)',
  bunny: 'var(--spend-bunny)',
  containers: 'var(--spend-containers)',
  ai: 'var(--spend-ai)',
  resend: 'var(--spend-resend)',
  plan: 'var(--spend-stage)',
  fixed: 'var(--spend-fixed)',
};
const TONE_FILL: Record<MeterTone, string> = { ok: 'var(--accent)', warn: 'var(--warning-fg)', danger: 'var(--danger-fg)' };
const TONE_TEXT: Record<MeterTone, string> = { ok: 'text-fg', warn: 'text-warning-fg', danger: 'text-danger-fg' };
/** A cost going up is the bad direction. */
const DIRECTION_TEXT: Record<Direction, string> = { up: 'text-danger-fg', down: 'text-success-fg', flat: 'text-fg-muted' };
const DIRECTION_MARK: Record<Direction, string> = { up: '▲', down: '▼', flat: '–' };

export const sectionTitle = 'text-lg font-semibold text-fg';
export const sectionNote = 'text-sm text-fg-muted';

interface Common {
  t: Translator;
  f: OpsFormats;
}

const envLabel = (t: Translator, env: string) => (ENV_KEYS as string[]).includes(env) ? t(`costs.envs.${env as CostEnvKey}`) : env;

/** "+$1.20" / "−$0.80" in the locale's digits. */
export function signedUsd(locale: string): (v: number) => string {
  const nf = moneyFormat(locale, 'USD', { signDisplay: 'exceptZero', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v) => nf.format(v);
}

function percentList(levels: readonly number[], f: OpsFormats, t: Translator): string {
  return levels.map((l) => f.percent(l)).join(t('costs.listSep'));
}

export function CostsHeader({ d, t, now }: Common & { d: CostsDashboard | null; now: Date }) {
  const age = d ? dataAge(d.dataAsOf, now) : null;
  return (
    <header className="cost-hero p-5 sm:p-6" data-testid="costs-header">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold text-fg">{t('costs.title')}</h1>
          <p className="mt-1 text-fg-muted">{t('costs.subtitle')}</p>
        </div>
        {age && (
          <p className="cost-pill min-w-0 max-w-full" data-tone={age.stale ? 'warn' : 'good'} data-testid="costs-data-age" data-stale={age.stale ? 'true' : 'false'}>
            <span aria-hidden="true" className={`cost-dot ${age.stale ? 'text-warning-fg' : 'text-success-fg'}`} />
            <span className="min-w-0 break-words tabular-nums">{age.never ? t('costs.dataNever') : fillNodes(t(age.stale ? 'costs.dataStale' : 'costs.dataAsOf'), { time: <LocalTime value={d!.dataAsOf!} withTime /> })}</span>
          </p>
        )}
      </div>
      {d && <p className="mt-3 text-xs text-fg-muted">{t('costs.estimated')}</p>}
    </header>
  );
}

/** The no-token banner (prominent) or the release-token note (quiet). */
/** `check`: the "Check again" button (a client component, passed in by the page). */
export function TokenNotice({ d, t, check }: { d: CostsDashboard; t: Translator; check?: React.ReactNode }) {
  const notice = tokenNotice(d.collector, d.connections);
  if (notice === 'release') {
    return (
      <p className="cost-note px-4 py-3 text-sm text-fg" data-testid="costs-token-banner" data-kind="release">
        {t('costs.token.release')}
      </p>
    );
  }
  if (notice === 'refused') return <RefusedNotice d={d} t={t} check={check} />;
  if (notice !== 'missing') return null;
  return (
    <section className="cost-banner p-5" role="status" aria-labelledby="costs-token-title" data-testid="costs-token-banner" data-kind="missing">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl">
          <h2 id="costs-token-title" className="flex items-center gap-2 text-lg font-semibold text-fg">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0 text-warning-fg" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 8a4 4 0 1 1-3.5 6L4 21H3v-3l7-7A4 4 0 0 1 15 8zM16 7h.01" />
            </svg>
            {t('costs.token.missingTitle')}
          </h2>
          <p className="mt-1 text-sm text-fg">{d.canManage ? t('costs.token.missingManage') : t('costs.token.missingAdmin')}</p>
        </div>
        {d.canManage && (
          <a
            href="#connections"
            className="cost-primary inline-flex min-h-11 items-center rounded px-5 py-2.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
            data-testid="costs-token-action"
          >
            {t('costs.token.missingAction')}
          </a>
        )}
      </div>
    </section>
  );
}

/** Warning banner when no monthly budget has been set yet: budget alerts stay quiet until a super admin sets one. */
export function BudgetNotice({ d, t }: { d: CostsDashboard; t: Translator }) {
  if ((d.settings.budgetUsd ?? d.budget.capUsd) !== null) return null;
  return (
    <section className="cost-banner p-5" role="status" aria-labelledby="costs-budget-banner-title" data-testid="costs-budget-banner" data-kind="unset">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl">
          <h2 id="costs-budget-banner-title" className="flex items-center gap-2 text-lg font-semibold text-fg">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0 text-warning-fg" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18.5A2 2 0 0 0 3.5 21.5h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            {t('costs.budget.unsetBannerTitle')}
          </h2>
          <p className="mt-1 text-sm text-fg">{d.canManage ? t('costs.budget.unsetBannerManage') : t('costs.budget.unsetBannerAdmin')}</p>
        </div>
        {d.canManage && (
          <a
            href="#thresholds"
            className="cost-primary inline-flex min-h-11 items-center rounded px-5 py-2.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
            data-testid="costs-budget-action"
          >
            {t('costs.budget.unsetBannerAction')}
          </a>
        )}
      </div>
    </section>
  );
}

const KEY_ICON = (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0 text-warning-fg" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 8a4 4 0 1 1-3.5 6L4 21H3v-3l7-7A4 4 0 0 1 15 8zM16 7h.01" />
  </svg>
);

/**
 * Cloudflare refuses the collector's token (no Account Analytics Read): the Cloudflare figures
 * are missing, not zero. Names the permission, where to fix it, and "Check again" for super admins.
 */
function RefusedNotice({ d, t, check }: { d: CostsDashboard; t: Translator; check?: React.ReactNode }) {
  const via = d.collector.analytics?.via === 'test' ? 'test' : 'run';
  const lastGood = d.dataAsOf;
  return (
    <section className="cost-banner p-5" role="alert" aria-labelledby="costs-token-title" data-testid="costs-token-banner" data-kind="refused" data-via={via}>
      <h2 id="costs-token-title" className="flex items-start gap-2 text-lg font-semibold text-fg">
        {KEY_ICON}
        <span>{t('costs.token.refusedTitle')}</span>
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-fg" data-testid="costs-token-permission">
        {fillNodes(t(d.collector.tokenSource === 'admin' ? 'costs.token.refusedAdminToken' : 'costs.token.refusedSharedToken'), {
          permission: (
            <span dir="ltr" className="whitespace-nowrap font-semibold">
              {t('costs.token.permission')}
            </span>
          ),
        })}
      </p>
      <p className="mt-1 max-w-3xl text-sm text-fg">{lastGood ? fillNodes(t('costs.token.refusedSince'), { time: <LocalTime value={lastGood} withTime /> }) : t('costs.token.refusedNever')}</p>
      <div className="mt-3 flex flex-wrap items-start gap-3">
        {d.canManage ? (
          <>
            {check}
            <a href="#connections" className={`${linkClass} inline-flex min-h-11 items-center`} data-testid="costs-token-action">
              {t('costs.token.refusedAction')}
            </a>
          </>
        ) : (
          <p className="text-sm text-fg-muted">{t('costs.token.refusedAdmin')}</p>
        )}
      </div>
    </section>
  );
}

export function CollectorFailures({ d, t }: Common & { d: CostsDashboard }) {
  if (!d.collector.lastJobFailures.length) return null;
  return (
    <div className="cost-note px-4 py-3 text-sm" data-testid="costs-collector-failures">
      <ul className="space-y-1 text-fg">
        {d.collector.lastJobFailures.map((j) => (
          <li key={`${j.job}-${j.at}`}>
            {fillNodes(t('costs.failures', { job: j.job }), { time: <LocalTime value={j.at} withTime /> })}
          </li>
        ))}
      </ul>
      <Link href="/errors" className={`${linkClass} mt-1 inline-block`}>{t('costs.failuresLink')}</Link>
    </div>
  );
}

function Stat({ label, value, sub, tone = 'ok', testId }: { label: string; value: string; sub?: React.ReactNode; tone?: MeterTone; testId: string }) {
  return (
    <div className="cost-tile p-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${TONE_TEXT[tone]}`} data-testid={testId}>{value}</dd>
      {sub ? <dd className="mt-1 text-xs text-fg-muted tabular-nums">{sub}</dd> : null}
    </div>
  );
}

export function alertText(d: CostsDashboard, key: string, t: Translator, f: OpsFormats): string {
  const a = parseAlertKey(key);
  if (a.type === 'budget') return a.percent === 100 ? t('costs.budget.alert.budgetFull', { month: f.month(a.month) }) : t('costs.budget.alert.budget', { percent: f.percent(a.percent / 100), month: f.month(a.month) });
  if (a.type === 'projected') return t('costs.budget.alert.projected', { month: f.month(a.month) });
  if (a.type === 'spike') {
    if (a.total) return t('costs.budget.alert.spikeTotal', { env: envLabel(t, a.env) });
    const name = d.spikes.find((s) => s.key === key)?.name ?? a.resource;
    return t('costs.budget.alert.spikeResource', { name, env: envLabel(t, a.env) });
  }
  return t('costs.budget.alert.other', { key: a.key });
}

export function BudgetSection({ d, t, f }: Common & { d: CostsDashboard }) {
  const b = d.budget;
  const cap = d.settings.budgetUsd ?? b.capUsd;
  const m = budgetMeter({ ...b, levels: d.settings.budgetLevels });
  const left = cap !== null ? Math.max(0, cap - b.mtd) : null;
  const idle = idleStatus(d.idle);
  const idleByEnv = (['production', 'stage', 'qa'] as const)
    .filter((e) => (d.idle.byEnv[e] ?? 0) > 0)
    .map((e) => `${t(`costs.envs.${e}`)} ${f.usd(d.idle.byEnv[e] ?? 0)}`)
    .join(t('costs.listSep'));
  return (
    <section className="cost-panel p-5 sm:p-6" aria-labelledby="costs-budget-title" data-testid="costs-budget">
      <h2 id="costs-budget-title" className={sectionTitle}>{t('costs.budget.title')}</h2>
      <p className={sectionNote}>{t('costs.budget.note')}</p>

      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-fg-muted">
            <span className={`text-4xl font-bold tabular-nums ${TONE_TEXT[m.tone]}`} data-testid="costs-budget-spent">{f.usd(b.mtd)}</span>{' '}
            <span data-testid="costs-budget-cap">
              {cap !== null ? t('costs.budget.ofBudget', { cap: f.usd(cap), month: f.month(b.month) }) : t('costs.budget.unsetInMonth', { month: f.month(b.month) })}
            </span>
          </p>
          <p className={`text-sm tabular-nums ${TONE_TEXT[m.projectedTone]}`}>
            {cap !== null && b.projectedShare !== null
              ? t('costs.budget.forecastShort', { value: f.usd(d.forecast.trailing), percent: f.percent(b.projectedShare) })
              : t('costs.budget.forecastShortUnset', { value: f.usd(d.forecast.trailing) })}
          </p>
        </div>
        {cap !== null ? (
          <>
            <div
              role="meter"
              aria-label={t('costs.budget.meter')}
              aria-valuemin={0}
              aria-valuemax={cap}
              aria-valuenow={Math.min(b.mtd, cap)}
              aria-valuetext={t('costs.budget.meterText', { spent: f.usd(b.mtd), cap: f.usd(cap), projected: f.usd(d.forecast.trailing) })}
              className="cost-bar-track relative h-5 w-full overflow-hidden border border-border"
              data-testid="costs-budget-meter"
              data-level={b.level}
            >
              <div
                className="absolute inset-y-0 start-0"
                style={{ width: `${m.projectedPct}%`, background: `repeating-linear-gradient(135deg, color-mix(in srgb, ${TONE_FILL[m.projectedTone]} 40%, transparent) 0 6px, transparent 6px 11px)` }}
              />
              <div
                className="absolute inset-y-0 start-0 rounded-full"
                style={{ width: `${m.spentPct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${TONE_FILL[m.tone]} 65%, var(--surface)), ${TONE_FILL[m.tone]})`, boxShadow: '0 0 12px -2px var(--m-glow, transparent)' }}
              />
              {m.ticks.map((tick) => (
                <span key={tick} aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-fg-muted" style={{ insetInlineStart: `${tick}%` }} />
              ))}
            </div>
            <div className="relative mt-1 h-4 text-xs text-fg-muted tabular-nums" aria-hidden="true">
              {m.ticks.map((tick) => (
                <span key={tick} className="absolute -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: `${tick}%` }}>{f.percent(tick / 100)}</span>
              ))}
              {/* The budget is in the line above the bar; on a phone this label ran into the 80% tick */}
              <span className="absolute end-0 hidden sm:inline">{f.usd(cap)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-full" style={{ background: TONE_FILL[m.tone] }} />{t('costs.budget.legendSpent')}</span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-full border border-border" style={{ background: `repeating-linear-gradient(135deg, color-mix(in srgb, ${TONE_FILL[m.projectedTone]} 55%, transparent) 0 3px, transparent 3px 6px)` }} />
                {t('costs.budget.legendForecast')}
              </span>
              <span data-testid="costs-budget-levels">{t('costs.budget.levels', { levels: percentList(d.settings.budgetLevels, f, t) })}</span>
            </div>
          </>
        ) : (
          <p className="cost-note px-4 py-3 text-sm text-fg" data-testid="costs-budget-unset">
            {d.canManage ? t('costs.budget.unsetNoteManage') : t('costs.budget.unsetNoteAdmin')}{' '}
            {d.canManage && <a href="#thresholds" className={`${linkClass} underline`}>{t('costs.budget.setPrompt')}</a>}
          </p>
        )}
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t('costs.budget.spent')} value={f.usd(b.mtd)} sub={cap !== null && b.share !== null ? t('costs.budget.share', { percent: f.percent(b.share) }) : t('costs.budget.spentSub')} tone={m.tone} testId="costs-spent" />
        <Stat
          label={t('costs.budget.forecast')}
          value={f.usd(d.forecast.trailing)}
          sub={
            <>
              <span className="block">{t('costs.budget.forecastSub')}</span>
              <span className="block" data-testid="costs-forecast-linear">{t('costs.budget.linear', { value: f.usd(d.forecast.linear) })}</span>
            </>
          }
          tone={m.projectedTone}
          testId="costs-forecast"
        />
        <Stat
          label={t('costs.budget.idleTitle')}
          value={f.usd(d.idle.monthlyUsd)}
          sub={
            <>
              <span className={`block ${idle.under ? 'text-success-fg' : 'text-danger-fg'}`} data-testid="costs-idle-status">
                {idle.under ? t('costs.budget.idleUnder', { target: f.usd(d.idle.targetUsd) }) : t('costs.budget.idleOver', { target: f.usd(d.idle.targetUsd), over: f.usd(idle.overBy) })}
              </span>
              {idleByEnv && <span className="block">{idleByEnv}</span>}
            </>
          }
          tone={idle.under ? 'ok' : 'danger'}
          testId="costs-idle"
        />
        {left !== null ? (
          <Stat label={t('costs.budget.left')} value={f.usd(left)} sub={t('costs.budget.leftSub', { month: f.month(b.month) })} testId="costs-left" />
        ) : (
          <Stat
            label={t('costs.budget.monthlyBudget')}
            value={t('costs.budget.notSet')}
            sub={d.canManage ? <a href="#thresholds" className={linkClass}>{t('costs.budget.setPrompt')}</a> : t('costs.budget.superAdminPrompt')}
            tone="warn"
            testId="costs-left"
          />
        )}
      </dl>

      <PartsBar d={d} t={t} f={f} />

      <div className="mt-6" data-testid="costs-alerts-open">
        <h3 className="mb-2 text-sm font-semibold text-fg">{t('costs.budget.alertsTitle')}</h3>
        {d.alerts.length === 0 ? (
          <p className="text-sm text-fg-muted" data-testid="costs-alerts-empty">{t('costs.budget.alertsEmpty')}</p>
        ) : (
          <>
            <ul className="space-y-2">
              {d.alerts.map((a) => {
                const kind = parseAlertKey(a.key).type;
                return (
                  <li key={a.key} className="cost-tile flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid="costs-alert" data-kind={kind}>
                    <span className="inline-flex items-center gap-2 text-fg">
                      <span aria-hidden="true" className={`cost-dot ${kind === 'spike' ? 'text-warning-fg' : 'text-danger-fg'}`} />
                      <bdi>{alertText(d, a.key, t, f)}</bdi>
                    </span>
                    <span className="text-xs text-fg-muted tabular-nums">{fillNodes(t('costs.budget.opened'), { time: <LocalTime value={a.opened_at} withTime /> })}</span>
                  </li>
                );
              })}
            </ul>
            <Link href="/errors" className={`${linkClass} mt-2 inline-block text-sm`} data-testid="costs-alerts-link">{t('costs.budget.alertsLink')}</Link>
          </>
        )}
      </div>
    </section>
  );
}

/** Where the month's spend goes: Cloudflare at billed rates, the other sources, the plan and the fixed costs. */
function PartsBar({ d, t, f }: Common & { d: CostsDashboard }) {
  const parts = d.budget.parts;
  const total = PARTS.reduce((s, p) => s + (parts[p]?.mtd ?? 0), 0);
  return (
    <div className="mt-6" data-testid="costs-parts">
      <h3 className="mb-2 text-sm font-semibold text-fg">{t('costs.budget.partsTitle')}</h3>
      {total > 0 && (
        <div className="cost-bar-track mb-3 flex h-2.5 w-full overflow-hidden" aria-hidden="true">
          {PARTS.map((p) => <span key={p} style={{ width: `${shareOf(parts[p]?.mtd ?? 0, total) * 100}%`, background: PART_COLOR[p] }} />)}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:grid-cols-7">
        {PARTS.map((p) => (
          <div key={p} data-testid={`costs-part-${p}`}>
            <dt className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: PART_COLOR[p] }} />
              {t(`costs.budget.parts.${p}`)}
            </dt>
            <dd className="text-sm font-medium text-fg tabular-nums">{f.usd(parts[p]?.mtd ?? 0)}</dd>
            <dd className="text-xs text-fg-muted tabular-nums">{t('costs.budget.partProjected', { value: f.usd(parts[p]?.projected ?? 0) })}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-fg-muted">{t('costs.budget.partsNote')}</p>
    </div>
  );
}

function DeltaText({ last7, prev7, t, f, signed }: Common & { last7: number; prev7: number; signed: (v: number) => string }) {
  const delta = weekDelta(last7, prev7);
  const label = delta.direction === 'flat' ? t('costs.breakdown.flat') : t(delta.direction === 'up' ? 'costs.breakdown.up' : 'costs.breakdown.down', { value: f.usd(Math.abs(delta.change)) });
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap tabular-nums ${DIRECTION_TEXT[delta.direction]}`} data-direction={delta.direction}>
      <span aria-hidden="true">{DIRECTION_MARK[delta.direction]}</span>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{delta.direction === 'flat' ? label : signed(delta.change)}</span>
      {delta.share !== null && delta.direction !== 'flat' && <span className="text-xs text-fg-muted" aria-hidden="true">({f.percent(Math.abs(delta.share))})</span>}
    </span>
  );
}

const th = 'px-3 py-2 font-medium whitespace-nowrap';

export function ProductsPanel({ d, t, f, locale }: Common & { d: CostsDashboard; locale: string }) {
  const total = d.products.reduce((s, p) => s + p.mtd, 0);
  const signed = signedUsd(locale);
  const notes = [
    d.sources.bunny === 'estimate' ? t('costs.sources.bunnyEstimate') : null,
    d.sources.containers === 'estimate' ? t('costs.sources.containersEstimate') : null,
    d.sources.resend === 'none' ? t('costs.sources.resendNone') : null,
  ].filter((n): n is string => !!n);
  return (
    <section className="cost-panel min-w-0 p-5 sm:p-6" aria-labelledby="costs-products-title" data-testid="costs-products">
      <h2 id="costs-products-title" className={sectionTitle}>{t('costs.breakdown.productsTitle')}</h2>
      <p className={`${sectionNote} mb-3`}>{t('costs.breakdown.productsNote')}</p>
      {d.products.length === 0 ? (
        <p className="text-fg-muted" data-testid="costs-products-empty">{t('costs.breakdown.empty')}</p>
      ) : (
        <>
        <ul className="space-y-2 sm:hidden" data-testid="costs-products-list">
          {d.products.map((p) => {
            const share = shareOf(p.mtd, total);
            return (
              <li key={p.product} className="cost-tile p-3" data-product={p.product}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-fg"><bdi>{t(`costs.products.${p.product}`)}</bdi></span>
                  <span className="font-semibold text-fg tabular-nums">{f.usd(p.mtd)}</span>
                </div>
                <span className="cost-bar-track mt-2 block h-1.5 w-full overflow-hidden" aria-hidden="true">
                  <span className="cost-bar-fill block h-full" style={{ width: `${Math.max(share > 0 ? 2 : 0, share * 100)}%` }} />
                </span>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div><dt className="text-fg-muted">{t('costs.breakdown.projected')}</dt><dd className="text-fg tabular-nums">{f.usd(p.projected)}</dd></div>
                  <div><dt className="text-fg-muted">{t('costs.breakdown.last7')}</dt><dd className="text-fg tabular-nums">{f.usd(p.last7)}</dd></div>
                  <div className="col-span-2 flex flex-wrap items-center justify-between gap-2">
                    <dt className="text-fg-muted">{t('costs.breakdown.share', { percent: f.percent(share) })}</dt>
                    <dd><DeltaText last7={p.last7} prev7={p.prev7} t={t} f={f} signed={signed} /></dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
        <div className="relative -mx-3 hidden overflow-x-auto sm:block focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" tabIndex={0} role="region" aria-label={t('costs.breakdown.productsTitle')}>
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">{t('costs.breakdown.productsTitle')}</caption>
            <thead>
              <tr className="text-fg-muted">
                <th scope="col" className={`${th} text-start`}>{t('costs.breakdown.product')}</th>
                <th scope="col" className={`${th} text-end`}>{t('costs.breakdown.mtd')}</th>
                <th scope="col" className={`${th} text-end`}>{t('costs.breakdown.projected')}</th>
                <th scope="col" className={`${th} text-end`}>{t('costs.breakdown.last7')}</th>
                <th scope="col" className={`${th} text-end`}>{t('costs.breakdown.change')}</th>
              </tr>
            </thead>
            <tbody>
              {d.products.map((p) => {
                const share = shareOf(p.mtd, total);
                return (
                  <tr key={p.product} className="border-t border-border" data-testid="costs-product-row" data-product={p.product}>
                    <th scope="row" className="px-3 py-2.5 text-start font-normal">
                      <span className="font-medium text-fg"><bdi>{t(`costs.products.${p.product}`)}</bdi></span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <span className="cost-bar-track block h-1.5 w-20 shrink-0 overflow-hidden" aria-hidden="true">
                          <span className="cost-bar-fill block h-full" style={{ width: `${Math.max(share > 0 ? 3 : 0, share * 100)}%` }} />
                        </span>
                        <span className="whitespace-nowrap text-xs text-fg-muted tabular-nums">{t('costs.breakdown.share', { percent: f.percent(share) })}</span>
                      </span>
                    </th>
                    <td className="px-3 py-2.5 text-end font-medium text-fg tabular-nums">{f.usd(p.mtd)}</td>
                    <td className="px-3 py-2.5 text-end text-fg-muted tabular-nums">{f.usd(p.projected)}</td>
                    <td className="px-3 py-2.5 text-end text-fg-muted tabular-nums">{f.usd(p.last7)}</td>
                    <td className="px-3 py-2.5 text-end"><DeltaText last7={p.last7} prev7={p.prev7} t={t} f={f} signed={signed} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      {notes.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-fg-muted" data-testid="costs-source-notes">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </section>
  );
}

export function EnvsPanel({ d, t, f }: Common & { d: CostsDashboard }) {
  const values = ENV_KEYS.map((e) => ({ env: e, value: d.envs[e] ?? 0 }));
  const total = values.reduce((s, v) => s + v.value, 0);
  return (
    <section className="cost-panel min-w-0 p-5 sm:p-6" aria-labelledby="costs-envs-title" data-testid="costs-envs">
      <h2 id="costs-envs-title" className={sectionTitle}>{t('costs.breakdown.envsTitle')}</h2>
      <p className={`${sectionNote} mb-4`}>{t('costs.breakdown.envsNote')}</p>
      <div className="cost-bar-track mb-4 flex h-3 w-full overflow-hidden" aria-hidden="true">
        {total > 0 && values.map((v) => <span key={v.env} style={{ width: `${shareOf(v.value, total) * 100}%`, background: ENV_COLOR[v.env] }} />)}
      </div>
      {/* Four across while the panel is full width; two once it sits beside By product (1800 px, page.tsx).
          A range, because Tailwind emits min-[1800px] before lg, so lg:grid-cols-4 would win over it. */}
      <dl className="grid grid-cols-2 gap-3 lg:max-[1799px]:grid-cols-4">
        {values.map((v) => (
          <div key={v.env} className="cost-tile p-3" data-testid={`costs-env-${v.env}`}>
            <dt className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ENV_COLOR[v.env] }} />
              {t(`costs.envs.${v.env}`)}
            </dt>
            <dd className="mt-1 text-xl font-semibold text-fg tabular-nums">{f.usd(v.value)}</dd>
            <dd className="text-xs text-fg-muted tabular-nums">{f.percent(shareOf(v.value, total))}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function TrendPanel({ d, t, f, locale }: Common & { d: CostsDashboard; locale: string }) {
  const cap = d.settings.budgetUsd ?? d.budget.capUsd;
  const daily = cap !== null ? dailyBudget(cap, d.budget.month) : null;
  const series = COST_TREND_KEYS.map((key) => ({
    key,
    label: t(`costs.breakdown.trendKeys.${key}`),
    color: TREND_COLOR[key],
    values: d.trend.series?.find((x) => x.key === key)?.values ?? d.trend.days.map(() => 0),
  })).filter((x) => x.values.some((v) => v > 0));
  return (
    <section className="cost-panel p-5 sm:p-6" aria-label={t('costs.breakdown.trendTitle')} data-testid="costs-trend-panel">
      <StackedBarChart
        title={t('costs.breakdown.trendTitle')}
        days={d.trend.days}
        series={series.length ? series : [{ key: 'total', label: t('costs.breakdown.total'), color: 'var(--accent)', values: d.trend.values }]}
        locale={locale}
        format={f.usd}
        dayLabel={f.day}
        reference={daily !== null ? { value: daily, label: t('costs.breakdown.dailyBudget', { value: f.usd(daily) }) } : undefined}
        labels={{ chart: t('costs.breakdown.trendTitle'), table: t('costs.breakdown.table'), day: t('costs.breakdown.day'), total: t('costs.breakdown.total'), empty: t('costs.breakdown.empty30') }}
        testId="costs-trend"
      />
      <p className="mt-2 text-xs text-fg-muted">{t('costs.breakdown.trendNote')}</p>
    </section>
  );
}

function MoversTable({ title, rows, empty, testId, t, locale }: { t: Translator; title: string; rows: CostMover[]; empty: string; testId: string; locale: string }) {
  const signed = signedUsd(locale);
  return (
    <div className="min-w-0" data-testid={testId}>
      <h3 className="mb-2 text-sm font-semibold text-fg">{title}</h3>
      {rows.length === 0 ? (
        <p className="cost-tile px-3 py-4 text-sm text-fg-muted" data-testid={`${testId}-empty`}>{empty}</p>
      ) : (
        <div className="cost-tile relative overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" tabIndex={0} role="region" aria-label={title}>
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-fg-muted">
                <th scope="col" className={`${th} text-start`}>{t('costs.movers.name')}</th>
                <th scope="col" className={`${th} text-end`}>{t('costs.movers.change')}</th>
                <th scope="col" className={`${th} hidden text-end sm:table-cell`}>{t('costs.movers.impact')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const dir = m.change > 0 ? 'up' : m.change < 0 ? 'down' : 'flat';
                const label = (['containers', 'workers_ai', 'bunny', 'resend'] as string[]).includes(m.label) ? t(`costs.products.${m.product}`) : m.label;
                return (
                  <tr key={m.id} className="border-t border-border" data-testid="costs-mover-row" data-direction={dir}>
                    <th scope="row" className="px-3 py-2 text-start font-normal">
                      <bdi className="block break-words font-medium text-fg">{label}</bdi>
                      <span className="text-xs text-fg-muted"><bdi>{t(`costs.products.${m.product}`)}</bdi> • {envLabel(t, m.env)}</span>
                    </th>
                    <td className={`px-3 py-2 text-end tabular-nums whitespace-nowrap ${DIRECTION_TEXT[dir]}`}>
                      <span aria-hidden="true">{DIRECTION_MARK[dir]} </span>{signed(m.change)}
                      <span className="block text-xs text-fg-muted sm:hidden">{t('costs.movers.perMonth', { value: signed(m.monthlyImpact) })}</span>
                    </td>
                    <td className="hidden px-3 py-2 text-end text-fg-muted tabular-nums whitespace-nowrap sm:table-cell">{t('costs.movers.perMonth', { value: signed(m.monthlyImpact) })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function MoversSection({ d, t, locale }: { t: Translator; d: CostsDashboard; locale: string }) {
  return (
    <section className="cost-panel p-5 sm:p-6" aria-labelledby="costs-movers-title" data-testid="costs-movers">
      <h2 id="costs-movers-title" className={sectionTitle}>{t('costs.movers.title')}</h2>
      <p className={`${sectionNote} mb-4`}>{t('costs.movers.note')}</p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <MoversTable title={t('costs.movers.up')} rows={d.movers.up} empty={t('costs.movers.emptyUp')} testId="costs-movers-up" t={t} locale={locale} />
        <MoversTable title={t('costs.movers.down')} rows={d.movers.down} empty={t('costs.movers.emptyDown')} testId="costs-movers-down" t={t} locale={locale} />
      </div>
    </section>
  );
}
