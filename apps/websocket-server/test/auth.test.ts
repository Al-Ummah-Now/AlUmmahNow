import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateToken, canPublish, canSubscribe } from '../src/auth.ts';
import { ISSUER, WEB_CLIENT, makeSigner, unsignedToken } from './helpers.ts';

const prodEnv = { Issuer: ISSUER, ALLOWED_CLIENT_IDS: `${WEB_CLIENT}, admin-client`, ENVIRONMENT: 'production' };

test('valid signed access token is accepted and identity comes from properties.id', async () => {
  const { getKey, sign } = await makeSigner();
  const auth = await authenticateToken(await sign(), prodEnv, { getKey });
  assert.ok(auth);
  assert.equal(auth.sub, 'user-123');
  assert.equal(auth.email, 'user@example.com');
  assert.equal(auth.iss, ISSUER);
});

test('token signed by a different key is rejected', async () => {
  const trusted = await makeSigner();
  const forger = await makeSigner(); // same kid, different key
  assert.equal(await authenticateToken(await forger.sign(), prodEnv, { getKey: trusted.getKey }), null);
});

test('tampered payload (bad signature) is rejected', async () => {
  const { getKey, sign } = await makeSigner();
  const [h, , s] = (await sign()).split('.');
  const forged = Buffer.from(JSON.stringify({ mode: 'access', type: 'user', properties: { id: 'victim' }, iss: ISSUER, exp: 9999999999 })).toString('base64url');
  assert.equal(await authenticateToken(`${h}.${forged}.${s}`, prodEnv, { getKey }), null);
});

test('wrong issuer is rejected', async () => {
  const { getKey, sign } = await makeSigner();
  const token = await sign({}, { issuer: 'https://auth.qa.alummahnow.net' });
  assert.equal(await authenticateToken(token, prodEnv, { getKey }), null);
});

test('expired token is rejected', async () => {
  const { getKey, sign } = await makeSigner();
  const token = await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 });
  assert.equal(await authenticateToken(token, prodEnv, { getKey }), null);
});

test('token without exp is rejected', async () => {
  // Validly signed by a trusted key, but with no exp claim
  const { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k', alg: 'ES256' }] });
  const token = await new SignJWT({ mode: 'access', type: 'user', properties: { id: 'u' } })
    .setProtectedHeader({ alg: 'ES256', kid: 'k' }).setIssuer(ISSUER).setAudience(WEB_CLIENT).sign(privateKey);
  assert.equal(await authenticateToken(token, prodEnv, { getKey: keys }), null);
});

test('refresh tokens and non-user subjects are rejected', async () => {
  const { getKey, sign } = await makeSigner();
  assert.equal(await authenticateToken(await sign({ mode: 'refresh' }), prodEnv, { getKey }), null);
  assert.equal(await authenticateToken(await sign({ type: 'service' }), prodEnv, { getKey }), null);
});

test('token for a client that is not allowed is rejected', async () => {
  const { getKey, sign } = await makeSigner();
  assert.equal(await authenticateToken(await sign({}, { aud: 'some-other-client' }), prodEnv, { getKey }), null);
});

test('unsigned token is rejected in production', async () => {
  const { getKey } = await makeSigner();
  const token = unsignedToken({ mode: 'access', type: 'user', properties: { id: 'victim' }, iss: ISSUER, exp: 9999999999 });
  assert.equal(await authenticateToken(token, prodEnv, { getKey }), null);
});

test('unsigned token is rejected when Issuer is missing outside development', async () => {
  const token = unsignedToken({ properties: { id: 'victim' }, exp: 9999999999 });
  for (const ENVIRONMENT of ['production', 'qa', 'dev', 'local', undefined]) {
    assert.equal(await authenticateToken(token, { ENVIRONMENT }), null, `ENVIRONMENT=${ENVIRONMENT}`);
  }
});

test('unsigned token is accepted only with ENVIRONMENT=development and no Issuer', async () => {
  const token = unsignedToken({ properties: { id: 'dev-user' }, exp: 9999999999 });
  const auth = await authenticateToken(token, { ENVIRONMENT: 'development' });
  assert.equal(auth?.sub, 'dev-user');
  const expired = unsignedToken({ properties: { id: 'dev-user' }, exp: 1 });
  assert.equal(await authenticateToken(expired, { ENVIRONMENT: 'development' }), null);
});

test('user channels are private; publishing into them is forbidden', () => {
  assert.equal(canSubscribe('u1', 'user:u1'), true);
  assert.equal(canSubscribe('u1', 'user:u2'), false);
  assert.equal(canSubscribe('u1', 'user:u1x'), false);
  assert.equal(canSubscribe('u1', 'video:v1'), true);
  assert.equal(canPublish('user:u2'), false);
  assert.equal(canPublish('live:s1'), true);
});
