/**
 * Epic 8.1: previous/next chapter controls (Arabic page: localized labels,
 * Arabic chapter title, RTL direction, disabled at the ends).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { VideoChapter } from '@al-ummah/shared-types';
import { ChapterNav } from '../ChapterNav';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS,
    lang: 'ar',
    locale: 'ar',
    dir: 'rtl',
    isRTL: true,
  }),
}));

const chapters = [
  { id: 'c1', title: 'Introduction', titleLocalized: { ar: 'مقدمة' }, startTime: 0, endTime: 60 },
  { id: 'c2', title: 'Main topic', startTime: 60, endTime: 120 },
] as VideoChapter[];

describe('ChapterNav', () => {
  it('shows localized controls and the Arabic chapter title, RTL', () => {
    const onPrevious = jest.fn();
    const onNext = jest.fn();
    render(<ChapterNav chapters={chapters} currentChapter={chapters[0]} currentChapterIndex={0} onPrevious={onPrevious} onNext={onNext} />);
    expect(screen.getByTestId('chapter-nav')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('chapter-nav-current')).toHaveTextContent('مقدمة');
    fireEvent.click(screen.getByTestId('chapter-next'));
    fireEvent.click(screen.getByTestId('chapter-previous'));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('chapter-next')).toHaveTextContent('الفصل التالي');
    expect(screen.getByTestId('chapter-next')).toHaveAttribute('aria-keyshortcuts', 'Control+ArrowLeft Alt+ArrowLeft');
  });

  it('disables next on the last chapter and previous before the first', () => {
    const { rerender } = render(<ChapterNav chapters={chapters} currentChapter={chapters[1]} currentChapterIndex={1} onPrevious={jest.fn()} onNext={jest.fn()} />);
    expect(screen.getByTestId('chapter-next')).toBeDisabled();
    expect(screen.getByTestId('chapter-previous')).toBeEnabled();
    rerender(<ChapterNav chapters={chapters} currentChapter={null} currentChapterIndex={-1} onPrevious={jest.fn()} onNext={jest.fn()} />);
    expect(screen.getByTestId('chapter-previous')).toBeDisabled();
    expect(screen.getByTestId('chapter-next')).toBeEnabled();
  });
});
