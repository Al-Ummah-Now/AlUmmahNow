/**
 * The shared bulk rename engine (packages/shared-types/src/bulk-rename.ts):
 * tokens, numbering, Arabic, duplicates and limits.
 */
import {
  applyTextEdit,
  changeCase,
  charCount,
  formatNumber,
  formatTokenDate,
  previewRename,
  renamedTitles,
  renameSummary,
  replaceText,
  staggeredTimes,
  stripExtension,
  VIDEO_TITLE_MAX,
  type RenameSubject,
} from '@al-ummah/shared-types';

const files: RenameSubject[] = [
  { id: 'a', title: { en: 'clip-one', ar: '' }, filename: 'Tafsir Al-Fatiha.part1.mp4', date: '2026-03-01T10:00:00Z', channel: { en: 'Noor', ar: 'نور' } },
  { id: 'b', title: { en: 'clip-two', ar: 'درس' }, filename: 'Tafsir Al-Fatiha.part2.mov', date: '2026-03-02T10:00:00Z', channel: { en: 'Noor', ar: 'نور' } },
  { id: 'c', title: { en: 'clip-three' }, filename: 'noext', date: null, channel: { en: 'Noor', ar: 'نور' } },
];

describe('tokens', () => {
  it('fills {n} {filename} {title} {channel} per language, never mixing languages', () => {
    const rows = previewRename(files, {
      rule: { kind: 'pattern', pattern: '{channel} {n}: {filename} ({title})' },
      languages: ['en', 'ar'],
    });
    const en = rows.filter((r) => r.language === 'en').map((r) => r.after);
    const ar = rows.filter((r) => r.language === 'ar').map((r) => r.after);
    expect(en).toEqual([
      'Noor 1: Tafsir Al-Fatiha.part1 (clip-one)',
      'Noor 2: Tafsir Al-Fatiha.part2 (clip-two)',
      'Noor 3: noext (clip-three)',
    ]);
    // {title} in the Arabic field is the Arabic title only (empty stays empty)
    expect(ar).toEqual([
      'نور 1: Tafsir Al-Fatiha.part1 ()',
      'نور 2: Tafsir Al-Fatiha.part2 (درس)',
      'نور 3: noext ()',
    ]);
  });

  it('leaves unknown tokens as typed', () => {
    const [row] = previewRename([files[0]], { rule: { kind: 'pattern', pattern: '{n} {unknown}' }, languages: ['en'] });
    expect(row.after).toBe('1 {unknown}');
  });

  it('strips only the last extension', () => {
    expect(stripExtension('a.b.mp4')).toBe('a.b');
    expect(stripExtension('.hidden')).toBe('.hidden');
    expect(stripExtension('plain')).toBe('plain');
  });

  it('formats {date} in the field language with Latin digits unless Arabic-Indic is chosen', () => {
    expect(formatTokenDate('2026-03-01T10:00:00Z', 'en')).toBe('1 March 2026');
    const latin = formatTokenDate('2026-03-01T10:00:00Z', 'ar');
    expect(latin).toMatch(/2026/);
    expect(latin).toMatch(/مارس/);
    const indic = formatTokenDate('2026-03-01T10:00:00Z', 'ar', 'arabic-indic');
    expect(indic).toMatch(/٢٠٢٦/);
    expect(formatTokenDate(null, 'en')).toBe('');
    expect(formatTokenDate('not a date', 'en')).toBe('');
  });
});

describe('numbering', () => {
  it('starts, steps and pads as asked', () => {
    expect(formatNumber(0, { start: 1, pad: 3 })).toBe('001');
    expect(formatNumber(4, { start: 10, step: 5, pad: 2 })).toBe('30');
    expect(formatNumber(0, { start: -2, pad: 2 })).toBe('-02');
  });

  it('skips excluded rows without spending a number', () => {
    const rows = previewRename(files, { rule: { kind: 'pattern', pattern: 'Lesson {n}', pad: 2 }, languages: ['en'], excluded: ['b'] });
    expect(rows.map((r) => [r.id, r.after, r.excluded])).toEqual([
      ['a', 'Lesson 01', false],
      ['b', 'clip-two', true],
      ['c', 'Lesson 02', false],
    ]);
  });

  it('uses Arabic-Indic digits only in the Arabic field and only when picked', () => {
    const plain = previewRename(files, { rule: { kind: 'pattern', pattern: 'درس {n}' }, languages: ['ar', 'en'] });
    expect(plain.find((r) => r.language === 'ar')?.after).toBe('درس 1');
    const indic = previewRename(files, { rule: { kind: 'pattern', pattern: 'درس {n}', start: 10 }, languages: ['ar', 'en'], arabicDigits: 'arabic-indic' });
    expect(indic.filter((r) => r.language === 'ar').map((r) => r.after)).toEqual(['درس ١٠', 'درس ١١', 'درس ١٢']);
    expect(indic.find((r) => r.language === 'en')?.after).toBe('درس 10');
  });
});

