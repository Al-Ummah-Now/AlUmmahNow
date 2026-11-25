/**
 * The playlist pickers read the first 50 or 100 playlists and silently dropped the rest. Reading all of
 * them 50 at a time is the hook's job, checked here without rendering a row per playlist.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePlaylistPages } from '@/hooks/usePlaylistPages';
import { listPlaylists } from '@/lib/api/playlists';
import { manyPlaylists, pagedList } from '@/components/playlists/__tests__/manyPlaylists';

jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/api/playlists', () => ({ listPlaylists: jest.fn() }));

const mockList = listPlaylists as jest.MockedFunction<typeof listPlaylists>;

beforeEach(() => jest.clearAllMocks());

it.each([
  ['personal playlists', '', { mine: true }],
  ['a channel\'s playlists', 'ch1', { channelId: 'ch1' }],
])('reads %s 50 at a time, past #150 to the last one', async (_label, channelId, scope) => {
  mockList.mockImplementation(pagedList(manyPlaylists('Mine', channelId)));
  const { result } = renderHook(() => usePlaylistPages(channelId));
  await waitFor(() => expect(result.current.items).toHaveLength(50));
  while (result.current.hasMore) {
    await act(async () => { result.current.loadMore(); });
  }
  expect(mockList.mock.calls.map(([params]) => params)).toEqual([
    { ...scope, limit: 50 },
    { ...scope, limit: 50, cursor: '50' },
    { ...scope, limit: 50, cursor: '100' },
    { ...scope, limit: 50, cursor: '150' },
  ]);
  expect(result.current.items).toHaveLength(160);
  expect(result.current.items[149]!.id).toBe('Mine-150');
});
