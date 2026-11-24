import {
  KIDS_AGE_BANDS,
  KIDS_TOPICS,
  type KidsAgeBand,
  type KidsTopic,
} from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { formatNumber, type Translator } from '@/i18n/translate';

/**
 * Format an age band using localized numerals (Eastern Arabic on Arabic pages).
 */
export function formatAgeBand(band: KidsAgeBand, t: Translator, locale: Locale): string {
  switch (band) {
    case '3-6':
      return t('kids.ageBands.early', { from: formatNumber(3, locale), to: formatNumber(6, locale) });
    case '7-12':
      return t('kids.ageBands.older', { from: formatNumber(7, locale), to: formatNumber(12, locale) });
    case 'all':
      return t('kids.ageBands.all');
  }
}

export function formatTopic(topic: KidsTopic, t: Translator): string {
  return t(`kids.topics.${topic}` as Parameters<Translator>[0]);
}

export const AGE_BAND_OPTIONS: readonly KidsAgeBand[] = KIDS_AGE_BANDS;
export const TOPIC_OPTIONS: readonly KidsTopic[] = KIDS_TOPICS;
