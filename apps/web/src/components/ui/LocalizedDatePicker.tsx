'use client';

/**
 * A date picker in the page's language: the chosen date as text («الاثنين، ١٦ نوفمبر ٢٠٢٦»,
 * "Mon, Nov 16, 2026") on a button with one calendar icon, opening a month grid under it.
 * Replaces <input type="date">, whose format and digits follow the browser, not the page, and
 * which adds its own icon. The grid is the WAI-ARIA date picker pattern: arrows move a day or
 * a week, Page Up/Down a month, Home/End the week's start/end, Enter or Space picks, Escape closes.
 * Values are "YYYY-MM-DD" (calendar dates, no zone).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { dateTimeFormat, numberFormat } from '@al-ummah/shared-types';

export interface LocalizedDatePickerProps {
  /** "YYYY-MM-DD" or '' */
  value: string;
  onChange: (value: string) => void;
  locale: 'en' | 'ar';
  /** Visible label text */
  label: string;
  /** Inclusive bounds, "YYYY-MM-DD" */
  min?: string;
  max?: string;
  placeholder: string;
  prevMonthLabel: string;
  nextMonthLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  testId?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromIso = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const addMonths = (d: Date, n: number) => {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), Math.min(d.getUTCDate(), last)));
};

/** The week starts on Saturday in Arabic, on Sunday in English. */
const weekStart = (locale: 'en' | 'ar') => (locale === 'ar' ? 6 : 0);

/** A calendar date as people read it, in the page's digits. */
export function formatPickedDate(value: string, locale: 'en' | 'ar'): string {
  const d = fromIso(value);
  return d ? dateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).format(d) : '';
}

export function LocalizedDatePicker({
  value, onChange, locale, label, min, max, placeholder, prevMonthLabel, nextMonthLabel, disabled, invalid, describedBy, testId = 'date-picker',
}: LocalizedDatePickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selected = fromIso(value);
  const minD = min ? fromIso(min) : null;
  const maxD = max ? fromIso(max) : null;
  const clamp = (d: Date) => (minD && d < minD ? minD : maxD && d > maxD ? maxD : d);
  const [focus, setFocus] = useState<Date>(() => clamp(selected ?? minD ?? new Date(Date.UTC(2026, 0, 1))));
  const grid = useRef<HTMLTableElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (open) setFocus(clamp(selected ?? minD ?? focus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open || !moved.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${isoDay(focus)}"]`)?.focus();
  }, [focus, open]);

  const monthTitle = dateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(focus);
  const dayNumber = numberFormat(locale, { useGrouping: false });
  const fullDate = dateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'full' });
  const weekdays = useMemo(() => {
    const fmt = dateTimeFormat(locale, { timeZone: 'UTC', weekday: 'narrow' });
    const long = dateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' });
    // 2023-01-01 was a Sunday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.UTC(2023, 0, 1 + ((weekStart(locale) + i) % 7)));
      return { short: fmt.format(d), long: long.format(d) };
    });
  }, [locale]);

  const first = new Date(Date.UTC(focus.getUTCFullYear(), focus.getUTCMonth(), 1));
  const lead = (first.getUTCDay() - weekStart(locale) + 7) % 7;
  const start = addDays(first, -lead);
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  const outOfRange = (d: Date) => Boolean((minD && d < minD) || (maxD && d > maxD));
  // Another month has a day in range
  const canPrev = !minD || first > minD;
  const canNext = !maxD || new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)) <= maxD;

  const move = (d: Date) => {
    moved.current = true;
    setFocus(clamp(d));
  };
  const pick = (d: Date) => {
    if (outOfRange(d)) return;
    onChange(isoDay(d));
    setOpen(false);
    moved.current = false;
    button.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const rtl = locale === 'ar';
    const map: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focus, rtl ? 1 : -1),
      ArrowRight: () => addDays(focus, rtl ? -1 : 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      Home: () => addDays(focus, -((focus.getUTCDay() - weekStart(locale) + 7) % 7)),
      End: () => addDays(focus, 6 - ((focus.getUTCDay() - weekStart(locale) + 7) % 7)),
    };
    if (map[e.key]) {
      e.preventDefault();
      move(map[e.key]());
    }
  };
  // Escape closes the calendar wherever focus is inside the picker, the date button included: a mouse
  // opens it with focus left on the button, and Escape must close it there too
  const onPickerKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    moved.current = false;
    button.current?.focus();
  };

  const text = value ? formatPickedDate(value, locale) : placeholder;
  return (
    <div className="space-y-1" data-testid={testId} onKeyDown={onPickerKey}>
      <span id={`${id}-label`} className="block text-xs text-muted-foreground">{label}</span>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-dialog` : undefined}
        aria-labelledby={`${id}-label ${id}-value`}
        data-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-start text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 data-[invalid=true]:border-[var(--fanous-color-error-text)]"
        data-testid={`${testId}-button`}
      >
        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span id={`${id}-value`} className={value ? '' : 'text-muted-foreground'}>{text}</span>
      </button>
      {open && (
        <div
          id={`${id}-dialog`}
          role="dialog"
          aria-modal="false"
          aria-label={label}
          className="min-w-0 max-w-full rounded-md border border-input bg-[var(--fanous-color-surface-raised)] p-2 shadow-md sm:p-3"
          data-testid={`${testId}-calendar`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button type="button" onClick={() => move(addMonths(focus, -1))} disabled={!canPrev} aria-label={prevMonthLabel}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-[var(--fanous-color-surface)] disabled:opacity-40" data-testid={`${testId}-prev`}>
              {locale === 'ar' ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
            </button>
            <h3 aria-live="polite" className="text-sm font-semibold" id={`${id}-month`}>{monthTitle}</h3>
            <button type="button" onClick={() => move(addMonths(focus, 1))} disabled={!canNext} aria-label={nextMonthLabel}
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-[var(--fanous-color-surface)] disabled:opacity-40" data-testid={`${testId}-next`}>
              {locale === 'ar' ? <ChevronLeft className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          <table ref={grid} role="grid" aria-labelledby={`${id}-month`} className="w-full table-fixed border-collapse text-center text-sm" onKeyDown={onKey}>
            <thead>
              <tr>
                {weekdays.map((w) => (
                  <th key={w.long} scope="col" abbr={w.long} className="pb-1 text-xs font-medium text-muted-foreground">{w.short}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={isoDay(week[0])}>
                  {week.map((d) => {
                    const iso = isoDay(d);
                    const inMonth = d.getUTCMonth() === focus.getUTCMonth();
                    const isSelected = value === iso;
                    const isFocus = isoDay(focus) === iso;
                    const off = outOfRange(d);
                    return (
                      <td key={iso} role="gridcell" aria-selected={isSelected || undefined} className="p-px">
                        <button
                          type="button"
                          data-day={iso}
                          tabIndex={isFocus ? 0 : -1}
                          disabled={off}
                          aria-label={fullDate.format(d)}
                          onClick={() => pick(d)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              pick(d);
                            }
                          }}
                          className={`mx-auto grid aspect-square w-full max-w-9 min-w-0 place-items-center rounded-full ${
                            isSelected
                              ? 'bg-[var(--fanous-color-primary)] font-semibold text-[var(--fanous-color-on-primary)]'
                              : 'hover:bg-[var(--fanous-color-surface)]'
                          } ${inMonth ? '' : 'text-muted-foreground'} disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fanous-color-link)]`}
                        >
                          {dayNumber.format(d.getUTCDate())}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
