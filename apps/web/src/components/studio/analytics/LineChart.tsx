'use client';

import { useId, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { compactNumber, labelIndices, niceScale } from '@al-ummah/shared-types';

export interface ChartPoint {
  label: string;
  value: number;
}

interface Props {
  title: string;
  points: readonly ChartPoint[];
  /** Locale of the page; Arabic puts the value axis on the right and runs time from the right. */
  locale: string;
  /** Fixed top of the scale, for shares (1 = 100%). Otherwise round ticks above the largest value. */
  max?: number;
  /** Counts get whole-number ticks (the default). */
  integer?: boolean;
  /** Full value, for the tooltip and the table. */
  format: (value: number) => string;
  /** Tick labels on the value axis. Defaults to compact numbers (1.2K, ١٫٢ ألف). */
  axisFormat?: (value: number) => string;
  /** Shown inside the plot when every value is zero. */
  emptyText?: string;
  emptyTestId?: string;
  /** Accessible summary, with {title} {from} {to} {peak} {peakLabel}. */
  summaryTemplate: string;
  /** Labels for the table alternative */
  tableLabel: string;
  xHeading: string;
  showTable: string;
  hideTable: string;
}

const TICK_COUNT = 4;

/**
 * The one chart of Studio analytics: a series over time (or position) with a
 * 0-based value axis, gridlines, date ticks, a tooltip on hover, tap or arrow
 * keys, and a table as the text alternative. Lines are drawn in a stretched
 * 0..100 SVG; every label is HTML so it never stretches.
 */
export function LineChart({ title, points, locale, max, integer = true, format, axisFormat, emptyText, emptyTestId = 'chart-empty', summaryTemplate, tableLabel, xHeading, showTable, hideTable }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const id = useId();
  const rtl = /^ar\b/.test(locale);
  const values = points.map((point) => point.value);
  const scale = useMemo(() => niceScale(values, { target: TICK_COUNT, integer, max }), [values.join(','), integer, max]); // eslint-disable-line react-hooks/exhaustive-deps
  const tick = useMemo(() => axisFormat ?? compactNumber(locale), [axisFormat, locale]);
  const empty = points.length === 0 || values.every((value) => !value);
  const last = Math.max(1, points.length - 1);

  /** Horizontal position in % of the plot; time runs from the axis side. */
  const x = (index: number) => {
    const ratio = points.length > 1 ? index / last : 0.5;
    return (rtl ? 1 - ratio : ratio) * 100;
  };
  const y = (value: number) => 100 - (Math.min(value, scale.top) / scale.top) * 100;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  const current = active === null ? null : points[active] ?? null;
  const peak = points.reduce<ChartPoint | null>((best, point) => (!best || point.value > best.value ? point : best), null);
  const summary = peak && !empty
    ? summaryTemplate
        .replace('{title}', title)
        .replace('{from}', points[0].label)
        .replace('{to}', points[points.length - 1].label)
        .replace('{peak}', format(peak.value))
        .replace('{peakLabel}', peak.label)
    : [title, emptyText].filter(Boolean).join('. ');

  const pick = (event: MouseEvent<HTMLDivElement>) => {
    if (!points.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    let ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    if (rtl) ratio = 1 - ratio;
    setActive(Math.round(ratio * (points.length - 1)));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length) return;
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    const at = active ?? -1;
    let next: number | null = null;
    if (event.key === forward) next = Math.min(points.length - 1, at + 1);
    else if (event.key === back) next = Math.max(0, at < 0 ? points.length - 1 : at - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = points.length - 1;
    else if (event.key === 'Escape') next = null;
    else return;
    event.preventDefault();
    setActive(next);
  };

  const tooltipX = active === null ? 0 : x(active);

  return (
    <figure className="m-0" data-testid="line-chart">
      <figcaption className="mb-2 text-sm font-medium text-foreground">{title}</figcaption>
      <div className="mt-3 flex gap-2" dir={rtl ? 'rtl' : 'ltr'}>
        {/* Value axis: on the start side, so on the right in Arabic */}
        <div className="relative h-48 shrink-0 text-xs tabular-nums text-muted-foreground" aria-hidden="true" data-testid="chart-y-axis">
          <div className="invisible whitespace-nowrap">{scale.ticks.map((value) => <div key={value} className="h-0 leading-none">{tick(value)}</div>)}</div>
          {scale.ticks.map((value) => (
            <span key={value} className="absolute end-0 -translate-y-1/2 whitespace-nowrap leading-none" style={{ top: `${y(value)}%` }} data-testid="chart-y-tick">
              {tick(value)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="relative h-48 cursor-crosshair touch-pan-y rounded-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="group"
            aria-label={summary}
            aria-describedby={`${id}-readout`}
            tabIndex={0}
            onMouseMove={pick}
            onClick={pick}
            onMouseLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            data-testid="chart-hit"
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
              {scale.ticks.map((value) => (
                <line
                  key={value}
                  x1={0}
                  x2={100}
                  y1={y(value)}
                  y2={y(value)}
                  className={value === 0 ? 'stroke-muted-foreground' : 'stroke-border'}
                  strokeWidth={1}
                  strokeDasharray={value === 0 ? undefined : '3 3'}
                  vectorEffect="non-scaling-stroke"
                  data-testid="chart-gridline"
                />
              ))}
              {!empty && <path d={path} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" data-testid="chart-line" />}
              {current && (
                <line x1={tooltipX} x2={tooltipX} y1={0} y2={100} className="stroke-muted-foreground" strokeWidth={1} vectorEffect="non-scaling-stroke" data-testid="chart-crosshair" />
              )}
            </svg>
            {current && !empty && (
              <span
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary"
                style={{ left: `${tooltipX}%`, top: `${y(current.value)}%` }}
                aria-hidden="true"
              />
            )}
            {empty && emptyText && (
              <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground" data-testid={emptyTestId}>
                {emptyText}
              </p>
            )}
            {current && (
              <div
                className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                style={{ left: `${tooltipX}%`, transform: `translateX(${tooltipX > 70 ? '-100%' : tooltipX < 30 ? '0' : '-50%'})` }}
                aria-hidden="true"
                data-testid="chart-tooltip"
              >
                <div className="text-muted-foreground">{current.label}</div>
                <div className="font-semibold tabular-nums">{format(current.value)}</div>
              </div>
            )}
          </div>
          {/* Time axis: the first, last and evenly spaced labels between; the middle ones drop on phones */}
          <div className="relative mt-1 h-4 text-xs text-muted-foreground" aria-hidden="true" data-testid="chart-x-axis">
            {labelIndices(points.length).map((index, order, all) => {
              const left = x(index);
              const edge = left < 1 ? '0' : left > 99 ? '-100%' : '-50%';
              const inner = order > 0 && order < all.length - 1;
              return (
                <span key={index} className={`absolute whitespace-nowrap ${inner && all.length > 3 && order % 2 === 1 ? 'hidden sm:inline' : ''}`} style={{ left: `${left}%`, transform: `translateX(${edge})` }} data-testid="chart-x-tick">
                  {points[index].label}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <p id={`${id}-readout`} className="sr-only" aria-live="polite" data-testid="chart-readout">
        {current ? `${current.label}: ${format(current.value)}` : ''}
      </p>
      <button type="button" className="mt-3 min-h-11 text-sm text-muted-foreground underline" aria-expanded={tableOpen} onClick={() => setTableOpen(!tableOpen)}>
        {tableOpen ? hideTable : showTable}
      </button>
      {tableOpen && (
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{tableLabel}</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th scope="col" className="p-1 text-start font-medium">{xHeading}</th>
              <th scope="col" className="p-1 text-end font-medium">{title}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={`${point.label}-${index}`} className="border-t border-border">
                <td className="p-1">{point.label}</td>
                <td className="p-1 text-end tabular-nums">{format(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
