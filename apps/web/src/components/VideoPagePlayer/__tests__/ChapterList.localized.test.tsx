/**
 * Regression: the chapter list and the current-chapter overlay always showed
 * the default (English) chapter title, even on /ar where the chapter has an
 * Arabic title (the progress-bar markers already used it).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { VideoChapter } from '@al-ummah/shared-types';
import { ChapterList } from '../ChapterList';
import { CurrentChapter } from '../CurrentChapter';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS,
    lang: 'ar',
    locale: 'ar',
    dir: 'rtl',
    isRTL: true,
  }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const chapters = [
  { id: 'c1', title: 'Introduction', titleLocalized: { en: 'Introduction', ar: 'مقدمة' }, startTime: 0, endTime: 60 },
  { id: 'c2', title: 'Main topic', titleLocalized: { en: 'Main topic' }, startTime: 60, endTime: 120 },
] as VideoChapter[];

describe('chapter titles on Arabic pages', () => {
  it('chapter list shows the Arabic title and falls back to the default title', () => {
    render(
      <ChapterList
        chapters={chapters}
        currentChapter={chapters[0]}
        currentChapterIndex={0}
        onSeek={jest.fn()}
        isOpen
        onToggle={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /مقدمة/ })).toBeInTheDocument();
    expect(screen.queryByText('Introduction')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Main topic/ })).toBeInTheDocument();
  });

  it('current-chapter overlay shows the Arabic title', () => {
    render(<CurrentChapter chapter={chapters[0]} enabled />);
    expect(screen.getByText('مقدمة')).toBeInTheDocument();
  });
});
