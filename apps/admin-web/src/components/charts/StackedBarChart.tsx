/**
 * Several series per day as stacked bars, server-rendered SVG in the style of TimeSeriesChart
 * (shared rules, docs: analytics-charts): a 0-based value axis on round ticks (shared niceScale)
 * on the reading side (right in Arabic) with time running from it, a hairline of the surface
 * between segments so neighbouring colours stay apart, a legend with each series' total, hover
 * titles per segment, and a <details> table as the text alternative. No hooks.
 */
import { chartLocale, labelIndices, niceScale } from '@al-ummah/shared-types';

export interface StackedSeries {
  key: string;
  label: string;
  /** A CSS colour, normally var(--chart-N). */
  color: string;
  /** One value per day, aligned with `days`. */
  values: readonly number[];
}

export interface StackedBarChartProps {
  title: string;
  days: readonly string[];
  series: readonly StackedSeries[];
  locale: string;
  format: (value: number) => string;
  dayLabel: (day: string) => string;
  labels: { chart: string; table: string; day: string; total: string; empty: string };
  /** A horizontal reference line (e.g. the daily share of the budget), keyed in the legend. */
  reference?: { value: number; label: string };
  testId: string;
}

const W = 640;
const H = 220;
const AXIS = 64;
const PAD = 14;
const TOP = 12;
const BOTTOM = 28;

export function StackedBarChart({ title, days, series, locale, format, dayLabel, labels, reference, testId }: StackedBarChartProps) {
  const rtl = /^ar\b/.test(locale);
  const totals = days.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const top = Math.max(0, ...totals, reference?.value ?? 0);
  const scale = niceScale(top > 0 ? [top] : [], { target: 4 });
  const tickNumber = new Intl.NumberFormat(chartLocale(locale), { maximumFractionDigits: 2 });
  const plotStart = rtl ? PAD : AXIS;
  const plotEnd = rtl ? W - AXIS : W - PAD;
  const n = days.length;
  const slot = n > 0 ? (plotEnd - plotStart) / n : 0;
  const barW = Math.max(2, slot * 0.72);
  const x = (i: number) => (rtl ? plotEnd - (i + 1) * slot : plotStart + i * slot) + (slot - barW) / 2;
  const y = (v: number) => TOP + (1 - v / scale.top) * (H - TOP - BOTTOM);
  const ticksAt = labelIndices(n, 5);
  // Nothing spent: the reference line alone is not data
  const empty = !totals.some((v) => v > 0);
  const seriesTotal = (s: StackedSeries) => s.values.reduce((a, b) => a + b, 0);

  return (
    <figure className="m-0" data-testid={testId}>
      <figcaption className="mb-2 font-medium text-fg">{title}</figcaption>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid={`${testId}-legend`}>
        {series.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5 text-fg-muted">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-fg">{s.label}</span>
            <span className="tabular-nums">{format(seriesTotal(s))}</span>
          </li>
        ))}
        {reference && reference.value > 0 && (
          <li className="inline-flex items-center gap-1.5 text-fg-muted" data-testid={`${testId}-reference-key`}>
            <span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--danger-fg)' }} />
            <span className="text-fg">{reference.label}</span>
          </li>
        )}
      </ul>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-fg-muted" style={{ direction: 'ltr' }} role="img" aria-label={labels.chart}>
          {scale.ticks.map((v) => (
            <g key={v}>
              <line x1={plotStart} x2={plotEnd} y1={y(v)} y2={y(v)} style={{ stroke: v === 0 ? 'var(--fg-muted)' : 'var(--border)' }} strokeDasharray={v === 0 ? undefined : '3 3'} strokeWidth="1" />
              <text
                x={rtl ? plotEnd + 6 : plotStart - 6}
                y={y(v)}
                textAnchor={rtl ? 'start' : 'end'}
                dominantBaseline="middle"
                fontSize="11"
                fill="currentColor"
                data-value={tickNumber.format(v)}
              >
                {format(v)}
              </text>
            </g>
          ))}
          {!empty &&
            days.map((day, i) => {
              let base = 0;
              return (
                <g key={day} data-testid={`${testId}-bar`} data-day={day} data-total={totals[i].toFixed(2)}>
                  {series.map((s) => {
                    const v = s.values[i] ?? 0;
                    if (v <= 0) return null;
                    const y0 = y(base);
                    base += v;
                    const y1 = y(base);
                    return (
                      <rect key={s.key} x={x(i)} y={y1} width={barW} height={Math.max(0.5, y0 - y1)} style={{ fill: s.color, stroke: 'var(--surface)' }} strokeWidth="0.75">
                        <title>{`${dayLabel(day)} · ${s.label}: ${format(v)}`}</title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
          {reference && reference.value > 0 && !empty && (
            <g data-testid={`${testId}-reference`}>
              <line x1={plotStart} x2={plotEnd} y1={y(reference.value)} y2={y(reference.value)} style={{ stroke: 'var(--danger-fg)' }} strokeDasharray="6 4" strokeWidth="1.5">
                <title>{reference.label}</title>
              </line>
            </g>
          )}
          {ticksAt.map((i, order) => (
            <text
              key={days[i]}
              x={x(i) + barW / 2}
              y={H - 8}
              fontSize="11"
              fill="currentColor"
              textAnchor={order === 0 ? (rtl ? 'end' : 'start') : order === ticksAt.length - 1 ? (rtl ? 'start' : 'end') : 'middle'}
            >
              {dayLabel(days[i])}
            </text>
          ))}
        </svg>
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted" data-testid={`${testId}-empty`}>
            {labels.empty}
          </p>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-fg-muted underline">{labels.table}</summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-fg-muted">
                <th scope="col" className="p-1 text-start font-medium">{labels.day}</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="p-1 text-end font-medium">{s.label}</th>
                ))}
                <th scope="col" className="p-1 text-end font-medium">{labels.total}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day, i) => (
                <tr key={day} className="border-t border-border">
                  <th scope="row" className="p-1 text-start font-normal">{dayLabel(day)}</th>
                  {series.map((s) => (
                    <td key={s.key} className="p-1 text-end tabular-nums">{format(s.values[i] ?? 0)}</td>
                  ))}
                  <td className="p-1 text-end tabular-nums font-medium">{format(totals[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
