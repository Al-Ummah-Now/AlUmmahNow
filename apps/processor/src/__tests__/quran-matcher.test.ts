/**
 * The zero-mistake Quran matcher (shared-types quran.ts, spec §5.5) on a hand-typed mini Quran.
 * Every match is a reference; nothing here produces Quran text.
 */
import {
  QuranIndex,
  formatQuranRange,
  matchQuran,
  normaliseQuranWord,
  parseQuranRange,
  quranAyahLabel,
  quranComUrl,
  wordSimilarity,
} from '@al-ummah/shared-types';
import { asr, miniQuranRows } from './fixtures/quran-mini';

const index = new QuranIndex(QuranIndex.build(miniQuranRows(), 'test-v1', '2026-11-13T00:00:00.000Z'));
const refs = (text: string) => matchQuran(index, asr(text)).map((m) => [formatQuranRange(m.range), m.class]);

describe('normalisation and references', () => {
  it('strips marks and unifies letters the way the index does', () => {
    expect(normaliseQuranWord('ٱلرَّحْمَٰنِ')).toBe('الرحمن');
    expect(normaliseQuranWord('إِيَّاكَ')).toBe('اياك');
    expect(normaliseQuranWord('الصَّلَوٰةَ')).toBe('الصلوه');
    expect(normaliseQuranWord('مُؤْمِنٌ')).toBe('ممن');
    expect(normaliseQuranWord('عَلَىٰ')).toBe('علي');
    expect(normaliseQuranWord('hello ۝')).toBe('');
  });

  it('parses and formats ranges; refuses reversed or cross-surah ranges', () => {
    const r = parseQuranRange('67:1:1-67:5:12')!;
    expect(formatQuranRange(r)).toBe('67:1:1-67:5:12');
    expect(quranAyahLabel(r)).toBe('67:1–5');
    expect(quranComUrl(r)).toBe('https://quran.com/67/1-5');
    expect(quranComUrl(parseQuranRange('2:255:1-2:255:50')!)).toBe('https://quran.com/2/255');
    expect(parseQuranRange('67:5:1-67:1:1')).toBeNull();
    expect(parseQuranRange('67:1:1-68:1:1')).toBeNull();
    expect(parseQuranRange('115:1:1-115:1:2')).toBeNull();
    expect(parseQuranRange('<b>')).toBeNull();
  });

  it('word similarity follows difflib ratio', () => {
    expect(wordSimilarity('الرحمن', 'الرحمن')).toBe(1);
    expect(wordSimilarity('abcd', 'bcde')).toBeCloseTo(0.75);
    expect(wordSimilarity('ab', 'cd')).toBe(0);
  });

  it('the serialised index round-trips', () => {
    const file = QuranIndex.build(miniQuranRows(), 'v', 't');
    const again = new QuranIndex(JSON.parse(JSON.stringify(file)));
    expect(again.words.length).toBe(index.words.length);
    expect(again.locs[0]).toEqual({ surah: 1, ayah: 1, word: 1 });
    expect(() => new QuranIndex({ ...file, locs: file.locs.slice(1) })).toThrow();
  });
});

describe('matching recitation', () => {
  it('a whole surah with one misheard word is confirmed, with its times, and never runs into the next surah', () => {
    const words = asr('قال الشيخ قل هو الله احد الله الصبر لم يلد ولم يولد ولم يكن له كفوا احد ثم قال', 1000);
    const [m, ...rest] = matchQuran(index, words);
    expect(rest).toHaveLength(0);
    expect(formatQuranRange(m!.range)).toBe('112:1:1-112:4:5');
    expect(m!.class).toBe('confirmed');
    expect(m!.occurrences).toBe(1);
    expect(m!.asrStart).toBe(2);
    expect(m!.startMs).toBe(words[2]!.startMs);
    expect(m!.endMs).toBe(words[m!.asrEnd - 1]!.endMs);
  });

  it('spoken letters fold to the written muqatta\'at («يا سين» → يس)', () => {
    expect(refs('يا سين والقران الحكيم انك لمن المرسلين')).toEqual([['36:1:1-36:3:3', 'confirmed']]);
  });

  it('a repeated ayah alone is never placed: a suggestion with its alternatives', () => {
    const [m] = matchQuran(index, asr('فباي الاء ربكما تكذبان'));
    expect(m!.class).toBe('review');
    expect(m!.occurrences).toBe(3);
    expect(m!.alternatives.map(formatQuranRange)).toEqual(['55:13:1-55:13:4', '55:16:1-55:16:4', '55:18:1-55:18:4']);
  });

  it('a repeated ayah right after a confirmed span is placed by verse order', () => {
    expect(refs('فيها فاكهة والنخل ذات الاكمام والحب ذو العصف والريحان قال الشيخ فباي الاء ربكما تكذبان')).toEqual([
      ['55:11:1-55:12:4', 'confirmed'],
      ['55:13:1-55:13:4', 'context'],
    ]);
  });

  it('the basmala opens the surah recited after it', () => {
    const ms = matchQuran(index, asr('بسم الله الرحمن الرحيم قل هو الله احد الله الصمد لم يلد ولم يولد'));
    expect(ms.map((m) => m.class)).toEqual(['basmala', 'confirmed']);
    expect(ms[0]!.basmalaFor).toBe(112);
  });

  it('a basmala with no surah after it is only a suggestion', () => {
    expect(refs('بسم الله الرحمن الرحيم نبدأ الدرس اليوم')).toEqual([['1:1:1-1:1:4', 'review']]);
  });

  it('Al-Fatihah recited in full is one confirmed span', () => {
    expect(refs('بسم الله الرحمن الرحيم الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين')).toEqual([['1:1:1-1:4:3', 'confirmed']]);
  });

  it('ordinary speech matches nothing; short fragments are dropped', () => {
    expect(refs('السلام عليكم ورحمة الله اليوم نتكلم عن الصبر')).toEqual([]);
    expect(refs('الله الصمد')).toEqual([]);
  });

  it('a short unique span is a suggestion, never confirmed', () => {
    expect(refs('هذا كلام من شر الوسواس الخناس ثم نكمل')).toEqual([['114:4:1-114:4:4', 'review']]);
  });
});
