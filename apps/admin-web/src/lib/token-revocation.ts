/**
 * Token revocation check and single sign-out revocation for apps/admin-web (#437, #762).
 *
 * Reads and writes the shared TOKEN_REVOCATIONS KV namespace:
 * - `u:<usr_id>` → written by Auth (account delete, sign-out-all, password reset, suspend)
 * - `s:<sid>`    → written by Auth (admin session terminate, device sign-out) and here on single sign-out
 * - `t:<sha256>` → fallback written here on single sign-out only when a token carries no `sid` claim
 *
 * User cutoffs and known session revocations are cached per isolate for 10 s,
 * in addition to KV edge caching. Session misses are read from KV each time
 * so middleware and server bundles see new revocations as soon as KV does.
 * Never logs raw tokens or secrets.
 */

export interface RevocationEntry {
  v: number;
  before?: number;
  reason?: string;
  updatedAt?: number;
}

export interface RevocationKv {
  get<T = unknown>(key: string, options?: { type: 'json'; cacheTtl?: number }): Promise<T | null>;
  put?(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface TokenTimes {
  userId: string;
  sid?: string;
  authTime?: number;
  iat?: number;
  /** Raw token checked under `t:<sha256>` only when `sid` is absent. */
  token?: string;
}

export const CACHE_MS = 10_000;
export const KV_CACHE_TTL_S = 30;
const MAX_CACHED = 5_000;
// Match Auth's scoped s: revocation policy, which outlives refresh tokens.
const SESSION_REVOCATION_TTL_S = 400 * 24 * 60 * 60;
const SINGLE_SIGN_OUT_MAX_TTL_S = 30 * 60;
const MIN_KV_TTL_S = 60;

const cache = new Map<string, { entry: RevocationEntry | null; until: number }>();

export function isRevoked(entry: RevocationEntry | null | undefined, token: Omit<TokenTimes, 'userId' | 'sid' | 'token'>): boolean {
  if (!entry) return false;
  if (entry.before === undefined) return false;
  const signedInAt = token.authTime ?? token.iat;
  if (signedInAt === undefined) return true;
  return signedInAt < entry.before;
}

export async function tokenHashKey(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `t:${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export function decodeTokenClaims(token: string): { userId?: string; iat?: number; exp?: number; auth_time?: number; sid?: string } {
  try {
    const segment = token.split('.')[1] ?? '';
    if (!segment) return {};
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const props = claims.properties && typeof claims.properties === 'object' ? (claims.properties as Record<string, unknown>) : undefined;
    return {
      ...(typeof props?.id === 'string' && props.id ? { userId: props.id } : {}),
      iat: num(claims.iat),
      exp: num(claims.exp),
      auth_time: num(claims.auth_time),
      ...(typeof claims.sid === 'string' && claims.sid ? { sid: claims.sid } : {}),
    };
  } catch {
    return {};
  }
}

async function lookup(kv: RevocationKv, key: string, now: number): Promise<RevocationEntry | null> {
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.entry;
  const entry = await kv.get<RevocationEntry>(key, { type: 'json', cacheTtl: KV_CACHE_TTL_S });
  // A concurrent sign-out can record a revocation while this read is pending.
  const updated = cache.get(key);
  if (updated !== hit && updated?.entry) return updated.entry;
  if (entry || key.startsWith('u:')) {
    if (cache.size >= MAX_CACHED) cache.clear();
    cache.set(key, { entry: entry ?? null, until: now + CACHE_MS });
  }
  return entry ?? null;
}

/** Immediately reflect a revocation written by this isolate in its local cache. */
export function recordLocalRevocation(key: string, entry: RevocationEntry, now = Date.now()): void {
  if (cache.size >= MAX_CACHED) cache.clear();
  const prev = cache.get(key)?.entry;
  const merged = prev?.before !== undefined && entry.before !== undefined && prev.before > entry.before ? prev : entry;
  cache.set(key, { entry: merged, until: now + CACHE_MS });
}

export async function isTokenRevoked(kv: RevocationKv | undefined, token: TokenTimes, now = Date.now()): Promise<boolean> {
  if (!kv || (!token.userId && !token.sid && !token.token)) return false;
  try {
    const sessionKey = token.sid ? `s:${token.sid}` : token.token ? await tokenHashKey(token.token) : null;
    const [user, session] = await Promise.all([
      token.userId ? lookup(kv, `u:${token.userId}`, now) : null,
      sessionKey ? lookup(kv, sessionKey, now) : null,
    ]);
    return isRevoked(user, token) || isRevoked(session, token);
  } catch (error) {
    console.warn('[revocation] Revocation list unavailable; allowing the token', String(error));
    return false;
  }
}

/**
 * Records a verified access token as revoked in TOKEN_REVOCATIONS KV on sign-out (#762).
 * Callers MUST verify the token's signature before calling this so forged cookies cannot
 * write entries into KV.
 */
export async function revokeVerifiedAccessToken(
  kv: RevocationKv | undefined,
  rawToken: string,
  reason = 'single_sign_out',
  now = Date.now(),
): Promise<boolean> {
  if (!kv?.put || !rawToken) return false;
  const claims = decodeTokenClaims(rawToken);
  const nowS = Math.floor(now / 1000);
  if (claims.exp !== undefined && claims.exp <= nowS) return false;

  const remainingS = claims.exp !== undefined ? claims.exp - nowS : 15 * 60;
  // A sibling app may hold a fresher token with this sid. Use the full
  // session TTL even if this token is about to expire or an Auth write is unseen.
  const expirationTtl = claims.sid
    ? SESSION_REVOCATION_TTL_S
    : Math.max(MIN_KV_TTL_S, Math.min(SINGLE_SIGN_OUT_MAX_TTL_S, remainingS + 60));
  const signedInAt = claims.auth_time ?? claims.iat ?? nowS;
  const before = claims.sid ? Math.max(signedInAt + 1, nowS) : Math.max(signedInAt + 1, nowS + 1);
  const key = claims.sid ? `s:${claims.sid}` : await tokenHashKey(rawToken);
  const entry: RevocationEntry = { v: 1, before, reason, updatedAt: now };

  try {
    const existing = await kv.get<RevocationEntry>(key, { type: 'json' });
    if (existing?.before !== undefined && (
      existing.before >= before
      || (claims.sid && existing.reason !== 'single_sign_out' && signedInAt < existing.before)
    )) {
      // Preserve a stronger cutoff or an Auth revocation that already covers this token.
      recordLocalRevocation(key, existing, now);
      return true;
    }
    await kv.put(key, JSON.stringify(entry), { expirationTtl });
    recordLocalRevocation(key, entry, now);
    return true;
  } catch (error) {
    console.warn('[revocation] Failed to record sign-out revocation', String(error));
    return false;
  }
}

/** Reads the Worker's TOKEN_REVOCATIONS KV binding when running on Cloudflare; undefined in dev/tests. */
export async function getRevocationKv(): Promise<RevocationKv | undefined> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const cf = await getCloudflareContext({ async: true });
    const kv = (cf.env as Record<string, unknown> | undefined)?.TOKEN_REVOCATIONS as RevocationKv | undefined;
    return kv && typeof kv.get === 'function' ? kv : undefined;
  } catch {
    return undefined;
  }
}

/** Checks whether an admin session access token has been revoked (u:, s:, or fallback t:). */
export async function isAdminTokenRevoked(
  accessToken: string | undefined | null,
  userId?: string,
  options: { kv?: RevocationKv | null; now?: number } = {},
): Promise<boolean> {
  if (!accessToken) return false;
  const kv = options.kv === undefined ? await getRevocationKv() : (options.kv ?? undefined);
  if (!kv) return false;
  const claims = decodeTokenClaims(accessToken);
  return isTokenRevoked(
    kv,
    {
      userId: userId || claims.userId || '',
      sid: claims.sid,
      authTime: claims.auth_time,
      iat: claims.iat,
      token: accessToken,
    },
    options.now,
  );
}

/** Test hook. */
export function clearRevocationCache(): void {
  cache.clear();
}
