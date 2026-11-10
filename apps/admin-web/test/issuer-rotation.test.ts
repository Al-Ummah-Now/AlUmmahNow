/**
 * The issuer invariant the admin and web sessions rely on across isolates
 * (SCALABILITY-AUDIT WEB-1, AW-1), checked against the real
 * @al-ummah-now/openauth issuer code (the version this app ships with).
 *
 * Cloudflare runs many isolates, so a page load, its prefetches and other
 * tabs can each refresh the same refresh token at the same moment, and each
 * isolate writes its own Set-Cookie. That is only safe if every use of a
 * refresh token within the reuse window returns the SAME successor refresh
 * token: then whichever cookie the browser keeps, it holds the live token.
 * The issuer reserves the successor (`nextToken`) when it stores a token, so
 * it does; this test fails if a library change ever breaks that.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { refreshTokens } from '../src/lib/token-refresh';

async function setup() {
  // ESM-only package: loaded with import() from this CommonJS test
  const { issuer } = await import('@al-ummah-now/openauth/issuer');
  const { MemoryStorage } = await import('@al-ummah-now/openauth/storage/memory');
  const { Storage } = await import('@al-ummah-now/openauth/storage/storage');
  const storage = MemoryStorage();
  const app = issuer({
    storage,
    providers: {},
    subjects: {} as never,
    success: async () => new Response('unused'),
  } as never);
  const subject = 'user:abc';
  const first = crypto.randomUUID();
  await Storage.set(storage, ['oauth:refresh', subject, first], {
    type: 'user',
    properties: { id: 'abc' },
    clientID: 'admin-web',
    subject,
    ttl: { access: 900, refresh: 86400 },
    nextToken: crypto.randomUUID(),
  }, 86400);
  // refreshTokens() talks HTTP; route it into the issuer in-process
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) =>
    app.fetch(new Request(String(url), init))) as typeof fetch;
  return { refresh: `${subject}:${first}`, fetchImpl };
}

describe('issuer: refresh rotation is idempotent within the reuse window', () => {
  it('25 isolates refreshing the same token at once all get the same successor refresh token', async () => {
    const { refresh, fetchImpl } = await setup();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => refreshTokens('https://auth.test', refresh, fetchImpl)),
    );
    assert.ok(results.every((r) => r.kind === 'refreshed'), JSON.stringify(results.find((r) => r.kind !== 'refreshed')));
    const successors = new Set(results.map((r) => (r.kind === 'refreshed' ? r.tokens.refreshToken : '')));
    assert.equal(successors.size, 1, 'one successor, whichever cookie wins');

    // And that successor is live: the session continues from it
    const [next] = [...successors];
    const again = await refreshTokens('https://auth.test', next, fetchImpl);
    assert.equal(again.kind, 'refreshed');
  });
});
