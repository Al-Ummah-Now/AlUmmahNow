/** @jest-environment node */
const apiRequestServer = jest.fn(async (_options: { expectedStatuses?: number[]; url: string }) => null);
jest.mock('../api-client', () => ({ apiRequestServer: (options: never) => apiRequestServer(options), buildApiUrl: (path: string) => path }));
jest.mock('../server-auth', () => ({ getServerAuthContext: async () => ({ userId: 'me', accessToken: 't' }) }));

import { getProfileById, getProfileCurrent } from '../profiles';

describe('no profile yet (a first sign-in)', () => {
  beforeEach(() => apiRequestServer.mockClear());

  it("is an expected answer for one's own profile, by either read", async () => {
    await getProfileCurrent();
    await getProfileById('me');
    for (const [options] of apiRequestServer.mock.calls) expect(options).toMatchObject({ url: '/api/profile', expectedStatuses: [404] });
    expect(apiRequestServer).toHaveBeenCalledTimes(2);
  });

  it("is an error for another user's profile", async () => {
    await getProfileById('other');
    expect(apiRequestServer.mock.calls[0][0].url).toBe('/api/profiles/other');
    expect(apiRequestServer.mock.calls[0][0].expectedStatuses).toBeUndefined();
  });
});
