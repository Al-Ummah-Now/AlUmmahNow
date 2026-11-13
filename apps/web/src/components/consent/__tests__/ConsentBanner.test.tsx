/**
 * Story 1.3 AC 4: bilingual cookie consent banner (LTR + RTL), equal-weight
 * accept/reject, granular choices, reopenable.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import { ConsentManager, hasConsent } from '@/lib/consent/ConsentManager';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS,
    lang: mockLang,
    locale: mockLang,
    isRTL: mockLang === 'ar',
    dir: mockLang === 'ar' ? 'rtl' : 'ltr',
  }),
}));

import { ConsentBanner } from '../ConsentBanner';

function clearCookies() {
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  });
}

describe('ConsentBanner', () => {
  beforeEach(() => {
    clearCookies();
    ConsentManager.resetCache();
    mockLang = 'en';
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
  });

  it('shows in English (LTR) until a choice is made, with accept and reject', () => {
    render(<ConsentBanner />);
    const banner = screen.getByTestId('consent-banner');
    expect(banner).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(EN_TRANSLATIONS.privacy.bannerTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN_TRANSLATIONS.privacy.acceptAll })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN_TRANSLATIONS.privacy.rejectAll })).toBeInTheDocument();
  });

  it('renders the Arabic RTL variant', () => {
    mockLang = 'ar';
    render(<ConsentBanner />);
    expect(screen.getByTestId('consent-banner')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(AR_TRANSLATIONS.privacy.bannerTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: AR_TRANSLATIONS.privacy.rejectAll })).toBeInTheDocument();
  });

  it('reject all records a denial and hides the banner', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole('button', { name: EN_TRANSLATIONS.privacy.rejectAll }));
    expect(screen.queryByTestId('consent-banner')).toBeNull();
    expect(ConsentManager.hasDecided()).toBe(true);
    expect(hasConsent('analytics')).toBe(false);
  });

  it('accept all grants every category', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole('button', { name: EN_TRANSLATIONS.privacy.acceptAll }));
    expect(hasConsent('analytics') && hasConsent('experiments') && hasConsent('performance')).toBe(true);
  });

  it('supports granular choices (all optional categories off by default)', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole('button', { name: EN_TRANSLATIONS.privacy.customize }));
    const performance = screen.getByRole('switch', { name: new RegExp(EN_TRANSLATIONS.privacy.performanceTitle) });
    expect(performance).not.toBeChecked();
    fireEvent.click(performance);
    fireEvent.click(screen.getByRole('button', { name: EN_TRANSLATIONS.privacy.savePreferences }));
    expect(hasConsent('performance')).toBe(true);
    expect(hasConsent('analytics')).toBe(false);
  });

  it('stays hidden once decided and reopens on request', () => {
    ConsentManager.rejectAll();
    render(<ConsentBanner />);
    expect(screen.queryByTestId('consent-banner')).toBeNull();
    act(() => ConsentManager.openPreferences());
    expect(screen.getByTestId('consent-banner')).toBeInTheDocument();
    expect(screen.getByText(EN_TRANSLATIONS.privacy.preferencesTitle)).toBeInTheDocument();
  });

  it('is in the server HTML on a first visit, as a labelled region whose buttons wait for hydration (#1205)', () => {
    const html = renderToString(<ConsentBanner initialVisible />);
    expect(html).toContain('data-testid="consent-banner"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-labelledby="consent-banner-title"');
    expect(html).toContain(EN_TRANSLATIONS.privacy.bannerTitle);
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(3);
  });

  it('is not in the server HTML when the request had a valid choice', () => {
    expect(renderToString(<ConsentBanner initialVisible={false} />)).not.toContain('consent-banner');
  });

  it('enables the buttons once hydrated', () => {
    render(<ConsentBanner initialVisible />);
    for (const button of screen.getAllByRole('button')) expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('hides a server-shown banner when the browser already has a choice', () => {
    ConsentManager.rejectAll();
    ConsentManager.resetCache();
    render(<ConsentBanner initialVisible />);
    expect(screen.queryByTestId('consent-banner')).toBeNull();
  });

  it('every privacy string exists in both English and Arabic', () => {
    const en = Object.keys(EN_TRANSLATIONS.privacy).sort();
    expect(Object.keys(AR_TRANSLATIONS.privacy).sort()).toEqual(en);
    for (const key of en) {
      expect((AR_TRANSLATIONS.privacy as Record<string, string>)[key]).not.toBe('');
    }
  });
});
