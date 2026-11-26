import { QURAN_CREDIT, QURAN_CREDIT_LINK_LABEL, QURAN_FOUNDATION_URL } from './quran.ts';

export type SystemCreditId = 'quranFoundation';

export interface SystemCredit {
  id: SystemCreditId;
  href: string;
  name: Readonly<Record<'en' | 'ar', string>>;
  label: Readonly<Record<'en' | 'ar', string>>;
  ariaLabel: Readonly<Record<'en' | 'ar', string>>;
}

const quranFoundation = {
  id: 'quranFoundation',
  href: QURAN_FOUNDATION_URL,
  name: { en: 'Quran Foundation', ar: 'مؤسسة القرآن' },
  label: QURAN_CREDIT,
  ariaLabel: QURAN_CREDIT_LINK_LABEL,
} as const satisfies SystemCredit;

export const SYSTEM_CREDITS = [quranFoundation] as const;
export const [QURAN_FOUNDATION_CREDIT] = SYSTEM_CREDITS;
