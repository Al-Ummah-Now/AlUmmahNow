/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { mintRealtimeTicket, realtimeHttpOrigin } from '@/lib/auth/realtime-ticket';

jest.mock('@/lib/logger-server', () => ({ logger: { warn: jest.fn() } }));
jest.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: async () => ({ env: {} }),
}));

const mockFreshSession = jest.fn();
jest.mock('@/lib/auth/session-manager', () => ({
  SessionManager: { ensureFreshActiveSession: () => mockFreshSession() },
}));

const originalFetch = global.fetch;
const originalEnv = process.env;
const jwt = 'header.payload.signature';
const opaque = 'wst_opaque123';
const request = (site = 'same-origin') => new NextRequest('https://videos.test/api/realtime/token', {
  headers: { 'sec-fetch-site': site },
});

beforeEach(() => {
  jest.resetAllMocks();
  process.env = {
    ...originalEnv,
    WEBSOCKET_URL: 'wss://realtime.qa.alummahnow.net/ws',
    INTERNAL_API_KEY: 'test-internal-key',
  };
  mockFreshSession.mockResolvedValue({ accessToken: jwt });
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = originalEnv;
});

it('converts WebSocket URLs to HTTP origins', () => {
  expect(realtimeHttpOrigin('wss://realtime.alummahnow.net/ws')).toBe('https://realtime.alummahnow.net');
  expect(realtimeHttpOrigin('ws://localhost:3087/ws')).toBe('http://localhost:3087');
  expect(realtimeHttpOrigin('javascript:alert(1)')).toBeNull();
  expect(realtimeHttpOrigin(undefined)).toBeNull();
});

it('returns only the opaque ticket with no-store and exchanges the access token server-side', async () => {
  const fetchMock = jest.fn(async () => Response.json({ ticket: opaque }));
  global.fetch = fetchMock;

  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ ticket: opaque });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('https://realtime.qa.alummahnow.net/internal/ws-ticket', expect.objectContaining({
    method: 'POST',
    headers: { 'X-API-Key': 'test-internal-key', Authorization: `Bearer ${jwt}` },
  }));
});

it('returns a no-store failure when minting fails or returns a raw JWT', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(Response.json({ ticket: jwt }));

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'realtime unavailable' });
  }
  expect(await mintRealtimeTicket(jwt, { origin: 'https://realtime.example', apiKey: '' })).toBeNull();
});

it('does not mint a ticket when signed out or requested cross-origin', async () => {
  const fetchMock = jest.fn();
  global.fetch = fetchMock;
  mockFreshSession.mockResolvedValue(null);

  expect((await GET(request('same-site'))).status).toBe(403);
  expect(mockFreshSession).not.toHaveBeenCalled();
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ticket: null });
  expect(fetchMock).not.toHaveBeenCalled();
});
