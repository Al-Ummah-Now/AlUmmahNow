'use client';

import { useSyncExternalStore } from 'react';
import { useOptionalLocale } from '@/i18n/I18nProvider';
import type { Locale } from '@/i18n/config';
import { formatClock, formatDate, formatUtc } from '@/i18n/translate';

const noSubscribe = () => () => {};

/**
 * A time in the admin: the viewer's local time with its zone, and the UTC time as the hover
 * title (owner, 2026-11-21). `clock` shows seconds (log lines, "updated" stamps), with the date
 * too when `withTime` is set. The server has no viewer zone, so it renders UTC (named "UTC"),
 * and the browser switches to the local zone straight after hydration.
 */
export function LocalTime({ value, withTime = false, clock = false, className, locale: localeProp }: { value: string | number | Date; withTime?: boolean; clock?: boolean; className?: string; locale?: Locale | string }) {
  const context = useOptionalLocale();
  const locale: Locale = localeProp === 'ar' || localeProp === 'en' ? localeProp : (context ?? 'en');
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return <>{String(value)}</>;
  const zone = inBrowser ? undefined : 'UTC';
  const text = clock ? formatClock(value, locale, withTime, zone) : formatDate(value, locale, withTime, zone);
  const utc = formatUtc(value, locale);
  return (
    <time dateTime={typeof value === 'string' ? value : date.toISOString()} title={utc || undefined} className={className}>
      {text}
    </time>
  );
}
