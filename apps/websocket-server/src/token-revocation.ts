/**
 * Token revocation check (#437) and the legacy 30-day token check (#663). Keep in sync: the same file lives in
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

/** Access tokens are issued for 15 minutes (Auth ACCESS_TOKEN_TTL, AlUmmahNowAuth#437). */
export const MAX_ACCESS_TOKEN_LIFETIME_S = 15 * 60;
/** Clock and issuer slack on top of the 15 minutes. */
export const ACCESS_TOKEN_LIFETIME_SLACK_S = 60;
/**
 * Every deployed Auth has issued 15-minute tokens since 2026-11-08. A longer
 * token issued before this cutoff is an old 30-day one; later ones only come
 * from a local issuer without ACCESS_TOKEN_TTL (development), which keeps
 * working. Same cutoff as the web/admin-web refresh (token-refresh.ts), so a
 * token rejected here is one those clients already refresh ahead of time.
 */
export const LEGACY_TOKEN_ISSUED_BEFORE_S = Date.UTC(2026, 10, 11) / 1000;

/**
 * A legacy 30-day access token (#663): its roles were frozen at issue, so a
 * demoted admin could keep using it until it expired (by about 2026-12-08).
 * Rejected with 401; clients refresh and get a 15-minute token with current
 * roles. Takes the claims of an already verified token.
 */
export function isLegacyLongLivedToken(claims: { iat?: number; exp?: number }): boolean {
	const { iat, exp } = claims;
	if (typeof iat !== 'number' || typeof exp !== 'number' || !Number.isFinite(iat) || !Number.isFinite(exp)) return false;
	return exp - iat > MAX_ACCESS_TOKEN_LIFETIME_S + ACCESS_TOKEN_LIFETIME_SLACK_S && iat < LEGACY_TOKEN_ISSUED_BEFORE_S;
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
