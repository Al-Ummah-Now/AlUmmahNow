/**
 * usePlaylistAdds: a video's adds are requested once, a request that did
 * not reach the API is sent again, and failures become notices.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePlaylistAdds } from '@/hooks/usePlaylistAdds';

const requestPlaylistAdds = jest.fn();
const getPlaylistAddStatus = jest.fn();
jest.mock('@/lib/api/upload-playlists-client', () => ({
  requestPlaylistAdds: (...args: unknown[]) => requestPlaylistAdds(...args),
  getPlaylistAddStatus: (...args: unknown[]) => getPlaylistAddStatus(...args),
}));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn(() => 'ERR-1') }));

beforeEach(() => {
  jest.useFakeTimers();
  requestPlaylistAdds.mockReset();
  getPlaylistAddStatus.mockReset();
});
afterEach(() => jest.useRealTimers());

it('requests each video→playlist once, then follows the queue until the adds are done', async () => {
  requestPlaylistAdds.mockResolvedValue([{ playlistId: 'p1', status: 'pending' }, { playlistId: 'p2', status: 'pending' }]);
  getPlaylistAddStatus.mockResolvedValue([
    { videoId: 'v1', playlistId: 'p1', status: 'added' },
    { videoId: 'v1', playlistId: 'p2', status: 'retrying' },
  ]);
  const { result } = renderHook(() => usePlaylistAdds('ch1'));
  act(() => result.current.queue('v1', ['p1', 'p2'], 'b:000000'));
  act(() => result.current.queue('v1', ['p1'], 'b:000000'));
  expect(requestPlaylistAdds).toHaveBeenCalledTimes(1);
  expect(requestPlaylistAdds).toHaveBeenCalledWith('ch1', 'v1', ['p1', 'p2'], 'b:000000');
  await waitFor(() => expect(result.current.items.map((i) => i.status)).toEqual(['pending', 'pending']));
  expect(result.current.notices).toEqual([]);

  await act(async () => { jest.advanceTimersByTime(5000); });
  await waitFor(() => expect(result.current.notices).toEqual([{ playlistId: 'p2', kind: 'retrying', count: 1 }]));
  expect(getPlaylistAddStatus).toHaveBeenCalledWith('ch1', ['v1']);

  getPlaylistAddStatus.mockResolvedValue([
    { videoId: 'v1', playlistId: 'p1', status: 'added' },
    { videoId: 'v1', playlistId: 'p2', status: 'added' },
  ]);
  await act(async () => { jest.advanceTimersByTime(5000); });
  await waitFor(() => expect(result.current.notices).toEqual([]));
  getPlaylistAddStatus.mockClear();
  await act(async () => { jest.advanceTimersByTime(60_000); });
  expect(getPlaylistAddStatus).not.toHaveBeenCalled();
});

it('sends a request that did not reach the API again, and says it will retry meanwhile', async () => {
  requestPlaylistAdds.mockResolvedValueOnce(null).mockResolvedValue([{ playlistId: 'p1', status: 'pending' }]);
  getPlaylistAddStatus.mockResolvedValue([]);
  const { result } = renderHook(() => usePlaylistAdds('ch1'));
  act(() => result.current.queue('v9', ['p1'], 'b:000001'));
  await waitFor(() => expect(result.current.notices).toEqual([{ playlistId: 'p1', kind: 'retrying', count: 1 }]));
  await act(async () => { jest.advanceTimersByTime(5000); });
  await waitFor(() => expect(requestPlaylistAdds).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.items[0].status).toBe('pending'));
  expect(result.current.notices).toEqual([]);
});

it('a refused add is shown as not added', async () => {
  requestPlaylistAdds.mockResolvedValue([{ playlistId: 'p1', status: 'failed', refusal: 'forbidden' }]);
  const { result } = renderHook(() => usePlaylistAdds('ch1'));
  act(() => result.current.queue('v1', ['p1'], 'b:000000'));
  await waitFor(() => expect(result.current.notices).toEqual([{ playlistId: 'p1', kind: 'failed', count: 1 }]));
});

it('keeps each video on the channel it was uploaded to after the page switches channel', async () => {
  requestPlaylistAdds.mockResolvedValue([{ playlistId: 'p1', status: 'pending' }]);
  getPlaylistAddStatus.mockResolvedValue([]);
  const { result, rerender } = renderHook(({ channel }) => usePlaylistAdds(channel), { initialProps: { channel: 'ch1' } });
  act(() => result.current.queue('v1', ['p1'], 'b:000000'));
  await waitFor(() => expect(result.current.items[0].status).toBe('pending'));
  rerender({ channel: 'ch2' });
  act(() => result.current.queue('v2', ['p1'], 'b:000001'));
  expect(requestPlaylistAdds).toHaveBeenNthCalledWith(1, 'ch1', 'v1', ['p1'], 'b:000000');
  expect(requestPlaylistAdds).toHaveBeenNthCalledWith(2, 'ch2', 'v2', ['p1'], 'b:000001');
  await waitFor(() => expect(result.current.items.map((i) => i.status)).toEqual(['pending', 'pending']));
  await act(async () => { jest.advanceTimersByTime(5000); });
  await waitFor(() => expect(getPlaylistAddStatus).toHaveBeenCalledTimes(2));
  expect(getPlaylistAddStatus).toHaveBeenCalledWith('ch1', ['v1']);
  expect(getPlaylistAddStatus).toHaveBeenCalledWith('ch2', ['v2']);
});
