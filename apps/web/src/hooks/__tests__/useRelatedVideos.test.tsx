import { renderHook, act, waitFor } from '@testing-library/react';
import { useRelatedVideos } from '../useRelatedVideos';
import { fetchRelatedVideos } from '@/lib/api/videos';

jest.mock('@/lib/api/videos', () => ({ fetchRelatedVideos: jest.fn() }));

const related = fetchRelatedVideos as jest.MockedFunction<typeof fetchRelatedVideos>;

describe('useRelatedVideos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports ready with the videos once the request resolves', async () => {
    const videos = [{ id: 'v1' }, { id: 'v2' }] as never[];
    related.mockResolvedValue(videos);
    const { result } = renderHook(() => useRelatedVideos('cur'));

    expect(result.current.status).toBe('loading');
    expect(result.current.videos).toEqual([]);

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.videos).toEqual(videos);
    expect(related).toHaveBeenCalledTimes(1);
  });

  it('reports error (not ready-with-nothing) when the request fails', async () => {
    related.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useRelatedVideos('cur'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.videos).toEqual([]);
  });

  it('retry re-runs the request and recovers to ready', async () => {
    related.mockRejectedValueOnce(new Error('down'));
    related.mockResolvedValue([{ id: 'v1' }] as never[]);
    const { result } = renderHook(() => useRelatedVideos('cur'));
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => result.current.retry());
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.videos).toEqual([{ id: 'v1' }]);
    expect(related).toHaveBeenCalledTimes(2);
  });

  it('refetches when the video id changes', async () => {
    related.mockResolvedValue([]);
    const { result, rerender } = renderHook(({ id }) => useRelatedVideos(id), { initialProps: { id: 'a' } });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ id: 'b' });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(related).toHaveBeenNthCalledWith(1, 'a');
    expect(related).toHaveBeenNthCalledWith(2, 'b');
  });
});