describe('other modes', () => {
  it('replaces plain text, every occurrence, with an optional ignore-case', () => {
    expect(replaceText('a.b.a', '.', '-')).toBe('a-b-a');
    expect(replaceText('Clip clip CLIP', 'clip', 'Part')).toBe('Clip Part CLIP');
    expect(replaceText('Clip clip CLIP', 'clip', 'Part', true)).toBe('Part Part Part');
    expect(replaceText('cost', 'cost', '$1')).toBe('$1');
  });

  it('adds a prefix and suffix', () => {
    const [row] = previewRename([files[1]], { rule: { kind: 'affix', prefix: 'سلسلة: ', suffix: ' (١)' }, languages: ['ar'] });
    expect(row.after).toBe('سلسلة: درس (١)');
  });

  it('changes case and leaves Arabic as it is', () => {
    expect(changeCase('the life OF the prophet', 'title', 'en')).toBe('The Life Of The Prophet');
    expect(changeCase('THE LIFE', 'sentence', 'en')).toBe('The life');
    expect(changeCase('درس الفقه', 'upper', 'ar')).toBe('درس الفقه');
  });

  it('normalizes nothing: diacritics, spacing and composed forms are kept', () => {
    const subject: RenameSubject = { id: 'x', title: { ar: 'الْفِقْهُ  ' } };
    const [row] = previewRename([subject], { rule: { kind: 'affix', prefix: '' }, languages: ['ar'] });
    expect(row.after).toBe('الْفِقْهُ  ');
    expect(row.changed).toBe(false);
  });
});

describe('problems', () => {
  it('flags empty, too long and duplicate results and keeps them out of the write', () => {
    const subjects: RenameSubject[] = [
      { id: '1', title: { en: 'A' } },
      { id: '2', title: { en: 'B' } },
      { id: '3', title: { en: 'C' } },
      { id: '4', title: { en: 'x'.repeat(VIDEO_TITLE_MAX) } },
    ];
    const rows = previewRename(subjects, { rule: { kind: 'replace', find: 'A', replace: '' }, languages: ['en'] });
    expect(rows[0].problems).toEqual(['empty']);

    const dup = previewRename(subjects.slice(0, 3), { rule: { kind: 'pattern', pattern: 'Same' }, languages: ['en'] });
    expect(dup.every((r) => r.problems.includes('duplicate'))).toBe(true);

    const long = previewRename([subjects[3]], { rule: { kind: 'affix', suffix: '!' }, languages: ['en'] });
    expect(long[0].problems).toEqual(['too_long']);

    expect(renamedTitles([...rows, ...long])).toEqual({});
    // Duplicates are a warning: they still apply
    expect(Object.keys(renamedTitles(dup))).toEqual(['1', '2', '3']);
    expect(renameSummary(dup)).toEqual({ applies: 3, blocked: 0, duplicates: 3, unchanged: 0, excluded: 0 });
  });

  it('judges duplicates per language, ignoring case and outer spaces only', () => {
    const subjects: RenameSubject[] = [
      { id: '1', title: { en: 'Lesson', ar: 'درس' } },
      { id: '2', title: { en: 'lesson ', ar: 'دَرس' } },
    ];
    const rows = previewRename(subjects, { rule: { kind: 'affix', prefix: '' }, languages: ['en', 'ar'] });
    expect(rows.filter((r) => r.language === 'en').every((r) => r.problems.includes('duplicate'))).toBe(true);
    // A diacritic makes a different title (nothing normalized)
    expect(rows.filter((r) => r.language === 'ar').some((r) => r.problems.includes('duplicate'))).toBe(false);
  });

  it('counts characters by code point', () => {
    expect(charCount('😀a')).toBe(2);
    const subject: RenameSubject = { id: 'e', title: { en: '😀'.repeat(VIDEO_TITLE_MAX) } };
    const [row] = previewRename([subject], { rule: { kind: 'case', mode: 'upper' }, languages: ['en'] });
    expect(row.problems).toEqual([]);
  });
});

