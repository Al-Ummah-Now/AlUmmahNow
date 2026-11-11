'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/hooks/useLanguage';
import { getStudioVideoAnalytics, getVideoRetention, type RetentionCurve, type StudioVideoAnalytics } from '@/lib/api/studio-analytics';
import { logger } from '@/lib/logger-client';
import { chartLocale, formatDuration, formatWatchTime, watchTimeUnit } from '@al-ummah/shared-types';
import { RANGE_PRESETS, rangeDates, type RangePreset } from '@/lib/studio/analytics';
import { LineChart } from './LineChart';
import { StatCard, TrafficSources } from './parts';

interface Props {
  locale: string;
  channelId: string;
  videoId: string;
  title: string;
  duration?: number;
  backHref: string;
  backLabel: string;
  created?: string;
}

/** Per-video stats, retention and traffic (spec §4.6). */
export function VideoAnalytics({ locale, channelId, videoId, title, duration, backHref, backLabel, created }: Props) {
  const { t } = useLanguage();
  const text = t.studio.analytics;
  const [range, setRange] = useState<RangePreset>('28');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StudioVideoAnalytics | null>(null);
  const [retention, setRetention] = useState<RetentionCurve | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const window = useMemo(() => rangeDates(range, new Date(), created).current, [range, created]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setFailed(false);
    const onError = (error: unknown) => {
      logger.error('[Studio] Could not load video analytics', { channelId, videoId, error });
      return null;
    };
    const [stats, curve] = await Promise.all([
      getStudioVideoAnalytics(videoId, window).catch(onError),
      getVideoRetention(videoId, window).catch(onError),
    ]);
    if (id !== request.current) return;
    setData(stats);
    setRetention(curve);
    setFailed(!stats);
    setLoading(false);
  }, [channelId, videoId, window]);

  useEffect(() => {
    void load();
  }, [load]);

  const number = new Intl.NumberFormat(chartLocale(locale));
  const percent = new Intl.NumberFormat(chartLocale(locale), { style: 'percent', maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat(chartLocale(locale), { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const clock = formatDuration(locale);
  const position = (bucket: number) => (duration ? clock((bucket / 20) * duration) : percent.format(bucket / 20));
  const lifetime = (count: number) => text.lifetimeViews.replace('{count}', number.format(count));

  return (
    <div data-testid="studio-video-analytics">
      <Link href={backHref} className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="h-4 w-4 rtl:rotate-180" />
        {backLabel}
      </Link>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 dir="auto" className="truncate text-xl font-bold text-foreground">{title}</h1>
        <select aria-label={text.rangeLabel} value={range} onChange={(event) => setRange(event.target.value as RangePreset)} className="min-h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground">
          {RANGE_PRESETS.map((preset) => <option key={preset} value={preset}>{text.ranges[preset]}</option>)}
        </select>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" aria-busy="true" />
      ) : failed || !data ? (
        <div className="py-8 text-center">
          <p className="mb-3 text-foreground">{text.loadFailed}</p>
          <Button variant="outline" onClick={() => void load()}>{text.retry}</Button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {/* The range's numbers, like the chart and the channel page; the lifetime total stays as a note */}
            <StatCard locale={locale} label={text.metrics.views} value={number.format(data.rangeViews ?? data.views)} note={data.rangeViews === undefined ? undefined : lifetime(data.views)} />
            <StatCard locale={locale} label={text.metrics.watchTime} value={formatWatchTime(locale, watchTimeUnit(data.watchTime))(data.watchTime)} />
            <StatCard locale={locale} label={text.metrics.avgViewDuration} value={clock(data.avgViewDuration)} />
            <StatCard locale={locale} label={text.metrics.likes} value={number.format(data.rangeLikes ?? data.likes)} />
            <StatCard locale={locale} label={text.metrics.comments} value={number.format(data.rangeComments ?? data.comments)} />
          </div>

          {data.recentMetrics && (
            <section aria-labelledby="studio-video-views" data-testid="studio-video-views">
              <h2 id="studio-video-views" className="mb-3 text-base font-semibold text-foreground">{text.viewsChart}</h2>
              <LineChart
                title={text.metrics.views}
                locale={locale}
                points={data.recentMetrics.map((entry) => ({ label: date.format(new Date(entry.date)), value: entry.views || 0 }))}
                format={(value) => number.format(value)}
                emptyText={text.emptyBy.views}
                summaryTemplate={text.chartSummary}
                tableLabel={text.chartTable}
                xHeading={text.dateHeading}
                showTable={text.showTable}
                hideTable={text.hideTable}
              />
            </section>
          )}

          <section aria-labelledby="studio-retention" data-testid="studio-retention">
            <h2 id="studio-retention" className="mb-1 text-base font-semibold text-foreground">{text.retention.title}</h2>
            <p className="mb-3 text-xs text-muted-foreground">{text.retention.note}</p>
            {retention?.points ? (
              <LineChart
                title={text.retention.series}
                locale={locale}
                points={retention.points.map((point) => ({ label: position(point.bucket), value: point.share }))}
                max={1}
                integer={false}
                format={(value) => percent.format(value)}
                axisFormat={(value) => percent.format(value)}
                summaryTemplate={text.chartSummary}
                tableLabel={text.chartTable}
                xHeading={text.retention.positionHeading}
                showTable={text.showTable}
                hideTable={text.hideTable}
              />
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="studio-retention-empty">{text.retention.notEnough}</p>
            )}
          </section>

          <TrafficSources traffic={data.traffic} locale={locale} />
        </div>
      )}
    </div>
  );
}
