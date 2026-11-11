/**
 * Daily values per live provider as two lines on a 0-based value axis, built
 * on the shared chart scale (shared-types chart-scale: niceScale,
 * labelIndices, chartLocale) like the Errors hourly chart. Bunny is the solid
 * accent line, self-hosted the dashed one, so the two differ without colour.
 * Time runs from the axis side (left to right in English, right to left in
 * Arabic). A day without data is a gap, never a zero. Each point has a title
 * for hover, and a <details> table is the text alternative.
 */
import { labelIndices, niceScale } from '@al-ummah/shared-types';
import type { ChartSeries } from '@/lib/live-streaming';

const STYLE: Record<ChartSeries['provider'], { stroke: string; dash?: string; dot: string }> = {
  bunny: { stroke: 'stroke-accent', dot: 'fill-accent' },
  selfhosted: { stroke: 'stroke-info-fg', dash: '6 4', dot: 'fill-info-fg' },
};

export interface ProviderLineChartProps {
  days: string[];
  series: ChartSeries[];
  label: string;
  format: (value: number) => string;
  dayLabel: (day: string) => string;
  providerLabel: (provider: ChartSeries['provider']) => string;
  tableLabel: string;
  dayHeading: string;
  emptyText: string;
  testId: string;
  /** Right to left (Arabic): time runs from the right. */
  rtl: boolean;
}

export function ProviderLineChart({ days, series, label, format, dayLabel, providerLabel, tableLabel, dayHeading, emptyText, testId, rtl }: ProviderLineChartProps) {
  const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const scale = niceScale(values, { target: 4 });
  const empty = values.length === 0;
  const y = (value: number) => 100 - (value / scale.top) * 100;
  const x = (index: number) => (days.length <= 1 ? 50 : (index / (days.length - 1)) * 100);
  const ticksAt = labelIndices(days.length, 5);
  const tick = format;

  // A line breaks at a missing day
  const segments = (s: ChartSeries) => {
    const out: string[] = [];
    let current: string[] = [];
    s.values.forEach((v, i) => {
      if (v === null) {
        if (current.length) out.push(current.join(' '));
        current = [];
      } else current.push(`${x(i)},${y(v)}`);
    });
    if (current.length) out.push(current.join(' '));
    return out;
  };

  return (
    <figure className="m-0" data-testid={testId}>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium text-fg">{label}</span>
        {series.map((s) => (
          <span key={s.provider} className="inline-flex items-center gap-1 text-fg-muted">
            <svg width="24" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="24" y2="4" className={STYLE[s.provider].stroke} strokeWidth="2" strokeDasharray={STYLE[s.provider].dash} />
            </svg>
            {providerLabel(s.provider)}
          </span>
        ))}
      </figcaption>
      <div className="flex gap-2">
        <div className="relative h-40 shrink-0 text-xs tabular-nums text-fg-muted" aria-hidden="true">
          <div className="invisible whitespace-nowrap">{scale.ticks.map((v) => <div key={v} className="h-0 leading-none">{tick(v)}</div>)}</div>
          {scale.ticks.map((v) => (
            <span key={v} className="absolute end-0 -translate-y-1/2 whitespace-nowrap leading-none" style={{ top: `${y(v)}%` }} data-testid={`${testId}-y-tick`}>
              {tick(v)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-40" role="img" aria-label={label}>
            {scale.ticks.map((v) => (
              <div key={v} className={`absolute inset-x-0 border-t ${v === 0 ? 'border-fg-muted' : 'border-dashed border-border'}`} style={{ top: `${y(v)}%` }} aria-hidden="true" />
            ))}
            {!empty && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible rtl:-scale-x-100" aria-hidden="true">
                {series.map((s) =>
                  segments(s).map((points, i) => (
                    <polyline key={`${s.provider}-${i}`} points={points} fill="none" className={STYLE[s.provider].stroke} strokeWidth="2" strokeDasharray={STYLE[s.provider].dash} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                  )),
                )}
              </svg>
            )}
            {!empty &&
              series.map((s) =>
                s.values.map((v, i) =>
                  v === null ? null : (
                    <span
                      key={`${s.provider}-${days[i]}`}
                      className={`absolute h-2 w-2 -translate-y-1/2 rounded-full rtl:translate-x-1/2 ltr:-translate-x-1/2 ${s.provider === 'bunny' ? 'bg-accent' : 'bg-info-fg'}`}
                      style={{ insetInlineStart: `${x(i)}%`, top: `${y(v)}%` }}
                      title={`${providerLabel(s.provider)} · ${dayLabel(days[i])}: ${format(v)}`}
                      data-testid={`${testId}-point`}
                    />
                  ),
                ),
              )}
            {empty && <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-muted">{emptyText}</p>}
          </div>
          <div className="relative mt-1 h-4 text-xs text-fg-muted" aria-hidden="true">
            {ticksAt.map((index, order) => {
              // insetInlineStart runs from the right in Arabic, so the label shifts the other way there
              const sign = rtl ? '' : '-';
              const shift = order === 0 ? '0' : order === ticksAt.length - 1 ? `${sign}100%` : `${sign}50%`;
              return (
                <span key={index} className="absolute whitespace-nowrap" style={{ insetInlineStart: `${x(index)}%`, transform: `translateX(${shift})` }}>
                  {dayLabel(days[index])}
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-fg-muted underline">{tableLabel}</summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-fg-muted">
                <th scope="col" className="p-1 text-start font-medium">{dayHeading}</th>
                {series.map((s) => (
                  <th key={s.provider} scope="col" className="p-1 text-end font-medium">{providerLabel(s.provider)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day, i) => (
                <tr key={day} className="border-t border-border">
                  <td className="p-1">{dayLabel(day)}</td>
                  {series.map((s) => (
                    <td key={s.provider} className="p-1 text-end tabular-nums">{s.values[i] === null ? '—' : format(s.values[i]!)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
