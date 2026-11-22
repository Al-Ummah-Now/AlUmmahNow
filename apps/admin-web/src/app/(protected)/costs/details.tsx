/**
 * Costs page details (server components):
 *
 * - Cloudflare, list price against billed (COST-GAPS, owner 2026-11-21): this month's usage per
 *   invoice line, the account's included usage and what Cloudflare bills past it, so the budget's
 *   Cloudflare figure reads like the invoice. The account is shared with other projects, so these
 *   are Al Ummah Now's lines only.
 * - The biggest drivers (moved from Operations): each Cloudflare resource's month so far at list
 *   price, its idle floor, an open jump and its last 14 days.
 */
import Link from '@/components/AppLink';
import { BreakAtHyphens } from '@/components/BreakAtHyphens';
import type { Translator } from '@/i18n/translate';
import { linkClass } from '@/components/ui';
import { CF_METERS } from '@al-ummah/shared-types';
import type { CostCloudflareLine, CostsDashboard } from '@/lib/api/costs-types';
import type { OpsFormats } from '../operations/model';
import { sectionNote, sectionTitle, TREND_COLOR } from './sections';

interface Common {
  t: Translator;
  f: OpsFormats;
}

const th = 'px-3 py-2 font-medium whitespace-nowrap';

/** A meter's usage in its own unit: GB-months for storage, hours for Browser Run, else a count. */
function usage(line: CostCloudflareLine, value: number, t: Translator, f: OpsFormats): string {
  if (line.key.endsWith('_storage_gb')) return t('costs.cloudflare.gbMonths', { value: Math.abs(value) >= 1000 ? f.countNoun(value) : f.gb(value) });
  // Hours agree with their number in Arabic («١٠ ساعات»)
  if (line.key === 'browser_hours') return t('costs.cloudflare.hours', { count: Math.floor(value * 10) / 10 });
  if (line.key === 'workers_cpu_ms') return t('costs.cloudflare.cpuMs', { value: f.countNoun(value) });
  if (line.key === 'do_gb_seconds') return t('costs.cloudflare.gbSeconds', { value: f.countNoun(value) });
  return f.count(value);
}

/** Why a line is $0 or carries a caveat: no source of ours, not billed, or estimated. */
function lineNote(line: CostCloudflareLine, t: Translator, f: OpsFormats): string | null {
  if (!line.billed) return t('costs.cloudflare.notBilled');
  // The allowance as the Included column shows it, so the note and the row use one form
  if (line.source === 'none') return t(`costs.cloudflare.none.${line.key}` as never, { allowance: usage(line, line.included, t, f) } as never);
  const notes = [line.source === 'estimated' ? t('costs.cloudflare.estimated') : null, wholeUnits(line, t, f)].filter(Boolean);
  return notes.length ? notes.join(' ') : null;
}

/**
 * Cloudflare bills each started unit past the allowance (the invoice charged 0.62M KV writes as
 * 1M), so a small overage reads high. Say so with the line's numbers.
 */
export function wholeUnits(line: CostCloudflareLine, t: Translator, f: OpsFormats): string | null {
  const meter = CF_METERS[line.key];
  if (!meter || line.billable <= 0) return null;
  const units = Math.ceil(line.billable / meter.unit - 1e-9);
  // Worth saying when it shows: billed above list, or charged for half again what was used past the
  // allowance (1.1K past 1M reads as "Used 1M, Included 1M" yet bills a whole million)
  if (line.cost <= line.listCost && units * meter.unit < 1.5 * line.billable) return null;
  return t('costs.cloudflare.wholeUnits', { billable: usage(line, line.billable, t, f), charged: usage(line, units * meter.unit, t, f) });
}

