/**
 * Realtime audience check (security audit 2026-11-14): without ALLOWED_CLIENT_IDS (prod, stage,
 * QA) the first-party registry applies in AUD_MODE. "log" (default) connects and logs the client
 * id, never the token; "enforce" refuses. An explicit ALLOWED_CLIENT_IDS is enforced as before.
 */
import { afterEach, beforeEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PARTY_CLIENT_IDS } from '@al-ummah/shared-types';
import { authenticateToken } from '../src/auth.ts';
import { logger } from '../src/lib/logger.ts';
import { makeSigner } from './helpers.ts';

const QA_ISSUER = 'https://auth.qa.alummahnow.net';
const QA = FIRST_PARTY_CLIENT_IDS.qa;
const qaEnv = { Issuer: QA_ISSUER, ENVIRONMENT: 'qa' };

let warns: Array<{ message: unknown; fields: unknown }>;
beforeEach(() => {
  warns = [];
  mock.method(logger, 'warn', (message: unknown, fields: unknown) => warns.push({ message, fields }));
});
afterEach(() => mock.restoreAll());
const mismatches = () => warns.filter((w) => (w.fields as { event?: string } | undefined)?.event === 'aud_mismatch');

test('the web, admin and native clients connect in every mode, without a log', async () => {
  const { getKey, sign } = await makeSigner();
  for (const AUD_MODE of [undefined, 'enforce']) {
    for (const aud of [QA.web, QA.adminWeb, QA.viewerTv, QA.adminWindows]) {
      assert.ok(await authenticateToken(await sign({}, { issuer: QA_ISSUER, aud }), { ...qaEnv, AUD_MODE }, { getKey }), `${aud} ${AUD_MODE}`);
    }
  }
  assert.equal(mismatches().length, 0);
});

test('log mode: another client connects and is logged with its id, never the token', async () => {
  const { getKey, sign } = await makeSigner();
  const token = await sign({}, { issuer: QA_ISSUER, aud: QA.cms });
  assert.equal((await authenticateToken(token, qaEnv, { getKey }))?.sub, 'user-123');
  assert.deepEqual(mismatches()[0]?.fields, { event: 'aud_mismatch', service: 'websocket-server', mode: 'log', clientId: QA.cms, client: 'cms@qa', issuer: QA_ISSUER, route: 'WS authenticate' });
  assert.ok(!JSON.stringify(warns).includes(token.split('.')[2]));
});

test('enforce mode: another client is refused', async () => {
  const { getKey, sign } = await makeSigner();
  assert.equal(await authenticateToken(await sign({}, { issuer: QA_ISSUER, aud: QA.www }), { ...qaEnv, AUD_MODE: 'enforce' }, { getKey }), null);
  assert.equal(await authenticateToken(await sign({}, { issuer: QA_ISSUER, aud: FIRST_PARTY_CLIENT_IDS.production.web }), { ...qaEnv, AUD_MODE: 'enforce' }, { getKey }), null);
});

test('an explicit ALLOWED_CLIENT_IDS replaces the registry and is always enforced', async () => {
  const { getKey, sign } = await makeSigner();
  const env = { ...qaEnv, ALLOWED_CLIENT_IDS: 'only-this', AUD_MODE: 'log' };
  assert.equal(await authenticateToken(await sign({}, { issuer: QA_ISSUER, aud: QA.web }), env, { getKey }), null);
  assert.ok(await authenticateToken(await sign({}, { issuer: QA_ISSUER, aud: 'only-this' }), env, { getKey }));
});
