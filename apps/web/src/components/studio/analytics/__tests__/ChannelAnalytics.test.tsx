import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { ChannelAnalytics } from '../ChannelAnalytics';
import { VideoAnalytics } from '../VideoAnalytics';

const channel = jest.fn();
const top = jest.fn();
const video = jest.fn();
const retention = jest.fn();

jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: { studio: mockStudio }, lang: 'en', isRTL: false }) }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/lib/api/studio-analytics', () => ({
  getStudioChannelAnalytics: (...args: unknown[]) => channel(...args),
  getTopContent: (...args: unknown[]) => top(...args),
  getStudioVideoAnalytics: (...args: unknown[]) => video(...args),
  getVideoRetention: (...args: unknown[]) => retention(...args),
}));

const mockStudio = STUDIO_EN;
const text = STUDIO_EN.analytics;
const traffic = { totalViews: 10, sources: { search: 4, unknown: 6 }, externalHosts: [{ host: 'a.org', views: 2 }] };
const day = (views: number) => ({ date: '2026-11-08', views, likes: 1, comments: 1, subscribers: 1, watchTime: views * 10 });
const item = (videoId: string, views: number, watchTime: number) => ({ videoId, title: `V ${videoId}`, isPublic: true, views, watchTime, avgViewDuration: 5 });

function renderOverview() {
  return render(<ChannelAnalytics locale="en" channelId="c1" />);
}

