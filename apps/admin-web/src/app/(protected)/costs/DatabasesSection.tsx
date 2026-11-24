/**
 * The Costs page's Databases section (wiki AUN-D1-SCALING D1-1): every D1 database against
 * Cloudflare's limits, soonest to 70% first, and the account total. A server component; super
 * admins also get DatabaseSettings (limits and capacity alerts) through `settings`. Data: admin-api GET
 * /api/costs/databases, fed by the cost-monitor.
 */
import type { ReactNode } from 'react';
import type { Translator } from '@/i18n/translate';
import type { CostDatabase, CostDatabases } from '@/lib/api/costs-types';
import type { OpsFormats } from '../operations/model';
import { sectionNote, sectionTitle } from './sections';

const th = 'px-3 py-2 font-medium';
const td = 'px-3 py-2 align-top';
const num = 'whitespace-nowrap text-end text-fg tabular-nums';

/** Fill colour of a share-of-limit bar: warning from 70%, danger from 90%. */
export function shareTone(share: number | null): 'ok' | 'warn' | 'danger' {
  if (share === null) return 'ok';
  return share >= 0.9 ? 'danger' : share >= 0.7 ? 'warn' : 'ok';
}
const FILL = { ok: 'var(--accent)', warn: 'var(--warning-fg)', danger: 'var(--danger-fg)' } as const;

export function ShareBar({ share, label }: { share: number | null; label: string }) {
  const pct = Math.min(100, Math.max(0, (share ?? 0) * 100));
  return (
    <span className="cost-bar-track mt-1 block h-1.5 w-full min-w-16 overflow-hidden" role="img" aria-label={label}>
      <span className="block h-full" style={{ width: `${pct > 0 ? Math.max(pct, 2) : 0}%`, background: FILL[shareTone(share)] }} />
    </span>
  );
}

/** A database name that wraps only after its hyphens, never inside a word. */
export function BreakableName({ name }: { name: string }) {
  const parts = name.split('-');
  return (
    <bdi>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <>-<wbr /></>}
        </span>
      ))}
    </bdi>
  );
}

const envName = (t: Translator, env: string) => (['production', 'stage', 'qa'].includes(env) ? t(`costs.databases.envs.${env as 'production' | 'stage' | 'qa'}`) : env);

function daysText(t: Translator, f: OpsFormats, d: CostDatabase): string {
  // No forecast: not growing, or too little history for one (a dash)
  if (d.daysTo70 === null) return d.growthPerDay !== null && d.growthPerDay <= 0 ? t('costs.databases.daysNone') : '—';
  if (d.daysTo70 === 0) return t('costs.databases.daysNow');
  return f.count(Math.round(d.daysTo70));
}

