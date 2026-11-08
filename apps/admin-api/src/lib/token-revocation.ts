/**
 * Token revocation check (#437). Keep in sync: the same file lives in
 * apps/api-videos, apps/admin-api and apps/websocket-server.
 *
 * The auth worker writes one entry per user to the TOKEN_REVOCATIONS KV when
 * the user signs out of all devices, deletes the account, resets the
 * password or is suspended/signed out by an admin:
 *   key `u:<usr_id>` → { v: 1, before: unix_s, reason, updatedAt }
 * A token is revoked when its sign-in (`auth_time`, else `iat`) is before
 * `before`. (Single sign-out deletes the refresh token at the auth server;
 * the short-lived access token then just expires.)
 *
 * Cost: one KV read per user per isolate per CACHE_MS at most (entries and
 * "no entry" are both cached in the isolate; KV's edge cache absorbs the
 * rest). Revocation takes effect within ~CACHE_MS + KV_CACHE_TTL_S + KV
 * propagation (about 2 minutes). KV errors fail open: the token is still
 * signature-checked and short-lived.
 */

export interface RevocationEntry {
	v: number;
	before?: number;
}

export interface TokenTimes {
	userId: string;
	authTime?: number;
	iat?: number;
}

export const CACHE_MS = 30_000;
export const KV_CACHE_TTL_S = 30;
const MAX_CACHED = 5_000;

const cache = new Map<string, { entry: RevocationEntry | null; until: number }>();

export function isRevoked(entry: RevocationEntry | null | undefined, token: Omit<TokenTimes, 'userId'>): boolean {
	if (!entry) return false;
	if (entry.before === undefined) return false;
	const signedInAt = token.authTime ?? token.iat;
	if (signedInAt === undefined) return true;
	return signedInAt < entry.before;
}

async function lookup(kv: KVNamespace, userId: string, now: number): Promise<RevocationEntry | null> {
	const hit = cache.get(userId);
	if (hit && hit.until > now) return hit.entry;
	const entry = await kv.get<RevocationEntry>(`u:${userId}`, { type: 'json', cacheTtl: KV_CACHE_TTL_S });
	if (cache.size >= MAX_CACHED) cache.clear();
	cache.set(userId, { entry: entry ?? null, until: now + CACHE_MS });
	return entry ?? null;
}

/** Whether the (already signature-verified) token belongs to a revoked sign-in. */
export async function isTokenRevoked(kv: KVNamespace | undefined, token: TokenTimes, now = Date.now()): Promise<boolean> {
	if (!kv || !token.userId) return false;
	try {
		return isRevoked(await lookup(kv, token.userId, now), token);
	} catch (error) {
		console.warn('[revocation] Revocation list unavailable; allowing the token', String(error));
		return false;
	}
}

/** Claims of a JWT that was already verified (no signature check here). */
export function decodeVerifiedClaims(token: string): { iat?: number; exp?: number; auth_time?: number } {
	try {
		const segment = token.split('.')[1] ?? '';
		const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
		const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
		const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
		return {
			iat: num(claims.iat),
			exp: num(claims.exp),
			auth_time: num(claims.auth_time),
		};
	} catch {
		return {};
	}
}

/** Test hook. */
export function clearRevocationCache(): void {
	cache.clear();
}
