/**
 * Creator-support money for people (wiki AUN-MEMBERS §11; O38). Kept apart from support.ts so the
 * money rules there have no imports (shared-types tests run them with plain Node).
 */
import { isArabicLocale, moneyFormat } from './locale-format';
import { SUPPORT_CURRENCY_EXPONENTS, toMajorString, type Money } from './support';

/**
 * Money for people: "$5.00" in English, «٥٫٠٠ دولار أمريكي» in Arabic (O38: the currency's name,
 * Eastern Arabic digits, never grouped). The decimal string goes to Intl as is, so no float is
 * formed even for large amounts.
 */
export function formatSupportMoney(locale: string, m: Money): string {
  const exp = SUPPORT_CURRENCY_EXPONENTS[m.currency];
  // Intl.NumberFormat accepts decimal strings (ES2023); the cast keeps older lib typings happy
  return moneyFormat(locale, m.currency, { minimumFractionDigits: exp, maximumFractionDigits: exp, ...(isArabicLocale(locale) ? { useGrouping: false } : {}) }).format(toMajorString(m) as unknown as number);
}