export function DatabasesSection({ data, t, f, settings }: { data: CostDatabases; t: Translator; f: OpsFormats; settings?: ReactNode }) {
  const { limits, databases, account } = data;
  return (
    <section id="databases" className="cost-panel min-w-0 scroll-mt-24 p-5 sm:p-6" aria-labelledby="costs-databases-title" data-testid="costs-databases">
      <h2 id="costs-databases-title" className={sectionTitle}>{t('costs.databases.title')}</h2>
      <p className={`${sectionNote} mb-4`}>{t('costs.databases.note', { perDb: f.bytes(limits.maxDbBytes), account: f.bytes(limits.accountBytes), pct: f.percent(0.7), days: f.count(60) })}</p>

      <div className="cost-tile mb-4 p-4" data-testid="costs-databases-account">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium text-fg">{t('costs.databases.account')}</span>
          {account && <span className="font-semibold text-fg tabular-nums">{f.percent(account.share)}</span>}
        </div>
        {account ? (
          <>
            <ShareBar share={account.share} label={f.percent(account.share)} />
            <p className="mt-1 text-xs text-fg-muted">{t('costs.databases.accountDetail', { count: f.count(account.databases), size: f.bytes(account.bytes), limit: f.bytes(limits.accountBytes) })}</p>
            {account.alerts.length > 0 && <p className="mt-1 text-xs font-medium text-warning-fg">{t('costs.databases.alertOpen')}</p>}
          </>
        ) : (
          <p className="mt-1 text-sm text-fg-muted">{t('costs.databases.accountUnknown')}</p>
        )}
      </div>

      {databases.length === 0 ? (
        <p className="text-fg-muted" data-testid="costs-databases-empty">{t('costs.databases.empty')}</p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:hidden" data-testid="costs-databases-list">
            {databases.map((d) => (
              <li key={d.id} className="cost-tile p-3" data-database={d.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-medium text-fg"><BreakableName name={d.name} /></span>
                  <span className="shrink-0 font-semibold text-fg tabular-nums">{d.share === null ? '—' : f.percent(d.share)}</span>
                </div>
                <ShareBar share={d.share} label={d.share === null ? '—' : f.percent(d.share)} />
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div><dt className="text-fg-muted">{t('costs.databases.columns.env')}</dt><dd className="text-fg">{envName(t, d.env)}</dd></div>
                  <div><dt className="text-fg-muted">{t('costs.databases.columns.size')}</dt><dd className="text-fg tabular-nums">{d.bytes === null ? '—' : f.bytes(d.bytes)}</dd></div>
                  <div><dt className="text-fg-muted">{t('costs.databases.columns.growth')}</dt><dd className="text-fg tabular-nums">{d.growthPerDay === null || d.growthPerDay === 0 ? '—' : f.bytes(d.growthPerDay)}</dd></div>
                  <div><dt className="text-fg-muted">{t('costs.databases.columns.days', { pct: f.percent(0.7) })}</dt><dd className="text-fg tabular-nums">{daysText(t, f, d)}</dd></div>
                  <div><dt className="text-fg-muted">{t('costs.databases.columns.writes')}</dt><dd className="text-fg tabular-nums">{d.rowsWrittenPerDay === null ? '—' : f.count(d.rowsWrittenPerDay)}</dd></div>
                  <div><dt className="text-fg-muted">{t('costs.databases.columns.busy')}</dt><dd className="text-fg tabular-nums">{d.peakBusy === null ? '—' : f.percent(d.peakBusy)}</dd></div>
                </dl>
                {d.alerts.length > 0 && <p className="mt-1 text-xs font-medium text-warning-fg">{t('costs.databases.alertOpen')}</p>}
              </li>
            ))}
          </ul>
          <div className="relative -mx-3 hidden overflow-x-auto xl:block focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" tabIndex={0} role="region" aria-label={t('costs.databases.title')}>
            <table className="w-full min-w-[52rem] text-sm" data-testid="costs-databases-table">
              <caption className="sr-only">{t('costs.databases.title')}</caption>
              <thead>
                <tr className="text-fg-muted">
                  <th scope="col" className={`${th} text-start`}>{t('costs.databases.columns.name')}</th>
                  <th scope="col" className={`${th} text-start`}>{t('costs.databases.columns.env')}</th>
                  <th scope="col" className={`${th} text-end`}>{t('costs.databases.columns.size')}</th>
                  <th scope="col" className={`${th} text-start`}>{t('costs.databases.columns.share')}</th>
                  <th scope="col" className={`${th} text-end`}>{t('costs.databases.columns.growth')}</th>
                  <th scope="col" className={`${th} text-end`}>{t('costs.databases.columns.days', { pct: f.percent(0.7) })}</th>
                  <th scope="col" className={`${th} text-end`}>{t('costs.databases.columns.writes')}</th>
                  <th scope="col" className={`${th} text-end`}>{t('costs.databases.columns.busy')}</th>
                </tr>
              </thead>
              <tbody>
                {databases.map((d) => (
                  <tr key={d.id} className="border-t border-border" data-database={d.name}>
                    <th scope="row" className={`${td} text-start font-medium text-fg`}>
                      <BreakableName name={d.name} />
                      {d.alerts.length > 0 && <span className="ms-2 text-xs font-medium text-warning-fg">{t('costs.databases.alertOpen')}</span>}
                    </th>
                    <td className={`${td} text-fg`}>{envName(t, d.env)}</td>
                    <td className={`${td} ${num}`}>{d.bytes === null ? '—' : f.bytes(d.bytes)}</td>
                    <td className={`${td} w-40 whitespace-nowrap text-fg tabular-nums`}>
                      {d.share === null ? '—' : f.percent(d.share)}
                      <ShareBar share={d.share} label={d.share === null ? '—' : f.percent(d.share)} />
                    </td>
                    <td className={`${td} ${num}`}>{d.growthPerDay === null || d.growthPerDay === 0 ? '—' : f.bytes(d.growthPerDay)}</td>
                    <td className={`${td} ${num}`}>{daysText(t, f, d)}</td>
                    <td className={`${td} ${num}`}>{d.rowsWrittenPerDay === null ? '—' : f.count(d.rowsWrittenPerDay)}</td>
                    <td className={`${td} ${num}`}>{d.peakBusy === null ? '—' : f.percent(d.peakBusy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {settings}
    </section>
  );
}
