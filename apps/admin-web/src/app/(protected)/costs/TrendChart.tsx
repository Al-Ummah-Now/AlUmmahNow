'use client';

import { useState, useSyncExternalStore } from 'react';
import { dateTimeFormat, numberFormat } from '@al-ummah/shared-types';
import { StackedBarChart, type StackedSeries } from '@/components/charts/StackedBarChart';
import { opsFormats } from '../operations/model';
import { localTrend, todayHoldsNextUtcDay, utcDates, utcDaysPhrase } from './model';

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
  /** "UTC days": the table's column of each bar's UTC days. */
  utcLabel: string;
  /** A bar's UTC days with their label, by how many it holds: "UTC day: {days}", "UTC days: {days}" (Arabic has a dual). */
  utcOne: string;
  utcTwo: string;
  utcMany: string;
  /** Between two dates: ", " / «، ». */
  utcSep: string;
  /** The chosen bar, e.g. "{day}: {total} ({utc})", {utc} being the labelled UTC days. */
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
  labels: { chart: string; table: string; day: string; total: string; empty: string; tableUnit?: string };
  reference?: { value: number; label: string };
  axisUnit?: string;
  text: TrendText;
  testId: string;
}) {
  const zone = useSyncExternalStore(noSubscribe, viewerZone, () => 'UTC');
  const [picked, setPicked] = useState<number | null>(null);
  const f = opsFormats(locale);
  // The table: plain amounts under one currency caption, so its eleven columns fit (Arabic spells the currency out)
  const amount = numberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const local = localTrend(days, series, now, zone);
  const byKey = new Map(local.series.map((s) => [s.key, s.values]));
  const last = local.days.length - 1;
  const selected = picked ?? last;
  const utcOf = (i: number) => (local.utcDays[i]?.length ? utcDates(local.utcDays[i]!, f.day, text.utcSep) : undefined);
  const utcPhrase = (i: number) => utcDaysPhrase(local.utcDays[i] ?? [], f.day, text);
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
        dayNoteTitle={utcPhrase}
        tableFormat={labels.tableUnit ? (v) => amount.format(v) : undefined}
        selected={selected}
        onSelect={setPicked}
        testId={testId}
      />
      <p className="mt-2 text-sm text-fg" aria-live="polite" data-testid={`${testId}-detail`} data-day={local.days[selected]}>
        {text.detail
          .replace('{day}', f.day(local.days[selected] ?? ''))
          .replace('{total}', f.usd(totalOf(selected)))
          .replace('{utc}', utcPhrase(selected) ?? text.utcOne.replace('{days}', '—'))}
      </p>
      <p className="mt-2 text-xs text-fg-muted" data-testid={`${testId}-note`}>
        {text.note}
        {todayHoldsNext ? ` ${text.noteToday}` : ''}
      </p>
    </div>
  );
}
