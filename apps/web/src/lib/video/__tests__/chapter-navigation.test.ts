import { adjacentChapter, chapterShortcut } from '../chapters';

const ch = (id: string, startTime: number, endTime: number) => ({ id, startTime, endTime, title: id });
const chapters = [ch('intro', 0, 60), ch('verse', 60, 180), ch('summary', 180, 300)];
const key = (k: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey', boolean>> = {}) =>
  ({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods });

describe('adjacentChapter (Epic 8.1 previous/next)', () => {
  it('next goes to the following chapter, and to nothing after the last', () => {
    expect(adjacentChapter(chapters, 10, 'next')?.id).toBe('verse');
    expect(adjacentChapter(chapters, 60, 'next')?.id).toBe('summary');
    expect(adjacentChapter(chapters, 200, 'next')).toBeNull();
  });

  it('next from before the first chapter goes to the first one', () => {
    expect(adjacentChapter([ch('a', 30, 90)], 5, 'next')?.id).toBe('a');
  });

  it('previous restarts the chapter after 3 s, otherwise goes back one', () => {
    expect(adjacentChapter(chapters, 100, 'previous')?.id).toBe('verse');
    expect(adjacentChapter(chapters, 61, 'previous')?.id).toBe('intro');
    expect(adjacentChapter(chapters, 1, 'previous')?.id).toBe('intro');
  });

  it('handles empty lists and bad times', () => {
    expect(adjacentChapter([], 10, 'next')).toBeNull();
    expect(adjacentChapter(chapters, Number.NaN, 'previous')).toBeNull();
  });
});

describe('chapterShortcut', () => {
  it('Ctrl/Alt + arrows navigate chapters in LTR', () => {
    expect(chapterShortcut(key('ArrowRight', { ctrlKey: true }), false)).toBe('next');
    expect(chapterShortcut(key('ArrowLeft', { altKey: true }), false)).toBe('previous');
  });

  it('swaps arrows in RTL', () => {
    expect(chapterShortcut(key('ArrowLeft', { ctrlKey: true }), true)).toBe('next');
    expect(chapterShortcut(key('ArrowRight', { ctrlKey: true }), true)).toBe('previous');
  });

  it('ignores plain arrows (seek), Meta and Shift combinations and other keys', () => {
    expect(chapterShortcut(key('ArrowRight'), false)).toBeNull();
    expect(chapterShortcut(key('ArrowRight', { metaKey: true, ctrlKey: true }), false)).toBeNull();
    expect(chapterShortcut(key('ArrowRight', { shiftKey: true, altKey: true }), false)).toBeNull();
    expect(chapterShortcut(key('k', { ctrlKey: true }), false)).toBeNull();
  });
});
