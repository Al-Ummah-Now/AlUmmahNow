import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WatchPageContent from '../WatchPageContent';
import { fetchRelatedVideos, fetchVideoById } from '@/lib/api/videos';

let mockIsRTL = false;
let mockUser: { id: string } | null = null;

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
jest.mock('@/lib/api/videos', () => ({ fetchRelatedVideos: jest.fn(), fetchVideoById: jest.fn() }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { video: { relatedVideos: 'Related', relatedLoadFailed: 'Nothing here', relatedLoadFailedRetry: 'Retry shelf' }, navigation: {} }, lang: mockIsRTL ? 'ar' : 'en', isRTL: mockIsRTL }),
}));
jest.mock('@al-ummah/shared-types', () => ({ ...jest.requireActual('@al-ummah/shared-types'), getLocalizedValue: (_: unknown, title: string) => title }));
jest.mock('@/components/relatedVideo', () => ({ __esModule: true, default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} /> }));
jest.mock('@/components/relatedVideo/rtl', () => ({ __esModule: true, default: ({ id }: { id: string }) => <div data-testid={`card-${id}`} /> }));
jest.mock('@/components/VideoPagePlayer/index', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/VideoPagePlayer/rtl/index', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/commentsSection/index', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/commentsSection/rtl/index', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/moderation/ReportContentButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/videoMetrics/VideoMetricsDisplay', () => ({ VideoMetricsDisplay: () => null }));
jest.mock('@/components/SaveToPlaylist', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/SaveToPlaylist/rtl', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/library/WatchLaterButton', () => ({ WatchLaterButton: () => null }));
jest.mock('@/components/video/ShareDialog', () => ({ __esModule: true, default: () => null }));

const related = fetchRelatedVideos as jest.MockedFunction<typeof fetchRelatedVideos>;
const details = fetchVideoById as jest.MockedFunction<typeof fetchVideoById>;
const card = (id: string) => ({ id, title: id }) as never;

describe('WatchPageContent related shelf', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsRTL = false;
    mockUser = null;
    details.mockReturnValue(new Promise(() => undefined));
  });

  it.each([[false], [true]])('renders recommendations after a skeleton, without the current video (rtl=%s)', async (rtl) => {
    mockIsRTL = rtl;
    let resolve: (videos: never[]) => void = () => undefined;
    related.mockReturnValue(new Promise((r) => { resolve = r as typeof resolve; }));

    render(<WatchPageContent videoId="cur" />);
    expect(screen.getAllByTestId('related-videos-skeleton').length).toBeGreaterThan(0);

    await act(async () => resolve([card('cur'), card('rec-1')] as never[]));
    expect(screen.queryByTestId('related-videos-skeleton')).toBeNull();
    expect(screen.getAllByTestId('card-rec-1').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('card-cur')).toBeNull();
  });

  it('requests the shelf without waiting for the video details', () => {
    related.mockResolvedValue([]);
    render(<WatchPageContent videoId="cur" />);
    expect(details).toHaveBeenCalledWith('cur');
    expect(related).toHaveBeenCalledWith('cur');
  });

  it('does not refetch when the auth state settles', async () => {
    related.mockResolvedValue([]);
    const { rerender } = render(<WatchPageContent videoId="cur" />);
    await waitFor(() => expect(screen.queryByTestId('related-videos-skeleton')).toBeNull());
    mockUser = { id: 'u1' };
    rerender(<WatchPageContent videoId="cur" />);
    expect(related).toHaveBeenCalledTimes(1);
  });

  it.each([[false], [true]])('offers a retry on a failed load, then shows the videos (rtl=%s)', async (rtl) => {
    mockIsRTL = rtl;
    related.mockRejectedValueOnce(new Error('down')).mockResolvedValue([card('rec-1')] as never);
    render(<WatchPageContent videoId="cur" />);
    const [retry] = await screen.findAllByRole('button', { name: 'Retry shelf' });
    expect(screen.getAllByText('Nothing here').length).toBeGreaterThan(0);

    fireEvent.click(retry);
    expect((await screen.findAllByTestId('card-rec-1')).length).toBeGreaterThan(0);
    expect(related).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('related-videos-failed')).toBeNull();
  });

  it.each([[false], [true]])('hides the shelf when a successful answer is empty — no error, no retry (rtl=%s)', async (rtl) => {
    mockIsRTL = rtl;
    related.mockResolvedValue([] as never);
    render(<WatchPageContent videoId="cur" />);
    await waitFor(() => expect(screen.queryByTestId('related-videos-skeleton')).toBeNull());
    expect(screen.queryByTestId('related-videos-failed')).toBeNull();
    expect(screen.queryByTestId('related-videos-list')).toBeNull();
    expect(screen.queryByText('Nothing here')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry shelf' })).toBeNull();
    expect(screen.queryByText('Related')).toBeNull();
    expect(screen.queryByText('المرئيات ذات الصلة')).toBeNull();
  });

  it('shows the failure state when the request fails', async () => {
    related.mockRejectedValue(new Error('down'));
    render(<WatchPageContent videoId="cur" />);
    expect((await screen.findAllByTestId('related-videos-failed')).length).toBeGreaterThan(0);
  });

  it('clears the skeleton when the request fails', async () => {
    related.mockRejectedValue(new Error('down'));
    render(<WatchPageContent videoId="cur" />);
    await waitFor(() => expect(screen.queryByTestId('related-videos-skeleton')).toBeNull());
  });
});
