'use client';

/**
 * Clear statuses: a chip that says the state in words, and a relative time
 * ("3 minutes ago") whose exact date and time is the hover title.
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatExact, formatRelative } from '@/lib/list/relative-time';
import { Chip, type ChipTone } from '@/components/content/parts';

export type { ChipTone };

/** `<time>` with "x ago" (refreshed every minute) and the exact time as its title. */
export function RelativeTime({ value, className = '' }: { value: string | number | Date; className?: string }) {
  const { locale } = useLanguage();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    // The server and the browser render "now" a moment apart
    <time dateTime={date.toISOString()} title={formatExact(date, locale)} className={className} suppressHydrationWarning>
      {formatRelative(date, locale, now)}
    </time>
  );
}

/** A status in words, optionally with when it last changed. */
export function StatusChip({ tone, label, at, testId }: { tone: ChipTone; label: string; at?: string | null; testId?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Chip tone={tone} testId={testId}>
        {label}
      </Chip>
      {at && <RelativeTime value={at} className="text-xs text-fg-muted" />}
    </span>
  );
}
