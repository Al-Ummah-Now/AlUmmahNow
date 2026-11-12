/**
 * Two sources per day as lines (Bunny solid with circles, R2 dashed with
 * squares), server-rendered SVG in the style of the Errors page charts:
 * a 0-based value axis on round ticks (shared niceScale), the value axis on
 * the reading side (right in Arabic) and time running from it. A day with
 * no plays is a gap. Hover shows each point; a <details> table is the text
 * alternative.
 */
import { chartLocale, labelIndices, niceScale } from '@al-ummah/shared-types';
import { deliveryFormats } from './format';

export type ChartUnit = 'seconds' | 'ratio' | 'count' | 'kbps';

export interface DailyChartProps {
  title: string;
  days: readonly string[];
  bunny: readonly (number | null)[];
  r2: readonly (number | null)[];
  unit: ChartUnit;
  /** What the x keys are: days (default) or minutes (the live view, shown as UTC times) */
  xKind?: 'day' | 'minute';
  locale: string;
  labels: { chart: string; table: string; day: string; bunny: string; r2: string; legendBunny: string; legendR2: string; empty: string; noValue: string };
  testId: string;
}

const W = 640;
const H = 200;
const AXIS = 56;
const PAD = 14;
const TOP = 12;
const BOTTOM = 28;

export const SERIES = {
  bunny: { color: 'var(--chart-1)', dash: undefined },
  r2: { color: 'var(--chart-2)', dash: '6 4' },
} as const;

function Marker({ kind, x, y, title }: { kind: 'bunny' | 'r2'; x: number; y: number; title?: string }) {
  const fill = SERIES[kind].color;
  const content = title ? <title>{title}</title> : null;
  return kind === 'bunny' ? (
    <circle cx={x} cy={y} r={3.5} style={{ fill }} data-series="bunny">{content}</circle>
  ) : (
    <rect x={x - 3.5} y={y - 3.5} width={7} height={7} style={{ fill }} data-series="r2">{content}</rect>
  );
}

/** Swatch for the legend: the line style and the marker of a series. */
export function SeriesSwatch({ kind }: { kind: 'bunny' | 'r2' }) {
  return (
    <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true" className="shrink-0">
      <line x1="0" y1="5" x2="28" y2="5" style={{ stroke: SERIES[kind].color }} strokeWidth="2" strokeDasharray={SERIES[kind].dash} />
      <Marker kind={kind} x={14} y={5} />
    </svg>
  );
}

