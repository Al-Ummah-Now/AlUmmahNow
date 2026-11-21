/**
 * The Arabic live card speaks Arabic: «مباشر», never "LIVE", and its viewer count
 * sits on a dark pill so it reads on any thumbnail.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/utils/test-utils';
import { createMockLiveStream } from '@/__tests__/utils/mock-data';
import { LiveStreamCardRTL } from '../index';

describe('LiveStreamCardRTL', () => {
  it('labels a live stream «مباشر», not "LIVE"', () => {
    const { container } = renderWithProviders(<LiveStreamCardRTL stream={createMockLiveStream({ status: 'live' })} />);
    expect(screen.getAllByText('مباشر').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bLIVE\b/);
  });

  it('shows the viewer count on a dark pill with white text', () => {
    const { container } = renderWithProviders(<LiveStreamCardRTL stream={createMockLiveStream({ status: 'live' })} />);
    const pill = [...container.querySelectorAll<HTMLElement>('[role="status"]')].find((el) => el.textContent?.includes('ألف')) as HTMLElement;
    expect(pill).toBeTruthy(); // the mock stream has 1,234 viewers: «١٫٢ ألف»
    expect(pill.className).toMatch(/bg-black\/75/);
    expect(pill.className).toMatch(/text-white/);
    expect(pill.className).not.toMatch(/text-red-600/);
  });
});
