import { QURAN_CREDIT, QURAN_CREDIT_LINK_LABEL, QURAN_FOUNDATION_URL } from './quran.ts';

export type SystemCreditId = 'quranFoundation';

export interface SystemCredit {
  id: SystemCreditId;
  url: string;
  name: Readonly<Record<'en' | 'ar', string>>;
  label: Readonly<Record<'en' | 'ar', string>>;
  linkLabel: Readonly<Record<'en' | 'ar', string>>;
  when: { cueCredit: 'quran' };
  required: true;
}

const quranFoundation = {
  id: 'quranFoundation',
  url: QURAN_FOUNDATION_URL,
  name: { en: 'Quran Foundation', ar: 'مؤسسة القرآن' },
  label: QURAN_CREDIT,
  linkLabel: QURAN_CREDIT_LINK_LABEL,
  when: { cueCredit: 'quran' },
  required: true,
} as const satisfies SystemCredit;

export const SYSTEM_CREDITS = [quranFoundation] as const;
export const [QURAN_FOUNDATION_CREDIT] = SYSTEM_CREDITS;
