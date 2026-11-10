/**
 * #663: admin-web's own session check (getAdminSessionState) takes roles from
 * the access token, so a legacy 30-day token (roles frozen at issue) is not
 * used: it is refreshed like an expired one, never shown as an error.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifySessionTokens, type VerifyOutcome } from '../src/lib/session-state';
import { LEGACY_TOKEN_ISSUED_BEFORE_SECONDS } from '../src/lib/token-refresh';

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function jwt(iat: number, exp: number): string {
  return `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url({ mode: 'access', type: 'user', iat, exp })}.sig`;
}

const admin: VerifyOutcome = { subject: { properties: { id: 'usr_a', email: 'a@example.com', roles: ['Super Admin'] } } };
const verifyOk = async () => admin;
const verifyFails = async (): Promise<VerifyOutcome> => ({ err: { name: 'InvalidAccessTokenError' } });

const BEFORE = LEGACY_TOKEN_ISSUED_BEFORE_SECONDS - 3600;
const legacy = jwt(BEFORE, BEFORE + 30 * 86400);
const fresh = jwt(LEGACY_TOKEN_ISSUED_BEFORE_SECONDS + 60, LEGACY_TOKEN_ISSUED_BEFORE_SECONDS + 960);

describe('verifySessionTokens', () => {
  it('a verified 15-minute token gives the session with the role from the token', async () => {
    const verdict = await verifySessionTokens({ accessToken: fresh, refreshToken: 'r' }, verifyOk);
    assert.deepEqual(verdict, { kind: 'valid', user: { id: 'usr_a', email: 'a@example.com', role: 'super_admin' } });
  });

  it('a verified legacy 30-day token is refreshed, not used (its roles may be revoked)', async () => {
    assert.deepEqual(await verifySessionTokens({ accessToken: legacy, refreshToken: 'r' }, verifyOk), { kind: 'refresh', reason: 'legacy' });
    // Nothing to refresh with: signed out (sign-in page), not an error
    assert.deepEqual(await verifySessionTokens({ accessToken: legacy, refreshToken: '' }, verifyOk), { kind: 'signed-out' });
  });

  it('a long-lived token from a local issuer after the cutover is used (no refresh loop)', async () => {
    const local = jwt(LEGACY_TOKEN_ISSUED_BEFORE_SECONDS, LEGACY_TOKEN_ISSUED_BEFORE_SECONDS + 30 * 86400);
    assert.equal((await verifySessionTokens({ accessToken: local, refreshToken: 'r' }, verifyOk)).kind, 'valid');
  });

  it('a token that fails verification is refreshed when a refresh token is there', async () => {
    assert.deepEqual(await verifySessionTokens({ accessToken: fresh, refreshToken: 'r' }, verifyFails), { kind: 'refresh', reason: 'invalid' });
    assert.deepEqual(await verifySessionTokens({ accessToken: fresh, refreshToken: '' }, verifyFails), { kind: 'signed-out' });
  });
});
