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

it('does not request unread counts when there is no access token', async () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ accessToken: null, channelId: null }),
  });
  global.fetch = fetchMock;
  clearClientAuthToken();
  try {
    expect(await NotificationsService.counts()).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/token']);
  } finally {
    clearClientAuthToken();
    global.fetch = originalFetch;
  }
});

it('does not reuse a rejected credential for unread counts', async () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ accessToken: 'revoked', channelId: null }) })
    .mockResolvedValueOnce({ ok: false, status: 401 })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ accessToken: null, channelId: null }) });
  global.fetch = fetchMock;
  clearClientAuthToken();
  try {
    expect(await NotificationsService.counts()).toBeNull();
    expect(await NotificationsService.counts()).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/token',
      'https://api.test/api/notifications/unread-count',
      '/api/auth/token',
    ]);
  } finally {
    clearClientAuthToken();
    global.fetch = originalFetch;
  }
});
