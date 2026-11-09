'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/hooks/useLanguage';
import { getStudioVideoAnalytics, getVideoRetention, type RetentionCurve, type StudioVideoAnalytics } from '@/lib/api/studio-analytics';
import { logger } from '@/lib/logger-client';
import { RANGE_PRESETS, rangeDates, type RangePreset } from '@/lib/studio/analytics';
import { LineChart } from './LineChart';
import { formatSeconds, StatCard, TrafficSources } from './parts';

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

  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const position = (bucket: number) => (duration ? formatSeconds((bucket / 20) * duration) : percent.format(bucket / 20));

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
            <StatCard label={text.metrics.views} value={number.format(data.views)} />
            <StatCard label={text.metrics.watchTime} value={formatSeconds(data.watchTime)} />
            <StatCard label={text.metrics.avgViewDuration} value={formatSeconds(data.avgViewDuration)} />
            <StatCard label={text.metrics.likes} value={number.format(data.likes)} />
            <StatCard label={text.metrics.comments} value={number.format(data.comments)} />
          </div>

          <section aria-labelledby="studio-retention" data-testid="studio-retention">
            <h2 id="studio-retention" className="mb-1 text-base font-semibold text-foreground">{text.retention.title}</h2>
            <p className="mb-3 text-xs text-muted-foreground">{text.retention.note}</p>
            {retention?.points ? (
              <LineChart
                title={text.retention.series}
                points={retention.points.map((point) => ({ label: position(point.bucket), value: point.share }))}
                max={1}
                format={(value) => percent.format(value)}
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
