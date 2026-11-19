'use client';

/**
 * The admin's own calendar (#1598), opened by the date field's calendar button. The browser's
 * picker follows the browser's language (English months, 0–9 on an Arabic page) and cannot be
 * styled or reviewed; this one is ours:
 *
 * - month and year heading with previous/next month buttons (mirrored right to left);
 * - weekday initials and a day grid in the admin's language and digits (Gregorian months; the
 *   week starts on the locale's first day: Saturday in Arabic, Sunday in English);
 * - Today, and Clear when the field is optional; days outside min/max are greyed and refused;
 * - with a time: 24-hour hour and minute spinbuttons and Done;
 * - WAI-ARIA date picker dialog: arrows move a day (or a week), Home/End the week's ends,
 *   PageUp/PageDown a month (Shift: a year), Enter or Space picks, Esc closes; Tab stays inside.
 *
 * A panel under the field on wider screens, a bottom sheet over a dimmed page on a phone.
 * `locale` and `t` come in as props so it renders without the language provider (tests).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { dateTimeFormat, numberFormat } from '@al-ummah/shared-types';
import type { Translator } from '@/i18n/translate';
import { addMonths, keyTarget, monthGrid, monthOf, outOfRange, startDay, todayIso, toUtc, weekStart, weekdayOrder } from './calendar';

export interface CalendarPanelProps {
  id: string;
  locale: string;
  t: Translator;
  /** The chosen day ("YYYY-MM-DD") or '' */
  value: string;
  /** With a time: the chosen hour and minute (24-hour); null for a date field */
  time: { h: number; m: number } | null;
  min?: string;
  max?: string;
  required?: boolean;
  /** Today's day, injectable for tests */
  today?: string;
  onPickDay: (iso: string) => void;
  onTime?: (h: number, m: number) => void;
  onClear: () => void;
  /** Close and give focus back to the calendar button */
  onClose: () => void;
}

