/**
 * @jest-environment node
 */
jest.mock('@/lib/logger-server', () => ({ logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

import { revokeTokensOnSignOut } from '../revoke-on-sign-out';
import { logger } from '@/lib/logger-server';

function fakeFetch(status = 200) {
  return jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', { status }));
}

beforeEach(() => jest.clearAllMocks());

it("posts each account's refresh token to the issuer's /token/revoke with the client id", async () => {
  const f = fakeFetch();
  await revokeTokensOnSignOut(
    [
      { userId: 'u1', refreshToken: 'user:1:a' },
      { userId: 'u2', refreshToken: 'user:2:b' },
    ],
    { issuer: 'https://auth.example/', clientId: 'web-client', fetch: f as unknown as typeof fetch },
  );
  expect(f).toHaveBeenCalledTimes(2);
  const sent = f.mock.calls.map(([url, init]) => ({ url: String(url), body: new URLSearchParams(String(init?.body)) }));
  for (const s of sent) {
    expect(s.url).toBe('https://auth.example/token/revoke');
    expect(s.body.get('client_id')).toBe('web-client');
    expect(s.body.get('token_type_hint')).toBe('refresh_token');
  }
  expect(sent.map((s) => s.body.get('token')).sort()).toEqual(['user:1:a', 'user:2:b']);
});

it('skips accounts without a refresh token and does nothing without an issuer', async () => {
  const f = fakeFetch();
  await revokeTokensOnSignOut([{ userId: 'u1', refreshToken: '' }], { issuer: 'https://auth.example', fetch: f as unknown as typeof fetch });
  await revokeTokensOnSignOut([{ userId: 'u1', refreshToken: 'user:1:a' }], { issuer: '', fetch: f as unknown as typeof fetch });
  expect(f).not.toHaveBeenCalled();
});

it('never throws: a refused or failed revocation is logged and sign-out goes on', async () => {
  const refused = fakeFetch(500);
  await expect(
    revokeTokensOnSignOut([{ userId: 'u1', refreshToken: 'user:1:a' }], { issuer: 'https://auth.example', fetch: refused as unknown as typeof fetch }),
  ).resolves.toBeUndefined();
  const broken = jest.fn(async () => {
    throw new Error('network down');
  });
  await expect(
    revokeTokensOnSignOut([{ userId: 'u1', refreshToken: 'user:1:a' }], { issuer: 'https://auth.example', fetch: broken as unknown as typeof fetch }),
  ).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledTimes(2);
});
