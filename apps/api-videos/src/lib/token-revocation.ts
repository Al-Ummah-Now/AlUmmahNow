/**
 * Token revocation check (#437, #762) and the legacy 30-day token check (#663).
 * Keep in sync across apps/api-videos, apps/admin-api, apps/websocket-server,
 * apps/web and apps/admin-web.
 *
 * Entries in TOKEN_REVOCATIONS KV:
 * - `u:<usr_id>` → { v: 1, before: unix_s, reason, updatedAt } (Auth: sign-out-all,
 *   account deletion, password reset, suspension, admin force logout)
 * - `s:<sid>`    → same layout (Auth: one signed-out device / terminated session #442;
 *   web/admin-web: single sign-out #762)
 * - `t:<sha256>` → same layout (fallback only when a signed-out token has no `sid` claim)
 *
 * A token is revoked when its sign-in (`auth_time`, else `iat`) is before the `before`
 * of a matching entry.
 *
 * Cost: cached per isolate for CACHE_MS (10 s) plus KV edge cache; tokens with `sid`
 * check `u:` and `s:` in parallel (never `t:`). KV errors fail open: tokens remain
 * signature-checked and short-lived.
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
	/** The token's sign-in (`sid` claim), when it has one. */
	sid?: string;
	authTime?: number;
	iat?: number;
	/** Raw verified JWT, checked under `t:<sha256>` only when `sid` is absent. */
	token?: string;
}

export const CACHE_MS = 10_000;
export const KV_CACHE_TTL_S = 30;
const MAX_CACHED = 5_000;

const cache = new Map<string, { entry: RevocationEntry | null; until: number }>();

export function isRevoked(entry: RevocationEntry | null | undefined, token: Omit<TokenTimes, 'userId' | 'sid' | 'token'>): boolean {
	if (!entry) return false;
	if (entry.before === undefined) return false;
	const signedInAt = token.authTime ?? token.iat;
	if (signedInAt === undefined) return true;
	return signedInAt < entry.before;
}

/** Stable `t:<base64url(sha256(token))>` key for tokens without a `sid` claim (never stores raw tokens). */
export async function tokenHashKey(rawToken: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
	let binary = '';
	for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
	return `t:${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

async function lookup(kv: RevocationKv, key: string, now: number): Promise<RevocationEntry | null> {
	const hit = cache.get(key);
	if (hit && hit.until > now) return hit.entry;
	const entry = await kv.get<RevocationEntry>(key, { type: 'json', cacheTtl: KV_CACHE_TTL_S });
	if (cache.size >= MAX_CACHED) cache.clear();
	cache.set(key, { entry: entry ?? null, until: now + CACHE_MS });
	return entry ?? null;
}

/** Immediately reflect a revocation written by this isolate in its local cache. */
export function recordLocalRevocation(key: string, entry: RevocationEntry, now = Date.now()): void {
	if (cache.size >= MAX_CACHED) cache.clear();
	const prev = cache.get(key)?.entry;
	const merged = prev?.before !== undefined && entry.before !== undefined && prev.before > entry.before ? prev : entry;
	cache.set(key, { entry: merged, until: now + CACHE_MS });
}

/** Whether the (already signature-verified) token belongs to a revoked sign-in. */
export async function isTokenRevoked(kv: RevocationKv | undefined, token: TokenTimes, now = Date.now()): Promise<boolean> {
	if (!kv || (!token.userId && !token.sid && !token.token)) return false;
	try {
		// The user's entry (everywhere) and this sign-in's entry (one device), read together.
		// Only fall back to `t:<hash>` when the token carries no `sid` claim.
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
export function decodeVerifiedClaims(token: string): { iat?: number; exp?: number; auth_time?: number; sid?: string } {
	try {
		const segment = token.split('.')[1] ?? '';
		const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
		const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
		const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
		return {
			iat: num(claims.iat),
			exp: num(claims.exp),
			auth_time: num(claims.auth_time),
			...(typeof claims.sid === 'string' && claims.sid ? { sid: claims.sid } : {}),
		};
	} catch {
		return {};
	}
}

/** Test hook. */
export function clearRevocationCache(): void {
	cache.clear();
}
