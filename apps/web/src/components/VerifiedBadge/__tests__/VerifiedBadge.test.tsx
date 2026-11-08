import React from 'react';
import { render, screen } from '@testing-library/react';
import { VerifiedBadge } from '..';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    isRTL: mockLang === 'ar',
  }),
}));

describe('VerifiedBadge (Epic 6.1)', () => {
  it('has a localized accessible name', () => {
    mockLang = 'en';
    const { unmount } = render(<VerifiedBadge />);
    expect(screen.getByRole('img', { name: 'Verified' })).toBeInTheDocument();
    unmount();
    mockLang = 'ar';
    render(<VerifiedBadge />);
    const ar = jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS.search.verified;
    expect(ar).not.toBe('Verified');
    expect(screen.getByRole('img', { name: ar })).toBeInTheDocument();
  });
});
