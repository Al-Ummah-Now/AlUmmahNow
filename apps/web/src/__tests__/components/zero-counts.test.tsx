/**
 * #1628: counts that can be zero use the shared count wording (@al-ummah/shared-types
 * formatCountNoun): «لا يوجد مشتركون» / "No subscribers", never «٠ مشترك» or "0 subscribers", and
 * Arabic agreement for 1, 2, 3–10, 11–99 and the compact scale words. Channel tiles (Explore,
 * search), the analytics top video and the analytics chart tooltips.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ChannelTile } from '@/components/ChannelTile';
import AnalyticsDashboard from '@/components/analytics/AnalyticsDashboard';
import MetricsChart from '@/components/analytics/MetricsChart';
import type { AnalyticsMetrics, AnalyticsSummary } from '@/lib/api/types';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('next/image', () => ({ __esModule: true, default: () => <span /> }));
jest.mock('@/components/common/AppLink', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const isAr = mockLang === 'ar';
    return {
      t: isAr ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
      lang: mockLang,
      locale: mockLang,
      dir: isAr ? 'rtl' : 'ltr',
      isRTL: isAr,
    };
  },
}));

/** Spaces of any kind as one plain space (compact numbers may carry a no-break space) */
const sp = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const tile = (subscribersCount: number, videosCount = 0) =>
  render(<ChannelTile channel={{ id: 'c1', name: 'Al-Fajr Reminders', handle: 'alfajr', subscribersCount, videosCount } as never} />);

beforeEach(() => {
  mockLang = 'en';
});

describe('ChannelTile counts (#1628)', () => {
  it.each([
    [0, 'لا يوجد مشتركون'],
    [1, 'مشترك واحد'],
    [2, 'مشتركان'],
    [3, '٣ مشتركين'],
    [11, '١١ مشتركًا'],
    [4200, '٤٫٢ ألف مشترك'],
  ])('Arabic: %d subscribers read «%s»', (count, text) => {
    mockLang = 'ar';
    tile(count);
    const line = sp(screen.getByTestId('channel-tile').textContent);
    expect(line).toContain(text);
    expect(line).not.toMatch(/٠ مشترك/);
  });

  it.each([
    [0, 'No subscribers'],
    [1, '1 subscriber'],
    [1200, '1.2K subscribers'],
  ])('English: %d subscribers read "%s"', (count, text) => {
    tile(count);
    expect(sp(screen.getByTestId('channel-tile').textContent)).toContain(text);
  });

  it('a new channel reads «لا يوجد مشتركون، لا توجد مرئيات» / "No subscribers • No videos"', () => {
    mockLang = 'ar';
    const { unmount } = tile(0, 0);
    expect(sp(screen.getByTestId('channel-tile').textContent)).toMatch(/لا يوجد مشتركون،\s*لا توجد مرئيات/);
    unmount();
    mockLang = 'en';
    tile(0, 0);
    expect(sp(screen.getByTestId('channel-tile').textContent)).toMatch(/No subscribers\s*•\s*No videos/);
  });
});

describe('Analytics counts (#1628)', () => {
  const summary = (views: number) => ({
    totalViews: views, totalLikes: 0, totalComments: 0, totalSubscribers: 0, totalVideos: 1,
    avgViewsPerVideo: views, engagementRate: 0, topVideo: { id: 'v1', title: 'Tafsir of Surat Al-Kahf, part 1', views },
  }) as unknown as AnalyticsSummary;
  const day = (views: number, subscribers: number): AnalyticsMetrics =>
    ({ date: '2026-11-04', views, likes: 0, comments: 0, shares: 0, subscribers, watchTime: 0 }) as AnalyticsMetrics;

  it.each([
    ['ar', 0, 'لا توجد مشاهدات'],
    ['ar', 2, 'مشاهدتان'],
    ['en', 0, 'No views'],
    ['en', 1, '1 view'],
  ] as const)('the top video (%s, %d views) reads «%s»', (lang, views, text) => {
    mockLang = lang;
    const { container } = render(<AnalyticsDashboard summary={summary(views)} channelData={null} metrics={[day(views, 0)]} />);
    expect(sp(container.textContent)).toContain(text);
    expect(sp(container.textContent)).not.toMatch(/٠ مشاهدة|\b0 views/);
  });

  it.each([
    ['ar', 'لا توجد مشاهدات', 'لا يوجد مشتركون جدد'],
    ['en', 'No views', 'No new subscribers'],
  ] as const)('chart tooltips on a quiet day (%s)', (lang, views, subscribers) => {
    mockLang = lang;
    const { container } = render(<MetricsChart data={[day(0, 0), day(3, 1)]} />);
    const titles = [...container.querySelectorAll('[title]')].map((el) => sp(el.getAttribute('title')));
    expect(titles.some((t) => t.endsWith(views))).toBe(true);
    expect(titles.some((t) => t.endsWith(subscribers))).toBe(true);
    // Views and new subscribers never read «٠ مشاهدة» / «٠ مشترك» / "0 views" (likes, comments and minutes keep their label-and-number form)
    expect(titles.join('|')).not.toMatch(/٠ مشاهدة|٠ مشترك|\b0 views|\b0 new subscribers/);
  });
});
