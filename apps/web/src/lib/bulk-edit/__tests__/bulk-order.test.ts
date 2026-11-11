/**
 * Ordering a bulk rename (packages/shared-types/src/bulk-order.ts): natural
 * sort in English and Arabic with mixed digits, the sort keys, the reorder
 * reducer, numbering in the chosen order, and "continue numbering after".
 */
import {
  hasOrderValue,
  highestNumber,
  missingOrderValues,
  naturalCompare,
  orderReducer,
  orderedSubjects,
  placeInOrder,
  previewRename,
  sortIds,
  toLatinDigits,
  type RenameSubject,
} from '@al-ummah/shared-types';

const sortNat = (items: string[], locale = 'en') => [...items].sort((a, b) => naturalCompare(a, b, locale));

describe('natural sort', () => {
  it('puts Lesson 2 before Lesson 10', () => {
    expect(sortNat(['Lesson 10', 'Lesson 2', 'Lesson 1', 'lesson 3'])).toEqual(['Lesson 1', 'Lesson 2', 'lesson 3', 'Lesson 10']);
  });

  it('reads Arabic-Indic and extended digits as numbers, mixed with Latin', () => {
    expect(toLatinDigits('درس ١٢ ۳')).toBe('درس 12 3');
    expect(sortNat(['درس ١٠', 'درس ٢', 'درس 3', 'درس ۱'], 'ar')).toEqual(['درس ۱', 'درس ٢', 'درس 3', 'درس ١٠']);
    expect(sortNat(['Part ١٠', 'Part 9'])).toEqual(['Part 9', 'Part ١٠']);
  });

  it('sorts Arabic letters in Arabic order, ignoring case in English', () => {
    expect(sortNat(['تفسير', 'أذكار', 'سيرة'], 'ar')).toEqual(['أذكار', 'تفسير', 'سيرة']);
    expect(naturalCompare('alpha', 'ALPHA')).toBe(0);
  });
});

const subjects: RenameSubject[] = [
  { id: 'a', title: { en: 'Lesson 10', ar: 'درس ١٠' }, filename: 'clip-10.mp4', uploadedAt: '2026-01-03', publishedAt: null, duration: 300 },
  { id: 'b', title: { en: 'Lesson 2', ar: 'درس ٢' }, filename: 'clip-2.mp4', uploadedAt: '2026-01-01', publishedAt: '2026-02-01', duration: 120 },
  { id: 'c', title: { en: 'Lesson 1', ar: '' }, filename: 'clip-1.mp4', uploadedAt: '2026-01-02', publishedAt: '2026-01-15', duration: null },
];

describe('sort keys', () => {
  it('orders by title, file name, dates and duration, both ways', () => {
    expect(sortIds(subjects, 'title')).toEqual(['c', 'b', 'a']);
    expect(sortIds(subjects, 'title', 'desc')).toEqual(['a', 'b', 'c']);
    expect(sortIds(subjects, 'filename')).toEqual(['c', 'b', 'a']);
    expect(sortIds(subjects, 'uploaded')).toEqual(['b', 'c', 'a']);
    expect(sortIds(subjects, 'list', 'desc')).toEqual(['c', 'b', 'a']);
  });

  it('puts missing values last in both directions', () => {
    expect(sortIds(subjects, 'published')).toEqual(['c', 'b', 'a']);
    expect(sortIds(subjects, 'published', 'desc')).toEqual(['b', 'c', 'a']);
    expect(sortIds(subjects, 'duration', 'desc')).toEqual(['a', 'b', 'c']);
  });

  it('sorts by the Arabic title when asked, falling back to English', () => {
    // c has no Arabic title: its English one is compared, and Arabic collation puts Latin after Arabic
    expect(sortIds(subjects, 'title', 'asc', 'ar')).toEqual(['b', 'a', 'c']);
  });
});

