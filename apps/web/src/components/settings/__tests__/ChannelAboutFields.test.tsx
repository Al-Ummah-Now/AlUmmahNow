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
});
