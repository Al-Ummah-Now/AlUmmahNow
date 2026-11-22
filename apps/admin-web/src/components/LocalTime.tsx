'use client';

import { useSyncExternalStore } from 'react';
import { useOptionalLocale } from '@/i18n/I18nProvider';
import type { Locale } from '@/i18n/config';
import { formatClock, formatDate, formatHourTick, formatTime, formatUtc, zoneLabel } from '@/i18n/translate';

const noSubscribe = () => () => {};

/** The browser's zone ("America/New_York"); "UTC" when Intl can't say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The zone to render in: the server has no viewer zone, so it renders UTC (named "UTC"), and the
 * browser switches to its own zone straight after hydration (the same text on both sides first).
 */
function useZone(): string {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  return inBrowser ? browserTimeZone() : 'UTC';
}

function useLocale(localeProp?: Locale | string): Locale {
  const context = useOptionalLocale();
  return localeProp === 'ar' || localeProp === 'en' ? localeProp : (context ?? 'en');
}

const WHOLE = { whole: true } as const;

/**
 * A time in the admin (owner, 2026-11-21): the viewer's local time with its zone ("Nov 22, 2026,
 * 2:20 PM EST", «غرينتش-٥»), and the UTC time as the hover title, to compare with logs. A date alone
 * by default; `withTime` adds the time, `clock` shows seconds (log lines, "updated" stamps; the date
 * too with `withTime`), `timeOnly` the time without the date ("next try at"). The date and the time
 * each stay whole, so a narrow cell breaks only between them (AUDIT-2). One formatter for every admin
 * time: i18n/translate.
 */
export function LocalTime({ value, withTime = false, clock = false, timeOnly = false, className, locale: localeProp, testId }: {
  value: string | number | Date;
  withTime?: boolean;
  clock?: boolean;
  timeOnly?: boolean;
  className?: string;
  locale?: Locale | string;
  testId?: string;
}) {
  const locale = useLocale(localeProp);
  const zone = useZone();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return <>{String(value)}</>;
  const text = timeOnly
    ? formatTime(value, locale, zone, WHOLE)
    : clock
      ? formatClock(value, locale, withTime, zone, WHOLE)
      : formatDate(value, locale, withTime, zone, WHOLE);
  // Every time has its UTC moment on hover (a tooltip never wraps, so plain spaces); a calendar day
  // ("2026-11-21") has none (formatUtc gives '')
  const utc = formatUtc(value, locale, { seconds: clock });
  return (
    <time dateTime={typeof value === 'string' ? value : date.toISOString()} title={utc || undefined} className={className} data-testid={testId}>
      {text}
    </time>
  );
}

/** An hour on a chart axis in the admin's zone, without the zone (the chart's heading names it via LocalZoneName). */
export function LocalHour({ value }: { value: string }) {
  const locale = useLocale();
  const zone = useZone();
  return <time dateTime={value}>{formatHourTick(value, locale, zone)}</time>;
}

/** The admin's zone name now: "EST", «غرينتش-٥». */
export function LocalZoneName() {
  const locale = useLocale();
  const zone = useZone();
  return <>{zoneLabel(new Date(), zone, locale)}</>;
}
