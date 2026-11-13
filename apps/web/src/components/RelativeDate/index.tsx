'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { formatAbsoluteDateTime, formatRelativeTime, type MetaLang } from '@/lib/format/videoMeta';

/** What the date is: a date never sits bare beside the views (owner, 2026-11-13). */
export type DateLabel = 'published' | 'updated' | 'started' | 'ended';

interface RelativeDateProps {
  value: Date | string | number | null | undefined;
  lang: MetaLang;
  /** Prefix the relative time with what it is («نُشر قبل يوم واحد», "Published 1 day ago") */
  label?: DateLabel;
}

/**
 * A relative time ("17 hours ago", «قبل 17 ساعة»), with its label, and the exact date and time as
 * its tooltip («12 نوفمبر 2026، 06:32 م»): `title` on hover, and `data-tip` shown by CSS while the
 * control around it has keyboard focus (theme/system.css .rel-date).
 */
export function RelativeDate({ value, lang, label }: RelativeDateProps) {
  const { t } = useLanguage();
  const relative = formatRelativeTime(value, lang);
  if (!relative) return null;
  const date = new Date(value as string | number | Date);
  const exact = formatAbsoluteDateTime(date, lang);
  const text = label ? (t.video?.dateLabel?.[label] ?? '{time}').replace('{time}', relative) : relative;
  // Relative text depends on the clock, so server and browser can differ by a unit
  return (
    <time className="rel-date" dateTime={date.toISOString()} title={exact} data-tip={exact} suppressHydrationWarning>
      {text}
    </time>
  );
}
