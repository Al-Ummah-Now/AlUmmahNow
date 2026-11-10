/**
 * @jest-environment node
 *
 * Refreshing one session from many isolates at once (SCALABILITY-AUDIT WEB-1).
 *
 * Each "isolate" is its own copy of token-refresh.ts (jest.isolateModules), so
 * none shares the in-memory single-flight or rotation memory. The issuer here
 * behaves like @al-ummah-now/openauth (checked against the real one in
 * apps/admin-web/test/issuer-rotation.test.ts): a refresh token's successor is
 * reserved when the token is stored, uses within 60 s return it again, a use
 * after that revokes the whole sign-in.
 */
import type * as TokenRefresh from '../token-refresh';
import { jwt } from './token-fixtures';

const WINDOW_MS = 60_000;

class RotatingIssuer {
  tokens = new Map<string, { next: string; usedAt?: number }>();
  revoked = false;
  issued = 0;
  constructor(public now: () => number) {}
  mint(): string {
    const t = `rt-${crypto.randomUUID()}`;
    this.tokens.set(t, { next: `rt-${crypto.randomUUID()}` });
    return t;
  }
  fetch = (async (_url: string, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    const token = new URLSearchParams(String(init?.body)).get('refresh_token') ?? '';
    const record = this.tokens.get(token);
    const fail = () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    if (!record || this.revoked) return fail();
    if (record.usedAt === undefined) {
      record.usedAt = this.now();
      if (!this.tokens.has(record.next)) this.tokens.set(record.next, { next: `rt-${crypto.randomUUID()}` });
    } else if (this.now() > record.usedAt + WINDOW_MS) {
      this.revoked = true; // reuse past the window: the issuer invalidates the subject
      return fail();
    }
    this.issued++;
    return new Response(JSON.stringify({
      access_token: jwt('u1', this.now(), 900_000),
      refresh_token: record.next,
      expires_in: 900,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

function isolate(): typeof TokenRefresh {
  let mod!: typeof TokenRefresh;
  jest.isolateModules(() => {
    mod = jest.requireActual('../token-refresh');
  });
  return mod;
}

describe('refresh across isolates', () => {
  it('20 isolates refreshing the same token at once: every cookie they write holds the live successor', async () => {
    let clock = 1_800_000_000_000;
    const issuer = new RotatingIssuer(() => clock);
    const first = issuer.mint();
    const isolates = Array.from({ length: 20 }, isolate);

    const outcomes = await Promise.all(
      isolates.map((m) => m.refreshTokensOnce('u1', first, { issuer: 'https://auth.test', fetchImpl: issuer.fetch, now: () => clock })),
    );
    expect(outcomes.every((o) => o.ok)).toBe(true);
    const successors = new Set(outcomes.map((o) => (o.ok ? o.tokens.refreshToken : '')));
    expect(successors.size).toBe(1);

    // The browser keeps whichever Set-Cookie arrived last; time moves past the reuse window
    const kept = outcomes[Math.floor(Math.random() * outcomes.length)];
    clock += 10 * 60_000;
    const next = await isolate().refreshTokensOnce('u1', kept.ok ? kept.tokens.refreshToken : '', {
      issuer: 'https://auth.test', fetchImpl: issuer.fetch, now: () => clock,
    });
    expect(next.ok).toBe(true);
    expect(issuer.revoked).toBe(false);
  });

  it('without the invariant (a fresh successor per use) the same race signs the user out: the test above guards it', async () => {
    const clock = 1_800_000_000_000;
    const issuer = new RotatingIssuer(() => clock);
    // Break the invariant: every use mints a different successor
    const real = issuer.fetch;
    issuer.fetch = (async (url: string, init?: RequestInit) => {
      const res = await real(url, init);
      const token = new URLSearchParams(String(init?.body)).get('refresh_token') ?? '';
      const record = issuer.tokens.get(token);
      if (record) record.next = issuer.mint();
      return res;
    }) as unknown as typeof fetch;
    const first = issuer.mint();
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, isolate).map((m) => m.refreshTokensOnce('u1', first, { issuer: 'https://auth.test', fetchImpl: issuer.fetch, now: () => clock })),
    );
    expect(new Set(outcomes.map((o) => (o.ok ? o.tokens.refreshToken : ''))).size).toBeGreaterThan(1);
  });
});
