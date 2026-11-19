'use client';

/**
 * The admin's one date field (#1598). The browser's own `<input type="date">` paints its
 * placeholder and value in the browser's language ("yyyy/mm/dd", "mm/dd/yyyy", 0–9) whatever the
 * admin's language is, so an Arabic page showed Latin letters. Here the text is ours:
 *
 * - the value in the admin's digits: "2026-11-18" / «٢٠٢٦/١١/١٨» (locale-format, nu-arab in ar);
 * - the placeholder in the admin's language: "YYYY-MM-DD" / «سنة/شهر/يوم»;
 * - typing in either digit set (٠–٩ or 0–9), as year-month-day, day/month/year or 8 digits;
 * - a calendar button that opens the browser's own picker (keyboard and screen reader friendly);
 * - a hidden `name` input carrying the ISO day, so GET filter forms and URLs stay as they were.
 *
 * `onChange` gets the ISO day (or undefined when cleared) once a value is committed: on blur,
 * Enter, or a pick in the calendar. `submitOnChange` also submits the enclosing form then.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { dateTimeFormat } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

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
}

export function DateField({ id, name, value, defaultValue, onChange, submitOnChange, min, max, required, className = '', testId, ...rest }: DateFieldProps) {
  const { t, locale } = useLanguage();
  const ownId = useId();
  const fieldId = id ?? ownId;
  const errorId = `${fieldId}-error`;
  const controlled = value !== undefined;
  const [iso, setIso] = useState<string>((controlled ? value : defaultValue) ?? '');
  const [text, setText] = useState(() => formatDateInput(iso, locale));
  const [invalid, setInvalid] = useState(false);
  const hidden = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // A new controlled value, or a language switch, redraws the text
  useEffect(() => {
    if (controlled && (value ?? '') !== iso) setIso(value ?? '');
  }, [controlled, value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setText(formatDateInput(iso, locale));
    setInvalid(false);
    if (hidden.current) hidden.current.value = iso;
  }, [iso, locale]);

  const commit = (next: string) => {
    if (next && ((min && next < min) || (max && next > max))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(formatDateInput(next, locale));
    if (next === iso) return;
    if (!controlled) setIso(next);
    if (hidden.current) hidden.current.value = next;
    onChange?.(next || undefined);
    if (submitOnChange) hidden.current?.form?.requestSubmit();
  };

  const commitText = () => {
    const next = parseDateInput(text);
    if (next === null) setInvalid(true);
    else commit(next);
  };

  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    el.value = iso;
    try {
      el.showPicker();
    } catch {
      // Older browsers: focusing the date input opens its picker on most of them
      el.focus();
      el.click();
    }
  };

  return (
    <div className={`relative ${className}`} data-testid={testId}>
      {name !== undefined && <input ref={hidden} type="hidden" name={name} defaultValue={iso} data-testid={testId ? `${testId}-value` : undefined} />}
      <input
        id={fieldId}
        type="text"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        value={text}
        placeholder={t('dateField.placeholder')}
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
        onClick={openPicker}
        aria-label={t('dateField.choose')}
        className="absolute inset-y-0 end-0 grid w-10 place-items-center rounded-e text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        data-testid={testId ? `${testId}-calendar` : undefined}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
          <path d="M3.5 9.5h17M8 3v4M16 3v4" />
        </svg>
      </button>
      {/* The browser's calendar, opened by the button; never shown or focused itself */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        min={min}
        max={max}
        className="pointer-events-none absolute bottom-0 end-0 h-px w-px opacity-0"
        onChange={(e) => commit(e.currentTarget.value)}
      />
      {invalid && (
        <p id={errorId} className="mt-1 text-xs text-danger-fg" role="alert">
          {t('dateField.invalid')}
        </p>
      )}
    </div>
  );
}
