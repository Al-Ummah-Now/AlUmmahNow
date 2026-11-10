import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';

export const ISSUER = 'https://auth.test.example';
export const WEB_CLIENT = 'web-client-id';

export interface Signer {
  getKey: JWTVerifyGetKey;
  sign: (claims?: Record<string, unknown>, opts?: { iat?: number; exp?: number; issuer?: string; aud?: string }) => Promise<string>;
}

/** An ES256 key pair plus a local JWKS, standing in for the auth server. */
export async function makeSigner(kid = 'primary'): Promise<Signer> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  const getKey = createLocalJWKSet({ keys: [jwk] });
  const sign: Signer['sign'] = async (claims = {}, opts = {}) => {
    const now = opts.iat ?? Math.floor(Date.now() / 1000);
    return new SignJWT({
      mode: 'access',
      type: 'user',
      properties: { id: 'user-123', email: 'user@example.com' },
      ...claims,
    })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer(opts.issuer ?? ISSUER)
      .setSubject('user:abc')
      .setAudience(opts.aud ?? WEB_CLIENT)
      .setIssuedAt(now)
      // 15 minutes, like Auth (ACCESS_TOKEN_TTL); longer ones count as legacy before the cutover
      .setExpirationTime(opts.exp ?? now + 900)
      .sign(privateKey);
  };
  return { getKey, sign };
}

/** An unsigned (alg: none) token carrying the given payload. */
export function unsignedToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
}
