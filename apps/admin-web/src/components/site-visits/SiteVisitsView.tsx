'use client';

/**
 * The Site visits panel (D-SEO-9): visits to the videos site in the chosen
 * period, per day, by source, by landing page kind and by referring website,
 * from admin-api GET /api/content/analytics/visits (cookieless daily
 * counters; aggregates only, nothing per visitor). Loads through TanStack
 * Query so a period switch keeps the last numbers on screen until the new
 * ones arrive; a failure shows the shared FriendlyError, reported once.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey, Translator } from '@/i18n/translate';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { ListError } from '@/components/list/ListStates';
import { cardClass } from '@/components/ui';
import { contentApi } from '@/lib/list/api-client';
import {
  dailyPoints,
  groupSources,
  shareOf,
  sourceName,
  visitFormats,
  visitPeriodLabel,
  type SiteVisitsReport,
  type VisitFormats,
  type VisitPeriod,
} from '@/lib/site-visits';

export const siteVisitsKey = (days: number) => ['admin-site-visits', days] as const;
const STALE_MS = 60_000;

function Bar({ share }: { share: number }) {
  return (
    <span className="block h-2 w-full overflow-hidden rounded bg-surface-2" aria-hidden="true">
      <span className="block h-full rounded bg-accent" style={{ width: `${(share * 100).toFixed(1)}%` }} />
    </span>
  );
}

interface Row {
  key: string;
  label: string;
  visits: number;
  /** Indented under the row above (an engine inside "Search engines") */
  nested?: boolean;
  testId?: string;
}

