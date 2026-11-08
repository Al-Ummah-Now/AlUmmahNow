import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const isAr = mockLang === 'ar';
    return {
      t: isAr
        ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
        : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
      lang: mockLang,
      isRTL: isAr,
    };
  },
}));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
const mockGet = jest.fn();
jest.mock('@/lib/api/analytics', () => ({ getVideoAnalytics: (...a: unknown[]) => mockGet(...a) }));

import { VideoAnalyticsView, formatDuration } from '..';

const data = {
  videoId: 'v1', title: 'Tafsir lesson', views: 1234, likes: 50, dislikes: 0, comments: 7, shares: 0,
  watchTime: 9000, avgViewDuration: 75, clickThroughRate: 0, engagementRate: 4.6, dateCreated: '2026-11-01T00:00:00.000Z',
};

describe('VideoAnalyticsView (#241)', () => {
  beforeEach(() => {
    mockLang = 'en';
    mockGet.mockReset();
  });

  it('formats durations', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(NaN)).toBe('0:00');
  });

  it('shows loading, then the video totals, watch time and average view duration', async () => {
    mockGet.mockResolvedValue(data);
    render(<VideoAnalyticsView videoId="v1" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tafsir lesson' })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('v1');
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('2.5 h')).toBeInTheDocument();
    expect(screen.getByText('1:15')).toBeInTheDocument();
    expect(screen.getByText('4.6%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to analytics/ })).toHaveAttribute('href', '/en/analytics');
  });

  it('shows an error with retry when the API answers nothing, and recovers', async () => {
    mockGet.mockResolvedValueOnce(null).mockResolvedValueOnce(data);
    render(<VideoAnalyticsView videoId="v1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load analytics');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tafsir lesson' })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('shows the error state when the request throws', async () => {
    mockGet.mockRejectedValue(new Error('network'));
    render(<VideoAnalyticsView videoId="v1" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('renders RTL in Arabic', async () => {
    mockLang = 'ar';
    mockGet.mockResolvedValue(data);
    render(<VideoAnalyticsView videoId="v1" />);
    await screen.findByRole('heading', { level: 1, name: 'Tafsir lesson' });
    expect(screen.getByTestId('video-analytics')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('متوسط مدة المشاهدة')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /العودة إلى الإحصاءات/ })).toHaveAttribute('href', '/ar/analytics');
  });
});
