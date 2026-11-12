'use client';

/**
 * Playback quality now and over the last 60 minutes, per provider
 * (docs/admin/LIVE_OPS.md): plays going on now, then plays started, startup
 * time, rebuffer ratio, error rate, average bitrate and R2 → Bunny fallbacks
 * in 5-minute buckets. Updated from the admin:media `qoe` events (every 5 s at
 * most); while the live channel is down it reads them every 30 s when the
 * page is visible.
 */
import { useCallback, useMemo, useState } from 'react';
import { getMediaQoeLive } from '@/lib/api/admin';
import type { QoeLiveData } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { cardClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { useAdminLive } from '@/lib/live/useAdminLive';
import { DailyChart, type ChartUnit } from './DailyChart';
import { deliveryFormats } from './format';
import { applyQoeEvent, fiveMinuteBuckets, qoeMetric, windowTotals, type QoeMetric } from './qoe-view';

export const QOE_POLL_MS = 30_000;

const CHARTS: { metric: QoeMetric; title: MessageKey; unit: ChartUnit }[] = [
  { metric: 'plays', title: 'mediaDelivery.qoeChartPlays', unit: 'count' },
  { metric: 'startup', title: 'mediaDelivery.qoeChartStartup', unit: 'seconds' },
  { metric: 'rebuffer', title: 'mediaDelivery.qoeChartRebuffer', unit: 'ratio' },
  { metric: 'errorRate', title: 'mediaDelivery.qoeChartErrors', unit: 'ratio' },
  { metric: 'bitrate', title: 'mediaDelivery.qoeChartBitrate', unit: 'kbps' },
  { metric: 'fallbacks', title: 'mediaDelivery.qoeChartFallbacks', unit: 'count' },
];

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded border border-border bg-surface-2 p-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-fg tabular-nums" data-testid={testId}>{value}</dd>
    </div>
  );
}

export function LiveQoe({ initial }: { initial: QoeLiveData | null }) {
  const { t, locale } = useLanguage();
  const f = deliveryFormats(locale);
  const [data, setData] = useState<QoeLiveData | null>(initial);
  const [stale, setStale] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await getMediaQoeLive();
      if (result.ok && result.data) {
        setData(result.data);
        setStale(false);
        return;
      }
      if (!result.ok) logger.warn('[delivery] Live playback refresh failed', { status: result.status });
    } catch (e) {
      logger.warn('[delivery] Live playback request failed', { error: e instanceof Error ? e.message : String(e) });
    }
    setStale(true);
  }, []);

  useAdminLive(
    ['media'],
    (update) => {
      if (update.events.some((e) => e.kind === 'qoe')) {
        setData((current) => update.events.reduce(applyQoeEvent, current));
        setStale(false);
      }
      if (update.resync) void refresh();
    },
    {
      poll: () => {
        if (document.visibilityState === 'visible') void refresh();
      },
      pollMs: QOE_POLL_MS,
    },
  );

  const buckets = useMemo(() => (data ? fiveMinuteBuckets(data.minutes) : []), [data]);
  const totals = useMemo(() => (data ? windowTotals(data.minutes) : null), [data]);
  const labels = (title: string) => ({
    chart: t('mediaDelivery.qoeChartLabel', { title }),
    table: t('mediaDelivery.chartTable'),
    day: t('mediaDelivery.colMinuteUtc'),
    bunny: t('mediaDelivery.colBunny'),
    r2: t('mediaDelivery.colR2'),
    legendBunny: t('mediaDelivery.legendBunny'),
    legendR2: t('mediaDelivery.legendR2'),
    empty: t('mediaDelivery.qoeEmpty'),
    noValue: t('mediaDelivery.noValue'),
  });

  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="delivery-qoe-live-title" data-testid="delivery-qoe-live">
      <h2 id="delivery-qoe-live-title" className="text-lg font-semibold text-fg mb-1">{t('mediaDelivery.qoeLiveTitle')}</h2>
      <p className="text-fg-muted text-sm mb-4">{t('mediaDelivery.qoeLiveIntro')}</p>
      {data && totals ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            <Figure label={t('mediaDelivery.qoeNowBunny')} value={f.integer(data.now.bunny)} testId="delivery-qoe-now-bunny" />
            <Figure label={t('mediaDelivery.qoeNowR2')} value={f.integer(data.now.r2)} testId="delivery-qoe-now-r2" />
            <Figure label={t('mediaDelivery.qoeHourBunny')} value={f.integer(totals.bunny.plays)} testId="delivery-qoe-hour-bunny" />
            <Figure label={t('mediaDelivery.qoeHourR2')} value={f.integer(totals.r2.plays)} testId="delivery-qoe-hour-r2" />
          </dl>
          <div className="grid gap-6 lg:grid-cols-2">
            {CHARTS.map(({ metric, title, unit }) => (
              <DailyChart
                key={metric}
                title={t(title)}
                days={buckets.map((b) => b.minute)}
                bunny={buckets.map((b) => qoeMetric(b.bunny, metric))}
                r2={buckets.map((b) => qoeMetric(b.r2, metric))}
                unit={unit}
                xKind="minute"
                locale={locale}
                labels={labels(t(title))}
                testId={`delivery-qoe-${metric}`}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-fg-muted" data-testid="delivery-qoe-updated">
            {t('mediaDelivery.qoeUpdated', { time: f.time(data.at.slice(0, 16)) })}
          </p>
          {stale && <p role="status" className="mt-1 text-sm text-warning-fg">{t('mediaDelivery.liveStale')}</p>}
        </>
      ) : (
        <p className="text-sm text-fg-muted" data-testid="delivery-qoe-unavailable">{t('mediaDelivery.qoeUnavailable')}</p>
      )}
    </section>
  );
}
