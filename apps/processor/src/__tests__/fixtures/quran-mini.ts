/**
 * A tiny hand-typed Quran (Imla'i script, words only) for the matcher and Content Sync tests:
 * Al-Fatihah, 112–114, Ya-Sin 1–5 and Ar-Rahman 1–18 (55:13 = 55:16 = 55:18, the ambiguity
 * case). Never fetched from Quran Foundation: tests make no QF calls.
 */
import type { QuranLocation } from '@al-ummah/shared-types';

export const MINI_QURAN: Record<number, string[]> = {
  1: [
    'بسم الله الرحمن الرحيم',
    'الحمد لله رب العالمين',
    'الرحمن الرحيم',
    'مالك يوم الدين',
    'إياك نعبد وإياك نستعين',
    'اهدنا الصراط المستقيم',
    'صراط الذين أنعمت عليهم غير المغضوب عليهم ولا الضالين',
  ],
  36: ['يس', 'والقرآن الحكيم', 'إنك لمن المرسلين', 'على صراط مستقيم', 'تنزيل العزيز الرحيم'],
  55: [
    'الرحمن',
    'علم القرآن',
    'خلق الإنسان',
    'علمه البيان',
    'الشمس والقمر بحسبان',
    'والنجم والشجر يسجدان',
    'والسماء رفعها ووضع الميزان',
    'ألا تطغوا في الميزان',
    'وأقيموا الوزن بالقسط ولا تخسروا الميزان',
    'والأرض وضعها للأنام',
    'فيها فاكهة والنخل ذات الأكمام',
    'والحب ذو العصف والريحان',
    'فبأي آلاء ربكما تكذبان',
    'خلق الإنسان من صلصال كالفخار',
    'وخلق الجان من مارج من نار',
    'فبأي آلاء ربكما تكذبان',
    'رب المشرقين ورب المغربين',
    'فبأي آلاء ربكما تكذبان',
  ],
  112: ['قل هو الله أحد', 'الله الصمد', 'لم يلد ولم يولد', 'ولم يكن له كفوا أحد'],
  113: ['قل أعوذ برب الفلق', 'من شر ما خلق', 'ومن شر غاسق إذا وقب', 'ومن شر النفاثات في العقد', 'ومن شر حاسد إذا حسد'],
  114: ['قل أعوذ برب الناس', 'ملك الناس', 'إله الناس', 'من شر الوسواس الخناس', 'الذي يوسوس في صدور الناس', 'من الجنة والناس'],
};

/** (location, Imla'i word) rows in Quran order, as the Content Sync job produces them. */
export function miniQuranRows(): Array<{ loc: QuranLocation; imlaei: string }> {
  const rows: Array<{ loc: QuranLocation; imlaei: string }> = [];
  for (const surah of Object.keys(MINI_QURAN).map(Number).sort((a, b) => a - b)) {
    MINI_QURAN[surah]!.forEach((text, i) => {
      text.split(' ').forEach((imlaei, w) => rows.push({ loc: { surah, ayah: i + 1, word: w + 1 }, imlaei }));
    });
  }
  return rows;
}

/** ASR-style words, 400 ms each, from a space-separated string. */
export function asr(text: string, startMs = 0): Array<{ text: string; startMs: number; endMs: number }> {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => ({ text: t, startMs: startMs + i * 400, endMs: startMs + i * 400 + 380 }));
}
