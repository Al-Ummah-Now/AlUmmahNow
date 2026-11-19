/**
 * The admin number fields' rules (NumberField.tsx), pure so they are unit tested: what a typed text
 * means (either digit set, «٫» or "." for decimals), how a value is shown (٠–٩ and «٫» in Arabic,
 * #1643) and whether it is in range.
 */
import { isArabicLocale, localizeDigits, parseDigits, type FormatLocale } from '@al-ummah/shared-types';

/**
 * Typed text as a plain Latin number string: ٠–٩/۰–۹ become 0–9, «٫» or "," a ".", anything else is
 * dropped. Decimals only when allowed (one mark), a minus only at the start and only when allowed.
 */
export function toLatinNumber(text: string, opts: { decimal: boolean; negative: boolean }): string {
  const plain = parseDigits(text).replace(/,/g, '.');
  let out = '';
  let dot = false;
  for (const c of plain) {
    if (c >= '0' && c <= '9') out += c;
    else if (c === '.' && opts.decimal && !dot) {
      dot = true;
      out += c;
    } else if (c === '-' && opts.negative && out === '') out += c;
  }
  return out;
}

/** A Latin number string as the admin reads it: ٠–٩ and the decimal mark «٫» in Arabic. */
export function showNumber(locale: FormatLocale, latin: string): string {
  const digits = localizeDigits(locale, latin);
  return isArabicLocale(locale) ? digits.replace(/\./g, '٫') : digits;
}

/** A controlled value (number or text, possibly NaN) as a Latin number string. */
export function latinOf(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return toLatinNumber(value, { decimal: true, negative: true });
}

export type NumberProblem = null | { key: 'range' | 'min' | 'max' | 'whole' | 'invalid'; min?: number; max?: number };

function bound(v: string | number | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** What is wrong with a value (empty is left to `required`), or null. */
export function numberProblem(latin: string, opts: { min?: string | number; max?: string | number; whole: boolean }): NumberProblem {
  if (latin === '') return null;
  const n = Number(latin);
  if (!Number.isFinite(n) || latin === '-' || latin === '.') return { key: 'invalid' };
  const min = bound(opts.min);
  const max = bound(opts.max);
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
    if (min !== undefined && max !== undefined) return { key: 'range', min, max };
    return min !== undefined ? { key: 'min', min } : { key: 'max', max };
  }
  if (opts.whole && !Number.isInteger(n)) return { key: 'whole' };
  return null;
}