describe('descriptions and schedules', () => {
  it('appends, prepends and replaces', () => {
    expect(applyTextEdit('Body', { mode: 'append', text: 'Footer' })).toBe('Body\n\nFooter');
    expect(applyTextEdit('Body', { mode: 'prepend', text: 'Intro' })).toBe('Intro\n\nBody');
    expect(applyTextEdit('', { mode: 'append', text: 'Only' })).toBe('Only');
    expect(applyTextEdit('Body', { mode: 'replace', text: '' })).toBe('');
  });

  it('staggers publish times by hours or calendar days', () => {
    expect(staggeredTimes('2026-12-01T18:00:00Z', 3, 6, 'hours')).toEqual([
      '2026-12-01T18:00:00.000Z', '2026-12-02T00:00:00.000Z', '2026-12-02T06:00:00.000Z',
    ]);
    expect(staggeredTimes('2026-12-01T18:00:00Z', 2, 0)).toEqual(['2026-12-01T18:00:00.000Z', '2026-12-01T18:00:00.000Z']);
    expect(staggeredTimes('bad', 2, 1)).toEqual([]);
    expect(staggeredTimes('2026-12-01T18:00:00Z', 2, 1, 'days')).toHaveLength(2);
  });
});

describe('English and Arabic in one pass, each with its own rule', () => {
  const pair: RenameSubject[] = [
    { id: 'a', title: { en: 'Fiqh class one', ar: 'درس الفقه الأول' } },
    { id: 'b', title: { en: 'Fiqh class two', ar: 'درس الفقه الثاني' } },
    { id: 'c', title: { en: 'Fiqh class three', ar: 'درس الفقه الثالث' } },
  ];

  it('gives each video the same {n} in both languages, with Arabic-Indic digits only in Arabic', () => {
    const rows = previewRename(pair, {
      rule: { kind: 'pattern', pattern: 'Lesson {n}' },
      rules: { en: { kind: 'pattern', pattern: 'Lesson {n}', start: 5, pad: 2 }, ar: { kind: 'pattern', pattern: 'الدرس {n}', start: 5, pad: 2 } },
      languages: ['en', 'ar'],
      arabicDigits: 'arabic-indic',
      excluded: ['b'],
    });
    const byLang = (lang: 'en' | 'ar') => rows.filter((r) => r.language === lang).map((r) => [r.id, r.after]);
    expect(byLang('en')).toEqual([['a', 'Lesson 05'], ['b', 'Fiqh class two'], ['c', 'Lesson 06']]);
    expect(byLang('ar')).toEqual([['a', 'الدرس ٠٥'], ['b', 'درس الفقه الثاني'], ['c', 'الدرس ٠٦']]);
  });

  it('finds and replaces, and adds prefixes, per language', () => {
    const rows = previewRename(pair, {
      rule: { kind: 'case', mode: 'upper' },
      rules: { en: { kind: 'replace', find: 'fiqh class', replace: 'Fiqh Lesson', ignoreCase: true }, ar: { kind: 'affix', prefix: 'سلسلة: ' } },
      languages: ['en', 'ar'],
    });
    expect(rows.filter((r) => r.language === 'en').map((r) => r.after)).toEqual(['Fiqh Lesson one', 'Fiqh Lesson two', 'Fiqh Lesson three']);
    expect(rows.filter((r) => r.language === 'ar').map((r) => r.after)).toEqual(['سلسلة: درس الفقه الأول', 'سلسلة: درس الفقه الثاني', 'سلسلة: درس الفقه الثالث']);
  });

  it('changes only the ticked language', () => {
    const rows = previewRename(pair, { rule: { kind: 'pattern', pattern: 'X' }, rules: { ar: { kind: 'pattern', pattern: 'الدرس {n}' } }, languages: ['ar'] });
    expect(rows.every((r) => r.language === 'ar')).toBe(true);
    expect(renamedTitles(rows)).toEqual({ a: { ar: 'الدرس 1' }, b: { ar: 'الدرس 2' }, c: { ar: 'الدرس 3' } });
  });
});

