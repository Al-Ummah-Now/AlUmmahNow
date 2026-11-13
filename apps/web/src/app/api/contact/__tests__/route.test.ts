/**
 * /api/contact forwards to admin-api /internal/contact with the internal key,
 * the visitor's IP and, when signed in, the account's token.
 */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));
jest.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: { INTERNAL_API_KEY: { get: async () => 'k-123' } } }) }));
const session = jest.fn();
jest.mock('@/lib/auth/session-manager', () => ({ SessionManager: { ensureFreshActiveSession: () => session() } }));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { POST } from '../route';

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const h = new Map(Object.entries({ 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'UA', ...headers }));
  return { headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) } as unknown as NextRequest;
}

const upstream = (status: number, body: unknown) => ({ status, json: async () => body }) as Response;

describe('POST /api/contact', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    process.env.ADMIN_API_URL = 'https://admin.api.example/';
    fetchMock.mockReset();
    session.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('forwards a signed-out message with the key and the visitor IP', async () => {
    session.mockResolvedValue(null);
    fetchMock.mockResolvedValue(upstream(201, { success: true, result: { id: 'm1' } }));
    const res = (await POST(request({ name: 'A' }))) as unknown as { status: number; body: unknown };
    expect(res).toEqual({ status: 201, body: { ok: true } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://admin.api.example/internal/contact');
    expect(init.headers).toMatchObject({ 'X-API-Key': 'k-123', 'X-Client-IP': '203.0.113.5', 'X-Client-User-Agent': 'UA' });
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('sends the signed-in account token', async () => {
    session.mockResolvedValue({ accessToken: 'tok' });
    fetchMock.mockResolvedValue(upstream(201, {}));
    await POST(request({ name: 'A' }));
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('passes field errors and the rate limit through, and hides other failures', async () => {
    session.mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(upstream(400, { errors: { email: 'invalid' } }));
    expect(await POST(request({}))).toEqual({ status: 400, body: { error: 'validation', errors: { email: 'invalid' } } });
    fetchMock.mockResolvedValueOnce(upstream(429, {}));
    expect(await POST(request({}))).toEqual({ status: 429, body: { error: 'rate_limited' } });
    fetchMock.mockResolvedValueOnce(upstream(500, { error: 'boom' }));
    expect(await POST(request({}))).toEqual({ status: 502, body: { error: 'failed' } });
  });

  it('passes a Turnstile request through with the site key', async () => {
    session.mockResolvedValue(null);
    fetchMock.mockResolvedValue(upstream(403, { success: false, error: 'human_check_required', siteKey: '1x00000000000000000000AA' }));
    const res = (await POST(request({ name: 'A' }))) as unknown as { status: number; body: unknown };
    expect(res).toEqual({ status: 403, body: { error: 'human_check_required', siteKey: '1x00000000000000000000AA' } });
  });

  it('refuses cross-site posts, bad JSON and oversized bodies without calling admin-api', async () => {
    expect(((await POST(request({}, { 'sec-fetch-site': 'cross-site' }))) as unknown as { status: number }).status).toBe(403);
    expect(((await POST(request('{nope'))) as unknown as { status: number }).status).toBe(400);
    expect(((await POST(request('x'.repeat(40000)))) as unknown as { status: number }).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
