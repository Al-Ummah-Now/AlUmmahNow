/** /api/errors forwards browser reports to admin-api with the key, IP and user agent, marked as browser-sourced. */
import type { NextRequest } from 'next/server';

const waitUntil = jest.fn();
jest.mock('next/server', () => ({
  NextResponse: class {
    status: number;
    constructor(_body: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
    }
  },
}));
let cfEnv: Record<string, unknown> = {};
jest.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: cfEnv, ctx: { waitUntil } }) }));

let sessionUser: string | null = null;
/** The id the session's access token proves (null: it does not verify, e.g. forged or tampered). */
let tokenUser: string | null = null;
jest.mock('@/lib/auth/session-manager', () => ({
  SessionManager: { getActiveSession: async () => (sessionUser ? { userId: sessionUser, accessToken: 'session-access-token' } : null) },
}));
jest.mock('@/lib/auth/openauth-client', () => ({
  getOpenAuthClient: () => ({
    verify: async (_subjects: unknown, token: string) =>
      token === 'session-access-token' && tokenUser ? { subject: { type: 'user', properties: { id: tokenUser } } } : { err: new Error('Invalid access token') },
  }),
}));
jest.mock('@/interfaces/subjects', () => ({ subjects: {} }));

import { POST } from '../route';

function request(body: string, headers: Record<string, string> = {}): NextRequest {
  const h = new Map(Object.entries({ 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'Mozilla/5.0 Chrome/131', ...headers }));
  return { headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null }, text: async () => body } as unknown as NextRequest;
}

describe('POST /api/errors', () => {
  const fetchMock = jest.fn(async () => ({ status: 202 }) as Response);
  beforeEach(() => {
    fetchMock.mockClear();
    waitUntil.mockClear();
    cfEnv = { ADMIN_API_URL: 'https://admin.api.example/', INTERNAL_API_KEY: { get: async () => 'k-1' } };
    global.fetch = fetchMock as unknown as typeof fetch;
    sessionUser = null;
    tokenUser = null;
  });

  it('forwards in the background and answers 202', async () => {
    const body = JSON.stringify({ events: [{ app: 'web', kind: 'upload', ref: 'ERR-AAAA-BBBB', message: 'x' }] });
    const res = (await POST(request(body))) as unknown as { status: number };
    expect(res.status).toBe(202);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://admin.api.example/internal/errors');
    expect(init.headers).toMatchObject({ 'X-API-Key': 'k-1', 'X-Report-Source': 'browser', 'X-Report-App': 'web', 'X-Client-IP': '203.0.113.9', 'X-Client-User-Agent': 'Mozilla/5.0 Chrome/131' });
    expect(init.headers['X-Client-User-Id']).toBeUndefined();
    expect(init.body).toBe(body);
  });

  it('an ADMIN_API_URL process override wins over the wrangler vars (local dev never reaches the configured host)', async () => {
    process.env.ADMIN_API_URL = 'http://localhost:3399';
    try {
      await POST(request(JSON.stringify({ events: [{ app: 'web', kind: 'upload', ref: 'ERR-AAAA-CCCC', message: 'x' }] })));
      const [url] = fetchMock.mock.calls[0] as unknown as [string];
      expect(url).toBe('http://localhost:3399/internal/errors');
    } finally {
      delete process.env.ADMIN_API_URL;
    }
  });

  it('vouches for the signed-in account its verified token proves, never the page', async () => {
    sessionUser = 'usr_session1';
    tokenUser = 'usr_session1';
    const body = JSON.stringify({ events: [{ app: 'web', kind: 'upload', ref: 'ERR-AAAA-BBBB', message: 'x', userId: 'usr_forged99' }] });
    await POST(request(body));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers['X-Client-User-Id']).toBe('usr_session1');
  });

  it('vouches for nobody when the session cookie names an account its token does not prove', async () => {
    // The session cookie is editable JSON: a userId there alone is never vouched for
    sessionUser = 'usr_victim';
    tokenUser = null;
    await POST(request(JSON.stringify({ events: [{ app: 'web', kind: 'upload', ref: 'ERR-AAAA-BBBB', message: 'x' }] })));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers['X-Client-User-Id']).toBeUndefined();
  });

  it('vouches for the verified token id, not the cookie userId, when they differ', async () => {
    sessionUser = 'usr_victim';
    tokenUser = 'usr_real';
    await POST(request(JSON.stringify({ events: [{ app: 'web', kind: 'upload', ref: 'ERR-AAAA-BBBB', message: 'x' }] })));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers['X-Client-User-Id']).toBe('usr_real');
  });

  it('accepts sendBeacon bodies (any content type) and refuses other sites, junk and huge bodies', async () => {
    expect(((await POST(request('{"events":[]}', { 'content-type': 'text/plain' }))) as unknown as { status: number }).status).toBe(202);
    expect(((await POST(request('{"events":[]}', { 'sec-fetch-site': 'cross-site' }))) as unknown as { status: number }).status).toBe(403);
    expect(((await POST(request('not json'))) as unknown as { status: number }).status).toBe(400);
    expect(((await POST(request('{"nope":1}'))) as unknown as { status: number }).status).toBe(400);
    expect(((await POST(request('x'.repeat(70 * 1024)))) as unknown as { status: number }).status).toBe(413);
  });

  it('quietly drops reports when not configured (never an error for the page)', async () => {
    cfEnv = {};
    delete process.env.ADMIN_API_URL;
    delete process.env.INTERNAL_API_KEY;
    expect(((await POST(request('{"events":[]}'))) as unknown as { status: number }).status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
