/**
 * Plural selection for player strings (#82).
 *
 * Forms come from Intl.PluralRules (CLDR): English uses one/other, Arabic
 * zero/one/two/few/many/other. A `zero` form, where a table has one, also
 * applies in English so "no videos" can be written.
 */

import { formatNumber, pluralCategory } from '@al-ummah/shared-types';
import type { PluralForms, PluralKey, SupportedLanguage } from '../types';
import { getTranslations } from './getTranslations';

function selectTemplate(table: PluralForms, lang: SupportedLanguage, count: number): string {
  if (count === 0 && table.zero) return table.zero;
  const form = pluralCategory(lang, count);
  return table[form] ?? table.other;
}

/**
 * Text for a count, with `{{count}}` replaced by the localized number.
 *
 * @example
 * plural('en', 'videos', 1);  // "1 video"
 * plural('ar', 'videos', 2);  // "مرئيان"
 * plural('ar', 'videos', 5);  // "٥ مرئيات"
 */
export function plural(lang: SupportedLanguage, key: PluralKey, count: number): string {
  const table = getTranslations(lang).pluralization[key];
  const formatted = formatNumber(lang, count);
  return selectTemplate(table, lang, count).replace('{{count}}', formatted);
}