export function CloudflarePanel({ d, t, f }: Common & { d: CostsDashboard }) {
  const cf = d.cloudflare;
  const lines = [...cf.lines].sort((a, b) => b.cost - a.cost || b.listCost - a.listCost || Number(a.source === 'none') - Number(b.source === 'none'));
  return (
    <section id="cloudflare" className="cost-panel min-w-0 scroll-mt-6 p-5 sm:p-6" aria-labelledby="costs-cf-title" data-testid="costs-cloudflare">
      <h2 id="costs-cf-title" className={sectionTitle}>{t('costs.cloudflare.title')}</h2>
      <p className={sectionNote}>{t('costs.cloudflare.note')}</p>

      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="cost-tile p-4">
          <dt className="text-sm text-fg-muted">{t('costs.cloudflare.billedMtd')}</dt>
          <dd className="mt-1 text-2xl font-semibold text-fg tabular-nums" data-testid="costs-cf-billed">{f.usd(cf.billedMtd)}</dd>
          <dd className="mt-1 text-xs text-fg-muted">{t('costs.cloudflare.billedSub')}</dd>
        </div>
        <div className="cost-tile p-4">
          <dt className="text-sm text-fg-muted">{t('costs.cloudflare.listMtd')}</dt>
          <dd className="mt-1 text-2xl font-semibold text-fg-muted tabular-nums" data-testid="costs-cf-list">{f.usd(cf.listMtd)}</dd>
          <dd className="mt-1 text-xs text-fg-muted">{t('costs.cloudflare.listSub')}</dd>
        </div>
        <div className="cost-tile p-4">
          <dt className="text-sm text-fg-muted">{t('costs.cloudflare.billedProjected')}</dt>
          <dd className="mt-1 text-2xl font-semibold text-fg tabular-nums" data-testid="costs-cf-projected">{f.usd(cf.billedProjected)}</dd>
          <dd className="mt-1 text-xs text-fg-muted">{t('costs.cloudflare.projectedSub')}</dd>
        </div>
      </dl>

      <p className="cost-note mt-4 px-4 py-3 text-sm text-fg" data-testid="costs-cf-shared">{t('costs.cloudflare.shared')}</p>

      {/* Phones: one card per line */}
      <ul className="mt-4 space-y-2 sm:hidden" data-testid="costs-cf-cards">
        {lines.map((l) => {
          const note = lineNote(l, t, f);
          return (
            <li key={l.key} className="cost-tile p-3" data-meter={l.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-fg"><bdi>{t(`costs.cloudflare.meters.${l.key}`)}</bdi></span>
                <span className="font-semibold text-fg tabular-nums">{f.usd(l.cost)}</span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div><dt className="text-fg-muted">{t('costs.cloudflare.used')}</dt><dd className="text-fg tabular-nums">{usage(l, l.used, t, f)}</dd></div>
                <div><dt className="text-fg-muted">{t('costs.cloudflare.included')}</dt><dd className="text-fg tabular-nums">{usage(l, l.included, t, f)}</dd></div>
                <div><dt className="text-fg-muted">{t('costs.cloudflare.list')}</dt><dd className="text-fg tabular-nums">{f.usd(l.listCost)}</dd></div>
                <div><dt className="text-fg-muted">{t('costs.cloudflare.projected')}</dt><dd className="text-fg tabular-nums">{f.usd(l.projectedCost)}</dd></div>
              </dl>
              {note && <p className="mt-2 text-xs text-fg-muted">{note}</p>}
            </li>
          );
        })}
      </ul>

      <div className="relative -mx-3 mt-4 hidden overflow-x-auto sm:block focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" tabIndex={0} role="region" aria-label={t('costs.cloudflare.title')}>
        <table className="w-full min-w-[44rem] text-sm" data-testid="costs-cf-lines">
          <caption className="sr-only">{t('costs.cloudflare.title')}</caption>
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className={`${th} text-start`}>{t('costs.cloudflare.meter')}</th>
              <th scope="col" className={`${th} text-end`}>{t('costs.cloudflare.used')}</th>
              <th scope="col" className={`${th} text-end`}>{t('costs.cloudflare.included')}</th>
              <th scope="col" className={`${th} text-end`}>{t('costs.cloudflare.list')}</th>
              <th scope="col" className={`${th} text-end`}>{t('costs.cloudflare.billed')}</th>
              <th scope="col" className={`${th} text-end`}>{t('costs.cloudflare.projected')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const note = lineNote(l, t, f);
              const past = l.included > 0 ? Math.min(1, l.used / l.included) : 1;
              return (
                <tr key={l.key} className="border-t border-border" data-testid="costs-cf-line" data-meter={l.key} data-source={l.source}>
                  <th scope="row" className="px-3 py-2.5 text-start font-normal">
                    <span className="block font-medium text-fg"><bdi>{t(`costs.cloudflare.meters.${l.key}`)}</bdi></span>
                    {note && <span className="block max-w-sm text-xs text-fg-muted">{note}</span>}
                  </th>
                  <td className="px-3 py-2.5 text-end tabular-nums text-fg">{usage(l, l.used, t, f)}</td>
                  <td className="px-3 py-2.5 text-end">
                    <span className="block tabular-nums text-fg-muted">{usage(l, l.included, t, f)}</span>
                    {/* How much of the allowance is used: past it, the meter bills */}
                    <span className="cost-bar-track ms-auto mt-1 block h-1 w-16 overflow-hidden" aria-hidden="true">
                      <span className="block h-full" style={{ width: `${past * 100}%`, background: l.used > l.included ? 'var(--warning-fg)' : 'var(--success-fg)' }} />
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-fg-muted">{f.usd(l.listCost)}</td>
                  <td className="px-3 py-2.5 text-end font-medium tabular-nums text-fg">{f.usd(l.cost)}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-fg-muted">{f.usd(l.projectedCost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DriversSection({ d, t, f }: Common & { d: CostsDashboard }) {
  return (
    <section id="drivers" className="cost-panel min-w-0 scroll-mt-6 p-5 sm:p-6" aria-labelledby="costs-drivers-title" data-testid="costs-drivers">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl">
          <h2 id="costs-drivers-title" className={sectionTitle}>{t('costs.drivers.title')}</h2>
          <p className={sectionNote}>{t('costs.drivers.note')}</p>
        </div>
        {d.spikes.length > 0 && (
          <Link href="/errors" className={`${linkClass} text-sm`} data-testid="costs-drivers-jumps">{t('costs.drivers.jumpsOpen', { count: d.spikes.length })}</Link>
        )}
      </div>
      {d.drivers.length === 0 ? (
        <p className="cost-tile mt-4 px-3 py-4 text-sm text-fg-muted" data-testid="costs-drivers-empty">{t('costs.drivers.empty')}</p>
      ) : (
        <>
        {/* Phones: one card per resource, every figure labelled; the five-column table needs ~40rem */}
        <ul className="mt-4 space-y-3 sm:hidden" data-testid="costs-drivers-cards">
          {d.drivers.map((r) => (
            <li key={r.id} className="cost-tile p-3 text-sm" data-testid="costs-driver-card" data-env={r.env}>
              <p className="font-medium text-fg">
                <bdi><BreakAtHyphens name={r.name} /></bdi>
                <span className="ms-2 text-xs font-normal text-fg-muted"><bdi>{t(`operations.tabs.${r.kind}`)}</bdi></span>
              </p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-fg-muted">
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: TREND_COLOR[r.env] }} />
                {t(`costs.envs.${r.env}`)}
              </p>
              {r.spike && (
                <p className="mt-2">
                  <span className="inline-block rounded-full border border-danger-border bg-danger-bg px-2 py-0.5 text-xs text-danger-fg">
                    {t('costs.drivers.jump', { value: f.usd(r.spike.cost), baseline: f.usd(r.spike.baseline) })}
                  </span>
                </p>
              )}
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                <div>
                  <dt className="text-xs text-fg-muted">{t('costs.drivers.mtd')}</dt>
                  <dd className="tabular-nums text-fg">{f.usd(r.mtdUsd)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">{t('costs.drivers.idle')}</dt>
                  <dd className="tabular-nums text-fg-muted">{t('costs.drivers.perMonth', { value: f.usd(r.idleMonthlyUsd) })}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-fg-muted">{t('costs.drivers.last14')}</dt>
                  <dd><Spark r={r} f={f} sep={t('common.sep')} /></dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="relative -mx-3 mt-4 hidden overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:block" tabIndex={0} role="region" aria-label={t('costs.drivers.title')}>
          <table className="w-full min-w-[40rem] text-sm" data-testid="costs-drivers-table">
            <caption className="sr-only">{t('costs.drivers.title')}</caption>
            <thead>
              <tr className="text-fg-muted">
                <th scope="col" className={`${th} text-start`}>{t('costs.drivers.name')}</th>
                <th scope="col" className={`${th} text-start`}>{t('costs.drivers.env')}</th>
                <th scope="col" className={`${th} text-end`}>{t('costs.drivers.mtd')}</th>
                <th scope="col" className={`${th} text-end`}>{t('costs.drivers.idle')}</th>
                <th scope="col" className={`${th} text-end`}>{t('costs.drivers.last14')}</th>
              </tr>
            </thead>
            <tbody>
              {d.drivers.map((r) => {
                return (
                  <tr key={r.id} className="border-t border-border" data-testid="costs-driver-row" data-env={r.env}>
                    <th scope="row" className="px-3 py-2.5 text-start font-normal text-fg">
                      {/* Isolated: a Latin name next to a Latin kind label would merge into one run in Arabic */}
                      <bdi><BreakAtHyphens name={r.name} /></bdi>
                      <span className="ms-2 text-xs text-fg-muted"><bdi>{t(`operations.tabs.${r.kind}`)}</bdi></span>
                      {r.spike && (
                        <span className="ms-2 inline-block rounded-full border border-danger-border bg-danger-bg px-2 py-0.5 text-xs text-danger-fg" data-testid="costs-driver-spike">
                          {t('costs.drivers.jump', { value: f.usd(r.spike.cost), baseline: f.usd(r.spike.baseline) })}
                        </span>
                      )}
                    </th>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg-muted">
                        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: TREND_COLOR[r.env] }} />
                        {t(`costs.envs.${r.env}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-fg">{f.usd(r.mtdUsd)}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums whitespace-nowrap text-fg-muted">{t('costs.drivers.perMonth', { value: f.usd(r.idleMonthlyUsd) })}</td>
                    <td className="px-3 py-2.5 text-end">
                      <Spark r={r} f={f} sep={t('common.sep')} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}

/** A driver's last 14 days as bars in its environment's colour, each day in the label. */
function Spark({ r, f, sep }: { r: CostsDashboard['drivers'][number]; f: OpsFormats; sep: string }) {
  const max = Math.max(0, ...r.daily.values);
  const label = r.daily.values.map((v, i) => `${f.day(r.daily.days[i]!)}: ${f.usd(v)}`).join(sep);
  return (
    <span className="inline-flex h-6 items-end gap-0.5" role="img" aria-label={label}>
      {r.daily.values.map((v, i) => (
        <span key={r.daily.days[i]} className="w-1.5 rounded-t-sm" style={{ height: `${max > 0 && v > 0 ? Math.max(8, (v / max) * 100) : 4}%`, background: TREND_COLOR[r.env], opacity: v > 0 ? 1 : 0.3 }} />
      ))}
    </span>
  );
}
