import { act, renderHook, waitFor } from '@testing-library/react';
import { useRelatedVideos } from '@/hooks/useRelatedVideos';
import { fetchRelatedVideos } from '@/lib/api/videos';

jest.mock('@/lib/api/videos', () => ({ fetchRelatedVideos: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn() } }));

const related = fetchRelatedVideos as jest.MockedFunction<typeof fetchRelatedVideos>;
const videos = [{ id: 'rec-1' } as never];

describe('useRelatedVideos', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts loading and distinguishes a successful empty result', async () => {
    let resolve: (value: never[]) => void = () => undefined;
    related.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useRelatedVideos('current'));

    expect(result.current.relatedLoading).toBe(true);
    expect(result.current.relatedFailed).toBe(false);

    await act(async () => resolve([]));
    expect(result.current.relatedLoading).toBe(false);
    expect(result.current.relatedFailed).toBe(false);
    expect(result.current.relatedVideos).toEqual([]);
  });

  it('returns loaded videos without a failure', async () => {
    related.mockResolvedValue(videos);
    const { result } = renderHook(() => useRelatedVideos('current'));

    await waitFor(() => expect(result.current.relatedLoading).toBe(false));
    expect(result.current.relatedVideos).toEqual(videos);
    expect(result.current.relatedFailed).toBe(false);
  });

  it('records a failed request separately from an empty result', async () => {
    related.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useRelatedVideos('current'));

    await waitFor(() => expect(result.current.relatedFailed).toBe(true));
    expect(result.current.relatedLoading).toBe(false);
    expect(result.current.relatedVideos).toEqual([]);
  });

  it('clears the failure on retry and returns the new videos', async () => {
    related.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(videos);
    const { result } = renderHook(() => useRelatedVideos('current'));
    await waitFor(() => expect(result.current.relatedFailed).toBe(true));

    act(() => result.current.retryRelated());
    expect(result.current.relatedLoading).toBe(true);
    expect(result.current.relatedFailed).toBe(false);
    await waitFor(() => expect(result.current.relatedVideos).toEqual(videos));
    expect(result.current.relatedLoading).toBe(false);
    expect(related).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale answer after the video changes', async () => {
    let resolveOld: (value: never[]) => void = () => undefined;
    const oldRequest = new Promise<never[]>((r) => { resolveOld = r; });
    related.mockImplementation((videoId) => videoId === 'old' ? oldRequest : Promise.resolve(videos));
    const { result, rerender } = renderHook(({ videoId }) => useRelatedVideos(videoId), { initialProps: { videoId: 'old' } });

    rerender({ videoId: 'new' });
    await waitFor(() => expect(result.current.relatedVideos).toEqual(videos));
    await act(async () => resolveOld([{ id: 'stale' } as never]));

    expect(result.current.relatedVideos).toEqual(videos);
    expect(result.current.relatedLoading).toBe(false);
    expect(result.current.relatedFailed).toBe(false);
  });
});
