/**
 * Story 1.4 AC 4 - skip links for main content areas (LTR + RTL)
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

let mockPathname = '/en';
let mockLang: 'en' | 'ar' = 'en';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    locale: mockLang,
    dir: mockLang === 'ar' ? 'rtl' : 'ltr',
    isRTL: mockLang === 'ar',
  }),
}));

import SkipLinks from '../index';

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  mockPathname = '/en';
  mockLang = 'en';
});

describe('SkipLinks', () => {
  it('renders "Skip to main content" as a link inside a labelled nav', () => {
    render(<SkipLinks />);
    const nav = screen.getByRole('navigation', { name: 'Skip links' });
    expect(nav).toHaveAttribute('dir', 'ltr');
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link).toHaveAttribute('href', '#main-content');
    expect(screen.queryByRole('link', { name: 'Skip to video player' })).not.toBeInTheDocument();
  });

  it('moves focus to the main landmark when activated', () => {
    render(
      <>
        <SkipLinks />
        <main id="main-content"><h1>Page</h1></main>
      </>
    );
    fireEvent.click(screen.getByRole('link', { name: 'Skip to main content' }));
    expect(document.activeElement).toBe(document.getElementById('main-content'));
  });

  it('falls back to the page content wrapper on pages without a <main> landmark (LTR + RTL)', () => {
    for (const lang of ['en', 'ar'] as const) {
      mockLang = lang;
      mockPathname = `/${lang}/dashboard/videos`;
      const { unmount } = render(
        <>
          <SkipLinks />
          <div id="page-content"><h1>Dashboard</h1></div>
        </>
      );
      fireEvent.click(screen.getAllByRole('link')[0]);
      expect(document.activeElement).toBe(document.getElementById('page-content'));
      unmount();
    }
  });

  it('adds player and comments targets on the watch page and focuses the player root', () => {
    mockPathname = '/en/video/abc-123';
    render(
      <>
        <SkipLinks />
        <main id="main-content">
          <section id="video-player"><div className="video-js" tabIndex={-1} data-testid="vjs" /></section>
          <div id="comments" />
        </main>
      </>
    );
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links).toEqual(['Skip to main content', 'Skip to video player', 'Skip to comments']);

    fireEvent.click(screen.getByRole('link', { name: 'Skip to video player' }));
    expect(document.activeElement).toBe(screen.getByTestId('vjs'));

    fireEvent.click(screen.getByRole('link', { name: 'Skip to comments' }));
    expect(document.activeElement).toBe(document.getElementById('comments'));
  });

  it('renders the Arabic RTL variant', () => {
    mockLang = 'ar';
    mockPathname = '/ar/video/abc-123';
    render(<SkipLinks />);
    expect(screen.getByRole('navigation', { name: 'روابط التخطي' })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('link', { name: 'انتقل إلى المحتوى الرئيسي' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'انتقل إلى مشغل الفيديو' })).toBeInTheDocument();
  });
});
