/**
 * @jest-environment node
 *
 * apiRequestServer retries a 401 exactly once, after refreshing the token.
 */

jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.example' }));

import { apiRequestServer, type AuthContext } from '../api-client';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function apiAnswering(statuses: number[]) {
  const seen: (string | null)[] = [];
  const mock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('Authorization'));
    const status = statuses[Math.min(seen.length - 1, statuses.length - 1)];
    return new Response(status === 200 ? JSON.stringify({ ok: true }) : 'nope', { status });
  });
  global.fetch = mock as unknown as typeof fetch;
  return { mock, seen };
}

const options = { method: 'GET' as const, url: 'https://api.example/api/profile', functionName: 'test' };
const auth = async (): Promise<AuthContext> => ({ userId: 'u1', accessToken: 'old' });

describe('apiRequestServer after a 401', () => {
  it('refreshes once and retries with the new token', async () => {
    const api = apiAnswering([401, 200]);
    const refresh = jest.fn(async (ctx: AuthContext) => ({ ...ctx, accessToken: 'new' }));

    const result = await apiRequestServer(options, auth, true, refresh);

    expect(result).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ userId: 'u1', accessToken: 'old' });
    expect(api.seen).toEqual(['Bearer old', 'Bearer new']);
  });

  it('never retries more than once, even if the retry is a 401 too', async () => {
    const api = apiAnswering([401, 401, 401]);
    const refresh = jest.fn(async (ctx: AuthContext) => ({ ...ctx, accessToken: 'new' }));

    expect(await apiRequestServer(options, auth, true, refresh)).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(api.mock).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the refresh fails (definitively or not)', async () => {
    const api = apiAnswering([401]);
    const refresh = jest.fn(async () => null);

    expect(await apiRequestServer(options, auth, true, refresh)).toBeNull();
    expect(api.mock).toHaveBeenCalledTimes(1);

    const throwing = jest.fn(async () => {
      throw new Error('boom');
    });
    expect(await apiRequestServer(options, auth, true, throwing)).toBeNull();
    expect(api.mock).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the refresh hands back the same token', async () => {
    const api = apiAnswering([401]);
    expect(await apiRequestServer(options, auth, true, async (ctx) => ctx)).toBeNull();
    expect(api.mock).toHaveBeenCalledTimes(1);
  });

  it('leaves other statuses and anonymous requests alone', async () => {
    const refresh = jest.fn();

    const api = apiAnswering([403]);
    expect(await apiRequestServer(options, auth, true, refresh)).toBeNull();

    apiAnswering([401]);
    expect(await apiRequestServer(options, async () => null, false, refresh)).toBeNull();

    expect(refresh).not.toHaveBeenCalled();
    expect(api.mock).toHaveBeenCalledTimes(1);
  });
});
