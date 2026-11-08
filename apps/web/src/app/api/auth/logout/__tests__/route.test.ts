/**
 * @jest-environment node
 *
 * Front-channel logout clears every account's session cookie, including the
 * al_ummah_session.N chunks a multi-account session is split into, and
 * revokes every stored account's tokens.
 */
import { NextRequest } from 'next/server';

const revoke = jest.fn(async (_accounts: unknown[]) => undefined);
jest.mock('@/lib/auth/revoke-on-sign-out', () => ({ revokeTokensOnSignOut: (accounts: unknown[]) => revoke(accounts) }));

import { GET } from '../route';
import { splitSessionValue } from '@/lib/auth/session-cookie';

const originalIssuer = process.env.Issuer;
beforeEach(() => {
  process.env.Issuer = 'https://auth.example';
  revoke.mockClear();
});
afterEach(() => {
  process.env.Issuer = originalIssuer;
});

it('revokes both accounts and deletes every chunk of a two-account session', async () => {
  const account = (id: string) => ({ userId: id, accessToken: `${id}-a`.padEnd(2500, 'x'), refreshToken: `${id}-r` });
  const value = JSON.stringify({ activeUserId: 'u1', activeChannelId: null, accounts: { u1: account('u1'), u2: account('u2') } });
  const chunks = splitSessionValue(value);
  expect(chunks.length).toBeGreaterThan(1);
  const cookie = chunks.map((c, i) => `${i === 0 ? 'al_ummah_session' : `al_ummah_session.${i}`}=${encodeURIComponent(c)}`).join('; ');

  const response = await GET(new NextRequest('https://web.example/api/auth/logout', { headers: { cookie } }));

  expect((revoke.mock.calls[0][0] as Array<{ userId: string }>).map((a) => a.userId).sort()).toEqual(['u1', 'u2']);
  const deleted = response.headers.getSetCookie().filter((c) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)).map((c) => c.split('=')[0]);
  for (let i = 0; i < chunks.length; i++) {
    expect(deleted).toContain(i === 0 ? 'al_ummah_session' : `al_ummah_session.${i}`);
  }
});