describe('ChannelAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    channel.mockResolvedValue({ recentMetrics: [day(10)], traffic });
    top.mockResolvedValue({ items: [item('a', 1, 100), item('b', 5, 10)], cursor: null });
  });

  it('shows totals and the change from the previous period', async () => {
    channel.mockReset().mockResolvedValueOnce({ recentMetrics: [day(10)], traffic }).mockResolvedValueOnce({ recentMetrics: [day(5)], traffic });
    renderOverview();
    const stats = await screen.findAllByTestId('studio-stat');
    expect(stats[0]).toHaveTextContent('10');
    expect(stats[0]).toHaveTextContent('+100%');
  });

  it('asks for 28 days, then the chosen range', async () => {
    renderOverview();
    await screen.findAllByTestId('studio-stat');
    fireEvent.change(screen.getByTestId('studio-analytics-range'), { target: { value: '7' } });
    await waitFor(() => expect(channel.mock.calls.length).toBeGreaterThan(2));
  });

  it('labels viewers who did not share as Not shared', async () => {
    renderOverview();
    expect(await screen.findByTestId('studio-traffic-unknown')).toHaveTextContent(text.traffic.sources.unknown);
    expect(screen.getByText('a.org')).toBeInTheDocument();
  });

  it('sorts Top content and links to the video', async () => {
    renderOverview();
    const rows = await screen.findAllByTestId('studio-top-row');
    expect(rows[0]).toHaveTextContent('V b');
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/en/studio/c1/content/videos/b/analytics');
    fireEvent.click(screen.getAllByRole('button', { name: text.metrics.watchTime }).at(-1)!);
    expect((await screen.findAllByTestId('studio-top-row'))[0]).toHaveTextContent('V a');
  });

  it('keeps Top content when the overview fails', async () => {
    channel.mockResolvedValue(null);
    renderOverview();
    expect(await screen.findByText(text.loadFailed)).toBeInTheDocument();
    expect(await screen.findAllByTestId('studio-top-row')).toHaveLength(2);
  });

  it('keeps the axes and says what is missing with no activity', async () => {
    channel.mockResolvedValue({ recentMetrics: [{ date: '2026-11-08', views: 0, likes: 0, comments: 0, subscribers: 0, watchTime: 0 }], traffic: { totalViews: 0, sources: {}, externalHosts: [] } });
    renderOverview();
    expect(await screen.findByTestId('studio-analytics-empty')).toHaveTextContent(text.emptyBy.views);
    expect(screen.getAllByTestId('chart-y-tick').map((tick) => tick.textContent)).toEqual(['0', '1']);
    fireEvent.click(screen.getByRole('button', { name: text.metrics.likes, pressed: false }));
    expect(screen.getByTestId('studio-analytics-empty')).toHaveTextContent(text.emptyBy.likes);
  });

  it('draws the views chart with a value axis and a date tooltip', async () => {
    channel.mockResolvedValue({ recentMetrics: [day(10), { ...day(1500), date: '2026-11-09' }], traffic });
    renderOverview();
    const hit = await screen.findByTestId('chart-hit');
    expect(screen.getAllByTestId('chart-y-tick').map((tick) => tick.textContent)).toEqual(['0', '500', '1K', '1.5K']);
    hit.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.mouseMove(hit, { clientX: 99 });
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Nov 9');
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('1,500');
  });

  it('charts watch time in minutes with the unit on the axis and the card', async () => {
    channel.mockResolvedValue({ recentMetrics: [{ ...day(1), watchTime: 183 }], traffic });
    renderOverview();
    const stats = await screen.findAllByTestId('studio-stat');
    expect(stats[1]).toHaveTextContent('3.1 min');
    fireEvent.click(screen.getByRole('button', { name: text.metrics.watchTime, pressed: false }));
    expect(screen.getAllByTestId('chart-y-tick').map((tick) => tick.textContent)).toEqual(['0 min', '1 min', '2 min', '3 min', '4 min']);
  });

  it('asks again by itself when the API is rebuilding its index', async () => {
    jest.useFakeTimers();
    try {
      channel.mockReset().mockResolvedValueOnce(null).mockResolvedValue({ recentMetrics: [day(10)], traffic });
      renderOverview();
      expect(await screen.findByText(text.loadFailed)).toBeInTheDocument();
      await act(async () => { jest.advanceTimersByTime(2500); });
      expect(await screen.findAllByTestId('studio-stat')).toHaveLength(6);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('VideoAnalytics', () => {
  const view = () => render(<VideoAnalytics locale="en" channelId="c1" videoId="v1" title="T" duration={100} backHref="/back" backLabel="Back" />);

  beforeEach(() => {
    jest.clearAllMocks();
    video.mockResolvedValue({ title: 'T', views: 3, likes: 1, comments: 1, watchTime: 30, avgViewDuration: 10, traffic });
  });

  it('draws the retention curve', async () => {
    retention.mockResolvedValue({ starts: 20, points: Array.from({ length: 20 }, (_, bucket) => ({ bucket, share: 1 - bucket / 20 })) });
    view();
    const retentionSection = await screen.findByTestId('studio-retention');
    expect(within(retentionSection).getByRole('group', { name: new RegExp(text.retention.series) })).toBeInTheDocument();
    expect(within(retentionSection).getAllByTestId('chart-y-tick').map((tick) => tick.textContent)).toEqual(['0%', '25%', '50%', '75%', '100%']);
    fireEvent.click(within(retentionSection).getByRole('button', { name: text.showTable }));
    expect(within(retentionSection).getByRole('table')).toHaveTextContent('0:05');
  });

  it('says when there is not enough data', async () => {
    retention.mockResolvedValue({ starts: 3, points: null });
    view();
    expect(await screen.findByTestId('studio-retention-empty')).toHaveTextContent(text.retention.notEnough);
  });

  it('shows the range numbers with the lifetime total, and a views chart', async () => {
    video.mockResolvedValue({
      title: 'T', views: 1500, likes: 9, comments: 4, watchTime: 30, avgViewDuration: 10, traffic,
      rangeViews: 12, rangeLikes: 2, rangeComments: 1,
      recentMetrics: [day(5), day(7)],
    });
    retention.mockResolvedValue({ starts: 3, points: null });
    view();
    const stats = await screen.findAllByTestId('studio-stat');
    expect(stats[0]).toHaveTextContent('12');
    expect(stats[0]).toHaveTextContent(text.lifetimeViews.replace('{count}', '1,500'));
    expect(stats[3]).toHaveTextContent('2');
    const chart = screen.getByTestId('studio-video-views');
    expect(within(chart).getAllByTestId('chart-y-tick').length).toBeGreaterThan(1);
  });

  it('offers Retry when stats fail', async () => {
    video.mockResolvedValue(null);
    retention.mockResolvedValue(null);
    view();
    expect(await screen.findByRole('button', { name: text.retry })).toBeInTheDocument();
  });
});
