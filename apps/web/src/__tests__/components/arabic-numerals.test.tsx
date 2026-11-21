/**
 * Arabic pages show Eastern Arabic (Hindi) numerals ٠–٩ in every number, count, date, time and
 * duration (owner decision 2026-11-15, #1488/#1496). These renders must not contain 0–9.
 */
import { render, screen } from '@testing-library/react';
import { AR_TRANSLATIONS, formatDuration, formatWatchTime, PostStatus, PostType, STUDIO_AR } from '@al-ummah/shared-types';
import { formatAbsoluteDate, formatAbsoluteDateTime, formatRelativeTime, formatSubscribers, formatVideoCount, formatViews, formatViewsExact } from '@/lib/format/videoMeta';
import { formatViewerCount, getViewerCountLabel } from '@/lib/utils/number-format';
import { plural } from '@/lib/video/i18n/utils/plural';
import { unreadBadge } from '@/lib/navigation/destinations';
import { pluralText } from '@/lib/notifications/toast-queue';
import { formatScheduledTime, formatDate as formatCalendarDate } from '@/utils/dateFormatters';
import { formatHijriDate } from '@/utils/hijriConverter';
import { ChannelTile } from '@/components/ChannelTile';
import { PostCard } from '@/components/Community/management/PostCard';
import { StudioDashboard } from '@/components/studio/dashboard/StudioDashboard';

const ASCII_DIGIT = /[0-9]/;

const counts = jest.fn();
const list = jest.fn();
const channel = jest.fn();
const video = jest.fn();

jest.mock('next/image', () => ({ __esModule: true, default: () => <span /> }));
jest.mock('@/components/common/AppLink', () => ({ __esModule: true, default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { ...mockAr, studio: mockStudioAr }, lang: 'ar', locale: 'ar', dir: 'rtl', isRTL: true }),
}));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/api/studio-content', () => ({
  getChannelContentCounts: (...args: unknown[]) => counts(...args),
  listChannelContent: (...args: unknown[]) => list(...args),
}));
jest.mock('@/lib/api/studio-analytics', () => ({
  getStudioChannelAnalytics: (...args: unknown[]) => channel(...args),
  getStudioVideoAnalytics: (...args: unknown[]) => video(...args),
}));

const mockAr = AR_TRANSLATIONS;
const mockStudioAr = STUDIO_AR;

/** Text a reader sees, with ids and links left out (they stay as written). */
function visibleText(element: HTMLElement): string {
  return element.textContent ?? '';
}

describe('Arabic numbers use ٠–٩', () => {
  const now = Date.UTC(2026, 10, 15, 12, 0, 0);

  it('formats counts, dates, times and durations without 0–9', () => {
    const values = [
      formatViews(5400, 'ar'),
      formatViews(1, 'ar'),
      formatViewsExact(12345, 'ar'),
      formatSubscribers(4200, 'ar'),
      formatVideoCount(15, 'ar'),
      formatVideoCount(1500, 'ar', { compact: true }),
      formatRelativeTime(now - 3 * 86400_000, 'ar', now),
      formatRelativeTime(now - 17 * 3600_000, 'ar', now),
      formatAbsoluteDate(now, 'ar'),
      formatAbsoluteDateTime(now, 'ar', 'UTC'),
      formatViewerCount(1234, 'full', 'ar'),
      formatViewerCount(1234, 'compact', 'ar'),
      getViewerCountLabel(25, 'ar'),
      plural('ar', 'videos', 5),
      unreadBadge(4, 'ar'),
      unreadBadge(40, 'ar'),
      pluralText({ one: '{count}', other: '{count} إشعارات' }, 7, 'ar'),
      formatWatchTime('ar', 'hour')(86400),
      formatDuration('ar')(3725),
      formatScheduledTime(new Date(now + 2 * 3600_000), 'ar', new Date(now)),
      formatCalendarDate(new Date(now), { locale: 'ar', includeTime: true }),
      formatHijriDate({ year: 1448, month: 5, day: 14 }, 'ar'),
    ];
    for (const value of values) expect(value).not.toMatch(ASCII_DIGIT);
  });

  it('English keeps 0–9', () => {
    expect(formatViews(5400, 'en')).toBe('5.4K views');
    expect(formatViewsExact(12345, 'en')).toBe('12,345 views');
    expect(unreadBadge(40, 'en')).toBe('9+');
  });

  it('renders the channel tile in ٠–٩', () => {
    render(<ChannelTile channel={{ id: 'c1', name: 'قناة', handle: 'qanah', subscribersCount: 4200, videosCount: 37 } as never} />);
    const tile = screen.getByTestId('channel-tile');
    expect(visibleText(tile)).toMatch(/[٠-٩]/);
    expect(visibleText(tile)).not.toMatch(ASCII_DIGIT);
  });

  it('renders a managed post card in ٠–٩', () => {
    const post = {
      id: 'p1',
      channelId: 'c1',
      type: PostType.TEXT,
      status: PostStatus.PUBLISHED,
      content: 'سلام',
      views: 340,
      likes: 15,
      comments: 2,
      shares: 0,
      createdAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    render(<PostCard post={post as never} locale="ar" onView={jest.fn()} onDelete={jest.fn()} />);
    const card = screen.getByTestId('managed-post');
    expect(visibleText(card)).toMatch(/[٠-٩]/);
    expect(visibleText(card)).not.toMatch(ASCII_DIGIT);
  });

  it('renders the Studio dashboard in ٠–٩', async () => {
    counts.mockResolvedValue({ published: 3, scheduled: 1, drafts: 0, processing: 1, failed: 2 });
    list.mockImplementation(async (_c: string, q: { status: string }) => (q.status === 'scheduled'
      ? { items: [{ id: 'next', title: 'المرئي التالي', views: 0, likesCount: 0, commentsCount: 0, dateCreated: '2026-01-01T00:00:00.000Z', scheduledPublishDate: '2027-01-01T10:30:00.000Z' }], cursor: null }
      : { items: [{ id: 'latest', title: 'آخر مرئي', views: 5400, likesCount: 320, commentsCount: 41, dateCreated: '2026-01-01T00:00:00.000Z' }], cursor: null }));
    channel.mockResolvedValue({ totalViews: 123456, totalSubscribers: 4200, recentMetrics: [{ date: '2026-11-08', views: 1234, likes: 0, comments: 0, subscribers: 0, watchTime: 0 }] });
    video.mockResolvedValue({ watchTime: 86400 });
    render(<StudioDashboard locale="ar" channelId="c1" role="owner" />);
    const latest = await screen.findByTestId('studio-dash-latest');
    const totals = await screen.findByTestId('studio-dash-totals');
    const tasks = await screen.findByTestId('studio-dash-tasks');
    const next = await screen.findByTestId('studio-dash-next');
    await screen.findByText(/وقت المشاهدة/);
    for (const el of [latest, totals, tasks, next]) {
      expect(visibleText(el)).not.toMatch(ASCII_DIGIT);
    }
    expect(visibleText(latest)).toMatch(/٥٤٠٠/);
  });
});
