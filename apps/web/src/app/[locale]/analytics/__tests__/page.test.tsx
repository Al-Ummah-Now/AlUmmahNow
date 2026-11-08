/**
 * Analytics page: one dashboard load per user/channel, and an error state
 * (never an endless "Loading...") when the API gives nothing back.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';

// A new translations object on every render, as when API translations swap in.
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { ...EN_TRANSLATIONS }, lang: 'en', isRTL: false, dir: 'ltr' }),
}));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'usr_1' } }) }));
jest.mock('@/hooks/useMultiAccount', () => ({ useCurrentChannel: () => ({ id: 'ch_1' }) }));
jest.mock('@/lib/actions', () => ({ login: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));
jest.mock('@/components/analytics/AnalyticsDashboard', () => ({
  __esModule: true,
  default: ({ summary }: { summary: { totalVideos: number } | null }) => <p>videos:{summary?.totalVideos}</p>,
}));
jest.mock('@/components/analytics/AnalyticsDashboard/rtl', () => ({ __esModule: true, default: () => null }));
const mockDashboard = jest.fn();
jest.mock('@/lib/api/analytics', () => ({
  getAnalyticsDashboard: (...args: unknown[]) => mockDashboard(...args),
}));

import AnalyticsPage from '../page';

describe('AnalyticsPage', () => {
  beforeEach(() => mockDashboard.mockReset());

  it('loads the dashboard once for the selected channel and renders it', async () => {
    mockDashboard.mockResolvedValue({ summary: { totalVideos: 3 }, metrics: [], channel: null });
    render(<AnalyticsPage />);
    expect(await screen.findByRole('heading', { level: 1, name: EN_TRANSLATIONS.analytics.analyticsTitle })).toBeInTheDocument();
    expect(screen.getByText('videos:3')).toBeInTheDocument();
    expect(mockDashboard).toHaveBeenCalledTimes(1);
    expect(mockDashboard).toHaveBeenCalledWith('ch_1');
  });

  it('shows the error state when the API returns no data', async () => {
    mockDashboard.mockResolvedValue({ summary: null, metrics: null, channel: null });
    render(<AnalyticsPage />);
    expect(await screen.findByText(EN_TRANSLATIONS.errors.genericError)).toBeInTheDocument();
    expect(screen.queryByText(EN_TRANSLATIONS.common.loading)).toBeNull();
  });

  it('shows the error state when the request throws', async () => {
    mockDashboard.mockRejectedValue(new Error('network'));
    render(<AnalyticsPage />);
    await waitFor(() => expect(screen.getByText(EN_TRANSLATIONS.errors.genericError)).toBeInTheDocument());
  });
});
