'use client';

import { useState, type MouseEvent } from 'react';

export interface ChartPoint {
  label: string;
  value: number;
}

interface Props {
  title: string;
  points: readonly ChartPoint[];
  /** Fixed top of the scale, for percentages. Otherwise the largest value. */
  max?: number;
  format: (value: number) => string;
  /** Labels for the table alternative */
  tableLabel: string;
  xHeading: string;
  showTable: string;
  hideTable: string;
}

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 8, end: 8, bottom: 8, start: 8 };

/** One series over time. Hover or tap reads out a point, and a table is the alternative. Time always runs left to right. */
export function LineChart({ title, points, max, format, tableLabel, xHeading, showTable, hideTable }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const top = max ?? Math.max(1, ...points.map((point) => point.value));
  const innerW = WIDTH - PAD.start - PAD.end;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.start + (points.length > 1 ? (index / (points.length - 1)) * innerW : innerW / 2);
  const y = (value: number) => PAD.top + innerH - (value / top) * innerH;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
  const current = active === null ? null : points[active];

  const onMove = (event: MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setActive(Math.round(ratio * (points.length - 1)));
  };

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex min-h-6 items-center justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{title}</span>
        <span aria-hidden="true" className="tabular-nums text-muted-foreground" data-testid="chart-readout">
          {current ? `${current.label}: ${format(current.value)}` : ''}
        </span>
      </figcaption>
      <div dir="ltr" className="text-primary">
        <svg role="img" aria-label={`${title}. ${tableLabel}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-48 w-full" preserveAspectRatio="none">
          <line x1={PAD.start} x2={WIDTH - PAD.end} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          {active !== null && (
            <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={y(0)} className="stroke-muted-foreground" strokeWidth={1} vectorEffect="non-scaling-stroke" data-testid="chart-crosshair" />
          )}
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setActive(null)} onClick={onMove} data-testid="chart-hit" />
        </svg>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{points[0]?.label}</span>
          <span>{points[points.length - 1]?.label}</span>
        </div>
      </div>
      <button type="button" className="mt-2 min-h-11 text-sm text-muted-foreground underline" aria-expanded={tableOpen} onClick={() => setTableOpen(!tableOpen)}>
        {tableOpen ? hideTable : showTable}
      </button>
      {tableOpen && (
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{tableLabel}</caption>
          <thead>
            <tr className="text-muted-foreground">
              <th className="p-1 text-start font-medium">{xHeading}</th>
              <th className="p-1 text-end font-medium">{title}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label} className="border-t border-border">
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
