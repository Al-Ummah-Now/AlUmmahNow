import React from 'react';
import { render, screen } from '@testing-library/react';
import { COMMUNITY_GUIDELINES_AR, COMMUNITY_GUIDELINES_EN } from '@al-ummah/shared-types';
import { CommunityGuidelinesPage } from '..';

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

describe('Community guidelines page (Epic 6.3)', () => {
  it('renders every section in English, LTR', () => {
    mockLang = 'en';
    render(<CommunityGuidelinesPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COMMUNITY_GUIDELINES_EN.title);
    expect(screen.getByTestId('community-guidelines')).toHaveAttribute('dir', 'ltr');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(7);
    expect(screen.getByText(COMMUNITY_GUIDELINES_EN.sections.prohibited.points[0])).toBeInTheDocument();
  });

  it('renders in Arabic, RTL', () => {
    mockLang = 'ar';
    render(<CommunityGuidelinesPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COMMUNITY_GUIDELINES_AR.title);
    expect(screen.getByTestId('community-guidelines')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(COMMUNITY_GUIDELINES_AR.sections.reporting.heading)).toBeInTheDocument();
  });

  it('has the same shape in both languages', () => {
    const shape = (g: typeof COMMUNITY_GUIDELINES_EN) =>
      Object.entries(g.sections).map(([k, s]) => [k, s.points.length]);
    expect(shape(COMMUNITY_GUIDELINES_AR)).toEqual(shape(COMMUNITY_GUIDELINES_EN));
  });
});
