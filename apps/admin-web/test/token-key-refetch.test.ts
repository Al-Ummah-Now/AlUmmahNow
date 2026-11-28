/**
 * Signing-key rotation (AlUmmahNowAuth#13) through each app's OpenAuth client.
 * The shared JWKS cache and bounded refetch were added in OpenAuth ca77c93f0570.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { object, string } from 'valibot';
import { FIRST_PARTY_CLIENT_IDS, tokenExpired } from '@al-ummah/shared-types';
import { getClient as getAdminApiClient } from '../../admin-api/src/lib/openauth-client';
import { getClient as getVideosApiClient } from '../../api-videos/src/lib/openauth-client';
import { getOpenAuthClient as getWebClient } from '../../web/src/lib/auth/openauth-client';
import { adminAuth } from '../src/lib/auth-client';

const ISSUER = 'http://localhost:3301';
const JWKS_REFETCH_COOLDOWN_MS = 30_000;
const clientIds = FIRST_PARTY_CLIENT_IDS.production;

async function key(kid: string, clientId = clientIds.adminWeb) {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  const sign = (expiresIn = '15m') =>
    new SignJWT({ mode: 'access', type: 'user', properties: { id: 'usr_a' } })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer(ISSUER)
      .setAudience(clientId)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey);
  return { jwk, sign };
}

/** An issuer whose JWKS can change; counts JWKS fetches. */
async function issuer(initial: unknown[]) {
  // The OpenAuth package is ESM-only and the tests run as CommonJS.
  const { clearClientCache, createClient } = await import('@al-ummah-now/openauth/client');
  const { createSubjects } = await import('@al-ummah-now/openauth/subject');
  clearClientCache();
  const subjects = createSubjects({ user: object({ id: string() }) });
  const state = { keys: initial, jwksFetches: 0 };
  const fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/.well-known/oauth-authorization-server')) return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks.json`, token_endpoint: `${ISSUER}/token`, authorization_endpoint: `${ISSUER}/authorize` });
    if (url.endsWith('/.well-known/jwks.json')) {
      state.jwksFetches++;
      return Response.json({ keys: state.keys });
    }
    return new Response('not found', { status: 404 });
  };
  return { subjects, state, fetch, make: () => createClient({ clientID: clientIds.adminWeb, issuer: ISSUER, fetch }) };
}

const apps = [
  { name: 'admin-web', clientId: clientIds.adminWeb, getClient: adminAuth((message) => assert.fail(message)).getAuthClient },
  { name: 'admin-api', clientId: clientIds.adminWeb, getClient: getAdminApiClient },
  { name: 'api-videos', clientId: clientIds.web, getClient: getVideosApiClient },
  { name: 'web', clientId: clientIds.web, getClient: () => getWebClient() },
];

for (const { name, clientId, getClient } of apps) {
  test(`${name} verifies a token from a newly published key on the same client`, async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const env = { Issuer: ISSUER, ClientId: clientId, AUD_MODE: 'enforce' };
    for (const [key, value] of Object.entries(env)) {
      const previous = process.env[key];
      process.env[key] = value;
      t.after(() => {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      });
    }
    const oldKey = await key('kid-old', clientId);
    const newKey = await key('kid-new', clientId);
    const { subjects, state, fetch } = await issuer([oldKey.jwk]);
    t.mock.method(globalThis, 'fetch', fetch);
    const client = await getClient(env);
    const oldToken = await oldKey.sign();
    assert.ok(!(await client.verify(subjects, oldToken)).err);

    state.keys = [newKey.jwk, oldKey.jwk];
    const newToken = await newKey.sign();
    assert.ok((await client.verify(subjects, newToken)).err, 'still inside the cooldown');
    assert.equal(state.jwksFetches, 1);

    t.mock.timers.tick(JWKS_REFETCH_COOLDOWN_MS);
    const verified = await client.verify(subjects, newToken);
    assert.ok(!verified.err, 'verified with fresh keys');
    assert.equal(verified.subject.properties.id, 'usr_a');
    assert.equal(state.jwksFetches, 2);
    assert.equal(await getClient(env), client);
    assert.ok(!(await client.verify(subjects, oldToken)).err, 'previous key still verifies during overlap');
  });
}

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
