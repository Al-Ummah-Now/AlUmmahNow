/**
 * Signing-key rotation (AlUmmahNowAuth#13) against the installed OpenAuth client.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenExpired } from '@al-ummah/shared-types';
import { JWKS_REFETCH_COOLDOWN_MS, issuer, key } from './openauth-issuer-fixture';

test('a token signed by a key published after the client cached JWKS verifies', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const oldKey = await key('kid-old');
  const newKey = await key('kid-new');
  const { subjects, state, make } = await issuer([oldKey.jwk]);
  const client = make();
  assert.ok(!(await client.verify(subjects, await oldKey.sign())).err);

  state.keys = [newKey.jwk, oldKey.jwk];
  const token = await newKey.sign();
  assert.ok((await client.verify(subjects, token)).err, 'still inside the cooldown');
  assert.equal(state.jwksFetches, 1);

  t.mock.timers.tick(JWKS_REFETCH_COOLDOWN_MS);
  const verified = await client.verify(subjects, token);
  assert.ok(!verified.err, 'verified with fresh keys');
  assert.equal(verified.subject.properties.id, 'usr_a');
  assert.equal(state.jwksFetches, 2);
  // The previous key's tokens still verify during the overlap
  assert.ok(!(await client.verify(subjects, await oldKey.sign())).err);
});

test('clients share the refetch cooldown, and an expired token with a known key does not refetch', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const k = await key('kid-1');
  const stranger = await key('kid-unknown');
  const { subjects, state, make } = await issuer([k.jwk]);
  const client = make();
  const otherClient = make();
  await client.verify(subjects, await k.sign());
  assert.equal(state.jwksFetches, 1);

  t.mock.timers.tick(JWKS_REFETCH_COOLDOWN_MS);
  const unknown = await stranger.sign();
  assert.ok((await client.verify(subjects, unknown)).err);
  assert.equal(state.jwksFetches, 2);
  assert.ok((await otherClient.verify(subjects, unknown)).err);
  assert.equal(state.jwksFetches, 2, 'the second client shares the cooldown');

  t.mock.timers.tick(JWKS_REFETCH_COOLDOWN_MS);
  assert.ok((await client.verify(subjects, await k.sign('-1m'))).err);
  assert.equal(state.jwksFetches, 2);
});

test('tokenExpired reads exp, and treats unreadable tokens as expired', () => {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Date.now();
  assert.equal(tokenExpired(`${b64({ alg: 'ES256' })}.${b64({ exp: Math.floor(now / 1000) + 60 })}.sig`, now), false);
  assert.equal(tokenExpired(`${b64({ alg: 'ES256' })}.${b64({ exp: Math.floor(now / 1000) - 1 })}.sig`, now), true);
  assert.equal(tokenExpired('not-a-jwt', now), true);
  assert.equal(tokenExpired(`${b64({})}.${b64({})}.sig`, now), true);
});
