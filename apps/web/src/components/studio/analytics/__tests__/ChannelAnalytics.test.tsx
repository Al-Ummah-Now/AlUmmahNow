import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { STUDIO_EN } from '@al-ummah/shared-types';
import { ChannelAnalytics } from '../ChannelAnalytics';
import { VideoAnalytics } from '../VideoAnalytics';
import { LineChart } from '../LineChart';

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

  it('shows the empty message with no activity', async () => {
    channel.mockResolvedValue({ recentMetrics: [{ date: 'x', views: 0, likes: 0, comments: 0, subscribers: 0, watchTime: 0 }], traffic: { totalViews: 0, sources: {}, externalHosts: [] } });
    renderOverview();
    expect(await screen.findByTestId('studio-analytics-empty')).toHaveTextContent(text.empty);
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
    expect(await screen.findByRole('img', { name: new RegExp(text.retention.series) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: text.showTable }));
    expect(screen.getByRole('table')).toHaveTextContent('0:05');
  });

  it('says when there is not enough data', async () => {
    retention.mockResolvedValue({ starts: 3, points: null });
    view();
    expect(await screen.findByTestId('studio-retention-empty')).toHaveTextContent(text.retention.notEnough);
  });

  it('offers Retry when stats fail', async () => {
    video.mockResolvedValue(null);
    retention.mockResolvedValue(null);
    view();
    expect(await screen.findByRole('button', { name: text.retry })).toBeInTheDocument();
  });
});

describe('LineChart', () => {
  it('reads out the point that was tapped, and keeps it until the next tap', () => {
    render(<LineChart title="Views" points={[{ label: 'a', value: 1 }, { label: 'b', value: 2 }]} format={String} tableLabel="t" xHeading="x" showTable="show" hideTable="hide" />);
    const hit = screen.getByTestId('chart-hit');
    hit.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.click(hit, { clientX: 90 });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('b: 2');
    expect(screen.getByTestId('chart-crosshair')).toBeInTheDocument();
    fireEvent.click(hit, { clientX: 5 });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('a: 1');
  });

  it('reads out the point under the pointer', () => {
    render(<LineChart title="Views" points={[{ label: 'a', value: 1 }, { label: 'b', value: 2 }]} format={String} tableLabel="t" xHeading="x" showTable="show" hideTable="hide" />);
    const hit = screen.getByTestId('chart-hit');
    hit.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.mouseMove(hit, { clientX: 95 });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('b: 2');
    fireEvent.mouseLeave(hit);
    expect(screen.getByTestId('chart-readout')).toHaveTextContent('');
  });
});