describe('direction (2026-11-11 "not ordering items asc and desc when dir button is clicked")', () => {
  const same = (id: string, i: number, over: Partial<RenameSubject> = {}): RenameSubject => ({ id, title: { en: 'Same title', ar: '' }, listIndex: i, ...over });
  const list = [same('p', 0), same('q', 1), same('r', 2)];

  it('reverses equal values: desc is the exact reverse of asc', () => {
    expect(sortIds(list, 'title')).toEqual(['p', 'q', 'r']);
    expect(sortIds(list, 'title', 'desc')).toEqual(['r', 'q', 'p']);
  });

  it('reverses when nobody has a value (no file name, not published, not encoded)', () => {
    for (const key of ['filename', 'published', 'duration'] as const) {
      expect(sortIds(list, key)).toEqual(['p', 'q', 'r']);
      expect(sortIds(list, key, 'desc')).toEqual(['r', 'q', 'p']);
    }
  });

  it('keeps missing values last both ways, reversed among themselves', () => {
    const mixed = [same('p', 0), same('q', 1, { duration: 20 }), same('r', 2), same('s', 3, { duration: 10 })];
    expect(sortIds(mixed, 'duration')).toEqual(['s', 'q', 'p', 'r']);
    expect(sortIds(mixed, 'duration', 'desc')).toEqual(['q', 's', 'r', 'p']);
  });

  it('flips natural and Arabic orders exactly', () => {
    for (const lang of ['en', 'ar'] as const) {
      const asc = sortIds(subjects, 'title', 'asc', lang);
      expect(sortIds(subjects, 'title', 'desc', lang)).toEqual([...asc].reverse());
    }
    const ar: RenameSubject[] = [
      { id: 'x', title: { en: '', ar: 'الدرس ١٠' } },
      { id: 'y', title: { en: '', ar: 'الدرس ٢' } },
      { id: 'z', title: { en: '', ar: 'الدرس 1' } },
    ];
    expect(sortIds(ar, 'title', 'asc', 'ar')).toEqual(['z', 'y', 'x']);
    expect(sortIds(ar, 'title', 'desc', 'ar')).toEqual(['x', 'y', 'z']);
  });

  it('counts what has nothing to sort by', () => {
    expect(missingOrderValues(subjects, 'published')).toBe(1);
    expect(missingOrderValues(subjects, 'list')).toBe(0);
    expect(hasOrderValue(list[0], 'filename')).toBe(false);
  });
});

describe('reorder reducer', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('moves by one and to a position, clamped', () => {
    expect(orderReducer(order, { type: 'moveBy', id: 'c', delta: -1 })).toEqual(['a', 'c', 'b', 'd']);
    expect(orderReducer(order, { type: 'move', id: 'a', to: 3 })).toEqual(['b', 'c', 'd', 'a']);
    expect(orderReducer(order, { type: 'move', id: 'd', to: -5 })).toEqual(['d', 'a', 'b', 'c']);
  });

  it('returns the same order when nothing moves', () => {
    expect(orderReducer(order, { type: 'moveBy', id: 'a', delta: -1 })).toBe(order);
    expect(orderReducer(order, { type: 'moveBy', id: 'zz', delta: 1 })).toBe(order);
  });

  it('sets a whole order', () => {
    expect(orderReducer(order, { type: 'set', ids: ['d', 'c'] })).toEqual(['d', 'c']);
  });
});

describe('numbering follows the order', () => {
  it('numbers the videos in the order shown, from the chosen start, step and padding', () => {
    const ordered = orderedSubjects(subjects, orderReducer(sortIds(subjects, 'title'), { type: 'moveBy', id: 'a', delta: -1 }));
    expect(ordered.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    const rows = previewRename(ordered, { rule: { kind: 'pattern', pattern: 'Lesson {n}', start: 37, step: 1, pad: 3 }, languages: ['en'] });
    expect(rows.map((r) => [r.id, r.after])).toEqual([['c', 'Lesson 037'], ['a', 'Lesson 038'], ['b', 'Lesson 039']]);
  });

  it('keeps subjects the order does not name, in list order', () => {
    expect(orderedSubjects(subjects, ['b']).map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(orderedSubjects(subjects, []).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('continue numbering after', () => {
  it('finds the highest number among titles that fit the pattern, in any digits', () => {
    expect(highestNumber('Lesson {n}', ['Lesson 3', 'lesson 36', 'Lesson ٤١', 'Other 99', 'Lesson 7 extra'])).toBe(41);
    expect(highestNumber('Tafsir {n} – {filename}', ['Tafsir 12 – a', 'Tafsir 9 – b'])).toBe(12);
    expect(highestNumber('درس {n}', ['درس ٣٦', 'درس 2'])).toBe(36);
  });

  it('gives null without {n} or without a match', () => {
    expect(highestNumber('Lesson', ['Lesson 3'])).toBeNull();
    expect(highestNumber('Lesson {n}', ['Talk 3'])).toBeNull();
    expect(highestNumber('a.b {n}', ['aXb 5'])).toBeNull();
  });
});

describe('playlist order', () => {
  it('places the selection together, in order, where the first of them was', () => {
    expect(placeInOrder(['x', 'b', 'y', 'a', 'z'], ['a', 'b'])).toEqual(['x', 'a', 'b', 'y', 'z']);
    expect(placeInOrder(['x', 'y'], ['a', 'b'])).toEqual(['x', 'y', 'a', 'b']);
  });
});
