/**
 * Signing-key rotation (AlUmmahNowAuth#13): the openauth client these apps use
 * caches the issuer's JWKS and never refetches it. withKeyRefetch (used by
 * admin-web, web, admin-api and api-videos) rebuilds the client when a live
 * token fails to verify, so a token signed by a newly published key verifies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { object, string } from 'valibot';
import { KEY_REFETCH_GAP_MS, tokenExpired, withKeyRefetch } from '@al-ummah/shared-types';

const ISSUER = 'https://auth.example.test';
// openauth is ESM-only ("import" exports) and this test runs as CommonJS: load it with import()
const openauth = async () => ({
  createClient: (await import('@al-ummah-now/openauth/client')).createClient,
  subjects: (await import('@al-ummah-now/openauth/subject')).createSubjects({ user: object({ id: string() }) }),
});
let subjects: Awaited<ReturnType<typeof openauth>>['subjects'];

async function key(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  const sign = (expiresIn = '15m') =>
    new SignJWT({ mode: 'access', type: 'user', properties: { id: 'usr_a' } })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer(ISSUER)
      .setAudience('admin-web')
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(privateKey);
  return { jwk, sign };
}

/** An issuer whose JWKS can change; counts JWKS fetches. */
async function issuer(initial: unknown[]) {
  const { createClient, subjects: s } = await openauth();
  subjects = s;
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
  return { state, make: () => createClient({ clientID: 'admin-web', issuer: ISSUER, fetch: fetch as typeof globalThis.fetch }) };
}

test('a token signed by a key published after the client cached JWKS verifies', async () => {
  const oldKey = await key('kid-old');
  const newKey = await key('kid-new');
  const { state, make } = await issuer([oldKey.jwk]);
  const now = Date.now();
  const client = withKeyRefetch(make, () => now);
  assert.ok(!(await client.verify(subjects, await oldKey.sign())).err);

  // Without the wrapper the cached client refuses the new key's tokens
  const plain = make();
  await plain.verify(subjects, await oldKey.sign());
  state.keys = [newKey.jwk, oldKey.jwk];
  assert.ok((await plain.verify(subjects, await newKey.sign())).err, 'the plain client keeps its stale JWKS');

  const verified = await client.verify(subjects, await newKey.sign());
  assert.ok(!verified.err, 'rebuilt with fresh keys');
  assert.equal(verified.subject.properties.id, 'usr_a');
  // The previous key's tokens still verify during the overlap
  assert.ok(!(await client.verify(subjects, await oldKey.sign())).err);
});

test('bad tokens rebuild at most once per gap; expired tokens never do', async () => {
  const k = await key('kid-1');
  const stranger = await key('kid-unknown');
  const { state, make } = await issuer([k.jwk]);
  let now = Date.now();
  const client = withKeyRefetch(make, () => now);
  await client.verify(subjects, await k.sign());
  const base = state.jwksFetches;

  assert.ok((await client.verify(subjects, await stranger.sign())).err);
  assert.equal(state.jwksFetches, base + 1);
  assert.ok((await client.verify(subjects, await stranger.sign())).err);
  assert.equal(state.jwksFetches, base + 1, 'inside the gap: no rebuild');
  now += KEY_REFETCH_GAP_MS;
  assert.ok((await client.verify(subjects, await stranger.sign())).err);
  assert.equal(state.jwksFetches, base + 2);

  now += KEY_REFETCH_GAP_MS;
  const expired = await new SignJWT({ mode: 'access' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(new Uint8Array(32));
  await client.verify(subjects, expired);
  assert.equal(state.jwksFetches, base + 2, 'an expired token is not a reason to refetch');
});

test('tokenExpired reads exp, and treats unreadable tokens as expired', () => {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Date.now();
  assert.equal(tokenExpired(`${b64({ alg: 'ES256' })}.${b64({ exp: Math.floor(now / 1000) + 60 })}.sig`, now), false);
  assert.equal(tokenExpired(`${b64({ alg: 'ES256' })}.${b64({ exp: Math.floor(now / 1000) - 1 })}.sig`, now), true);
  assert.equal(tokenExpired('not-a-jwt', now), true);
  assert.equal(tokenExpired(`${b64({})}.${b64({})}.sig`, now), true);
});

test('every app that verifies with an openauth client wraps it in withKeyRefetch', () => {
  for (const file of ['../src/lib/auth.ts', '../../web/src/lib/auth/openauth-client.ts', '../../admin-api/src/lib/openauth-client.ts', '../../api-videos/src/lib/openauth-client.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /withKeyRefetch\(\(\) => createClient\(/, file);
  }
});
