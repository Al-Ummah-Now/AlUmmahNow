import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WatchPageContent from '../WatchPageContent';
import { fetchRelatedVideos, fetchVideoById } from '@/lib/api/videos';
import { RelatedUnavailableError } from '@/lib/video/related';

let mockIsRTL = false;
let mockUser: { id: string } | null = null;

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
jest.mock('@/lib/api/videos', () => ({ fetchRelatedVideos: jest.fn(), fetchVideoById: jest.fn() }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { video: { relatedVideos: 'Related', relatedFailed: 'Could not load', relatedRetry: 'Retry shelf' }, navigation: {} }, lang: mockIsRTL ? 'ar' : 'en', isRTL: mockIsRTL }),
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
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn() }));

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

  it.each([[false], [true]])('hides the shelf and its side column when the answer is empty, with no error or retry (rtl=%s)', async (rtl) => {
    mockIsRTL = rtl;
    related.mockResolvedValue([]);
    render(<WatchPageContent videoId="cur" />);
    await waitFor(() => expect(screen.queryByTestId('related-videos-skeleton')).toBeNull());
    expect(screen.queryByTestId('related-videos')).toBeNull();
    expect(screen.queryByText('Could not load')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry shelf' })).toBeNull();
    expect(screen.queryByTestId('watch-secondary')).toBeNull();
    expect(screen.queryByTestId('watch-secondary-below')).toBeNull();
  });

  it('hides the shelf when the only related video is the current one', async () => {
    related.mockResolvedValue([card('cur')] as never);
    render(<WatchPageContent videoId="cur" />);
    await waitFor(() => expect(screen.queryByTestId('related-videos-skeleton')).toBeNull());
    expect(screen.queryByTestId('related-videos')).toBeNull();
  });

  it.each([[false], [true]])('offers a retry when the request fails, then shows the videos (rtl=%s)', async (rtl) => {
    mockIsRTL = rtl;
    related.mockRejectedValueOnce(new RelatedUnavailableError()).mockResolvedValue([card('rec-1')] as never);
    render(<WatchPageContent videoId="cur" />);
    const [retry] = await screen.findAllByRole('button', { name: 'Retry shelf' });
    expect(screen.getAllByText('Could not load').length).toBeGreaterThan(0);

    fireEvent.click(retry);
    expect((await screen.findAllByTestId('card-rec-1')).length).toBeGreaterThan(0);
    expect(related).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('related-videos-failed')).toBeNull();
  });

  it('clears the skeleton when the request fails', async () => {
    related.mockRejectedValue(new RelatedUnavailableError());
    render(<WatchPageContent videoId="cur" />);
    expect((await screen.findAllByTestId('related-videos-failed')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('related-videos-skeleton')).toBeNull();
  });
});