export function DailyChart({ title, days, bunny, r2, unit, xKind = 'day', locale, labels, testId }: DailyChartProps) {
  const rtl = /^ar\b/.test(locale);
  const f = deliveryFormats(locale);
  // Ratios are drawn in percent so the ticks land on round percentages
  const toAxis = (v: number) => (unit === 'ratio' ? v * 100 : v);
  const present = [...bunny, ...r2].filter((v): v is number => v !== null && Number.isFinite(v));
  const scale = niceScale(present.map(toAxis), { target: 4 });
  const tickNumber = new Intl.NumberFormat(chartLocale(locale), { maximumFractionDigits: 2 });
  const plain = (v: number) => (unit === 'count' ? f.integer(v) : unit === 'kbps' ? f.kbps(v) : f.seconds(v));
  const tickText = (v: number) => (unit === 'ratio' ? f.percent(v / 100) : plain(v));
  const valueText = (v: number | null) => (v === null ? labels.noValue : unit === 'ratio' ? f.percent(v) : plain(v));
  const xText = (key: string) => (xKind === 'minute' ? f.time(key) : f.day(key));

  const plotStart = rtl ? PAD : AXIS;
  const plotEnd = rtl ? W - AXIS : W - PAD;
  const n = days.length;
  const step = n > 1 ? (plotEnd - plotStart) / (n - 1) : 0;
  const x = (i: number) => (n > 1 ? (rtl ? plotEnd - i * step : plotStart + i * step) : (plotStart + plotEnd) / 2);
  const y = (v: number) => TOP + (1 - toAxis(v) / scale.top) * (H - TOP - BOTTOM);

  /** Runs of consecutive days with a value: one polyline each (a missing day is a gap). */
  const runs = (values: readonly (number | null)[]) => {
    const out: string[] = [];
    let current: string[] = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (current.length > 1) out.push(current.join(' '));
        current = [];
        return;
      }
      current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    if (current.length > 1) out.push(current.join(' '));
    return out;
  };

  const ticksAt = labelIndices(n, 5);
  const empty = present.length === 0;

  return (
    <figure className="m-0" data-testid={testId}>
      <figcaption className="mb-2 font-medium text-fg">{title}</figcaption>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted" data-testid={`${testId}-legend`}>
        <li className="flex items-center gap-2"><SeriesSwatch kind="bunny" />{labels.legendBunny}</li>
        <li className="flex items-center gap-2"><SeriesSwatch kind="r2" />{labels.legendR2}</li>
      </ul>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-fg-muted" style={{ direction: 'ltr' }} role="img" aria-label={labels.chart}>
          {scale.ticks.map((v) => (
            <g key={v}>
              <line
                x1={plotStart}
                x2={plotEnd}
                y1={y(unit === 'ratio' ? v / 100 : v)}
                y2={y(unit === 'ratio' ? v / 100 : v)}
                style={{ stroke: v === 0 ? 'var(--fg-muted)' : 'var(--border)' }}
                strokeDasharray={v === 0 ? undefined : '3 3'}
                strokeWidth="1"
              />
              <text
                x={rtl ? plotEnd + 6 : plotStart - 6}
                y={y(unit === 'ratio' ? v / 100 : v)}
                textAnchor={rtl ? 'start' : 'end'}
                dominantBaseline="middle"
                fontSize="11"
                fill="currentColor"
                data-testid={`${testId}-y-tick`}
                data-value={tickNumber.format(v)}
              >
                {tickText(v)}
              </text>
            </g>
          ))}
          {ticksAt.map((i, order) => (
            <text
              key={days[i]}
              x={x(i)}
              y={H - 8}
              fontSize="11"
              fill="currentColor"
              textAnchor={order === 0 ? (rtl ? 'end' : 'start') : order === ticksAt.length - 1 ? (rtl ? 'start' : 'end') : 'middle'}
              data-testid={`${testId}-x-tick`}
            >
              {xText(days[i])}
            </text>
          ))}
          {!empty &&
            (['bunny', 'r2'] as const).map((kind) => {
              const values = kind === 'bunny' ? bunny : r2;
              const name = kind === 'bunny' ? labels.bunny : labels.r2;
              return (
                <g key={kind} data-testid={`${testId}-series-${kind}`}>
                  {runs(values).map((points, k) => (
                    <polyline key={k} points={points} fill="none" style={{ stroke: SERIES[kind].color }} strokeWidth="2" strokeDasharray={SERIES[kind].dash} strokeLinejoin="round" />
                  ))}
                  {values.map((v, i) => (v === null ? null : <Marker key={days[i]} kind={kind} x={x(i)} y={y(v)} title={`${name} · ${xText(days[i])}: ${valueText(v)}`} />))}
                </g>
              );
            })}
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
              <th scope="col" className="p-1 text-start font-medium">{labels.day}</th>
              <th scope="col" className="p-1 text-end font-medium">{labels.bunny}</th>
              <th scope="col" className="p-1 text-end font-medium">{labels.r2}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day, i) => (
              <tr key={day} className="border-t border-border">
                <th scope="row" className="p-1 text-start font-normal">{xText(day)}</th>
                <td className="p-1 text-end tabular-nums">{valueText(bunny[i] ?? null)}</td>
                <td className="p-1 text-end tabular-nums">{valueText(r2[i] ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
