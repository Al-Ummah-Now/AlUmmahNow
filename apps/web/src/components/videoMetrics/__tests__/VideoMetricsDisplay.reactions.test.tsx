/**
 * Regressions for the watch page like button (dislikes are turned off,
 * owner decision 2026-11-11: there is no dislike control):
 * - the viewer's existing reaction was never restored (always "not liked"
 *   after a reload, so a second click re-liked instead of unliking);
 * - reactions were sent with the user id as the channel id;
 * - failed API calls (helpers return null) left the optimistic count in place.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VideoMetricsDisplay } from '../VideoMetricsDisplay';
import * as VideosAPI from '@/lib/api/videos';

jest.mock('@/lib/api/videos', () => ({
  likeVideo: jest.fn(),
  unlikeVideo: jest.fn(),
  getVideoById: jest.fn(),
}));
jest.mock('@/lib/logger-client', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: () => ({ user: { id: 'usr_1' } }),
}));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    isRTL: false,
  }),
}));
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: () => ({ user: { id: 'usr_1', channel: { id: 'ch_main' } }, loading: false }),
}));
jest.mock('@/hooks/useRealTimeVideoMetrics', () => {
  const ReactActual = jest.requireActual('react');
  return {
    useRealTimeVideoMetrics: ({ initialMetrics }: { initialMetrics: Record<string, number> }) => {
      const [metrics, setMetrics] = ReactActual.useState({ viewCount: 0, ...initialMetrics });
      return {
        metrics,
        isConnected: false,
        updateMetrics: (u: Record<string, number>) => setMetrics((m: Record<string, number>) => ({ ...m, ...u })),
      };
    },
    useRealTimePresence: () => ({ viewerCount: 0, isConnected: false }),
  };
});

const api = VideosAPI as jest.Mocked<typeof VideosAPI>;

describe('VideoMetricsDisplay reactions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('restores an existing like of the active channel and unlikes on click', async () => {
    api.unlikeVideo.mockResolvedValue({ success: true });
    render(
      <VideoMetricsDisplay
        videoId="v1"
        initialLikesCount={3}
        likes={[{ userId: 'usr_1', channelId: 'ch_main' }]}
      />
    );
    const like = screen.getByTestId('video-like-button');
    await waitFor(() => expect(like).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.click(like);
    await waitFor(() => expect(like).toHaveAttribute('aria-pressed', 'false'));
    expect(api.unlikeVideo).toHaveBeenCalledWith('v1', { channelId: 'ch_main' });
    expect(api.likeVideo).not.toHaveBeenCalled();
    expect(like).toHaveTextContent('2');
  });

  it('reacts as the active channel and reverts the optimistic update when the API fails', async () => {
    api.likeVideo.mockResolvedValue(null);
    api.getVideoById.mockResolvedValue(null);
    render(<VideoMetricsDisplay videoId="v1" initialLikesCount={5} likes={[{ userId: 'other', channelId: 'ch_other' }]} />);
    const like = screen.getByTestId('video-like-button');
    expect(like).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(like);
    await waitFor(() => expect(api.likeVideo).toHaveBeenCalledWith('v1', { channelId: 'ch_main' }));
    await waitFor(() => expect(like).not.toBeDisabled());
    expect(like).toHaveAttribute('aria-pressed', 'false');
    expect(like).toHaveTextContent('5');
  });

  it('after an error response, shows the reaction the server actually stored', async () => {
    // e.g. the API stored the like but answered 500
    api.likeVideo.mockResolvedValue(null);
    api.getVideoById.mockResolvedValue({ likes: [{ id: 'l1', userId: 'usr_1', videoId: 'v1', channelId: 'ch_main' }] } as never);
    render(<VideoMetricsDisplay videoId="v1" initialLikesCount={0} />);
    const like = screen.getByTestId('video-like-button');

    fireEvent.click(like);
    await waitFor(() => expect(api.getVideoById).toHaveBeenCalledWith('v1'));
    await waitFor(() => expect(like).not.toBeDisabled());
    expect(like).toHaveAttribute('aria-pressed', 'true');
    expect(like).toHaveTextContent('1');
  });

  it('has no dislike control: one like pill (thumbs up), and the comment count is a link to the comments', () => {
    const { container } = render(<VideoMetricsDisplay videoId="v1" initialLikesCount={1} initialCommentsCount={4} />);
    const like = screen.getByTestId('video-like-button');
    expect(like.querySelector('svg')).toHaveClass('lucide-thumbs-up');
    expect(screen.queryByTestId('video-dislike-button')).toBeNull();
    expect(screen.queryByTestId('video-reactions')).toBeNull();
    expect(container.querySelector('.lucide-thumbs-down, [data-icon=thumbs-down]')).toBeNull();
    expect(screen.queryByRole('button', { name: /dislike/i })).toBeNull();
    expect(screen.getAllByRole('button')).toEqual([like]);
    const comments = screen.getByTestId('video-comments-count');
    expect(comments.tagName).toBe('A');
    expect(comments).toHaveAttribute('href', '#comments');
    expect(comments).toHaveTextContent('4');
  });
});
