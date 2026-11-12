/**
 * One series over time as a line, server-rendered SVG in the style of the
 * Errors and Delivery charts (shared rules, docs: analytics-charts):
 * a 0-based value axis on round ticks (shared niceScale), the value axis on
 * the reading side (right in Arabic) with time running from it, a missing
 * point is a gap, hover shows each point, and a <details> table is the text
 * alternative. No hooks: usable from server and client components.
 */
import { chartLocale, labelIndices, niceScale } from '@al-ummah/shared-types';

export interface TimeSeriesPoint {
  /** Hour ('2026-11-12T14:00:00Z') or day ('2026-11-12') */
  t: string;
  value: number | null;
}

export interface TimeSeriesChartProps {
  title: string;
  points: readonly TimeSeriesPoint[];
  locale: string;
  /** Formats a value for the axis, the hover titles and the table. */
  format: (value: number) => string;
  /** Formats a point's time (axis labels and table rows). */
  timeLabel: (t: string) => string;
  /** Integer-only ticks (counts). */
  integer?: boolean;
  labels: { chart: string; table: string; time: string; value: string; empty: string; noValue: string };
  testId: string;
}

const W = 640;
const H = 200;
const AXIS = 64;
const PAD = 14;
const TOP = 12;
const BOTTOM = 28;
const COLOR = 'var(--chart-1)';

export function TimeSeriesChart({ title, points, locale, format, timeLabel, integer = false, labels, testId }: TimeSeriesChartProps) {
  const rtl = /^ar\b/.test(locale);
  const present = points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const scale = niceScale(present, { target: 4, integer });
  const tickNumber = new Intl.NumberFormat(chartLocale(locale), { maximumFractionDigits: 2 });

  const plotStart = rtl ? PAD : AXIS;
  const plotEnd = rtl ? W - AXIS : W - PAD;
  const n = points.length;
  const step = n > 1 ? (plotEnd - plotStart) / (n - 1) : 0;
  const x = (i: number) => (n > 1 ? (rtl ? plotEnd - i * step : plotStart + i * step) : (plotStart + plotEnd) / 2);
  const y = (v: number) => TOP + (1 - v / scale.top) * (H - TOP - BOTTOM);

  // Runs of consecutive points with a value: one polyline each (a missing point is a gap)
  const runs: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null || !Number.isFinite(p.value)) {
      if (current.length > 1) runs.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  if (current.length > 1) runs.push(current.join(' '));

  const ticksAt = labelIndices(n, 5);
  const empty = present.length === 0;
  const valueText = (v: number | null) => (v === null ? labels.noValue : format(v));

  return (
    <figure className="m-0" data-testid={testId}>
      <figcaption className="mb-2 font-medium text-fg">{title}</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-fg-muted" style={{ direction: 'ltr' }} role="img" aria-label={labels.chart}>
          {scale.ticks.map((v) => (
            <g key={v}>
              <line
                x1={plotStart}
                x2={plotEnd}
                y1={y(v)}
                y2={y(v)}
                style={{ stroke: v === 0 ? 'var(--fg-muted)' : 'var(--border)' }}
                strokeDasharray={v === 0 ? undefined : '3 3'}
                strokeWidth="1"
              />
              <text
                x={rtl ? plotEnd + 6 : plotStart - 6}
                y={y(v)}
                textAnchor={rtl ? 'start' : 'end'}
                dominantBaseline="middle"
                fontSize="11"
                fill="currentColor"
                data-testid={`${testId}-y-tick`}
                data-value={tickNumber.format(v)}
              >
                {format(v)}
              </text>
            </g>
          ))}
          {ticksAt.map((i, order) => (
            <text
              key={points[i].t}
              x={x(i)}
              y={H - 8}
              fontSize="11"
              fill="currentColor"
              textAnchor={order === 0 ? (rtl ? 'end' : 'start') : order === ticksAt.length - 1 ? (rtl ? 'start' : 'end') : 'middle'}
              data-testid={`${testId}-x-tick`}
            >
              {timeLabel(points[i].t)}
            </text>
          ))}
          {!empty && (
            <g data-testid={`${testId}-series`}>
              {runs.map((pts, k) => (
                <polyline key={k} points={pts} fill="none" style={{ stroke: COLOR }} strokeWidth="2" strokeLinejoin="round" />
              ))}
              {points.map((p, i) =>
                p.value === null || !Number.isFinite(p.value) ? null : (
                  <circle key={p.t} cx={x(i)} cy={y(p.value)} r={n > 60 ? 1.5 : 3} style={{ fill: COLOR }}>
                    <title>{`${timeLabel(p.t)}: ${valueText(p.value)}`}</title>
                  </circle>
                ),
              )}
            </g>
          )}
        </svg>
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted" data-testid={`${testId}-empty`}>
            {labels.empty}
          </p>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-fg-muted underline">{labels.table}</summary>
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className="p-1 text-start font-medium">{labels.time}</th>
              <th scope="col" className="p-1 text-end font-medium">{labels.value}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.t} className="border-t border-border">
                <th scope="row" className="p-1 text-start font-normal">{timeLabel(p.t)}</th>
                <td className="p-1 text-end tabular-nums">{valueText(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
