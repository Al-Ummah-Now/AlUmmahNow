/**
 * #241: the dashboard shows watch time and subscriber growth (the API already
 * returned them in the daily series, but nothing displayed them).
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';

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

import AnalyticsDashboard, { seriesTotal, toHours, periodChange } from '..';
import AnalyticsDashboardRTL from '../rtl';
import type { AnalyticsMetrics, AnalyticsSummary, ChannelAnalyticsData, VideoAnalyticsData } from '@/lib/api/types';

const day = (date: string, watchTime: number, subscribers: number): AnalyticsMetrics =>
  ({ date, views: 3, likes: 1, comments: 0, shares: 0, subscribers, watchTime } as AnalyticsMetrics);

// 4 days: first half 1800 s + 1 sub, second half 5400 s + 3 subs
const metrics = [day('2026-11-01', 600, 0), day('2026-11-02', 1200, 1), day('2026-11-03', 2400, 1), day('2026-11-04', 3000, 2)];
const summary = {
  totalViews: 12, totalLikes: 4, totalComments: 0, totalSubscribers: 9, totalVideos: 2,
  avgViewsPerVideo: 6, engagementRate: 33.3, topVideo: null,
} as unknown as AnalyticsSummary;

describe('AnalyticsDashboard localized titles', () => {
  it('localizes ranked titles in Arabic and falls back to the original title', () => {
    mockLang = 'ar';
    const topVideo: VideoAnalyticsData = {
      videoId: 'v1', title: 'Introduction', titleLocalized: { ar: 'مقدمة' },
      views: 12, likes: 4, dislikes: 0, comments: 0, shares: 0, watchTime: 0,
      avgViewDuration: 0, clickThroughRate: 0, engagementRate: 33.3, dateCreated: '',
    };
    const channelData: ChannelAnalyticsData = {
      ...summary,
      channelId: 'c1',
      avgEngagementRate: 33.3,
      topPerformingVideos: [
        topVideo,
        { ...topVideo, videoId: 'v2', title: 'Another talk', titleLocalized: undefined },
      ],
      recentMetrics: [],
    };
    render(<AnalyticsDashboardRTL summary={{ ...summary, topVideo }} channelData={channelData} metrics={null} />);
    expect(screen.getAllByText('مقدمة')).toHaveLength(2);
    expect(screen.getByText('Another talk')).toBeInTheDocument();
    expect(screen.queryByText('Introduction')).toBeNull();
  });
});

describe('AnalyticsDashboard growth (#241)', () => {
  beforeEach(() => {
    mockLang = 'en';
  });

  it('sums and converts the series', () => {
    expect(seriesTotal(metrics, 'watchTime')).toBe(7200);
    expect(seriesTotal(metrics, 'subscribers')).toBe(4);
    expect(seriesTotal(null, 'watchTime')).toBe(0);
    expect(toHours(7200)).toBe(2);
    expect(toHours(5400)).toBe(1.5);
    expect(periodChange(metrics, 'watchTime')?.label).toBe('+200%');
  });

  it('shows watch time (hours) and new subscribers with their change', () => {
    render(<AnalyticsDashboard summary={summary} channelData={null} metrics={metrics} />);
    const cards = within(screen.getByTestId('analytics-growth-cards'));
    expect(cards.getByText('Watch Time')).toBeInTheDocument();
    expect(cards.getByText('2 h')).toBeInTheDocument();
    expect(cards.getByText('New Subscribers')).toBeInTheDocument();
    expect(cards.getByText('4')).toBeInTheDocument();
    expect(cards.getAllByText('Last 4 days')).toHaveLength(2);
    // watch time 1800 s → 5400 s and subscribers 1 → 3: both +200%
    expect(cards.getAllByText('+200% vs previous 2 weeks')).toHaveLength(2);
    expect(screen.getByTestId('metrics-watch-time')).toHaveTextContent('Watch Time Over Time');
    expect(screen.getByTestId('metrics-subscribers')).toHaveTextContent('New Subscribers Over Time');
  });

  it('renders the growth cards in Arabic (RTL)', () => {
    mockLang = 'ar';
    const { container } = render(<AnalyticsDashboardRTL summary={summary} channelData={null} metrics={metrics} />);
    expect(container.firstChild).toHaveAttribute('dir', 'rtl');
    const cards = within(screen.getByTestId('analytics-growth-cards'));
    expect(cards.getByText('وقت المشاهدة')).toBeInTheDocument();
    expect(cards.getByText('المشتركون الجدد')).toBeInTheDocument();
    // 7,200 s of watch time: two hours, the dual (#1666)
    expect(cards.getByText('ساعتان')).toBeInTheDocument();
  });
});
