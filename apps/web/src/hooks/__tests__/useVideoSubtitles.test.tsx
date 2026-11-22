import { renderHook, waitFor } from '@testing-library/react';

let token: string | null = 'tok-1';
jest.mock('@/lib/auth/client-token', () => ({ fetchClientAuthInfo: async () => ({ accessToken: token, channelId: null }) }));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {} }) }));

import { useVideoSubtitles } from '../useVideoSubtitles';

const VTT = 'WEBVTT\n\n00:00.000 --> 00:01.000\nfixture\n';
const track = { language: 'en', label: 'English', isDefault: true, status: 'ready' };

describe('useVideoSubtitles', () => {
  const realFetch = global.fetch;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  let fetchMock: jest.Mock;
  let restricted: boolean;
  beforeEach(() => {
    token = 'tok-1';
    restricted = false;
    fetchMock = jest.fn(async (url: string) =>
      url.endsWith('/subtitles')
        ? { ok: true, json: async () => ({ success: true, data: { tracks: [track], defaultLanguage: 'en', restricted } }) }
        : { ok: true, text: async () => VTT },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    URL.createObjectURL = jest.fn(() => 'blob:https://web.test/1');
    URL.revokeObjectURL = jest.fn();
  });
  afterEach(() => {
    global.fetch = realFetch;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  });

  it('a video open to anyone: the player loads each track by its API URL', async () => {
    const { result } = renderHook(() => useVideoSubtitles('v1', 'en'));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].src).toBe('https://api.test/api/videos/v1/subtitles/en');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an owner-only video: each track is fetched with the viewer's token and played from a blob URL, revoked on unmount", async () => {
    restricted = true;
    const { result, unmount } = renderHook(() => useVideoSubtitles('v1', 'en'));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].src).toBe('blob:https://web.test/1');
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.test/api/videos/v1/subtitles', expect.objectContaining({ headers: { Authorization: 'Bearer tok-1' } }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.test/api/videos/v1/subtitles/en', expect.objectContaining({ headers: { Authorization: 'Bearer tok-1' }, cache: 'no-store' }));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://web.test/1');
  });

  it('signed out: no token is sent and a hidden video gives no tracks', async () => {
    token = null;
    fetchMock.mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({ success: false }) }));
    const { result } = renderHook(() => useVideoSubtitles('v1', 'en'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('headers');
    expect(result.current).toEqual([]);
  });
});