/** A breakdown as a table: name, a bar of its share of the period's visits, the count and the share. */
function Breakdown({ id, title, rows, total, empty, t, f, testId }: { id: string; title: string; rows: Row[]; total: number; empty: string; t: Translator; f: VisitFormats; testId: string }) {
  return (
    <section className={cardClass} aria-labelledby={id} data-testid={testId}>
      <h2 id={id} className="mb-3 text-lg font-semibold text-fg">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-fg-muted" data-testid={`${testId}-empty`}>{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className="p-1 text-start font-medium">{t('siteVisits.table.name')}</th>
              <th scope="col" className="w-1/3 p-1"><span className="sr-only">{t('siteVisits.table.share')}</span></th>
              <th scope="col" className="p-1 text-end font-medium">{t('siteVisits.table.visits')}</th>
              <th scope="col" className="p-1 text-end font-medium">{t('siteVisits.table.share')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const share = shareOf(r.visits, total);
              return (
                <tr key={r.key} className={r.nested ? '' : 'border-t border-border'} data-testid={r.testId} data-visits={r.visits}>
                  <th scope="row" className={`p-1 text-start break-all ${r.nested ? 'ps-5 font-normal text-fg-muted' : 'font-medium text-fg'}`}>{r.label}</th>
                  <td className="p-1 align-middle"><Bar share={share} /></td>
                  <td className="p-1 text-end tabular-nums text-fg">{f.count(r.visits)}</td>
                  <td className="p-1 text-end tabular-nums text-fg-muted">{f.percent(share)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Tile({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="rounded border border-border bg-surface-2 p-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-fg tabular-nums" data-testid={testId}>{value}</dd>
      {sub && <dd className="mt-1 text-xs text-fg-muted">{sub}</dd>}
    </div>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" role="status" aria-label={label} data-testid="site-visits-loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${cardClass} space-y-3`} aria-hidden="true">
          <span className="block h-5 w-1/3 rounded bg-surface-2 animate-pulse" />
          <span className="block h-24 w-full rounded bg-surface-2 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function SiteVisitsPanel({ report, t, locale }: { report: SiteVisitsReport; t: Translator; locale: string }) {
  const f = visitFormats(locale);
  const points = dailyPoints(report);
  const total = report.visits;
  const average = points.length > 0 ? total / points.length : 0;
  const busiest = points.reduce<{ t: string; value: number } | null>((best, p) => (p.value > 0 && (!best || p.value > best.value) ? p : best), null);
  const periodLabel = visitPeriodLabel(t, report.days);
  const range = t('siteVisits.range', { from: f.date(report.from), to: f.date(report.to) });

  const groupLabel = (g: string) => t(`siteVisits.sources.${g}` as MessageKey);
  const sourceRows: Row[] = groupSources(report.sources).flatMap((g) => [
    { key: g.group, label: groupLabel(g.group), visits: g.visits, testId: `site-visits-source-${g.group}` },
    ...g.items.map((i) => ({ key: `${g.group}:${i.name}`, label: sourceName(i.name) ?? t('siteVisits.sources.ai'), visits: i.visits, nested: true, testId: `site-visits-source-${g.group}-${i.name}` })),
  ]);
  const landingRows: Row[] = report.landing
    .filter((l) => l.visits > 0)
    .map((l) => {
      const key = `siteVisits.landing.${l.kind}` as MessageKey;
      const label = t(key);
      return { key: l.kind, label: label === key ? l.kind : label, visits: l.visits, testId: `site-visits-landing-${l.kind}` };
    });
  const referrerRows: Row[] = report.referrers.filter((r) => r.visits > 0).map((r) => ({ key: r.host, label: r.host, visits: r.visits, testId: 'site-visits-referrer' }));

  return (
    <div className="space-y-6" data-testid="site-visits-panel" data-days={report.days}>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="site-visits-tiles">
        <Tile label={t('siteVisits.tiles.visits')} value={f.count(total)} sub={range} testId="site-visits-total" />
        <Tile label={t('siteVisits.tiles.average')} value={f.count(Math.round(average))} sub={periodLabel} testId="site-visits-average" />
        <Tile
          label={t('siteVisits.tiles.busiest')}
          value={busiest ? f.count(busiest.value) : t('siteVisits.none')}
          sub={busiest ? f.date(busiest.t) : periodLabel}
          testId="site-visits-busiest"
        />
      </dl>

      {total === 0 && (
        <div className={`${cardClass} text-center`} data-testid="site-visits-empty">
          <p className="font-medium text-fg">{t('siteVisits.empty.title')}</p>
          <p className="mt-1 text-sm text-fg-muted">{t('siteVisits.empty.body')}</p>
        </div>
      )}

      <div className={cardClass}>
        <TimeSeriesChart
          title={t('siteVisits.chart.title', { period: periodLabel })}
          points={total === 0 ? points.map((p) => ({ t: p.t, value: null })) : points}
          locale={locale}
          format={f.axis}
          timeLabel={f.day}
          integer
          labels={{
            chart: t('siteVisits.chart.title', { period: periodLabel }),
            table: t('siteVisits.chart.table'),
            time: t('siteVisits.chart.day'),
            value: t('siteVisits.table.visits'),
            empty: t('siteVisits.chart.empty'),
            noValue: '—',
          }}
          testId="site-visits-chart"
        />
      </div>

      {total > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Breakdown id="site-visits-sources-title" title={t('siteVisits.sourcesTitle')} rows={sourceRows} total={total} empty={t('siteVisits.chart.empty')} t={t} f={f} testId="site-visits-sources" />
          <Breakdown id="site-visits-landing-title" title={t('siteVisits.landingTitle')} rows={landingRows} total={total} empty={t('siteVisits.chart.empty')} t={t} f={f} testId="site-visits-landing" />
          <div className="lg:col-span-2">
            <Breakdown id="site-visits-referrers-title" title={t('siteVisits.referrersTitle')} rows={referrerRows} total={total} empty={t('siteVisits.referrersEmpty')} t={t} f={f} testId="site-visits-referrers" />
          </div>
        </div>
      )}
    </div>
  );
}

export function SiteVisitsView({ days }: { days: VisitPeriod }) {
  const { t, locale } = useLanguage();
  const query = useQuery({
    queryKey: siteVisitsKey(days),
    queryFn: ({ signal }) => contentApi.get<SiteVisitsReport>('analytics/visits', { days }, signal),
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });

  if (query.isError && !query.data) return <ListError error={query.error} onRetry={() => void query.refetch()} testId="site-visits-error" />;
  if (!query.data) return <Skeleton label={t('siteVisits.loading')} />;
  return (
    <div aria-busy={query.isFetching ? 'true' : 'false'} className={query.isPlaceholderData ? 'opacity-60' : undefined}>
      <SiteVisitsPanel report={query.data} t={t} locale={locale} />
    </div>
  );
}
