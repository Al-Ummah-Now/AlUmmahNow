/**
 * Regression (AUDIT-2, 2026-11-22): the current-chapter toast never hid. Recording the shown
 * chapter in state re-ran the effect, whose cleanup cleared the hide timer, so the toast stayed
 * over the captions on a phone-width player.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import type { VideoChapter } from '@al-ummah/shared-types';
import { CurrentChapter } from '../CurrentChapter';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', dir: 'ltr', isRTL: false }),
}));

const c1 = { id: 'c1', title: 'Opening', startTime: 0, endTime: 30 } as VideoChapter;
const c2 = { id: 'c2', title: 'The middle', startTime: 30, endTime: 60 } as VideoChapter;
const toast = () => screen.getByRole('status');

describe('CurrentChapter auto-hide', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows on a chapter change and hides after the delay', () => {
    const { rerender } = render(<CurrentChapter chapter={c1} autoHideDelay={3000} />);
    expect(toast()).toHaveClass('opacity-100');
    act(() => { jest.advanceTimersByTime(3000); });
    expect(toast()).toHaveClass('opacity-0');

    rerender(<CurrentChapter chapter={c2} autoHideDelay={3000} />);
    expect(toast()).toHaveClass('opacity-100');
    act(() => { jest.advanceTimersByTime(3000); });
    expect(toast()).toHaveClass('opacity-0');
  });

  it('stays hidden when the same chapter is passed again', () => {
    const { rerender } = render(<CurrentChapter chapter={c1} autoHideDelay={3000} />);
    act(() => { jest.advanceTimersByTime(3000); });
    rerender(<CurrentChapter chapter={{ ...c1 }} autoHideDelay={3000} />);
    expect(toast()).toHaveClass('opacity-0');
  });
});
