/** @jest-environment node */
import { NextRequest } from 'next/server';

const ensureFresh = jest.fn();
const loadUserChannels = jest.fn();
const info = jest.fn();
jest.mock('@/lib/auth/session-manager', () => ({
  SessionManager: { ensureFreshActiveSession: () => ensureFresh(), loadUserChannels: (id: string) => loadUserChannels(id) },
}));
jest.mock('@/lib/actions/multi-account', () => ({ getActiveSessionInfo: () => info() }));

import { POST } from '../route';

const request = (site?: string) => new NextRequest('https://videos.example/api/session/channels', { method: 'POST', headers: site ? { 'sec-fetch-site': site } : {} });

describe('POST /api/session/channels', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reloads the active account and returns the session', async () => {
    ensureFresh.mockResolvedValue({ userId: 'u-1' });
    info.mockResolvedValue({ user: { id: 'u-1' }, accounts: [] });
    const res = await POST(request('same-origin'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ session: { user: { id: 'u-1' }, accounts: [] } });
    expect(loadUserChannels).toHaveBeenCalledWith('u-1');
  });

  it('answers signed out without a session, and refuses other sites', async () => {
    ensureFresh.mockResolvedValue(null);
    expect(await (await POST(request('same-origin'))).json()).toEqual({ session: null });
    expect(loadUserChannels).not.toHaveBeenCalled();
    expect((await POST(request('cross-site'))).status).toBe(403);
  });
});
