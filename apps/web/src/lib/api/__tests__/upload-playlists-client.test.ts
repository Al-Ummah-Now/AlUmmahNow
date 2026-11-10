/**
 * Upload page playlist calls go from the browser to api-videos (they survive
 * a deploy during a batch). A refused add request is final; a request that
 * did not get through is answered null, so the page sends it again.
 */
import { createChannelPlaylist, getPlaylistAddStatus, listChannelPlaylists, requestPlaylistAdds } from '../upload-playlists-client';

const callUploadApi = jest.fn();
jest.mock('@/lib/api/upload-client', () => ({ callUploadApi: (...args: unknown[]) => callUploadApi(...args) }));

beforeEach(() => callUploadApi.mockReset());

it("lists the channel's playlists", async () => {
  callUploadApi.mockResolvedValue({ data: [{ id: 'p1' }], accessToken: 't' });
  expect(await listChannelPlaylists('ch1')).toEqual([{ id: 'p1' }]);
  expect(callUploadApi.mock.calls[0][0]).toMatchObject({ method: 'GET', path: '/api/playlists?channelId=ch1&limit=100', channelId: 'ch1' });
  callUploadApi.mockResolvedValue({ success: false });
  expect(await listChannelPlaylists('ch1')).toBeNull();
});

it('creates a playlist with its visibility and description', async () => {
  callUploadApi.mockResolvedValue({ success: true, result: { playlist: { id: 'p9', title: 'Duas' } } });
  expect(await createChannelPlaylist('ch1', { title: 'Duas', description: 'Daily', isPublic: false })).toEqual({ id: 'p9', title: 'Duas', videos: [] });
  expect(callUploadApi.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/api/playlists', body: { title: 'Duas', description: 'Daily', isPublic: false } });
});

it('queues adds; a refusal is final, a failure to get through is null', async () => {
  callUploadApi.mockResolvedValue({ success: true, result: { items: [{ playlistId: 'p1', status: 'pending' }] } });
  expect(await requestPlaylistAdds('ch1', 'v1', ['p1'], 'b:000000')).toEqual([{ playlistId: 'p1', status: 'pending' }]);
  expect(callUploadApi.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/api/playlists/upload-adds', body: { videoId: 'v1', playlistIds: ['p1'], orderKey: 'b:000000' }, retries: 2 });

  callUploadApi.mockResolvedValue({ success: false, status: 403 });
  expect(await requestPlaylistAdds('ch1', 'v1', ['p1'], 'b:000000')).toEqual([{ playlistId: 'p1', status: 'failed', refusal: 'refused' }]);
  callUploadApi.mockResolvedValue({ success: false, status: 503 });
  expect(await requestPlaylistAdds('ch1', 'v1', ['p1'], 'b:000000')).toBeNull();
  callUploadApi.mockResolvedValue({ success: false });
  expect(await requestPlaylistAdds('ch1', 'v1', ['p1'], 'b:000000')).toBeNull();
});

it('reads the status of several uploads at once', async () => {
  callUploadApi.mockResolvedValue({ success: true, result: { items: [{ videoId: 'v1', playlistId: 'p1', status: 'added' }] } });
  expect(await getPlaylistAddStatus('ch1', ['v1', 'v2'])).toEqual([{ videoId: 'v1', playlistId: 'p1', status: 'added' }]);
  expect(callUploadApi.mock.calls[0][0].path).toBe('/api/playlists/upload-adds?videoIds=v1%2Cv2');
});
