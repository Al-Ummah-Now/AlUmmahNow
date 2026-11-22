/**
 * The Arabic live card speaks Arabic: «مباشر», never "LIVE", and its viewer count
 * sits on a dark pill so it reads on any thumbnail.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/utils/test-utils';
import { createMockLiveStream } from '@/__tests__/utils/mock-data';
import { LiveStreamCardRTL, arabicTimeSpan } from '../index';

describe('LiveStreamCardRTL', () => {
  it('labels a live stream «مباشر», not "LIVE"', () => {
    const { container } = renderWithProviders(<LiveStreamCardRTL stream={createMockLiveStream({ status: 'live' })} />);
    expect(screen.getAllByText('مباشر').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bLIVE\b/);
  });

  it('shows the viewer count on the duration badge colours, never red text on the thumbnail', () => {
    const { container } = renderWithProviders(<LiveStreamCardRTL stream={createMockLiveStream({ status: 'live' })} />);
    const pill = [...container.querySelectorAll<HTMLElement>('[role="status"]')].find((el) => el.textContent?.includes('ألف')) as HTMLElement;
    expect(pill).toBeTruthy(); // the mock stream has 1,234 viewers: «١٫٢ ألف»
    expect(pill.className).toMatch(/bg-\[var\(--fanous-c-badge-duration-bg\)\]/);
    expect(pill.className).toMatch(/text-\[var\(--fanous-c-badge-duration-text\)\]/);
    expect(pill.className).not.toMatch(/text-red-600/);
  });

  it('counts time in the genitive after «منذ»/«بعد»: no «١» or «٢» before the noun, CLDR forms above', () => {
    expect(arabicTimeSpan(1, 'minute')).toBe('دقيقة');
    expect(arabicTimeSpan(2, 'minute')).toBe('دقيقتين');
    expect(arabicTimeSpan(3, 'minute')).toBe('٣ دقائق');
    expect(arabicTimeSpan(10, 'minute')).toBe('١٠ دقائق');
    expect(arabicTimeSpan(11, 'minute')).toBe('١١ دقيقة');
    expect(arabicTimeSpan(59, 'minute')).toBe('٥٩ دقيقة');
    expect(arabicTimeSpan(2, 'hour')).toBe('ساعتين');
    expect(arabicTimeSpan(12, 'hour')).toBe('١٢ ساعة');
    expect(arabicTimeSpan(1, 'day')).toBe('يوم');
    expect(arabicTimeSpan(15, 'day')).toBe('١٥ يومًا');
    expect(arabicTimeSpan(100, 'day')).toBe('١٠٠ يوم');
  });

  it('says «بدأ منذ دقيقة» for a stream that started a minute ago, never «منذ ١ دقيقة»', () => {
    const startedAt = new Date(Date.now() - 90_000);
    const { container } = renderWithProviders(<LiveStreamCardRTL stream={{ ...createMockLiveStream({ status: 'live' }), startedAt }} />);
    expect(container.textContent).toContain('بدأ منذ دقيقة');
    expect(container.textContent).not.toContain('١ دقيقة');
  });

  it('says «يبدأ بعد ساعتين و٥ دقائق» for a scheduled stream, dropping zero minutes', () => {
    const at = (ms: number) => new Date(Date.now() + ms + 20_000);
    const { container, rerender } = renderWithProviders(
      <LiveStreamCardRTL stream={{ ...createMockLiveStream({ status: 'scheduled' }), scheduledStartTime: at(2 * 3_600_000 + 5 * 60_000) }} />,
    );
    expect(container.textContent).toContain('يبدأ بعد ساعتين و٥ دقائق');
    rerender(<LiveStreamCardRTL stream={{ ...createMockLiveStream({ status: 'scheduled' }), scheduledStartTime: at(3_600_000) }} />);
    expect(container.textContent).toContain('يبدأ بعد ساعة');
    expect(container.textContent).not.toMatch(/٠ دقيقة|و ?٠/);
  });
});
