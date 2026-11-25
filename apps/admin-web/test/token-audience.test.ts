/**
 * Security audit 2026-11-14: admin-web's openauth client (lib/auth-client.ts getAuthClient) checks that a
 * session's access token was issued to admin-web, through withAudienceCheck.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRST_PARTY_CLIENT_IDS, withAudienceCheck, type AudienceMode } from '@al-ummah/shared-types';

const PROD = FIRST_PARTY_CLIENT_IDS.production;
const subject = { type: 'user', properties: { id: 'usr_a' } };

function client(result: unknown, mode: AudienceMode) {
  const warns: Array<Record<string, unknown>> = [];
  const base = { verify: async (..._args: unknown[]) => result, refresh: async () => 'refreshed' };
  const wrapped = withAudienceCheck(base, { service: 'admin-web', issuer: 'https://auth.stage.alummahnow.net', mode: () => mode }, (_m, f) => warns.push(f));
  return { wrapped, warns };
}

test('admin-web\'s own token passes without a log; the other methods are the client\'s own', async () => {
  const { wrapped, warns } = client({ aud: PROD.adminWeb, subject }, 'enforce');
  assert.deepEqual(await wrapped.verify({}, 'tok'), { aud: PROD.adminWeb, subject });
  assert.equal(await wrapped.refresh(), 'refreshed');
  assert.equal(warns.length, 0);
});

test('log mode: the web site\'s token verifies and is logged with its client id', async () => {
  const { wrapped, warns } = client({ aud: PROD.web, subject }, 'log');
  assert.deepEqual(await wrapped.verify({}, 'secret-token'), { aud: PROD.web, subject });
  assert.equal(warns[0]?.event, 'aud_mismatch');
  assert.equal(warns[0]?.service, 'admin-web');
  assert.equal(warns[0]?.client, 'web@production');
  assert.ok(!JSON.stringify(warns).includes('secret-token'));
});

test('enforce mode: another client\'s token is a verify error', async () => {
  const { wrapped } = client({ aud: PROD.web, subject }, 'enforce');
  const result = (await wrapped.verify({}, 'tok')) as { err?: Error };
  assert.equal(result.err?.name, 'AudienceMismatchError');
});

test('getAuthClient wraps the openauth client with the admin-web audience check', () => {
  const src = readFileSync(new URL('../src/lib/auth-client.ts', import.meta.url), 'utf8');
  assert.match(src, /withAudienceCheck\(\s*withKeyRefetch\(\(\) => createClient\(/);
  assert.match(src, /service: 'admin-web'/);
});
