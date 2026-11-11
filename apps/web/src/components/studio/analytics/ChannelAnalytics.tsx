'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/hooks/useLanguage';
import { getStudioChannelAnalytics, getTopContent, type StudioChannelAnalytics, type TopContentItem } from '@/lib/api/studio-analytics';
import { logger } from '@/lib/logger-client';
import { chartLocale, formatDuration, formatInUnit, formatWatchTime, watchTimeInUnit, watchTimeUnit } from '@al-ummah/shared-types';
import { changePercent, RANGE_PRESETS, rangeDates, sumMetrics, type DailyMetric, type RangePreset } from '@/lib/studio/analytics';
import { LineChart } from './LineChart';
import { StatCard, TrafficSources } from './parts';

type Metric = 'views' | 'watchTime' | 'likes' | 'comments' | 'subscribers';
type SortKey = 'views' | 'watchTime' | 'avgViewDuration';

const METRICS: Metric[] = ['views', 'watchTime', 'likes', 'comments', 'subscribers'];
/** Wait before the automatic second try of a section that failed. */
const AUTO_RETRY_MS = 2000;

interface Props {
  locale: string;
  channelId: string;
  channelCreated?: string;
}

/** The channel overview (spec §4.6). A failing section doesn't blank the others. */
export function ChannelAnalytics({ locale, channelId, channelCreated }: Props) {
  const { t } = useLanguage();
  const text = t.studio.analytics;
  const [range, setRange] = useState<RangePreset>('28');
  const [metric, setMetric] = useState<Metric>('views');
  const [sort, setSort] = useState<SortKey>('views');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<StudioChannelAnalytics | null>(null);
  const [previous, setPrevious] = useState<StudioChannelAnalytics | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [top, setTop] = useState<TopContentItem[]>([]);
  const [topCursor, setTopCursor] = useState<string | null>(null);
  const [topFailed, setTopFailed] = useState(false);
  const request = useRef(0);
  const windows = useMemo(() => rangeDates(range, new Date(), channelCreated), [range, channelCreated]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setOverviewFailed(false);
    setTopFailed(false);
    const failed = (error: unknown) => {
      logger.error('[Studio] Could not load analytics', { channelId, error });
      return null;
    };
    const [current, before, content] = await Promise.all([
      getStudioChannelAnalytics(channelId, windows.current).catch(failed),
      windows.previous ? getStudioChannelAnalytics(channelId, windows.previous).catch(failed) : Promise.resolve(null),
      getTopContent(channelId, windows.current).catch(failed),
    ]);
    if (id !== request.current) return;
    setOverview(current);
    setPrevious(before);
    setOverviewFailed(!current);
    setTop(content?.items ?? []);
    setTopCursor(content?.cursor ?? null);
    setTopFailed(!content);
    setLoading(false);
  }, [channelId, windows]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Top content alone, so its Retry doesn't reload the whole page. */
  const loadTop = useCallback(async () => {
    const id = request.current;
    setTopFailed(false);
    const content = await getTopContent(channelId, windows.current).catch(() => null);
    if (id !== request.current) return;
    setTop(content?.items ?? []);
    setTopCursor(content?.cursor ?? null);
    setTopFailed(!content);
  }, [channelId, windows]);

  // One automatic second try per range: the API answers 503 while the channel's index heals,
  // which takes seconds. A second failure leaves the Retry buttons.
  const retried = useRef<string | null>(null);
  useEffect(() => {
    const key = `${channelId}/${windows.current.dateFrom}/${windows.current.dateTo}`;
    if (loading || (!overviewFailed && !topFailed) || retried.current === key) return;
    retried.current = key;
    const timer = setTimeout(() => void (overviewFailed ? load() : loadTop()), AUTO_RETRY_MS);
    return () => clearTimeout(timer);
  }, [loading, overviewFailed, topFailed, channelId, windows, load, loadTop]);

  const loadMore = async () => {
    if (!topCursor) return;
    const content = await getTopContent(channelId, windows.current, topCursor).catch(() => null);
    if (!content) return setTopFailed(true);
    setTop((items) => [...items, ...content.items]);
    setTopCursor(content.cursor);
  };

  const number = new Intl.NumberFormat(chartLocale(locale));
  const date = new Intl.DateTimeFormat(chartLocale(locale), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const duration = formatDuration(locale);
  const series: DailyMetric[] = overview?.recentMetrics ?? [];
  const totals = sumMetrics(series);
  // Watch time is charted in minutes or hours, so the axis ticks are round in that unit
  const unit = watchTimeUnit(Math.max(0, ...series.map((entry) => entry.watchTime || 0)));
  const chart = metric === 'watchTime'
    ? { value: (entry: DailyMetric) => watchTimeInUnit(entry.watchTime, unit), format: formatInUnit(locale, unit), integer: false }
    : { value: (entry: DailyMetric) => entry[metric] || 0, format: (value: number) => number.format(value), integer: true };
  const before = previous ? sumMetrics(previous.recentMetrics) : undefined;
  const sorted = [...top].sort((a, b) => b[sort] - a[sort]);
  const videoHref = (id: string) => `/${locale}/studio/${encodeURIComponent(channelId)}/content/videos/${encodeURIComponent(id)}/analytics`;
  const retry = <Button variant="outline" onClick={() => void load()}>{text.retry}</Button>;
  const retryTop = <Button variant="outline" onClick={() => void loadTop()}>{text.retry}</Button>;
  const sortHeader = (key: SortKey, label: string) => (
    <th className="p-2 text-end font-medium" aria-sort={sort === key ? 'descending' : 'none'}>
      <button type="button" className="min-h-11 hover:text-foreground" onClick={() => setSort(key)}>{label}</button>
    </th>
  );

  return (
    <div data-testid="studio-analytics">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-foreground">{t.studio.nav.analytics}</h1>
        <select aria-label={text.rangeLabel} value={range} onChange={(event) => setRange(event.target.value as RangePreset)} data-testid="studio-analytics-range" className="min-h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground">
          {RANGE_PRESETS.map((preset) => <option key={preset} value={preset}>{text.ranges[preset]}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true" data-testid="studio-analytics-loading">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {overviewFailed ? (
            <div className="py-8 text-center">
              <p className="mb-3 text-foreground">{text.loadFailed}</p>
              {retry}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                <StatCard locale={locale} label={text.metrics.views} value={number.format(totals.views)} change={changePercent(totals.views, before?.views)} />
                <StatCard locale={locale} label={text.metrics.watchTime} value={formatWatchTime(locale, watchTimeUnit(totals.watchTime))(totals.watchTime)} change={changePercent(totals.watchTime, before?.watchTime)} />
                <StatCard locale={locale} label={text.metrics.avgViewDuration} value={duration(totals.avgViewDuration)} change={changePercent(totals.avgViewDuration, before?.avgViewDuration)} />
                <StatCard locale={locale} label={text.metrics.likes} value={number.format(totals.likes)} change={changePercent(totals.likes, before?.likes)} />
                <StatCard locale={locale} label={text.metrics.comments} value={number.format(totals.comments)} change={changePercent(totals.comments, before?.comments)} />
                <StatCard locale={locale} label={text.metrics.subscribers} value={number.format(totals.subscribers)} change={changePercent(totals.subscribers, before?.subscribers)} />
              </div>

              <section>
                <div role="group" aria-label={text.metricLabel} className="mb-3 flex gap-2 overflow-x-auto">
                  {METRICS.map((item) => (
                    <Button key={item} variant={metric === item ? 'default' : 'outline'} aria-pressed={metric === item} onClick={() => setMetric(item)} className="min-h-11 whitespace-nowrap">
                      {text.metrics[item]}
                    </Button>
                  ))}
                </div>
                <LineChart
                  key={metric}
                  title={text.metrics[metric]}
                  locale={locale}
                  points={series.map((entry) => ({ label: date.format(new Date(entry.date)), value: chart.value(entry) }))}
                  integer={chart.integer}
                  format={chart.format}
                  axisFormat={metric === 'watchTime' ? chart.format : undefined}
                  emptyText={text.emptyBy[metric]}
                  emptyTestId="studio-analytics-empty"
                  summaryTemplate={text.chartSummary}
                  tableLabel={text.chartTable}
                  xHeading={text.dateHeading}
                  showTable={text.showTable}
                  hideTable={text.hideTable}
                />
                <p className="mt-2 text-xs text-muted-foreground">{text.watchTimeNote}</p>
              </section>

              {overview && <TrafficSources traffic={overview.traffic} locale={locale} />}
            </>
          )}

          <section aria-labelledby="studio-top">
            <h2 id="studio-top" className="mb-2 text-base font-semibold text-foreground">{text.topContent}</h2>
            {topFailed ? (
              <div className="py-4">
                <p className="mb-3 text-foreground">{text.loadFailed}</p>
                {retryTop}
              </div>
            ) : sorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">{text.empty}</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="p-2 text-start font-medium">{text.videoHeading}</th>
                      {sortHeader('views', text.metrics.views)}
                      {sortHeader('watchTime', text.metrics.watchTime)}
                      {sortHeader('avgViewDuration', text.metrics.avgViewDuration)}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((item) => (
                      <tr key={item.videoId} className="border-b border-border" data-testid="studio-top-row">
                        <td className="max-w-40 truncate p-2">
                          <Link href={videoHref(item.videoId)} dir="auto" className="text-foreground hover:underline">{item.title}</Link>
                        </td>
                        <td className="p-2 text-end tabular-nums">{number.format(item.views)}</td>
                        <td className="p-2 text-end tabular-nums">{formatWatchTime(locale, watchTimeUnit(item.watchTime))(item.watchTime)}</td>
                        <td className="p-2 text-end tabular-nums">{duration(item.avgViewDuration)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {topCursor && <Button variant="outline" className="mt-3" onClick={() => void loadMore()}>{text.loadMore}</Button>}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
