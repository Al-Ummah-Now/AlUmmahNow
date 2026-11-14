import Link from '@/components/AppLink';
import { getOpsCosts, getOpsOverview, getOpsSeries, listOpsResources } from '@/lib/api/ops';
import { AdminApiError } from '@/lib/api/errors';
import { OPS_KINDS, OPS_RANGES, type OpsCosts, type OpsEnv, type OpsKind, type OpsOverview, type OpsRange, type OpsResource } from '@/lib/api/ops-types';
import { getAdminSession } from '@/lib/auth';
import { canReadOps } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import type { Translator } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { logger } from '@/lib/logger';
import { TAB_CHARTS, fillSeries, opsFormats, parseEnv, parseRange, parseTab, type OpsFormats } from './model';
import { SpendSection } from './SpendSection';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const ENV_ORDER: OpsEnv[] = ['production', 'stage', 'qa'];
const TABS: readonly OpsKind[] = OPS_KINDS;

function pillClass(active: boolean) {
  return `block rounded px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
    active ? 'bg-accent text-on-accent font-medium' : 'border border-border text-fg hover:bg-surface-hover'
  }`;
}

function Tile({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="rounded border border-border bg-surface-2 p-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-fg tabular-nums" data-testid={testId}>{value}</dd>
      {sub && <dd className="mt-1 text-xs text-fg-muted tabular-nums">{sub}</dd>}
    </div>
  );
}

function Tiles({ o, t, f }: { o: OpsOverview; t: Translator; f: OpsFormats }) {
  const pct = (v: number | null) => (v === null ? t('operations.tiles.none') : f.percent(v));
  return (
    <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="ops-tiles">
      <Tile label={t('operations.tiles.requests')} value={f.count(o.workers.requests)} sub={t('operations.tiles.before', { value: f.count(o.workers.requestsBefore) })} testId="ops-tile-requests" />
      <Tile label={t('operations.tiles.errorRate')} value={pct(o.workers.errorRate)} sub={t('operations.tiles.before', { value: pct(o.workers.errorRateBefore) })} testId="ops-tile-error-rate" />
      <Tile label={t('operations.tiles.cpuP99')} value={o.workers.cpuP99 === null ? t('operations.tiles.none') : f.us(o.workers.cpuP99)} testId="ops-tile-cpu" />
      <Tile label={t('operations.tiles.d1Latency')} value={o.d1.latencyP99 === null ? t('operations.tiles.none') : f.ms(o.d1.latencyP99)} testId="ops-tile-d1" />
      <Tile label={t('operations.tiles.worstQueue')} value={o.queues.worst ? f.count(o.queues.worst.backlog) : t('operations.tiles.none')} sub={o.queues.worst?.name} testId="ops-tile-queue" />
      <Tile label={t('operations.tiles.dlq')} value={f.count(o.queues.dlqMessages)} testId="ops-tile-dlq" />
    </dl>
  );
}

