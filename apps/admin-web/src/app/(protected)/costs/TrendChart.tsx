'use client';

import { useSyncExternalStore } from 'react';
import { dateTimeFormat, joinMeta } from '@al-ummah/shared-types';
import { StackedBarChart, type StackedSeries } from '@/components/charts/StackedBarChart';
import { opsFormats } from '../operations/model';
import { localTrend } from './model';

const noSubscribe = () => () => {};
const viewerZone = () => {
  try {
    return dateTimeFormat('en').resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * The daily spend chart on the viewer's calendar. The server has no viewer zone, so it draws the
 * UTC days; straight after hydration the browser redraws them on the local calendar (as
 * LocalTime does), so the last bar is the viewer's today. Each segment's title names the UTC
 * days its bar holds, since every source reports by UTC day.
 */
export function TrendChart({
  days,
  series,
  now,
  locale,
  title,
  labels,
  reference,
  axisUnit,
  utcNote,
  testId,
}: {
  days: readonly string[];
  series: readonly StackedSeries[];
  /** The page's clock (ms), so the server and the first client render agree. */
  now: number;
  locale: string;
  title: string;
  labels: { chart: string; table: string; day: string; total: string; empty: string };
  reference?: { value: number; label: string };
  axisUnit?: string;
  /** "By UTC day: {days}" in the page's language. */
  utcNote: string;
  testId: string;
}) {
  const zone = useSyncExternalStore(noSubscribe, viewerZone, () => 'UTC');
  const f = opsFormats(locale);
  const local = localTrend(days, series, now, zone);
  const byKey = new Map(local.series.map((s) => [s.key, s.values]));
  return (
    <div data-zone={zone} data-testid={`${testId}-local`}>
      <StackedBarChart
        title={title}
        days={local.days}
        series={series.map((s) => ({ ...s, values: byKey.get(s.key) ?? [] }))}
        locale={locale}
        format={f.usd}
        dayLabel={f.day}
        axisUnit={axisUnit}
        reference={reference}
        labels={labels}
        dayNote={(i) => (local.utcDays[i]?.length ? utcNote.replace('{days}', joinMeta(locale, local.utcDays[i]!.map(f.day))) : undefined)}
        testId={testId}
      />
    </div>
  );
}