/** A chevron toward the start (previous) or the end (next) of the line, mirrored right to left. */
const chevron = (to: 'start' | 'end') => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-5 ${to === 'start' ? 'rtl:rotate-180' : 'rotate-180 rtl:rotate-0'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const iconButton = 'grid size-10 place-items-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
const textButton = 'rounded-lg px-3 py-2 text-sm font-medium text-link hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 disabled:cursor-not-allowed';

export function CalendarPanel({ id, locale, t, value, time, min, max, required, today = todayIso(), onPickDay, onTime, onClear, onClose }: CalendarPanelProps) {
  const rtl = locale === 'ar';
  const firstDay = weekStart(locale);
  const [focused, setFocused] = useState(() => startDay(value, today, min, max));
  const month = monthOf(focused);
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLTableElement>(null);
  const moved = useRef(false);

  const fmt = useMemo(
    () => ({
      month: dateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      full: dateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
      weekdayShort: dateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }),
      weekdayLong: dateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }),
      day: numberFormat(locale, { useGrouping: false }),
      two: numberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false }),
    }),
    [locale],
  );
  // 2026-11-01 is a Sunday: day d of that week is weekday d
  const weekdayDate = (d: number) => new Date(Date.UTC(2026, 10, 1 + d));
  const weeks = monthGrid(month, firstDay);
  const headingId = `${id}-heading`;

  // Focus the day on open, and follow it when the keyboard moves it
  useEffect(() => {
    const target = grid.current?.querySelector<HTMLButtonElement>(`button[data-day="${focused}"]`);
    if (target && (moved.current || !panel.current?.contains(document.activeElement))) target.focus();
    moved.current = false;
  }, [focused]);

  const go = (iso: string) => {
    moved.current = true;
    setFocused(iso);
  };

  const onDayKey = (e: React.KeyboardEvent<HTMLButtonElement>, iso: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!outOfRange(iso, min, max)) onPickDay(iso);
      return;
    }
    const next = keyTarget(iso, e.key, { rtl, firstDay, shift: e.shiftKey });
    if (next) {
      e.preventDefault();
      go(next);
    }
  };

  // The dialog keeps focus: Esc closes, Tab and Shift+Tab cycle its controls
  const onPanelKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [role="spinbutton"]')].filter((el) => el.tabIndex >= 0);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const todayAllowed = !outOfRange(today, min, max);
  // A month entirely outside min/max is not offered
  const prevAllowed = !min || addMonths(month, -1).slice(0, 7) >= min.slice(0, 7);
  const nextAllowed = !max || addMonths(month, 1).slice(0, 7) <= max.slice(0, 7);

  return (
    <>
      {/* Phone: the sheet dims the page behind it; a tap there closes it */}
      <div className="fixed inset-0 z-40 bg-bg/70 sm:hidden" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={onPanelKey}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-fg shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:end-0 sm:top-full sm:mt-1 sm:max-h-none sm:w-80 sm:rounded-lg sm:p-3"
        data-testid={`${id}-panel`}
      >
        <div className="flex items-center justify-between gap-2">
          <button type="button" className={iconButton} onClick={() => setFocused(addMonths(focused, -1))} disabled={!prevAllowed} aria-label={t('dateField.prevMonth')} data-testid={`${id}-prev`}>
            {chevron('start')}
          </button>
          <h2 id={headingId} className="text-base font-semibold" aria-live="polite" data-testid={`${id}-month`}>
            {fmt.month.format(toUtc(month))}
          </h2>
          <button type="button" className={iconButton} onClick={() => setFocused(addMonths(focused, 1))} disabled={!nextAllowed} aria-label={t('dateField.nextMonth')} data-testid={`${id}-next`}>
            {chevron('end')}
          </button>
        </div>

        <table ref={grid} role="grid" aria-labelledby={headingId} className="mt-2 w-full table-fixed border-collapse text-center">
          <thead>
            <tr>
              {weekdayOrder(firstDay).map((d) => (
                <th key={d} scope="col" abbr={fmt.weekdayLong.format(weekdayDate(d))} className="h-8 text-xs font-medium text-fg-muted">
                  {fmt.weekdayShort.format(weekdayDate(d))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>
                {week.map((day, i) => {
                  if (!day) return <td key={i} />;
                  const selected = day === value;
                  const disabled = outOfRange(day, min, max);
                  return (
                    <td key={day} role="gridcell" aria-selected={selected} className="p-0.5">
                      <button
                        type="button"
                        data-day={day}
                        tabIndex={day === focused ? 0 : -1}
                        aria-label={fmt.full.format(toUtc(day))}
                        aria-current={day === today ? 'date' : undefined}
                        aria-disabled={disabled || undefined}
                        onClick={() => !disabled && onPickDay(day)}
                        onKeyDown={(e) => onDayKey(e, day)}
                        onFocus={() => day !== focused && setFocused(day)}
                        className={`mx-auto grid size-10 place-items-center rounded-full text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                          selected ? 'bg-accent font-semibold text-on-accent' : disabled ? 'cursor-not-allowed text-fg-subtle line-through decoration-fg-subtle/60' : 'hover:bg-surface-hover'
                        } ${day === today && !selected ? 'border border-accent font-semibold' : ''}`}
                      >
                        {fmt.day.format(toUtc(day).getUTCDate())}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {time && onTime && (
          <div className="mt-3 flex items-center justify-center gap-2 border-t border-border pt-3" dir="ltr" data-testid={`${id}-time`}>
            <Spin label={t('dateField.hour')} value={time.h} max={23} format={fmt.two} onChange={(h) => onTime(h, time.m)} testId={`${id}-hour`} more={t('dateField.more')} less={t('dateField.less')} />
            <span aria-hidden="true" className="text-lg font-semibold">:</span>
            <Spin label={t('dateField.minute')} value={time.m} max={59} format={fmt.two} onChange={(m) => onTime(time.h, m)} testId={`${id}-minute`} more={t('dateField.more')} less={t('dateField.less')} />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <button
            type="button"
            className={textButton}
            disabled={!todayAllowed}
            onClick={() => {
              setFocused(today);
              onPickDay(today);
            }}
            data-testid={`${id}-today`}
          >
            {t('dateField.today')}
          </button>
          <div className="flex items-center gap-2">
            {!required && (
              <button type="button" className={textButton} onClick={onClear} data-testid={`${id}-clear`}>
                {t('dateField.clear')}
              </button>
            )}
            {!time && (
              <button type="button" className={textButton} onClick={onClose} data-testid={`${id}-close`}>
                {t('dateField.close')}
              </button>
            )}
            {time && (
              <button type="button" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2" onClick={onClose} data-testid={`${id}-done`}>
                {t('dateField.done')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * A 24-hour hour or minute (WAI-ARIA spinbutton): Up/Down step by one (wrapping), PageUp/PageDown
 * by ten, Home/End the ends; digits in either set type a value. Shown in the admin's digits.
 */
function Spin({ label, value, max, format, onChange, testId, more, less }: { label: string; value: number; max: number; format: Intl.NumberFormat; onChange: (v: number) => void; testId: string; more: string; less: string }) {
  const typed = useRef('');
  const wrap = (v: number) => ((v % (max + 1)) + (max + 1)) % (max + 1);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
    if (e.key in steps) {
      e.preventDefault();
      onChange(wrap(value + steps[e.key]!));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      onChange(e.key === 'Home' ? 0 : max);
      return;
    }
    const digit = /^[0-9٠-٩۰-۹]$/.test(e.key) ? e.key.charCodeAt(0) & 0xf : null;
    if (digit === null) return;
    e.preventDefault();
    typed.current = (typed.current + digit).slice(-2);
    const n = Number(typed.current);
    onChange(n > max ? digit : n);
  };
  const step = 'grid h-7 w-14 place-items-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg';
  return (
    <div className="flex flex-col items-center">
      <button type="button" tabIndex={-1} className={step} aria-label={`${more}: ${label}`} onClick={() => onChange(wrap(value + 1))}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 15 6-6 6 6" /></svg>
      </button>
      <div
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format.format(value)}
        onKeyDown={onKey}
        onBlur={() => (typed.current = '')}
        className="grid h-11 w-14 place-items-center rounded-lg border border-border bg-surface-2 text-xl font-semibold tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        data-testid={testId}
      >
        {format.format(value)}
      </div>
      <button type="button" tabIndex={-1} className={step} aria-label={`${less}: ${label}`} onClick={() => onChange(wrap(value - 1))}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </div>
  );
}
