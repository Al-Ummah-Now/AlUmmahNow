/**
 * useBatchPlaylists: while the batch uploads, each row with a video record
 * and playlists is queued once, in queue order, with its own playlists or the
 * batch's; files uploaded before and cancelled rows are skipped.
 */
import { act, renderHook } from '@testing-library/react';
import type { UploadQueueItem } from '@al-ummah/shared-types';
import { useBatchPlaylists } from '@/hooks/useBatchPlaylists';

const row = (id: string, extra: Partial<UploadQueueItem> = {}) => ({ id, videoId: `v-${id}`, status: 'pending', ...extra } as unknown as UploadQueueItem);

it('queues rows only once the batch uploads, in order, with overrides, once each', () => {
  const queueAdds = jest.fn();
  const files = [row('a'), row('b'), row('c', { alreadyUploaded: true }), row('d', { status: 'cancelled' }), row('e', { videoId: undefined })];
  const { result, rerender } = renderHook(({ uploading, list }) => useBatchPlaylists(list, uploading, queueAdds), { initialProps: { uploading: false, list: files } });

  act(() => result.current.setBatchPlaylists(['p1', 'p2']));
  act(() => result.current.setRowPlaylists('b', ['p3']));
  expect(queueAdds).not.toHaveBeenCalled();

  rerender({ uploading: true, list: files });
  expect(queueAdds.mock.calls.map(([videoId, ids]) => [videoId, ids])).toEqual([['v-a', ['p1', 'p2']], ['v-b', ['p3']]]);
  const keys = queueAdds.mock.calls.map(([, , key]) => key as string);
  expect(keys[0] < keys[1]).toBe(true);
  expect(result.current.committed).toEqual({ a: ['p1', 'p2'], b: ['p3'] });

  // A row that gets its record later (the upload limit deferred it) is queued after the others
  rerender({ uploading: true, list: [...files, row('f')] });
  expect(queueAdds).toHaveBeenCalledTimes(3);
  expect(queueAdds.mock.calls[2][0]).toBe('v-f');
  expect((queueAdds.mock.calls[2][2] as string) > keys[1]).toBe(true);

  // Changing the batch's choice later never re-queues a row
  act(() => result.current.setBatchPlaylists(['p9']));
  expect(queueAdds).toHaveBeenCalledTimes(3);
});

it('a row whose own choice is "no playlists" is not queued', () => {
  const queueAdds = jest.fn();
  const { result, rerender } = renderHook(({ uploading }) => useBatchPlaylists([row('a')], uploading, queueAdds), { initialProps: { uploading: false } });
  act(() => result.current.setBatchPlaylists(['p1']));
  act(() => result.current.setRowPlaylists('a', []));
  rerender({ uploading: true });
  expect(queueAdds).not.toHaveBeenCalled();
});
