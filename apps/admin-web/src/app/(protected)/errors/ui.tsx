/**
 * Presentational pieces of the Errors pages (server and client safe).
 */

import { compactNumber, localizeDigits, niceScale, numberFormat } from '@al-ummah/shared-types';
import { translateDynamic, type Translator } from '@/i18n/translate';

/** The error's message as its title; the type ("UploadError") is shown apart, as a technical detail (errorType). */
export function errorTitle(g: { name: string | null; message: string }): string {
  return g.message || g.name || '';
}

/** The type when the message doesn't already say it ("UploadError"), or null. */
export function errorType(g: { name: string | null; message: string }): string | null {
  return g.name && !g.message.startsWith(g.name) ? g.name : null;
}

/** Which app reported it, in words ("Al Ummah Now Tools", «أدوات الأمة الآن»); an unknown one as it is. */
export const appName = (t: Translator, app: string) => translateDynamic(t, 'errorsPage.apps', app);

/**
 * A browser or OS as the reader says it: "Windows 11" / «ويندوز ١١». The family name comes from the
 * messages (unknown ones stay as written) and the version takes the locale's digits.
 */
export function platformName(t: Translator, locale: string, value: string): string {
  const m = /^(.*?)\s*(\d[\d.]*)?$/.exec(value.trim());
  const family = m?.[1] || value.trim();
  const named = translateDynamic(t, 'errorsPage.platforms', family);
  return m?.[2] ? `${named} ${localizeDigits(locale, m[2])}` : named;
}

/** The environment in words ("Production", «الإنتاج»). */
export const environmentName = (t: Translator, environment: string) => translateDynamic(t, 'errorsPage.environments', environment);

/** A language code in the page language ("ar" → "Arabic", «العربية»). */
export function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
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
/** Daily counts, oldest first. Time runs like the Studio and admin charts: left to right in
 *  English, right to left in Arabic (`rtl`), so today is at the reading end in both. */
export function Sparkline({ values, label, width = 112, height = 28, rtl = false }: { values: number[]; label: string; width?: number; height?: number; rtl?: boolean }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => `${(rtl ? width - i * step : i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
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
 * count (CSS), and a <details> table is the text alternative. Hours are in the admin's zone (LocalHour).
 */
/**
 * Hours to label on the time axis, evenly apart and counted back from the latest hour: every 12 hours of 48,
 * every 6 of 24 (AUDIT-2: uneven 8/7/8-hour gaps read as missing data).
 */
export function hourTicks(length: number): number[] {
  if (length <= 0) return [];
  const step = length >= 36 ? 12 : length >= 18 ? 6 : Math.max(1, Math.round(length / 4));
  const picked: number[] = [];
  for (let i = length - 1; i >= 0; i -= step) picked.unshift(i);
  return picked;
}

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
  axisNote,
}: {
  hours: { hour: string; occurrences: number }[];
  label: string;
  barTitle: (h: { hour: string; occurrences: number }) => React.ReactNode;
  locale: string;
  /** Short label for an hour on the time axis */
  hourLabel: (hour: string) => React.ReactNode;
  tableLabel: string;
  hourHeading: React.ReactNode;
  countHeading: string;
  emptyText: string;
  /** Under the time axis: which zone its hours are in ("Times in EST") */
  axisNote?: React.ReactNode;
}) {
  const scale = niceScale(hours.map((h) => h.occurrences), { integer: true, target: 3 });
  const tick = compactNumber(locale);
  const number = numberFormat(locale);
  const empty = hours.every((h) => !h.occurrences);
  const y = (value: number) => 100 - (value / scale.top) * 100;
  const ticksAt = hourTicks(hours.length);
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
                <div key={h.hour} className="group relative flex h-full flex-1 items-end">
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
              // Each label centres on its bar; one near an edge hugs that edge instead. Logical insets only: a
              // physical translateX pushed the last label off the page in Arabic. On a phone only the first and
              // the last show (the date labels would run into each other).
              const nearStart = at < 12;
              const nearEnd = at > 88;
              const place = nearStart ? { insetInlineStart: 0 } : nearEnd ? { insetInlineEnd: 0 } : { insetInlineStart: `${at}%` };
              const phone = order === 0 || order === ticksAt.length - 1;
              return (
                <span key={index} className={`absolute whitespace-nowrap ${phone ? '' : 'hidden sm:block'} ${nearStart || nearEnd ? '' : '-translate-x-1/2 rtl:translate-x-1/2'}`} style={place} data-testid="error-hourly-x-tick">
                  {hourLabel(hours[index].hour)}
                </span>
              );
            })}
          </div>
          {axisNote && <p className="mt-1 text-xs text-fg-muted" data-testid="error-hourly-zone">{axisNote}</p>}
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
