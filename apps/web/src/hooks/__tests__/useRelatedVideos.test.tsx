import { act, renderHook, waitFor } from '@testing-library/react';
import { useRelatedVideos } from '../useRelatedVideos';
import { fetchRelatedVideos } from '@/lib/api/videos';
import { reportError } from '@/lib/errors/reporter';
import { RelatedUnavailableError } from '@/lib/video/related';

jest.mock('@/lib/api/videos', () => ({ fetchRelatedVideos: jest.fn() }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn() }));

const related = fetchRelatedVideos as jest.MockedFunction<typeof fetchRelatedVideos>;
const card = (id: string) => ({ id, title: id }) as never;

describe('useRelatedVideos (#1552)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is loading until the shelf answers, then loaded with its videos', async () => {
    let resolve: (videos: never[]) => void = () => undefined;
    related.mockReturnValue(new Promise((r) => { resolve = r as typeof resolve; }));
    const { result } = renderHook(() => useRelatedVideos('cur'));
    expect(result.current.status).toBe('loading');

    await act(async () => resolve([card('r1')]));
    expect(result.current.status).toBe('loaded');
    expect(result.current.videos.map((v) => v.id)).toEqual(['r1']);
  });

  it('is empty, not failed, when the API answered with nothing, and reports nothing', async () => {
    related.mockResolvedValue([]);
    const { result } = renderHook(() => useRelatedVideos('cur'));
    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(reportError).not.toHaveBeenCalled();
  });

  it('is failed when the request fails, and reports the failure the viewer sees', async () => {
    const error = new RelatedUnavailableError();
    related.mockRejectedValue(error);
    const { result } = renderHook(() => useRelatedVideos('cur'));
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.videos).toEqual([]);
    expect(reportError).toHaveBeenCalledWith(error, expect.objectContaining({ shown: true }));
  });

  it('retry requests the shelf again: loading, then the new answer', async () => {
    related.mockRejectedValueOnce(new RelatedUnavailableError()).mockResolvedValue([card('r1')]);
    const { result } = renderHook(() => useRelatedVideos('cur'));
    await waitFor(() => expect(result.current.status).toBe('failed'));

    act(() => result.current.retry());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('loaded'));
    expect(related).toHaveBeenCalledTimes(2);
  });

  it('starts over for a new video and ignores the old answer', async () => {
    let resolveOld: (videos: never[]) => void = () => undefined;
    related.mockReturnValueOnce(new Promise((r) => { resolveOld = r as typeof resolveOld; })).mockResolvedValue([]);
    const { result, rerender } = renderHook(({ id }) => useRelatedVideos(id), { initialProps: { id: 'a' } });
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.status).toBe('empty'));

    await act(async () => resolveOld([card('stale')]));
    expect(result.current.status).toBe('empty');
    expect(result.current.videos).toEqual([]);
  });
});
