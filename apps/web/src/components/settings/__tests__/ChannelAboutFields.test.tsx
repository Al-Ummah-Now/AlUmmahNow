/**
 * The Studio Profile page shows these fields under the name and description, so they wear the same
 * theme tokens as ProfileTab's FIELD: never the old grey boxes the theme background showed through.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: EN_TRANSLATIONS, lang: 'en', isRTL: false }) }));
jest.mock('@/lib/api/channel-profile', () => ({ checkHandleAvailability: jest.fn().mockResolvedValue({ available: true }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { ChannelAboutFields } from '../ChannelAboutFields';

describe('ChannelAboutFields look like the Profile form fields', () => {
  it('handle, link, e-mail and location inputs use the theme field tokens', () => {
    render(
      <ChannelAboutFields
        channelId="ch1"
        currentHandle="halaqat.alfajr"
        value={{ handle: 'halaqat.alfajr', links: [{ title: 'Website', url: 'https://alummahnow.net' }], contactEmail: 'hello@mail.alummahnow.net', location: 'Amman' }}
        onChange={jest.fn()}
      />,
    );
    const fields = screen.getAllByRole('textbox');
    expect(fields.length).toBeGreaterThanOrEqual(5);
    for (const el of fields) {
      for (const token of ['border-input', 'bg-background', 'text-foreground', 'rounded-md']) expect(el).toHaveClass(token);
      expect(el.className).not.toMatch(/\b(?:dark:)?(?:bg|border)-gray-\d+/);
    }
  });

  it('help lines wrap balanced, so none ends on one lone word ("hide / it." on a phone)', () => {
    const { container } = render(
      <ChannelAboutFields channelId="ch1" currentHandle="halaqat.alfajr" value={{ handle: 'halaqat.alfajr', links: [], contactEmail: '', location: '' }} onChange={jest.fn()} />,
    );
    const handleHelp = screen.getByTestId('channel-handle-help');
    const help = [...container.querySelectorAll('p')].filter((p) => p !== handleHelp);
    expect(help.length).toBeGreaterThanOrEqual(3);
    for (const p of help) expect(p).toHaveClass('text-balance');
  });

  it('the handle help puts the URL and the rule on their own lines, the URL isolated (no "… 3 / to 30")', () => {
    render(
      <ChannelAboutFields channelId="ch1" currentHandle="halaqat.alfajr" value={{ handle: 'halaqat.alfajr', links: [], contactEmail: '', location: '' }} onChange={jest.fn()} />,
    );
    const help = screen.getByTestId('channel-handle-help');
    const lines = [...help.children] as HTMLElement[];
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toHaveClass('block');
    expect(lines[0].textContent).toMatch(/^Your channel URL: \S+\/@halaqat\.alfajr$/);
    expect(lines[0].querySelector('bdi')).toHaveAttribute('dir', 'ltr');
    expect(lines[0].querySelector('bdi')?.textContent).toMatch(/\/@halaqat\.alfajr$/);
    expect(lines[1].textContent).toBe('3 to 30 characters: Latin letters, digits, periods, underscores and hyphens.');
    expect(lines[1]).toHaveClass('text-balance');
  });
});
