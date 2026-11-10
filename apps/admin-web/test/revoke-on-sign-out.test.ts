import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { refreshTokensOf, revokeTokensOnSignOut } from '../src/lib/revoke-on-sign-out';

function jar(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name] } : undefined) };
}

describe('admin sign-out revokes the refresh token', () => {
  it('reads the refresh token from admin_session and the legacy cookie, once each', () => {
    const session = JSON.stringify({ user: {}, accessToken: 'a', refreshToken: 'user:1:r' });
    assert.deepEqual(refreshTokensOf(jar({ admin_session: session })).map((t) => t.refreshToken), ['user:1:r']);
    assert.deepEqual(
      refreshTokensOf(jar({ admin_session: session, refresh_token: 'user:1:legacy' })).map((t) => t.refreshToken),
      ['user:1:r', 'user:1:legacy'],
    );
    assert.deepEqual(refreshTokensOf(jar({ admin_session: session, refresh_token: 'user:1:r' })).length, 1);
    assert.deepEqual(refreshTokensOf(jar({ admin_session: 'not json' })), []);
  });

  it("posts the token to the issuer's /token/revoke with admin's client id", async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: new URLSearchParams(String(init?.body)) });
      return new Response('{}');
    }) as typeof fetch;
    await revokeTokensOnSignOut([{ userId: '', refreshToken: 'user:1:r' }], { issuer: 'https://auth.example', clientId: 'admin-client', fetch: fetcher });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://auth.example/token/revoke');
    assert.equal(calls[0].body.get('token'), 'user:1:r');
    assert.equal(calls[0].body.get('client_id'), 'admin-client');
  });

  it('never blocks sign-out when the issuer fails', async () => {
    const failing = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    await revokeTokensOnSignOut([{ userId: '', refreshToken: 'user:1:r' }], { issuer: 'https://auth.example', fetch: failing });
  });
});
