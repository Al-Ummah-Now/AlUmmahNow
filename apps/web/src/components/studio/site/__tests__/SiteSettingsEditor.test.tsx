/** Studio → Site settings (SS16): the checklist, the home page pick, SEO validation in words, the page menu kind. */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SITE_THEME_CHOICES, SITE_TIER_SEEDS } from '@al-ummah/shared-types';
import { SiteSettingsEditor } from '../SiteSettingsEditor';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', locale: 'en', isRTL: false }),
}));
jest.mock('@/lib/studio/site-client', () => ({ saveSiteSettings: jest.fn(), previewSiteSettings: jest.fn(), uploadSiteImage: jest.fn() }));

const site = {
  schemaVersion: 1,
  channelId: 'ch1',
  slug: 'scholar',
  status: 'live',
  tier: 'white-label',
  limits: SITE_TIER_SEEDS['white-label'].limits,
  themeRef: `${SITE_THEME_CHOICES[0].id}@${SITE_THEME_CHOICES[0].version}`,
  name: {},
  logoUrl: 'https://images.alummahnow.net/logo.png',
  faviconUrl: null,
  locales: ['en', 'ar'],
  navigation: [],
  about: {},
  hosts: [{ host: 'scholar.alummahnow.org', kind: 'subdomain', primary: true }],
  redirectHosts: [],
  pages: [{ id: 'pg_0123456789abcdef', slug: 'about-us', title: { en: 'About us' }, status: 'published', updatedAt: '2026-11-13T00:00:00Z' }],
  configVersion: 1,
  grantedAt: '',
  grantedBy: '',
  updatedAt: '',
  updatedBy: '',
} as never;

describe('SiteSettingsEditor', () => {
  it('shows the checklist, offers pages for the home and the menu, and explains a bad title template', () => {
    render(<SiteSettingsEditor locale="en" channelId="ch1" channelName="Scholar" initial={{ site, etag: 'e1', primaryHost: 'scholar.alummahnow.org', themes: [] }} />);
    const items = screen.getByTestId('studio-site-overview').querySelectorAll('li');
    expect(items[0]).toHaveAttribute('data-done', 'true'); // logo
    expect(items[1]).toHaveAttribute('data-done', 'false'); // about
    expect(items[2]).toHaveAttribute('data-done', 'true'); // a page
    fireEvent.change(screen.getByTestId('studio-site-home-page'), { target: { value: 'pg_0123456789abcdef' } });
    expect(screen.getByTestId('studio-site-save')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('studio-site-nav-add'));
    const kind = screen.getAllByTestId('studio-site-nav-item').at(-1)!.querySelector('select')!;
    fireEvent.change(kind, { target: { value: 'page' } });
    expect(screen.getByTestId('studio-site-nav-page')).toHaveValue('pg_0123456789abcdef');
    fireEvent.change(screen.getByTestId('studio-site-seo-title'), { target: { value: 'No placeholder' } });
    expect(screen.getByTestId('studio-site-message')).toHaveTextContent('the title needs %s');
    expect(screen.getByTestId('studio-site-save')).toBeDisabled();
  });
});
