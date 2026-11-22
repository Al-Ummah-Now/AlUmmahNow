'use client';

import { useState, useSyncExternalStore } from 'react';
import { dateTimeFormat, joinMeta } from '@al-ummah/shared-types';
import { StackedBarChart, type StackedSeries } from '@/components/charts/StackedBarChart';
import { opsFormats } from '../operations/model';
import { localTrend, todayHoldsNextUtcDay } from './model';

const noSubscribe = () => () => {};
const viewerZone = () => {
  try {
    return dateTimeFormat('en').resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export interface TrendText {
  /** The note under the chart. */
  note: string;
  /** Added to the note only when today's bar also holds the next UTC day (the Americas' evening). */
  noteToday: string;
  /** "By UTC day": the hover titles' and the table's label for a bar's UTC days. */
  utcLabel: string;
  /** The chosen bar, e.g. "{day}: {total} (By UTC day: {utc})". */
  detail: string;
}

/**
 * The daily spend chart on the viewer's calendar. The server has no viewer zone, so it draws the
 * UTC days; straight after hydration the browser redraws them on the local calendar (as
 * LocalTime does), so the last bar is the viewer's today. Every source reports by UTC day, so
 * each bar says which UTC days it holds: in its hover titles, in the table, and, since a phone has
 * no hover, in a line under the chart for the bar tapped (today's bar until one is).
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
  text,
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
  text: TrendText;
  testId: string;
}) {
  const zone = useSyncExternalStore(noSubscribe, viewerZone, () => 'UTC');
  const [picked, setPicked] = useState<number | null>(null);
  const f = opsFormats(locale);
  const local = localTrend(days, series, now, zone);
  const byKey = new Map(local.series.map((s) => [s.key, s.values]));
  const last = local.days.length - 1;
  const selected = picked ?? last;
  const utcOf = (i: number) => (local.utcDays[i]?.length ? joinMeta(locale, local.utcDays[i]!.map(f.day)) : undefined);
  const totalOf = (i: number) => local.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
  const todayHoldsNext = todayHoldsNextUtcDay(local);
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
        dayNote={utcOf}
        dayNoteLabel={text.utcLabel}
        selected={selected}
        onSelect={setPicked}
        testId={testId}
      />
      <p className="mt-2 text-sm text-fg" aria-live="polite" data-testid={`${testId}-detail`} data-day={local.days[selected]}>
        {text.detail
          .replace('{day}', f.day(local.days[selected] ?? ''))
          .replace('{total}', f.usd(totalOf(selected)))
          .replace('{utc}', utcOf(selected) ?? '—')}
      </p>
      <p className="mt-2 text-xs text-fg-muted" data-testid={`${testId}-note`}>
        {text.note}
        {todayHoldsNext ? ` ${text.noteToday}` : ''}
      </p>
    </div>
  );
}
