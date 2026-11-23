import { act, renderHook, waitFor } from '@testing-library/react';
import { useRelatedVideos } from '../useRelatedVideos';
import { fetchRelatedVideos } from '@/lib/api/videos';
import type { VideoInfo } from '@/interfaces';

jest.mock('@/lib/api/videos', () => ({
  fetchRelatedVideos: jest.fn(),
}));

const mockFetchRelated = fetchRelatedVideos as jest.MockedFunction<typeof fetchRelatedVideos>;
const card = (id: string) => ({ id, title: id }) as VideoInfo;

describe('useRelatedVideos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('transitions from loading to loaded when videos are returned', async () => {
    let resolve: (videos: VideoInfo[]) => void = () => undefined;
    mockFetchRelated.mockReturnValue(new Promise((r) => { resolve = r; }));

    const { result } = renderHook(() => useRelatedVideos('cur'));
    expect(result.current).toMatchObject({ status: 'loading', loading: true, failed: false, videos: [] });

    await act(async () => resolve([card('rec-1')]));
    expect(result.current).toMatchObject({ status: 'loaded', loading: false, failed: false });
    expect(result.current.videos.map((v) => v.id)).toEqual(['rec-1']);
  });

  it('transitions from loading to empty when the request succeeds with no videos', async () => {
    mockFetchRelated.mockResolvedValue([]);

    const { result } = renderHook(() => useRelatedVideos('cur'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toMatchObject({ status: 'empty', loading: false, failed: false, videos: [] });
  });

  it('transitions from loading to failed when the request rejects, and recovers on retry', async () => {
    mockFetchRelated
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce([card('rec-1')]);

    const { result } = renderHook(() => useRelatedVideos('cur'));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current).toMatchObject({ loading: false, failed: true, videos: [] });

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('loaded'));
    expect(result.current).toMatchObject({ loading: false, failed: false });
    expect(result.current.videos.map((v) => v.id)).toEqual(['rec-1']);
    expect(mockFetchRelated).toHaveBeenCalledTimes(2);
  });

  it('ignores stale responses when videoId changes', async () => {
    let resolveFirst: (videos: VideoInfo[]) => void = () => undefined;
    let resolveSecond: (videos: VideoInfo[]) => void = () => undefined;
    mockFetchRelated
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));

    const { result, rerender } = renderHook(({ id }) => useRelatedVideos(id), {
      initialProps: { id: 'v1' },
    });

    rerender({ id: 'v2' });
    await act(async () => resolveSecond([card('for-v2')]));
    expect(result.current.videos.map((v) => v.id)).toEqual(['for-v2']);

    await act(async () => resolveFirst([card('stale-v1')]));
    expect(result.current.videos.map((v) => v.id)).toEqual(['for-v2']);
  });
});
