/** /api/report forwards a guest's report to admin-api with the internal key and Cloudflare's own address, never a session. */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));
jest.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: { INTERNAL_API_KEY: { get: async () => 'k-123' } } }) }));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { POST } from '../route';

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const h = new Map(Object.entries({ 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.5', cookie: 'session=x', ...headers }));
  return { headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) } as unknown as NextRequest;
}
const upstream = (status: number, body: unknown = {}) => ({ status, json: async () => body }) as Response;

describe('POST /api/report', () => {
  const fetchMock = jest.fn();
  const send = async (body: unknown, headers?: Record<string, string>) => (await POST(request(body, headers))) as unknown as { status: number; body: unknown };
  beforeEach(() => {
    process.env.ADMIN_API_URL = 'https://admin.api.example/';
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('forwards the report and answers the same for every one that was taken', async () => {
    fetchMock.mockResolvedValue(upstream(201, { success: true, result: { id: 'r1', merged: true } }));
    expect(await send({ entityId: 'v' })).toEqual({ status: 201, body: { ok: true } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://admin.api.example/internal/guest-reports');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-API-Key': 'k-123', 'X-Client-IP': '203.0.113.5' });
  });

  it("never lets a visitor's own header pick the address that is counted", async () => {
    fetchMock.mockResolvedValue(upstream(201));
    await send({}, { 'cf-connecting-ip': '', 'x-forwarded-for': '198.51.100.1' });
    expect(fetchMock.mock.calls[0][1].headers['X-Client-IP']).toBeUndefined();
  });

  it('refuses other sites, broken bodies and large ones', async () => {
    expect((await send({}, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await send('{')).status).toBe(400);
    expect((await send('x'.repeat(33 * 1024))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, { errors: { reason: 'invalid' } }, 400, { error: 'validation', errors: { reason: 'invalid' } }],
    [429, { code: 'rate_limited' }, 429, { error: 'rate_limited' }],
    [403, { code: 'human_check_required', siteKey: 's' }, 403, { error: 'human_check_required', siteKey: 's' }],
    [503, {}, 503, { error: 'unavailable' }],
    [401, {}, 502, { error: 'failed' }],
    [404, { code: 'target_not_found' }, 502, { error: 'failed' }],
  ])('answers %i %j', async (status, body, expected, out) => {
    fetchMock.mockResolvedValue(upstream(status, body));
    expect(await send({})).toEqual({ status: expected, body: out });
  });

  it('is unavailable without admin-api or its key, and when it cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    expect((await send({})).status).toBe(503);
    process.env.ADMIN_API_URL = '';
    expect((await send({})).status).toBe(503);
  });
});
