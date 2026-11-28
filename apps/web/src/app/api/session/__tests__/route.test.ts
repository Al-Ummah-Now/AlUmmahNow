/** @jest-environment node */
import { NextRequest } from 'next/server';

const ensureFresh = jest.fn();
const info = jest.fn();
jest.mock('@/lib/auth/session-manager', () => ({
  SessionManager: { ensureFreshActiveSession: () => ensureFresh() },
}));
jest.mock('@/lib/actions/multi-account', () => ({ getActiveSessionInfo: () => info() }));

import { GET } from '../route';

const request = (site?: string) => new NextRequest('https://videos.example/api/session', { headers: site ? { 'sec-fetch-site': site } : {} });

describe('GET /api/session', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refreshes the active account and returns the session, never cached', async () => {
    ensureFresh.mockResolvedValue({ userId: 'u-1' });
    info.mockResolvedValue({ user: { id: 'u-1' }, accounts: [] });
    const res = await GET(request('same-origin'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ session: { user: { id: 'u-1' }, accounts: [] } });
    expect(ensureFresh).toHaveBeenCalledTimes(1);
  });

  it('answers signed out without a session, and refuses other sites', async () => {
    ensureFresh.mockResolvedValue(null);
    expect(await (await GET(request('same-origin'))).json()).toEqual({ session: null });
    expect(info).not.toHaveBeenCalled();
    expect((await GET(request('cross-site'))).status).toBe(403);
  });
});
