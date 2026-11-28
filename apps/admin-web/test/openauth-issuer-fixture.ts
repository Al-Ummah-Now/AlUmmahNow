import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { object, string } from 'valibot';
import { FIRST_PARTY_CLIENT_IDS } from '@al-ummah/shared-types';

export const ISSUER = 'http://localhost:3301';
export const JWKS_REFETCH_COOLDOWN_MS = 30_000;
export const clientIds = FIRST_PARTY_CLIENT_IDS.production;

export async function key(kid: string, clientId = clientIds.adminWeb) {
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
export async function issuer(initial: unknown[]) {
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
