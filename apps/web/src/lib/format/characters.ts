/**
 * Character counters for the comment, reply and post forms. The noun (and its adjective)
 * agrees with the count in both languages (#1666): «حرف واحد متبقٍّ», «حرفان متبقيان»,
 * «٣ أحرف متبقية», «١١ حرفًا متبقيًا», «١٠٠ حرف متبقٍّ»; "1 character remaining", "2 characters remaining".
 */
import { fillTemplate } from '@al-ummah/shared-types';

const LEFT = {
  ar: '{count, plural, zero {لم يتبقَّ أي حرف} one {حرف واحد متبقٍّ} two {حرفان متبقيان} few {# أحرف متبقية} many {# حرفًا متبقيًا} other {# حرف متبقٍّ}}',
  en: '{count, plural, one {# character remaining} other {# characters remaining}}',
};
const OVER = {
  ar: '{count, plural, one {حرف واحد زيادة} two {حرفان زيادة} few {# أحرف زيادة} many {# حرفًا زيادة} other {# حرف زيادة}}',
  en: '{count, plural, one {# character over} other {# characters over}}',
  enLimit: '{count, plural, one {# character over limit} other {# characters over limit}}',
};
const MAX = {
  ar: '{count, plural, one {حرف واحد كحد أقصى} two {حرفان كحد أقصى} few {# أحرف كحد أقصى} many {# حرفًا كحد أقصى} other {# حرف كحد أقصى}}',
  en: '{count, plural, one {# character max} other {# characters max}}',
};

const lang = (isArabic: boolean) => (isArabic ? 'ar' : 'en');

export function charactersLeft(isArabic: boolean, count: number): string {
  return fillTemplate(lang(isArabic), isArabic ? LEFT.ar : LEFT.en, { count });
}

export function charactersOver(isArabic: boolean, count: number, options: { limit?: boolean } = {}): string {
  return fillTemplate(lang(isArabic), isArabic ? OVER.ar : options.limit ? OVER.enLimit : OVER.en, { count });
}

export function charactersMax(isArabic: boolean, count: number): string {
  return fillTemplate(lang(isArabic), isArabic ? MAX.ar : MAX.en, { count });
}
