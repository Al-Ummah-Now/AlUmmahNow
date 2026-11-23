/**
 * Credits page (QF 2026-11-23): QF's full line with its link, and the editions the API lists, in
 * English and Arabic. The list is whatever the API generated from the configured editions.
 */
import { render, screen, within } from '@testing-library/react';
import { CreditsPage } from '../CreditsPage';
import type { QuranCredits } from '@/lib/credits/quran-credits';

const credits: QuranCredits = {
  attribution: { en: 'Quran data provided by Quran Foundation (https://quran.foundation/)', ar: 'بيانات القرآن مقدَّمة من مؤسسة القرآن (https://quran.foundation/‎)' },
  credit: { en: 'Source: Quran Foundation', ar: 'المصدر: مؤسسة القرآن', url: 'https://quran.foundation/' },
  quranText: true,
  editions: [
    { id: 85, name: 'M.A.S. Abdel Haleem', author: 'Abdel Haleem', language: 'en' },
    { id: 20, name: 'Saheeh International', author: 'Saheeh International', language: 'en' },
    { id: 31, name: 'Muhammad Hamidullah', author: 'Hamidullah', language: 'fr' },
  ],
};

describe('CreditsPage', () => {
  it('shows QF’s full line, its URL linked in a new tab, and every edition with its translator (en)', () => {
    render(<CreditsPage locale="en" quran={credits} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Credits');
    expect(screen.getByTestId('credits-qf-attribution')).toHaveTextContent('Quran data provided by Quran Foundation (https://quran.foundation/)');
    const link = screen.getByTestId('credits-qf-link');
    expect(link).toHaveAttribute('href', 'https://quran.foundation/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
    const items = within(screen.getByTestId('credits-editions')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'M.A.S. Abdel Haleem, translated by Abdel Haleem · English',
      'Saheeh International · English',
      'Muhammad Hamidullah, translated by Hamidullah · French',
    ]);
  });

  it('Arabic: QF’s Arabic line, right to left, language names in Arabic', () => {
    render(<CreditsPage locale="ar" quran={credits} />);
    expect(screen.getByTestId('credits-page')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('المصادر');
    expect(screen.getByTestId('credits-qf-attribution')).toHaveTextContent('بيانات القرآن مقدَّمة من مؤسسة القرآن (https://quran.foundation/)');
    const items = within(screen.getByTestId('credits-editions')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('M.A.S. Abdel Haleem، ترجمة Abdel Haleem · الإنجليزية');
  });

  it('with the list unavailable: QF’s line still shows, and says so', () => {
    render(<CreditsPage locale="en" quran={{ ...credits, editions: [] }} editionsUnavailable />);
    expect(screen.getByTestId('credits-qf-attribution')).toHaveTextContent('Quran data provided by Quran Foundation');
    expect(screen.queryByTestId('credits-editions')).toBeNull();
    expect(screen.getByTestId('credits-editions-unavailable')).toBeInTheDocument();
  });
});
