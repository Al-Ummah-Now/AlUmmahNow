/**
 * Edge bot protection for the write and search endpoints (docs/features/bot-protection.md).
 *
 * - edgeRateLimit: Workers Rate Limiting bindings (atomic per location, no storage
 *   writes), keyed by the signed-in user, else the client IP. Requests from
 *   Cloudflare's own addresses (the web app's server actions and SSR, which call
 *   this API from a Worker) are keyed by user only, never by that shared IP.
 * - scriptedClientBlock: production with TURNSTILE_MODE=enforce refuses writes from
 *   curl, python-requests, Go-http-client and the like. Reads stay open to every
 *   client, including crawlers and link previewers.
 * - requireHuman: Cloudflare Turnstile. "always" (reports) or "first" (an account's
 *   first comment or post: once verified, the account is remembered for 180 days in
 *   KV HUMAN_VERIFIED). Tokens issued to our native apps (NATIVE_CLIENT_IDS) are not
 *   asked: the apps cannot show the widget; the rate limits still apply to them.
 *   Native clients listed in videos admin → Mobile apps → "Require a proof from" lose that
 *   exemption: they need a valid attestation proof (X-AUN-Native-Proof, lib/attestation), else
 *   403 native_proof_required. A proof counts only on a native client's signed-in request, while
 *   its platform's check is on, and for the account that first used it; anyone else's request
 *   ignores the header and goes through Turnstile as usual.
 *
 * Refusals answer JSON with a `code` the clients translate:
 * 429 rate_limited, 403 forbidden_client, 403 human_check_required (+ siteKey),
 * 403 native_proof_required.
 */
import type { Context, Next } from 'hono';
import { logger } from '../lib/logger';
import {
	checkHuman,
	isBadUserAgent,
	recordAbuse,
	TURNSTILE_HEADER,
	turnstileMode,
	type TurnstileEnv,
} from '../lib/bot-guard';
import { NATIVE_PROOF_HEADER } from '@al-ummah/shared-types';
import { acceptProof, loadMobileAppsSettings, type AttestationEnv } from '../lib/attestation/service';
import { apiError } from '../lib/api-error';

export const RATE_LIMIT_RETRY_SECONDS = 60;
export const HUMAN_VERIFIED_TTL_SECONDS = 180 * 24 * 60 * 60;

/** KV HUMAN_VERIFIED key of an account that passed the check (deleted by the account erasure). */
export function humanVerifiedKey(userId: string): string {
	return `h:${userId}`;
}

export type LimiterName =
	| 'COMMENT_LIMITER'
	| 'POST_LIMITER'
	| 'REACTION_LIMITER'
	| 'REPORT_LIMITER'
	| 'UPLOAD_INITIATE_LIMITER'
	| 'SEARCH_LIMITER'
	| 'ATTEST_LIMITER'
	| 'LIVE_VIEWER_LIMITER'
	| 'LIVE_CHAT_LIMITER'
	| 'LIVE_CHAT_IP_LIMITER'
	| 'PRAYER_LIMITER';

