/**
 * Signing-key rotation (AlUmmahNowAuth#13): Auth publishes a new signing key
 * an hour before it signs, signs with it, and retires the old key a day later.
 *
 * The openauth client caches the issuer's JWKS inside the client object and,
 * in the version these apps use, never refetches it: a client built before a
 * new key was published rejects every token the new key signs until the
 * client is rebuilt. withKeyRefetch rebuilds the client once when a token
 * that has not expired fails to verify (its key may be new), at most once
 * per KEY_REFETCH_GAP_MS, and verifies again with fresh keys.
 */

/** Minimum gap between two rebuilds, so bad tokens cannot force a JWKS fetch per request. */
export const KEY_REFETCH_GAP_MS = 30_000;

/** The token's `exp` is in the past, or the token is not a readable JWT. */
export function tokenExpired(token: string, now: number = Date.now()): boolean {
  try {
    const part = token.split('.')[1];
    if (!part) return true;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp !== 'number' || exp * 1000 <= now;
  } catch {
    return true;
  }
}

type AnyClient = { verify: (subjects: any, token: string, ...rest: any[]) => Promise<any> };

/**
 * A client that delegates to `make()`'s client, rebuilding it once when a
 * live token fails to verify. `verify` results are returned unchanged.
 */
export function withKeyRefetch<C extends AnyClient>(make: () => C, now: () => number = Date.now): C {
  let current = make();
  let rebuiltAt = -Infinity;
  const wrapper = {} as Record<string, unknown>;
  for (const key of Object.keys(current)) {
    const value = (current as Record<string, unknown>)[key];
    wrapper[key] = typeof value === 'function' ? (...args: unknown[]) => ((current as Record<string, unknown>)[key] as (...a: unknown[]) => unknown)(...args) : value;
  }
  wrapper.verify = async (subjects: unknown, token: string, ...rest: unknown[]) => {
    const first = await current.verify(subjects, token, ...rest);
    if (!first?.err || tokenExpired(token, now())) return first;
    const t = now();
    // t < rebuiltAt: the clock moved back; allow a rebuild
    if (t - rebuiltAt < KEY_REFETCH_GAP_MS && t >= rebuiltAt) return first;
    rebuiltAt = t;
    current = make();
    return current.verify(subjects, token, ...rest);
  };
  return wrapper as C;
}
