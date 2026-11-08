/**
 * JWT authentication for WebSocket connections.
 *
 * Clients send their OpenAuth access token (in an `authenticate` message, or the
 * deprecated `?token=` query param). The token is verified against the issuer's
 * JWKS (ES256), and the connection's user id is taken ONLY from the verified
 * token. Anything else the client claims (e.g. `?userId=`) is ignored.
 *
 * jose resolves to its WebCrypto build under wrangler (the `workerd`/`browser`
 * export conditions); its Node build's node:crypto EC path fails ES256 checks
 * on workerd (see the admin-web fix in 5bacbea).
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { logger } from './lib/logger';
import { isTokenRevoked } from './token-revocation';

/** Identity established for a connection. */
export interface AuthPayload {
  /** Our user id: the OpenAuth `user` subject's `properties.id`. */
  sub: string;
  email?: string;
  iat?: number;
  exp: number;
  aud?: string;
  iss?: string;
}

/** The subset of Env that authentication reads. */
export interface AuthEnv {
  Issuer?: string;
  /**
   * Optional comma-separated OpenAuth client ids whose access tokens may connect (checked
   * against `aud`). Unset in prod/QA: the auth server issues tokens for any client_id, so an
   * aud check adds no protection there, and the web worker's client id is not reliably set.
   */
  ALLOWED_CLIENT_IDS?: string;
  ENVIRONMENT?: string;
  /** Token revocation list written by the auth worker (#437). */
  TOKEN_REVOCATIONS?: KVNamespace;
}

export interface AuthDeps {
  /** Override JWKS key lookup (tests). Defaults to the issuer's remote JWKS. */
  getKey?: JWTVerifyGetKey;
  /** Override the current time in seconds (tests). */
  now?: number;
}

interface OpenAuthAccessClaims extends JWTPayload {
  mode?: string;
  type?: string;
  properties?: { id?: unknown; email?: unknown };
}

/** Unsigned tokens are accepted only when ENVIRONMENT is exactly "development". */
export function isDevelopment(env: AuthEnv): boolean {
  return env.ENVIRONMENT === 'development';
}

const jwksByIssuer = new Map<string, JWTVerifyGetKey>();

function remoteJwks(issuer: string): JWTVerifyGetKey {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

/** Tests only: serve keys for an issuer without fetching its JWKS over the network. */
export function __setJwksForTests(issuer: string, getKey: JWTVerifyGetKey | undefined): void {
  if (getKey) jwksByIssuer.set(issuer, getKey);
  else jwksByIssuer.delete(issuer);
}

function allowedClientIds(env: AuthEnv): string[] {
  return (env.ALLOWED_CLIENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function audienceAllowed(aud: JWTPayload['aud'], allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  // OpenAuth sets aud to the client id that obtained the token; require it.
  const auds = Array.isArray(aud) ? aud : aud ? [aud] : [];
  return auds.some((a) => allowed.includes(a));
}

/**
 * Verify an OpenAuth access token and return the identity it proves, or null.
 *
 * - With `Issuer` set: ES256 signature against the issuer JWKS, `iss` must match,
 *   `exp` must be present and in the future, the token must be an access token for
 *   a `user` subject, and `aud` must be an allowed client id (when configured).
 * - Without `Issuer`: only in development, the payload is decoded unverified.
 * - Otherwise: rejected.
 */
export async function authenticateToken(
  token: string,
  env: AuthEnv,
  deps: AuthDeps = {},
): Promise<AuthPayload | null> {
  if (env.Issuer) {
    return verifySignedToken(token, env.Issuer, allowedClientIds(env), deps, env.TOKEN_REVOCATIONS);
  }
  if (isDevelopment(env)) {
    return decodeUnverifiedToken(token, deps.now);
  }
  logger.error('Issuer not configured; refusing to authenticate WebSocket token');
  return null;
}

async function verifySignedToken(
  token: string,
  issuer: string,
  allowed: string[],
  deps: AuthDeps,
  revocations?: KVNamespace,
): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify<OpenAuthAccessClaims>(token, deps.getKey ?? remoteJwks(issuer), {
      issuer,
      algorithms: ['ES256'],
      requiredClaims: ['exp'],
      currentDate: deps.now !== undefined ? new Date(deps.now * 1000) : undefined,
    });

    if (payload.mode !== 'access' || payload.type !== 'user') {
      logger.warn('WebSocket token rejected: not a user access token');
      return null;
    }
    const userId = payload.properties?.id;
    if (typeof userId !== 'string' || userId.length === 0) {
      logger.warn('WebSocket token rejected: no user id');
      return null;
    }
    if (!audienceAllowed(payload.aud, allowed)) {
      logger.warn('WebSocket token rejected: client not allowed', { aud: payload.aud });
      return null;
    }
    // Signed out everywhere / account deleted / suspended since this sign-in
    const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : undefined;
    if (await isTokenRevoked(revocations, { userId, authTime, iat: payload.iat }, deps.now !== undefined ? deps.now * 1000 : undefined)) {
      logger.warn('WebSocket token rejected: sign-in revoked');
      return null;
    }

    const email = payload.properties?.email;
    return {
      sub: userId,
      email: typeof email === 'string' ? email : undefined,
      iat: payload.iat,
      exp: payload.exp as number,
      aud: Array.isArray(payload.aud) ? payload.aud[0] : payload.aud,
      iss: payload.iss,
    };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    logger.warn('WebSocket token rejected', { code: e?.code, message: e?.message });
    return null;
  }
}

function decodeBase64Url(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** Development only: decode without verifying the signature. */
function decodeUnverifiedToken(token: string, nowSeconds?: number): AuthPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(decodeBase64Url(parts[1])) as OpenAuthAccessClaims;

    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) return null;

    const userId = typeof payload.properties?.id === 'string' ? payload.properties.id : payload.sub;
    if (!userId) return null;

    return {
      sub: userId,
      email: typeof payload.properties?.email === 'string' ? payload.properties.email : undefined,
      iat: payload.iat,
      exp: payload.exp ?? now + 3600,
      iss: payload.iss,
    };
  } catch {
    return null;
  }
}

/**
 * Channels a user may subscribe to. `user:<id>` carries private notifications,
 * so only that user may join it; other channel types are public feeds.
 */
export function canSubscribe(userId: string, channel: string): boolean {
  if (channel.startsWith('user:')) {
    return channel === `user:${userId}`;
  }
  return true;
}

/**
 * Channels an unauthenticated socket may join. Only per-video feeds, whose
 * events (new comments, counters) are already public on the watch page.
 */
export function canSubscribeAnonymously(channel: string): boolean {
  return channel.startsWith('video:');
}

/** Clients may not publish into private `user:<id>` channels (server-fed via /broadcast). */
export function canPublish(channel: string): boolean {
  return !channel.startsWith('user:');
}
