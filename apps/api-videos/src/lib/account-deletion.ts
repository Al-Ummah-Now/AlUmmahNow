/**
 * In-app account deletion (Epic 9.7): helpers shared by the account endpoints.
 *
 * Deletion order: content first (resumable erasure here), then the identity
 * (auth `DELETE /account`, same bearer token). The recent-sign-in rule is
 * checked here BEFORE any content is erased, with the same limit auth
 * enforces, so a stale session never erases content it then can't finish
 * deleting.
 */
import { decodeJwt } from 'jose';

/** Must match the auth service (apps/auth/src/routes/account-routes.ts). */
export const REAUTH_MAX_AGE_SECONDS = 600;

/** The bearer token of the request (already signature-checked by the auth middleware). */
export function bearerToken(request: Request): string | null {
	const header = request.headers.get('Authorization') ?? '';
	return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/** OIDC auth_time (seconds) of a token, or undefined. */
export function authTimeOf(token: string): number | undefined {
	try {
		const claims = decodeJwt(token);
		return typeof claims.auth_time === 'number' ? claims.auth_time : undefined;
	} catch {
		return undefined;
	}
}

export function isRecentSignIn(authTime: number | undefined, now = Date.now()): boolean {
	return authTime !== undefined && now / 1000 - authTime <= REAUTH_MAX_AGE_SECONDS;
}

export const REAUTH_CHALLENGE = {
	status: 401 as const,
	body: {
		success: false,
		code: 'insufficient_user_authentication',
		error: 'Sign in again to delete your account',
		max_age: REAUTH_MAX_AGE_SECONDS,
	},
	headers: {
		'WWW-Authenticate': `Bearer error="insufficient_user_authentication", max_age=${REAUTH_MAX_AGE_SECONDS}`,
		'Cache-Control': 'no-store',
	},
};

/** Calls the auth service as the user (their own token). */
export async function callAuth(issuer: string | undefined, path: string, token: string, init: RequestInit = {}): Promise<Response> {
	if (!issuer) throw new Error('Issuer is not configured');
	return fetch(new URL(path, issuer).toString(), {
		...init,
		headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
	});
}
