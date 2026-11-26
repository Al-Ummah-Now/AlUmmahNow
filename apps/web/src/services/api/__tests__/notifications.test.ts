import { clearClientAuthToken } from '@/lib/auth/client-token';
import { NotificationsService } from '../notifications';

jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));

it('reads account notifications even when the session still names a transferred channel', async () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ accessToken: 'token', channelId: 'transferred' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { items: [] } }) });
  global.fetch = fetchMock;
  clearClientAuthToken();
  try {
    expect(await NotificationsService.list()).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.test/api/notifications?limit=20', {
      headers: { Authorization: 'Bearer token' },
    });
  } finally {
    clearClientAuthToken();
    global.fetch = originalFetch;
  }
});