export type BotEnv = TurnstileEnv & AttestationEnv & { [K in LimiterName]?: RateLimit } & {
	HUMAN_VERIFIED?: KVNamespace;
	/** Comma-separated OAuth client ids of our native apps */
	NATIVE_CLIENT_IDS?: string;
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Cloudflare's own egress (Workers subrequests carry it as CF-Connecting-IP). */
export function isCloudflareEgress(ip: string): boolean {
	return ip.toLowerCase().startsWith('2a06:98c0:');
}

function clientIp(c: Context): string {
	return c.req.header('CF-Connecting-IP') || 'unknown';
}

function signedInUser(c: Context): string | null {
	const auth = c.get('auth') as { userId?: string } | undefined;
	return auth?.userId || null;
}

/** The limiter key: the user, else the client IP; null when only a shared Worker address is known. */
export function limiterKey(c: Context): string | null {
	const user = signedInUser(c);
	if (user) return `u:${user}`;
	const ip = clientIp(c);
	if (ip === 'unknown' || isCloudflareEgress(ip)) return null;
	return `ip:${ip}`;
}

/** The OAuth client the bearer token was issued to (`aud`). The signature was checked by the auth middleware. */
export function tokenClientId(c: Context): string | null {
	const header = c.req.header('Authorization') ?? '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : '';
	const part = token.split('.')[1];
	if (!part) return null;
	try {
		const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { aud?: unknown; client_id?: unknown };
		const aud = Array.isArray(json.aud) ? json.aud[0] : json.aud ?? json.client_id;
		return typeof aud === 'string' ? aud : null;
	} catch {
		return null;
	}
}

/**
 * A signed-in native client's request: a valid proof passes; without one, 403 native_proof_required
 * when the admin requires a proof from this client, else the native exemption.
 */
async function nativeProofDecision(c: Context, env: BotEnv): Promise<'pass' | 'refuse'> {
	const id = tokenClientId(c);
	const user = signedInUser(c);
	let settings;
	try {
		settings = await loadMobileAppsSettings(env);
	} catch {
		return 'pass';
	}
	const proof = c.req.header(NATIVE_PROOF_HEADER);
	if (proof && user && (await acceptProof(env.HUMAN_VERIFIED, settings, proof, user))) return 'pass';
	return id && settings.attestation.enforceClientIds.includes(id) ? 'refuse' : 'pass';
}

function isNativeClient(c: Context, env: BotEnv): boolean {
	if (!signedInUser(c)) return false;
	const id = tokenClientId(c);
	if (!id) return false;
	return (env.NATIVE_CLIENT_IDS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.includes(id);
}

/** Counts one request against `binding`; 429 rate_limited when over. Fails open on a binding error. */
export function edgeRateLimit(binding: LimiterName, endpoint: string, methods: string[] = ['POST']) {
	return async (c: Context, next: Next) => {
		if (!methods.includes(c.req.method)) return next();
		const env = c.env as BotEnv;
		const limiter = env[binding];
		const key = limiterKey(c);
		if (!limiter || !key) return next();
		let allowed = true;
		try {
			allowed = (await limiter.limit({ key })).success;
		} catch (error) {
			logger.error('Rate limiter failed', { binding, error: error instanceof Error ? error.message : String(error) });
		}
		if (allowed) return next();
		recordAbuse(env, endpoint, 'rate_limited');
		logger.warn('[SECURITY] Edge rate limit exceeded', { binding, endpoint, signedIn: key.startsWith('u:') });
		return apiError(c, 429, 'rate_limited', { error: 'Too many requests. Please wait a minute and try again.', retryAfter: RATE_LIMIT_RETRY_SECONDS }, { 'Retry-After': String(RATE_LIMIT_RETRY_SECONDS) });
	};
}

/**
 * Live chat messages from one address (edgeRateLimit counts a signed-in caller by account, so this is
 * a limit of its own). Loose on purpose: a mosque or a conference may share one. Fails open.
 */
export async function allowLiveChatAddress(c: Context): Promise<boolean> {
	const env = c.env as BotEnv;
	const ip = clientIp(c);
	if (!env.LIVE_CHAT_IP_LIMITER || ip === 'unknown' || isCloudflareEgress(ip)) return true;
	try {
		if ((await env.LIVE_CHAT_IP_LIMITER.limit({ key: `live-chat:${ip}` })).success) return true;
	} catch (error) {
		logger.error('Rate limiter failed', { binding: 'LIVE_CHAT_IP_LIMITER', error: error instanceof Error ? error.message : String(error) });
		return true;
	}
	recordAbuse(env, 'videos.live_chat', 'rate_limited');
	return false;
}

/** Production with Turnstile enforced: writes from command-line clients answer 403 forbidden_client. */
export function scriptedClientBlock() {
	return async (c: Context, next: Next) => {
		if (!WRITE_METHODS.has(c.req.method)) return next();
		const env = c.env as BotEnv;
		if (env.ENVIRONMENT !== 'production' || turnstileMode(env) !== 'enforce') return next();
		if (!isBadUserAgent(c.req.header('User-Agent') ?? null)) return next();
		recordAbuse(env, `videos.${c.req.method.toLowerCase()}`, 'bad_user_agent');
		return apiError(c, 403, 'forbidden_client', { error: 'This client is not allowed to make changes. Use the website or the app.' });
	};
}

/**
 * Turnstile for one endpoint. The token comes in the X-Turnstile-Token header.
 * "first": only until the signed-in account has passed once (KV HUMAN_VERIFIED).
 */
export function requireHuman(endpoint: string, policy: 'always' | 'first') {
	return async (c: Context, next: Next) => {
		if (c.req.method !== 'POST') return next();
		const env = c.env as BotEnv;
		if (isNativeClient(c, env)) {
			if ((await nativeProofDecision(c, env)) === 'refuse') {
				recordAbuse(env, endpoint, 'native_proof_missing');
				// aun-core keeps only the message of a 403, so the message is the code the apps match on
				return apiError(c, 403, 'native_proof_required', { error: 'native_proof_required' });
			}
			return next();
		}
		if (turnstileMode(env) === 'off') return next();
		const user = signedInUser(c);
		if (policy === 'first') {
			if (!user) return next(); // the endpoint answers 401
			if (env.HUMAN_VERIFIED && (await env.HUMAN_VERIFIED.get(humanVerifiedKey(user)).catch(() => null))) return next();
		}
		const ip = clientIp(c);
		const check = await checkHuman(env, c.req.raw, c.req.header(TURNSTILE_HEADER), endpoint, {
			ip: isCloudflareEgress(ip) ? undefined : ip,
			app: 'videos',
		});
		if (!check.allowed) {
			return apiError(c, 403, 'human_check_required', { error: 'Please confirm that you are not a robot, then try again.', siteKey: env.TURNSTILE_SITE_KEY });
		}
		await next();
		if (policy === 'first' && user && env.HUMAN_VERIFIED && (check.outcome === 'pass' || check.outcome === 'bypass') && c.res.status < 300) {
			const put = env.HUMAN_VERIFIED.put(humanVerifiedKey(user), '1', { expirationTtl: HUMAN_VERIFIED_TTL_SECONDS }).catch((error: unknown) =>
				logger.warn('Could not remember a verified account', { error: error instanceof Error ? error.message : String(error) })
			);
			try {
				c.executionCtx.waitUntil(put);
			} catch {
				await put;
			}
		}
	};
}

/**
 * GET /api/me/human-check?kind=comment|post|report — whether the next such post
 * from this account needs a Turnstile token, and the site key to get one. Lets
 * the web app get the token before submitting instead of failing first.
 */
export async function humanCheckStatus(c: Context): Promise<Response> {
	const env = c.env as BotEnv;
	const kind = c.req.query('kind');
	const mode = turnstileMode(env);
	let required = mode !== 'off' && !isNativeClient(c, env);
	// Reports and tier requests check every time; comments and posts only an account's first
	if (required && kind !== 'report' && kind !== 'tier_request') {
		const user = signedInUser(c);
		if (user && env.HUMAN_VERIFIED && (await env.HUMAN_VERIFIED.get(humanVerifiedKey(user)).catch(() => null))) required = false;
	}
	return c.json(
		{ success: true, result: { required, siteKey: required ? env.TURNSTILE_SITE_KEY : null } },
		200,
		{ 'Cache-Control': 'private, no-store' }
	);
}
