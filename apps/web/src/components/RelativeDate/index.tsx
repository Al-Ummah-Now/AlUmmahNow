'use client';

import { formatAbsoluteDate, formatRelativeTime, type MetaLang } from '@/lib/format/videoMeta';

interface RelativeDateProps {
  value: Date | string | number | null | undefined;
  lang: MetaLang;
}

/** A relative time with the full date in a tooltip. */
export function RelativeDate({ value, lang }: RelativeDateProps) {
  const relative = formatRelativeTime(value, lang);
  if (!relative) return null;
  const date = new Date(value as string | number | Date);
  // Relative text depends on the clock, so server and browser can differ by a unit
  return <time dateTime={date.toISOString()} title={formatAbsoluteDate(date, lang)} suppressHydrationWarning>{relative}</time>;
}
