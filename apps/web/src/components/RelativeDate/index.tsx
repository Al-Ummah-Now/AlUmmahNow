'use client';

import { formatAbsoluteDateTime, formatRelativeTime, type MetaLang } from '@/lib/format/videoMeta';

interface RelativeDateProps {
  value: Date | string | number | null | undefined;
  lang: MetaLang;
}

/**
 * A relative time ("17 hours ago", «قبل 17 ساعة») with the exact date and time as its tooltip
 * («12 نوفمبر 2026، 06:32 م»): `title` on hover, and `data-tip` shown by CSS while the control
 * around it has keyboard focus (theme/pages.css .rel-date).
 */
export function RelativeDate({ value, lang }: RelativeDateProps) {
  const relative = formatRelativeTime(value, lang);
  if (!relative) return null;
  const date = new Date(value as string | number | Date);
  const exact = formatAbsoluteDateTime(date, lang);
  // Relative text depends on the clock, so server and browser can differ by a unit
  return (
    <time className="rel-date" dateTime={date.toISOString()} title={exact} data-tip={exact} suppressHydrationWarning>
      {relative}
    </time>
  );
}
