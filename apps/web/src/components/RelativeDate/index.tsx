'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { useHydrated } from '@/hooks/useHydrated';
import { formatAbsoluteDateTime, formatRelativeTime, type MetaLang } from '@/lib/format/videoMeta';

/** What the date is: said in its tooltip and to screen readers, not on the line (YouTube style). */
export type DateLabel = 'published' | 'premiered' | 'updated' | 'started' | 'ended';

/** The tooltip of a relative date: its label and exact value («نُشر في 12 نوفمبر 2026، 06:32 م»). */
export function dateTooltip(t: { video?: { dateLabel?: Record<string, string> } }, label: DateLabel | undefined, exact: string): string {
  const template = label ? t.video?.dateLabel?.[label] : undefined;
  return template ? template.replace('{date}', exact) : exact;
}

interface RelativeDateProps {
  value: Date | string | number | null | undefined;
  lang: MetaLang;
  /** What the date is, in the tooltip and for screen readers («نُشر في …», "Published …") */
  label?: DateLabel;
}

/**
 * A relative time ("1 day ago", «قبل يوم واحد»), as YouTube shows it: the line stays short, and
 * hovering shows what the date is and its exact value («نُشر في 12 نوفمبر 2026، 06:32 م»).
 * Screen readers hear the labelled date too (visually hidden text), and the watch page shows the
 * same tooltip while its summary has keyboard focus (theme/system.css).
 */
export function RelativeDate({ value, lang, label }: RelativeDateProps) {
  const { t } = useLanguage();
  // The exact time is in UTC on the server and while hydrating (server-rendered lists), then the viewer's zone
  const timeZone = useHydrated() ? undefined : 'UTC';
  const relative = formatRelativeTime(value, lang);
  if (!relative) return null;
  const date = new Date(value as string | number | Date);
  const tip = dateTooltip(t as never, label, formatAbsoluteDateTime(date, lang, timeZone));
  // Relative text depends on the clock, so server and browser can differ by a unit
  return (
    <time className="rel-date" dateTime={date.toISOString()} title={tip} data-tip={tip} suppressHydrationWarning>
      {relative}
      {label && <span className="sr-only">{lang === 'ar' ? '، ' : ', '}{tip}</span>}
    </time>
  );
}
