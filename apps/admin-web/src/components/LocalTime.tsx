'use client';

/**
 * A time in the admin's own zone with the zone shown, and UTC on hover (owner, 2026-11-21;
 * lib/local-time.ts). The server does not know the browser's zone, so the first render (server and
 * hydration) is in UTC and the browser's zone follows right after: the same text on both sides.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatLocalHour, formatLocalTime, zoneLabel } from '@/lib/local-time';

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function useBrowserZone(): string {
  const [zone, setZone] = useState('UTC');
  useEffect(() => setZone(browserTimeZone()), []);
  return zone;
}

export function LocalTime({ value, date = true, seconds = false, className, testId }: { value: string | number; date?: boolean; seconds?: boolean; className?: string; testId?: string }) {
  const { locale } = useLanguage();
  const zone = useBrowserZone();
  const time = formatLocalTime(value, locale, zone, { date, seconds });
  if (!time) return null;
  return (
    <time dateTime={typeof value === 'number' ? new Date(value).toISOString() : value} title={time.utc} className={className} data-testid={testId}>
      {time.text}
    </time>
  );
}

/** An hour on a chart axis in the admin's zone, without the zone (the chart's heading names it via LocalZoneName). */
export function LocalHour({ value }: { value: string }) {
  const { locale } = useLanguage();
  const zone = useBrowserZone();
  const text = formatLocalHour(value, locale, zone);
  return text ? <time dateTime={value}>{text}</time> : null;
}

/** The admin's zone name now: "EST", «غرينتش-٥». */
export function LocalZoneName() {
  const { locale } = useLanguage();
  const zone = useBrowserZone();
  return <>{zoneLabel(new Date(), zone, locale)}</>;
}