function ResourcesTable({ kind, resources, t, f }: { kind: OpsKind; resources: OpsResource[]; t: Translator; f: OpsFormats }) {
  const spec = TAB_CHARTS[kind][0];
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : f[spec.format](v));
  if (resources.length === 0) return <p className="text-fg-muted" data-testid="ops-resources-empty">{t('operations.resources.empty')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="ops-resources">
        <caption className="sr-only">{t('operations.resources.title')}</caption>
        <thead>
          <tr className="text-fg-muted">
            <th scope="col" className="p-2 text-start font-medium">{t('operations.resources.name')}</th>
            <th scope="col" className="p-2 text-end font-medium">{t(`operations.charts.${spec.label}`)} · {t('operations.resources.today')}</th>
            <th scope="col" className="p-2 text-end font-medium">{t('operations.resources.last7')}</th>
            <th scope="col" className="p-2 text-end font-medium">{t('operations.resources.monthCost')}</th>
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => {
            const max = Math.max(0, ...r.spark.values.map((v) => v ?? 0));
            return (
              <tr key={r.id} className="border-t border-border" data-testid="ops-resource-row">
                <th scope="row" className="p-2 text-start font-normal text-fg break-all">{r.name}</th>
                <td className="p-2 text-end tabular-nums">{fmt(r.metrics[spec.metric])}</td>
                <td className="p-2 text-end">
                  <span className="inline-flex h-6 items-end gap-0.5" aria-label={r.spark.values.map((v, i) => `${f.day(r.spark.days[i])}: ${fmt(v)}`).join(', ')} role="img">
                    {r.spark.values.map((v, i) => (
                      <span key={r.spark.days[i]} className="w-1.5 bg-accent" style={{ height: `${max > 0 && v ? Math.max(8, (v / max) * 100) : 4}%`, opacity: v ? 1 : 0.3 }} />
                    ))}
                  </span>
                </td>
                <td className="p-2 text-end tabular-nums">{f.usd(r.monthCostUsd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function loadError(error: unknown, t: Translator): string {
  if (error instanceof AdminApiError && error.status === 503) {
    return error.code === 'not_configured' ? t('operations.notConfigured') : t('operations.notReady');
  }
  return t('operations.loadFailed');
}

/**
 * Operations (docs/admin/LIVE_OPS.md Part A): platform health and usage per
 * environment from the hourly collector's rollups (admin-api /api/ops, ops:read),
 * with spend against the $500/month budget (every source), the projected idle cost and open alerts.
 */
export default async function OperationsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const env = parseEnv(params.env);
  const tab = parseTab(params.tab);
  const range = parseRange(params.range);
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canReadOps(session?.user.role)) {
    return <ErrorAlert testId="ops-no-access">{t('operations.noAccess')}</ErrorAlert>;
  }
  const f = opsFormats(locale);
  const specs = TAB_CHARTS[tab];
  const [costsResult, overviewResult, resourcesResult, ...seriesResults] = await Promise.allSettled([
    getOpsCosts('all'),
    getOpsOverview(env),
    listOpsResources(env, tab),
    ...specs.map((s) => getOpsSeries(env, tab, s.metric, range)),
  ]);
  if (overviewResult.status === 'rejected') {
    logger.error('[operations] Failed to load the overview', { env, error: overviewResult.reason instanceof Error ? overviewResult.reason.message : String(overviewResult.reason) });
  }
  if (costsResult.status === 'rejected') {
    logger.error('[operations] Failed to load spend', { error: costsResult.reason instanceof Error ? costsResult.reason.message : String(costsResult.reason) });
  }
  const overview = overviewResult.status === 'fulfilled' ? (overviewResult.value as OpsOverview) : null;
  const costs = costsResult.status === 'fulfilled' ? (costsResult.value as OpsCosts) : null;
  const resources = resourcesResult.status === 'fulfilled' ? (resourcesResult.value as OpsResource[]) : null;
  const now = new Date();
  const href = (next: Partial<{ env: OpsEnv; tab: OpsKind; range: OpsRange }>) => `?${new URLSearchParams({ env, tab, range, ...next })}`;
  const envs = overview ? ENV_ORDER.filter((e) => overview.envs.includes(e) || e === env) : [env];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold text-fg">{t('operations.title')}</h1>
          <p className="text-fg-muted mt-1">{t('operations.subtitle')}</p>
          {overview?.dataAsOf && (
            <p className={`mt-1 text-sm ${overview.stale ? 'text-warning-fg' : 'text-fg-muted'}`} data-testid="ops-data-age" data-stale={overview.stale ? 'true' : 'false'}>
              {overview.stale ? t('operations.stale') : t('operations.dataAsOf', { time: f.time(overview.dataAsOf) })}
            </p>
          )}
        </div>
        <nav aria-label={t('operations.envLabel')} data-testid="ops-env">
          <ul className="flex flex-wrap gap-1">
            {envs.map((e) => (
              <li key={e}>
                <Link href={href({ env: e })} aria-current={e === env ? 'page' : undefined} className={pillClass(e === env)}>{t(`operations.envs.${e}`)}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {costs ? (
        <SpendSection c={costs} t={t} f={f} locale={locale} />
      ) : (
        <div className="mb-6"><ErrorAlert testId="ops-spend-error">{loadError(costsResult.status === 'rejected' ? costsResult.reason : null, t)}</ErrorAlert></div>
      )}

      {!overview ? (
        <div className="mb-6"><ErrorAlert testId="ops-overview-error">{loadError(overviewResult.status === 'rejected' ? overviewResult.reason : null, t)}</ErrorAlert></div>
      ) : (
        <>
          <Tiles o={overview} t={t} f={f} />
          <section className={`${cardClass} mb-6`} aria-labelledby="ops-alerts-title" data-testid="ops-alerts">
            <h2 id="ops-alerts-title" className="text-lg font-semibold text-fg mb-2">{t('operations.alerts.title')}</h2>
            {overview.alerts.length === 0 ? (
              <p className="text-fg-muted" data-testid="ops-alerts-empty">{t('operations.alerts.empty')}</p>
            ) : (
              <>
                <ul className="mb-2 space-y-1">
                  {overview.alerts.map((a) => (
                    <li key={a.key} className="text-fg" data-testid="ops-alert">
                      <span className="font-medium">{a.resource_id.slice(a.resource_id.indexOf(':') + 1)}</span> · {a.rule_id} ·{' '}
                      <span className="text-fg-muted">{t('operations.alerts.opened', { time: f.time(a.opened_at) })}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/errors" className={linkClass}>{t('operations.alerts.errorsLink')}</Link>
              </>
            )}
          </section>
        </>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <nav aria-label={t('operations.tabsLabel')} data-testid="ops-tabs">
          <ul className="flex flex-wrap gap-1">
            {TABS.map((k) => (
              <li key={k}>
                <Link href={href({ tab: k })} aria-current={k === tab ? 'page' : undefined} className={pillClass(k === tab)} data-testid={`ops-tab-${k}`}>{t(`operations.tabs.${k}`)}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t('operations.rangeLabel')} data-testid="ops-range">
          <ul className="flex flex-wrap gap-1">
            {OPS_RANGES.map((r) => (
              <li key={r}>
                <Link href={href({ range: r })} aria-current={r === range ? 'page' : undefined} className={pillClass(r === range)}>{t(`operations.ranges.${r}`)}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2" aria-label={t(`operations.tabs.${tab}`)} data-testid="ops-charts">
        {specs.map((spec, i) => {
          const result = seriesResults[i];
          const title = t(`operations.charts.${spec.label}`);
          if (result.status === 'rejected') {
            return <div key={spec.metric} className={cardClass}><ErrorAlert testId={`ops-chart-${spec.metric}-error`}>{loadError(result.reason, t)}</ErrorAlert></div>;
          }
          const series = result.value as Awaited<ReturnType<typeof getOpsSeries>>;
          const points = fillSeries(series, range, now);
          return (
            <div key={spec.metric} className={cardClass}>
              <TimeSeriesChart
                title={title}
                points={points}
                locale={locale}
                format={f[spec.format]}
                timeLabel={series.granularity === 'hour' ? f.hour : f.day}
                integer={spec.format === 'count'}
                labels={{ chart: title, table: t('operations.charts.table'), time: t('operations.charts.time'), value: title, empty: t('operations.charts.empty'), noValue: t('operations.charts.noValue') }}
                testId={`ops-chart-${spec.metric}`}
              />
            </div>
          );
        })}
      </section>

      <section className={`${cardClass} mb-6`} aria-labelledby="ops-resources-title">
        <h2 id="ops-resources-title" className="text-lg font-semibold text-fg mb-3">{t('operations.resources.title')}</h2>
        {resources ? <ResourcesTable kind={tab} resources={resources} t={t} f={f} /> : <ErrorAlert testId="ops-resources-error">{loadError(resourcesResult.status === 'rejected' ? resourcesResult.reason : null, t)}</ErrorAlert>}
      </section>

      <section className={cardClass} aria-labelledby="ops-product-title" data-testid="ops-product">
        <h2 id="ops-product-title" className="text-lg font-semibold text-fg mb-1">{t('operations.product.title')}</h2>
        <p className="text-fg-muted mb-2">{t('operations.product.body')}</p>
        <Link href="/delivery" className={linkClass}>{t('operations.product.delivery')}</Link>
      </section>
    </div>
  );
}
