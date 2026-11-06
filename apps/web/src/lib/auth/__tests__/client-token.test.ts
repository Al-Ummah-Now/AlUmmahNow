/**
 * Tests for client-side auth token utilities.
 * Tokens come from the same-origin /api/auth/token endpoint (cookies are httpOnly).
 */

import {
  fetchClientAuthToken,
  getClientAuthToken,
  getClientAuthHeaders,
  clearClientAuthToken,
} from '../client-token';

const mockFetch = (status: number, body: unknown) =>
  jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, json: async () => body });

describe('client-token', () => {
  const originalFetch = global.fetch;

  beforeEach(() => clearClientAuthToken());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the token from /api/auth/token and caches it', async () => {
    const f = mockFetch(200, { accessToken: 'tok', channelId: 'ch1' });
    global.fetch = f as unknown as typeof fetch;

    expect(await fetchClientAuthToken()).toBe('tok');
    expect(await fetchClientAuthToken()).toBe('tok');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('/api/auth/token', expect.objectContaining({ credentials: 'same-origin' }));
    expect(getClientAuthToken()).toBe('tok');
  });

  it('returns null when not authenticated', async () => {
    global.fetch = mockFetch(401, { accessToken: null }) as unknown as typeof fetch;
    expect(await fetchClientAuthToken()).toBeNull();
  });

  it('returns null when the request fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    expect(await fetchClientAuthToken()).toBeNull();
  });

  it('builds Authorization and channelId headers', async () => {
    global.fetch = mockFetch(200, { accessToken: 'tok', channelId: 'ch1' }) as unknown as typeof fetch;
    expect(await getClientAuthHeaders()).toEqual({ Authorization: 'Bearer tok', channelId: 'ch1' });
  });

  it('returns no headers when anonymous', async () => {
    global.fetch = mockFetch(401, { accessToken: null, channelId: null }) as unknown as typeof fetch;
    expect(await getClientAuthHeaders()).toEqual({});
  });
});
