/**
 * Story 1.3 AC 4 (server-side enforcement) and Story 1.2 AC 5 (sanitization
 * before forwarding) for the A/B and performance beacon routes.
 */
import type { NextRequest } from 'next/server';
import { forwardClientEvents } from '../forward-client-events';
import { normalizeClientEvents, CONSENT_FOR_KIND } from '../client-events';

// Minimal next/server stand-in: jsdom has no fetch Response for NextResponse.
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

function beacon(body: unknown, cookie?: string): NextRequest {
  const headers = new Map<string, string>([['content-type', 'application/json'], ...(cookie ? [['cookie', cookie] as [string, string]] : [])]);
  return {
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => JSON.stringify(body),
  } as unknown as NextRequest;
}

const now = Date.now();
const allow = `aun_consent=v1.a1.e1.p1.${now}`;
const deny = `aun_consent=v1.a1.e0.p0.${now}`;

describe('forwardClientEvents consent enforcement', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async () => ({ ok: true }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('maps beacon kinds to consent categories', () => {
    expect(CONSENT_FOR_KIND).toEqual({ ab_test: 'experiments', performance: 'performance', visit: 'analytics' });
  });

  it('drops beacons without a consent cookie (default deny)', async () => {
    const res = await forwardClientEvents(beacon({ type: 'web-vitals', data: { name: 'LCP', value: 1 } }), 'performance');
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: 0, reason: 'no-consent' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops beacons when the specific category was declined', async () => {
    const res = await forwardClientEvents(beacon({ events: [{ eventType: 'exposure' }] }, deny), 'ab_test');
    expect(await res.json()).toMatchObject({ reason: 'no-consent' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards sanitized events when consent was given', async () => {
    const res = await forwardClientEvents(
      beacon({ type: 'web-vitals', data: { name: '<img src=x onerror=alert(1)>LCP', url: 'https://web.test/en?token=secret', email: 'a@b.c' } }, allow),
      'performance',
    );
    expect(await res.json()).toMatchObject({ accepted: 1 });
    const forwarded = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(forwarded.events[0]).toEqual({ metricType: 'web-vitals', name: 'LCP', url: 'https://web.test/en' });
  });
});

describe('normalizeClientEvents sanitization', () => {
  it('strips markup, prototype keys and identifiers from events and referrer', () => {
    const payload = JSON.parse(
      '{"events":[{"eventType":"<script>x</script>exposure","__proto__":{"admin":true},"ip":"1.2.3.4"}],"referrer":"https://x.test/p?session=abc"}',
    );
    expect(normalizeClientEvents(payload)).toEqual({ events: [{ eventType: 'exposure' }], referrer: 'https://x.test/p' });
  });
});
