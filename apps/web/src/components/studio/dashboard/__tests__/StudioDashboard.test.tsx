import { render, screen } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { StudioDashboard } from '../StudioDashboard';

const counts = jest.fn();
const list = jest.fn();
const channel = jest.fn();
const video = jest.fn();

jest.mock('next/image', () => ({ __esModule: true, default: () => <span /> }));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: mockStudio } }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/lib/api/studio-content', () => ({
  getChannelContentCounts: (...args: unknown[]) => counts(...args),
  listChannelContent: (...args: unknown[]) => list(...args),
}));
jest.mock('@/lib/api/studio-analytics', () => ({
  getStudioChannelAnalytics: (...args: unknown[]) => channel(...args),
  getStudioVideoAnalytics: (...args: unknown[]) => video(...args),
}));

const mockStudio = STUDIO_EN;
const text = STUDIO_EN.dashboard;
const ZERO = { published: 0, scheduled: 0, drafts: 0, processing: 0, failed: 0 };
const day = (views: number) => ({ date: '2026-11-08', views, likes: 0, comments: 0, subscribers: 0, watchTime: 0 });
const v = (id: string, extra = {}) => ({ id, title: `Video ${id}`, views: 7, likesCount: 2, commentsCount: 1, dateCreated: '2026-01-01T00:00:00.000Z', ...extra });

const show = (role: 'owner' | 'editor' | 'moderator' = 'owner') => render(<StudioDashboard locale="en" channelId="c1" role={role} />);

describe('StudioDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    counts.mockResolvedValue({ ...ZERO, published: 3, processing: 1, failed: 2 });
    list.mockImplementation(async (_c: string, q: { status: string }) => (q.status === 'scheduled'
      ? { items: [v('late', { scheduledPublishDate: '2027-02-01T00:00:00.000Z' }), v('soon', { scheduledPublishDate: '2027-01-01T00:00:00.000Z' })], cursor: null }
      : { items: [v('latest')], cursor: null }));
    channel.mockResolvedValue({ totalViews: 500, totalSubscribers: 9, recentMetrics: [day(10)] });
    video.mockResolvedValue({ watchTime: 90 });
  });

  it('shows the latest video, totals and tasks', async () => {
    show();
    expect(await screen.findByTestId('studio-dash-latest')).toHaveTextContent('Video latest');
    expect(await screen.findByTestId('studio-dash-totals')).toHaveTextContent('500');
    const tasks = await screen.findByTestId('studio-dash-tasks');
    expect(tasks.querySelector('a[href$="status=failed"]')).toHaveTextContent('2');
  });

  it('shows watch time on the latest video with stats access', async () => {
    show();
    expect(await screen.findByTestId('studio-dash-latest')).toHaveTextContent('1.5 min');
  });

  it('orders Next scheduled soonest first', async () => {
    show();
    const links = (await screen.findByTestId('studio-dash-next')).querySelectorAll('a');
    expect(links[0]).toHaveTextContent('Video soon');
  });

  it('welcomes a new channel instead of showing zeros', async () => {
    counts.mockResolvedValue(ZERO);
    list.mockResolvedValue({ items: [], cursor: null });
    show();
    expect(await screen.findByTestId('studio-dash-welcome')).toHaveTextContent(text.welcome.title);
    expect(screen.queryByTestId('studio-dash-totals')).toBeNull();
  });

  it('gives an editor no stats', async () => {
    show('editor');
    expect(await screen.findByTestId('studio-dash-latest')).not.toHaveTextContent('1.5 min');
    expect(screen.queryByTestId('studio-dash-totals')).toBeNull();
    expect(channel).not.toHaveBeenCalled();
    expect(video).not.toHaveBeenCalled();
  });

  it('shows a moderator only what the role can use', async () => {
    show('moderator');
    expect(await screen.findByTestId('studio-dash-moderator')).toBeInTheDocument();
    expect(counts).not.toHaveBeenCalled();
    expect(screen.queryByTestId('studio-dash-latest')).toBeNull();
    expect(screen.queryByRole('link', { name: text.quick.upload })).toBeNull();
  });

  it('keeps the other cards when one fails, and offers Retry', async () => {
    channel.mockResolvedValue(null);
    show();
    expect(await screen.findByTestId('studio-dash-latest')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: text.retry })).toBeInTheDocument();
  });
});
