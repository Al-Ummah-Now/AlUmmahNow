/**
 * The shared Switch and the settings breadcrumb trail.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS,
    lang: mockLang,
    dir: mockLang === 'ar' ? 'rtl' : 'ltr',
  }),
}));

import { Switch } from '@/components/common/Switch';
import { BreadcrumbTrail, openedFromSettings, settingsTrail } from '../SettingsBreadcrumb';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';

describe('Switch', () => {
  it('is a button[role=switch] whose aria-checked follows the value and toggles on click', () => {
    const onChange = jest.fn();
    const { rerender } = render(<Switch checked={false} onCheckedChange={onChange} aria-label="Alerts" />);
    const sw = screen.getByRole('switch', { name: 'Alerts' });
    expect(sw.tagName).toBe('BUTTON');
    expect(sw).toHaveAttribute('type', 'button');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveClass('sw');
    // No utility classes: theme selectors match on them
    expect(sw.className).toBe('sw');
    expect(sw.querySelector('[data-switch-track] [data-switch-thumb]')).not.toBeNull();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Switch checked onCheckedChange={onChange} aria-label="Alerts" />);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toBeChecked();
  });

  it('does not toggle when disabled', () => {
    const onChange = jest.fn();
    render(<Switch checked={false} onCheckedChange={onChange} disabled aria-label="Alerts" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('settingsTrail', () => {
  const t = EN_TRANSLATIONS;
  it('has no trail on /settings itself or outside settings', () => {
    expect(settingsTrail('/en/settings', 'en', t)).toBeNull();
    expect(settingsTrail('/en/settings/', 'en', t)).toBeNull();
    expect(settingsTrail('/en/explore', 'en', t)).toBeNull();
  });

  it('starts at Settings on the settings sub-pages', () => {
    expect(settingsTrail('/en/settings/upload-defaults', 'en', t)).toEqual([
      { label: 'Settings', href: '/en/settings' },
      { label: 'Upload Defaults', href: '/en/settings/upload-defaults' },
    ]);
    expect(settingsTrail('/ar/settings/privacy', 'ar', AR_TRANSLATIONS)?.[0].href).toBe('/ar/settings');
  });

  it('shows on the profile page only when opened from Settings', () => {
    expect(settingsTrail('/en/profile', 'en', t)).toBeNull();
    expect(settingsTrail('/en/profile', 'en', t, true)?.map((c) => c.href)).toEqual(['/en/settings', '/en/profile']);
  });

  it('shows on Contact us only when opened from Settings', () => {
    expect(settingsTrail('/en/contact', 'en', t)).toBeNull();
    expect(settingsTrail('/ar/contact', 'ar', AR_TRANSLATIONS, true)?.map((c) => c.href)).toEqual(['/ar/settings', '/ar/contact']);
  });

  it('reads "opened from Settings" from ?from=settings or ?from=/<lang>/settings', () => {
    expect(openedFromSettings('settings', 'en')).toBe(true);
    expect(openedFromSettings('/en/settings', 'en')).toBe(true);
    expect(openedFromSettings('/ar/settings/', 'ar')).toBe(true);
    expect(openedFromSettings('/en/settings/privacy', 'en')).toBe(false);
    expect(openedFromSettings('/en/watch/abc', 'en')).toBe(false);
    expect(openedFromSettings(null, 'en')).toBe(false);
  });
});

describe('BreadcrumbTrail', () => {
  afterEach(() => { mockLang = 'en'; });

  it('links back to the nearest linked ancestor and marks the current page', () => {
    render(<BreadcrumbTrail label="Trail" trail={[{ label: 'Settings', href: '/en/settings' }, { label: 'Group' }, { label: 'Here', href: '/en/x' }]} />);
    expect(screen.getByTestId('settings-back')).toHaveAttribute('href', '/en/settings');
    expect(screen.getByTestId('settings-back')).toHaveAccessibleName('Back to Settings');
    expect(screen.getByText('Here')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('navigation', { name: 'Trail' })).toHaveAttribute('dir', 'ltr');
  });

  it('runs right to left in Arabic', () => {
    mockLang = 'ar';
    render(<BreadcrumbTrail label="Trail" trail={[{ label: 'A', href: '/ar/settings' }, { label: 'B' }]} />);
    expect(screen.getByRole('navigation', { name: 'Trail' })).toHaveAttribute('dir', 'rtl');
  });

  it('channel pages: Settings › Channel Settings › <channel> › page, back to the channel overview', () => {
    render(<ChannelSettingsBreadcrumb channelId="c1" channelName="My Channel" locale="en" currentPage="sections" />);
    const nav = screen.getByTestId('channel-settings-breadcrumb');
    expect(nav).toHaveTextContent(/^Settings.*Channel Settings.*My Channel.*Manage Sections$/);
    expect(screen.getByRole('link', { name: 'My Channel' })).toHaveAttribute('href', '/en/settings/channel/c1');
    expect(screen.getByTestId('settings-back')).toHaveAttribute('href', '/en/settings/channel/c1');
  });

  it('channel overview goes back to Settings; a new post goes back to Community', () => {
    const { unmount } = render(<ChannelSettingsBreadcrumb channelId="c1" channelName="My Channel" locale="en" currentPage="overview" />);
    expect(screen.getByTestId('settings-back')).toHaveAttribute('href', '/en/settings');
    unmount();
    render(<ChannelSettingsBreadcrumb channelId="c1" locale="en" currentPage="communityNew" />);
    expect(screen.getByTestId('settings-back')).toHaveAttribute('href', '/en/settings/channel/c1/community');
  });
});
