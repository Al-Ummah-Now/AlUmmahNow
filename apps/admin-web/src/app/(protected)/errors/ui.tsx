/**
 * Presentational pieces of the Errors pages (server and client safe).
 */

import { chartLocale, compactNumber, labelIndices, niceScale } from '@al-ummah/shared-types';

/** "TypeError: message", without repeating a name the message already starts with. */
export function errorTitle(g: { name: string | null; message: string }): string {
  return g.name && !g.message.startsWith(g.name) ? `${g.name}: ${g.message}` : g.message;
}

const statusChipClasses: Record<string, string> = {
  new: 'bg-danger-bg text-danger-fg',
  acknowledged: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  resolved: 'bg-chip-resolved-bg text-chip-resolved-fg',
  ignored: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
  open: 'bg-chip-pending-bg text-chip-pending-fg',
  retrying: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  dismissed: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
};

/** Error group status (new, acknowledged, resolved, ignored) or item status (open, retrying, resolved, dismissed). */
export function ErrorStatusChip({ status, label, testId = 'error-status-chip' }: { status: string; label: string; testId?: string }) {
  return (
    <span data-testid={testId} data-status={status} className={`px-2 py-1 text-sm rounded font-medium whitespace-nowrap ${statusChipClasses[status] ?? statusChipClasses.ignored}`}>
      {label}
    </span>
  );
}

/** Marks a release E2E test group. */
export function TestChip({ label }: { label: string }) {
  return (
    <span data-testid="error-test-chip" className="px-2 py-0.5 text-xs rounded font-medium bg-chip-pending-bg text-chip-pending-fg whitespace-nowrap">
      {label}
    </span>
  );
}

/**
 * Occurrences per day as an inline SVG polyline. Drawn left to right in
 * time order in both directions (a time axis is not mirrored in RTL).
 */
export function Sparkline({ values, label, width = 112, height = 28 }: { values: number[]; label: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="text-accent overflow-visible" style={{ direction: 'ltr' }} data-testid="error-sparkline">
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} className="stroke-border" strokeWidth="1" />
      {values.length > 0 && <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

/**
 * Hourly occurrences as bars with a 0-based value axis and hour ticks. Time
 * runs from the axis side (left to right in English, right to left in Arabic),
 * like the Studio charts. Server-rendered: hover shows each bar's hour and
 * count (CSS), and a <details> table is the text alternative.
 */
export function HourlyChart({
  hours,
  label,
  barTitle,
  locale,
  hourLabel,
  tableLabel,
  hourHeading,
  countHeading,
  emptyText,
}: {
  hours: { hour: string; occurrences: number }[];
  label: string;
  barTitle: (h: { hour: string; occurrences: number }) => string;
  locale: string;
  /** Short label for an hour on the time axis */
  hourLabel: (hour: string) => string;
  tableLabel: string;
  hourHeading: string;
  countHeading: string;
  emptyText: string;
}) {
  const scale = niceScale(hours.map((h) => h.occurrences), { integer: true, target: 3 });
  const tick = compactNumber(locale);
  const number = new Intl.NumberFormat(chartLocale(locale));
  const empty = hours.every((h) => !h.occurrences);
  const y = (value: number) => 100 - (value / scale.top) * 100;
  const ticksAt = labelIndices(hours.length, 4);
  return (
    <figure className="m-0" data-testid="error-hourly-chart">
      <div className="flex gap-2">
        <div className="relative h-24 shrink-0 text-xs tabular-nums text-fg-muted" aria-hidden="true" data-testid="error-hourly-y-axis">
          <div className="invisible whitespace-nowrap">{scale.ticks.map((v) => <div key={v} className="h-0 leading-none">{tick(v)}</div>)}</div>
          {scale.ticks.map((v) => (
            <span key={v} className="absolute end-0 -translate-y-1/2 whitespace-nowrap leading-none" style={{ top: `${y(v)}%` }} data-testid="error-hourly-y-tick">
              {tick(v)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-24" role="img" aria-label={label}>
            {scale.ticks.map((v) => (
              <div key={v} className={`absolute inset-x-0 border-t ${v === 0 ? 'border-fg-muted' : 'border-dashed border-border'}`} style={{ top: `${y(v)}%` }} aria-hidden="true" />
            ))}
            <div className="absolute inset-0 flex items-end gap-px">
              {hours.map((h) => (
                <div key={h.hour} className="group relative flex h-full flex-1 items-end" title={barTitle(h)}>
                  <div className="w-full rounded-t-sm bg-accent group-hover:opacity-80" style={{ height: h.occurrences ? `max(2px, ${(h.occurrences / scale.top) * 100}%)` : 0 }} />
                  <span
                    className="pointer-events-none absolute bottom-full start-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded border border-border bg-surface px-2 py-1 text-xs text-fg shadow group-hover:block rtl:translate-x-1/2"
                    aria-hidden="true"
                  >
                    {barTitle(h)}
                  </span>
                </div>
              ))}
            </div>
            {empty && <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted" data-testid="error-hourly-empty">{emptyText}</p>}
          </div>
          <div className="relative mt-1 h-4 text-xs text-fg-muted" aria-hidden="true">
            {ticksAt.map((index, order) => {
              const at = ((index + 0.5) / hours.length) * 100;
              const shift = order === 0 ? '0' : order === ticksAt.length - 1 ? '-100%' : '-50%';
              return (
                <span key={index} className="absolute whitespace-nowrap" style={{ insetInlineStart: `${order === 0 ? 0 : order === ticksAt.length - 1 ? 100 : at}%`, transform: `translateX(${shift})` }} data-testid="error-hourly-x-tick">
                  {hourLabel(hours[index].hour)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-fg-muted underline">{tableLabel}</summary>
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className="p-1 text-start font-medium">{hourHeading}</th>
              <th scope="col" className="p-1 text-end font-medium">{countHeading}</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h.hour} className="border-t border-border">
                <td className="p-1">{hourLabel(h.hour)}</td>
                <td className="p-1 text-end tabular-nums">{number.format(h.occurrences)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
