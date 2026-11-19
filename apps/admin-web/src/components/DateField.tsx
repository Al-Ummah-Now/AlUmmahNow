'use client';

/**
 * The admin's one date field (#1598). The browser's own `<input type="date">` paints its
 * placeholder and value in the browser's language ("yyyy/mm/dd", "mm/dd/yyyy", 0–9) whatever the
 * admin's language is, so an Arabic page showed Latin letters. Here the text is ours:
 *
 * - the value in the admin's digits: "2026-11-18" / «٢٠٢٦/١١/١٨» (locale-format, nu-arab in ar);
 * - the placeholder in the admin's language: "YYYY-MM-DD" / «سنة/شهر/يوم»;
 * - typing in either digit set (٠–٩ or 0–9), as year-month-day, day/month/year or 8 digits;
 * - a calendar button that opens our own calendar (CalendarPanel: the admin's language and digits,
 *   keyboard and screen reader friendly; the browser's picker followed the browser's language);
 * - a hidden `name` input carrying the ISO day, so GET filter forms and URLs stay as they were.
 *
 * DateTimeField (below) is the same field with a 24-hour time: "2026-11-18 14:30" / «٢٠٢٦/١١/١٨ ١٤:٣٠»,
 * placeholder "YYYY-MM-DD HH:MM" / «سنة/شهر/يوم س:د», value "YYYY-MM-DDTHH:mm" (datetime-local's).
 *
 * `onChange` gets the ISO day (or undefined when cleared) once a value is committed: on blur,
 * Enter, or a pick in the calendar. `submitOnChange` also submits the enclosing form then.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { dateTimeFormat, numberFormat } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';
import { CalendarPanel } from '@/components/date/CalendarPanel';
import { todayIso } from '@/components/date/calendar';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** Eastern Arabic (٠–٩) and Persian (۰–۹) digits as 0–9; everything else unchanged. */
export function toAsciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (c) => String(c.charCodeAt(0) & 0xf));
}

