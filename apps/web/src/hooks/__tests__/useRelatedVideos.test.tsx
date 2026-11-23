/**
 * #1552: the related shelf must tell a failed load from a successful empty
 * answer. An empty list is a success — retrying it returns the same nothing,
 * so only a failure may offer Try again.
 */
jest.mock('@/lib/api/videos', () => ({ fetchRelatedVideos: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn() } }));

import { renderHook, act, waitFor } from '@testing-library/react';
import { fetchRelatedVideos } from '@/lib/api/videos';
import { useRelatedVideos } from '../useRelatedVideos';
import type { VideoInfo } from '@/interfaces';

const related = fetchRelatedVideos as jest.MockedFunction<typeof fetchRelatedVideos>;
const card = (id: string) => ({ id, title: id }) as unknown as VideoInfo;

describe('useRelatedVideos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts loading with no videos', () => {
    related.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useRelatedVideos('v1'));
    expect(result.current).toMatchObject({ videos: [], status: 'loading' });
    expect(related).toHaveBeenCalledWith('v1');
  });

  it('a successful empty answer is a success, not an error', async () => {
    related.mockResolvedValue([]);
    const { result } = renderHook(() => useRelatedVideos('v1'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.videos).toEqual([]);
  });

  it('a successful answer carries the videos', async () => {
    related.mockResolvedValue([card('rec-1')]);
    const { result } = renderHook(() => useRelatedVideos('v1'));
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.videos.map((video) => video.id)).toEqual(['rec-1']);
  });

  it('a failed load reports an error', async () => {
    related.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useRelatedVideos('v1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.videos).toEqual([]);
  });

  it('retry asks for the shelf again after a failure', async () => {
    related.mockRejectedValueOnce(new Error('down')).mockResolvedValue([card('rec-1')]);
    const { result } = renderHook(() => useRelatedVideos('v1'));
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => result.current.retry());
    expect(related).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.videos.map((video) => video.id)).toEqual(['rec-1']);
  });

  it('a new video id restarts the load', async () => {
    related.mockResolvedValue([card('rec-1')]);
    const { result, rerender } = renderHook(({ id }) => useRelatedVideos(id), { initialProps: { id: 'v1' } });
    await waitFor(() => expect(result.current.status).toBe('success'));

    related.mockResolvedValue([card('rec-2')]);
    rerender({ id: 'v2' });
    await waitFor(() => expect(result.current.videos.map((video) => video.id)).toEqual(['rec-2']));
    expect(related).toHaveBeenLastCalledWith('v2');
  });
});
