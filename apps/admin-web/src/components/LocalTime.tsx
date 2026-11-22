'use client';

/**
 * A time in the admin's own zone with the zone shown, and UTC on hover (owner, 2026-11-21;
 * lib/local-time.ts). The server does not know the browser's zone, so the first render (server and
 * hydration) is in UTC and the browser's zone follows right after: the same text on both sides.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatLocalTime } from '@/lib/local-time';

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function LocalTime({ value, date = true, seconds = false, className, testId }: { value: string; date?: boolean; seconds?: boolean; className?: string; testId?: string }) {
  const { locale } = useLanguage();
  const [zone, setZone] = useState('UTC');
  useEffect(() => setZone(browserTimeZone()), []);
  const time = formatLocalTime(value, locale, zone, { date, seconds });
  if (!time) return null;
  return (
    <time dateTime={value} title={time.utc} className={className} data-testid={testId}>
      {time.text}
    </time>
  );
}