/** A real calendar day as "YYYY-MM-DD", or null. */
function isoOf(y: number, m: number, d: number): string | null {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Reads what the admin typed: "2026-11-18", «٢٠٢٦/١١/١٨», "18/11/2026", "20261118". Empty → '';
 * not a real day → null.
 */
export function parseDateInput(text: string): string | null {
  const t = toAsciiDigits(text).trim();
  if (!t) return '';
  if (/^\d{8}$/.test(t)) return isoOf(Number(t.slice(0, 4)), Number(t.slice(4, 6)), Number(t.slice(6, 8)));
  const parts = t.split(/[^\d]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [a, b, c] = parts as [string, string, string];
  if (a.length === 4) return isoOf(Number(a), Number(b), Number(c));
  if (c.length === 4) return isoOf(Number(c), Number(b), Number(a));
  return null;
}

/**
 * A local date and time as typed: the day as parseDateInput reads it, then a 24-hour time "14:30"
 * («١٤:٣٠»), after a space or a "T". Returns "YYYY-MM-DDTHH:mm" (what datetime-local carries),
 * '' when empty, null when either part is not real.
 */
export function parseDateTimeInput(text: string): string | null {
  const t = toAsciiDigits(text).trim();
  if (!t) return '';
  const m = /^(.*?)[\sT]+(\d{1,2})[:.\u066B](\d{2})$/.exec(t);
  if (!m) return null;
  const day = parseDateInput(m[1]!);
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (!day || h > 23 || min > 59) return null;
  // The machine value datetime-local carries (never shown), so zero-padded ASCII digits
  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${day}T${two(h)}:${two(min)}`;
}

/** "YYYY-MM-DDTHH:mm" as the field shows it: "2026-11-18 14:30" / «٢٠٢٦/١١/١٨ ١٤:٣٠». */
export function formatDateTimeInput(value: string | undefined | null, locale: string): string {
  const m = value ? ISO_LOCAL.exec(value) : null;
  if (!m) return '';
  const two = numberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false });
  return `${formatDateInput(m[1], locale)} ${two.format(Number(m[2]))}:${two.format(Number(m[3]))}`;
}

/** The ISO day as the field shows it: "2026-11-18" in English, «٢٠٢٦/١١/١٨» in Arabic. */
export function formatDateInput(iso: string | undefined | null, locale: string): string {
  const m = iso ? ISO_DAY.exec(iso) : null;
  if (!m) return '';
  const parts = dateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).formatToParts(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return [part('year'), part('month'), part('day')].join(locale === 'ar' ? '/' : '-');
}

export interface DateFieldProps {
  id?: string;
  /** The form field name: a hidden input carries the ISO day under it. */
  name?: string;
  /** Controlled ISO day ("" or undefined = empty). */
  value?: string;
  /** Uncontrolled starting ISO day. */
  defaultValue?: string;
  onChange?: (iso: string | undefined) => void;
  /** Submit the enclosing form once a value is committed (filter bars). */
  submitOnChange?: boolean;
  min?: string;
  max?: string;
  required?: boolean;
  className?: string;
  testId?: string;
  'aria-describedby'?: string;
  /** A date and a time ("YYYY-MM-DDTHH:mm", local), the datetime-local value; see DateTimeField. */
  withTime?: boolean;
}

export function DateField({ id, name, value, defaultValue, onChange, submitOnChange, min, max, required, className = '', testId, withTime = false, ...rest }: DateFieldProps) {
  const show = withTime ? formatDateTimeInput : formatDateInput;
  const read = withTime ? parseDateTimeInput : parseDateInput;
  const { t, locale } = useLanguage();
  const ownId = useId();
  const fieldId = id ?? ownId;
  const errorId = `${fieldId}-error`;
  const controlled = value !== undefined;
  const [iso, setIso] = useState<string>((controlled ? value : defaultValue) ?? '');
  const [text, setText] = useState(() => show(iso, locale));
  const [invalid, setInvalid] = useState(false);
  const hidden = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const panelId = `${fieldId}-calendar`;

  // A new controlled value, or a language switch, redraws the text
  useEffect(() => {
    if (controlled && (value ?? '') !== iso) setIso(value ?? '');
  }, [controlled, value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setText(show(iso, locale));
    setInvalid(false);
    if (hidden.current) hidden.current.value = iso;
  }, [iso, locale, show]);

  const commit = (next: string) => {
    if (next && ((min && next < min) || (max && next > max))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(show(next, locale));
    if (next === iso) return;
    if (!controlled) setIso(next);
    if (hidden.current) hidden.current.value = next;
    onChange?.(next || undefined);
    if (submitOnChange) hidden.current?.form?.requestSubmit();
  };

  const commitText = () => {
    const next = read(text);
    if (next === null) setInvalid(true);
    else commit(next);
  };

  // Our calendar: a press outside it closes it; closing gives focus back to the calendar button
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const day = iso.slice(0, 10);
  const timeOf = (v: string) => (/T(\d{2}):(\d{2})$/.exec(v) ? { h: Number(v.slice(11, 13)), m: Number(v.slice(14, 16)) } : { h: 0, m: 0 });
  // The machine value (never shown), so zero-padded ASCII digits
  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const withClock = (d: string, h: number, m: number) => `${d}T${two(h)}:${two(m)}`;

  return (
    <div className={className} data-testid={testId}>
      {name !== undefined && <input ref={hidden} type="hidden" name={name} defaultValue={iso} data-testid={testId ? `${testId}-value` : undefined} />}
      {/* The text field and its calendar button; the error line sits below, outside it */}
      <div ref={box} className="relative">
        <input
          id={fieldId}
          type="text"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          value={text}
          data-date-field={withTime ? 'datetime' : 'date'}
          placeholder={t(withTime ? 'dateField.placeholderTime' : 'dateField.placeholder')}
          onChange={(e) => {
            setText(e.currentTarget.value);
            if (invalid) setInvalid(false);
          }}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitText();
            }
          }}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={[invalid ? errorId : null, rest['aria-describedby'] ?? null].filter(Boolean).join(' ') || undefined}
          // The text runs left to right (digits); the calendar button sits at the page's end, so the room
          // for it is on the right in English and on the left in Arabic
          className={`${fieldClass} w-full pr-11 rtl:pr-3 rtl:pl-11 rtl:text-right tabular-nums`}
          data-testid={testId ? `${testId}-input` : undefined}
        />
        <button
          type="button"
          ref={button}
          onClick={() => setOpen((o) => !o)}
          aria-label={t('dateField.choose')}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className="absolute inset-y-0 end-0 grid w-10 place-items-center rounded-e text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          data-testid={testId ? `${testId}-calendar` : undefined}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
            <path d="M3.5 9.5h17M8 3v4M16 3v4" />
          </svg>
        </button>
        {open && (
          <CalendarPanel
            id={panelId}
            locale={locale}
            t={t}
            value={day}
            time={withTime ? timeOf(iso) : null}
            min={min}
            max={max}
            required={required}
            onPickDay={(d) => {
              if (!withTime) {
                commit(d);
                close();
                return;
              }
              const { h, m } = timeOf(iso);
              commit(withClock(d, h, m));
            }}
            onTime={(h, m) => commit(withClock(day || todayIso(), h, m))}
            onClear={() => {
              commit('');
              close();
            }}
            onClose={close}
          />
        )}
      </div>
      {invalid && (
        <p id={errorId} className="mt-1 text-xs text-danger-fg" role="alert">
          {t(withTime ? 'dateField.invalidTime' : 'dateField.invalid')}
        </p>
      )}
    </div>
  );
}

/** The admin's date-and-time field: DateField with a 24-hour time, value "YYYY-MM-DDTHH:mm" (local). */
export function DateTimeField(props: Omit<DateFieldProps, 'withTime'>) {
  return <DateField {...props} withTime />;
}
