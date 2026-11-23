/**
 * The Credits page's copy (components/credits/CreditsPage.tsx), English and Arabic. Quran Foundation's
 * own attribution line comes from the API (shared-types QURAN_ATTRIBUTION), never from here.
 */
import { metaSeparator } from '@/lib/i18n/meta-separator';

export interface CreditsCopy {
  title: string;
  /** The rail's "More" link */
  navLabel: string;
  lead: string;
  quran: {
    heading: string;
    text: string;
    editionsIntro: string;
    /** Between an edition's name and its translator */
    by: string;
    /** Before the edition's language */
    separator: string;
    editionsUnavailable: string;
    unaltered: string;
  };
}

export const CREDITS_COPY: Record<'en' | 'ar', CreditsCopy> = {
  en: {
    title: 'Credits',
    navLabel: 'Credits',
    lead: 'Where the content Al Ummah Now shows comes from.',
    quran: {
      heading: 'Quran',
      text: 'Quran verses in captions are shown in the official Uthmani text (Hafs), exactly as Quran Foundation provides it.',
      editionsIntro: 'In translated captions, Quran verses are shown in these translations:',
      by: ', translated by ',
      separator: metaSeparator('en', '·'),
      editionsUnavailable: 'The list of translations can’t be loaded right now. Try again later.',
      unaltered: 'Quran text and translations are never machine-translated or changed. Next to captions with Quran text, the player shows “Source: Quran Foundation”, linked to Quran Foundation’s site.',
    },
  },
  ar: {
    title: 'المصادر',
    navLabel: 'المصادر',
    lead: 'مصادر المحتوى الذي يعرضه موقع الأمة الآن.',
    quran: {
      heading: 'القرآن الكريم',
      text: 'تُعرض الآيات في الترجمة النصية بالرسم العثماني الرسمي (حفص) كما تقدّمه مؤسسة القرآن تمامًا.',
      editionsIntro: 'وفي الترجمة النصية المترجمة تُعرض الآيات بهذه الترجمات:',
      by: '، ترجمة ',
      // «،» in Arabic, as on every meta line (a middle dot next to Arabic text reads as «٠»)
      separator: metaSeparator('ar'),
      editionsUnavailable: 'تعذّر تحميل قائمة الترجمات الآن. حاول لاحقًا.',
      unaltered: 'لا يُترجَم نص القرآن ولا ترجماته آليًا ولا يُغيَّر أبدًا. وبجوار الترجمة النصية التي فيها آيات يعرض المشغّل «المصدر: مؤسسة القرآن» مع رابط إلى موقع مؤسسة القرآن.',
    },
  },
};
