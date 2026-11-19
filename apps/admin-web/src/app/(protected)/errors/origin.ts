import type { Locale } from '@/i18n/config';
import { translateDynamic, type MessageKey, type Translator } from '@/i18n/translate';

/** "search:google" → "Search (google)"; plain sources by name. */
export function sourceLabel(source: string, t: Translator): string {
  const [kind, name] = source.split(':');
  if (name && (kind === 'search' || kind === 'social')) return t(`originSource.${kind}` as MessageKey, { name });
  return translateDynamic(t, 'originSource', source);
}

/** A country code in the page's language ("EG" → "Egypt" / «مصر»); unknown codes as they are. */
export function countryName(code: string, locale: Locale): string {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
