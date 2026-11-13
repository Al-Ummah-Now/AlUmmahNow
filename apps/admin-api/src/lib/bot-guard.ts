/**
 * Cloudflare Turnstile and bot checks (docs/features/bot-protection.md). The same
 * contract as AlUmmahNowAuth apps/auth/src/security/turnstile.ts and the copies in
 * admin-api and the www/CMS Workers: keep them in step.
 *
 * TURNSTILE_MODE (wrangler var, per environment):
 * - "off"      no widget, no check (the default when unset or unknown)
 * - "monitor"  widget shown and tokens verified; failures are counted, never refused
 * - "enforce"  a missing or failed token is refused
 *
 * Keys: TURNSTILE_SITE_KEY (public, a var) and TURNSTILE_SECRET (Secrets Store in
 * production). Non-production environments use Cloudflare's official test keys:
 * the test secrets are answered here without calling siteverify, and the web app
 * loads a same-origin stub instead of challenges.cloudflare.com, so tests and CI
 * never talk to Turnstile. Production refuses test keys (the mode reads as "off" and an
 * error is logged).
 *
 * Bypass: outside production only, a request carrying X-AUN-Bot-Bypass signed
 * with BOT_BYPASS_SECRET (see signBypass) skips the widget and the check.
 * Production never honours it.
 *
 * Every outcome is one Analytics Engine data point (ABUSE_EVENTS), read by the
 * videos admin Abuse panel. No IPs, emails or tokens are written.
 */
import { logger } from './logger';

export type TurnstileMode = 'off' | 'monitor' | 'enforce';

type Secret = string | { get(): Promise<string> } | undefined;

export interface TurnstileEnv {
	ENVIRONMENT?: string;
	TURNSTILE_MODE?: string;
	TURNSTILE_SITE_KEY?: string;
	TURNSTILE_SECRET?: Secret;
	BOT_BYPASS_SECRET?: Secret;
	ABUSE_EVENTS?: { writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void };
}

/** Cloudflare's documented test keys (developers.cloudflare.com/turnstile/troubleshooting/testing/). */
export const TEST_SITE_KEYS = {
	pass: '1x00000000000000000000AA',
	passInvisible: '1x00000000000000000000BB',
	block: '2x00000000000000000000AB',
	interactive: '3x00000000000000000000FF',
} as const;
export const TEST_SECRETS = {
	pass: '1x0000000000000000000000000000000AA',
	fail: '2x0000000000000000000000000000000AA',
	spent: '3x0000000000000000000000000000000AA',
} as const;
/** The token the test site keys (and the stub) produce. */
export const TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

export const TURNSTILE_FIELD = 'cf-turnstile-response';
export const BYPASS_HEADER = 'X-AUN-Bot-Bypass';
/** A signed bypass is good for 6 hours either side of its timestamp (a long E2E run). */
export const BYPASS_MAX_AGE_SECONDS = 6 * 60 * 60;
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const API_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

const isProduction = (env: TurnstileEnv) => env.ENVIRONMENT === 'production';
const isTestKey = (value: string | undefined) => !!value && /^[123]x0{20,}[A-F]{2}$/.test(value);

async function readSecret(secret: Secret): Promise<string | undefined> {
	if (!secret) return undefined;
	if (typeof secret === 'string') return secret || undefined;
	try {
		return (await secret.get()) || undefined;
	} catch (error) {
		logger.error('Turnstile: could not read a secret binding', { error: error instanceof Error ? error.message : String(error) });
		return undefined;
	}
}

/** The mode in force. Production with a test key or without a site key reads as "off". */
export function turnstileMode(env: TurnstileEnv): TurnstileMode {
	const mode = env.TURNSTILE_MODE === 'enforce' || env.TURNSTILE_MODE === 'monitor' ? env.TURNSTILE_MODE : 'off';
	if (mode === 'off') return 'off';
	if (!env.TURNSTILE_SITE_KEY) {
		logger.error('Turnstile: TURNSTILE_MODE is on but TURNSTILE_SITE_KEY is not set; treating as off');
		return 'off';
	}
	if (isProduction(env) && isTestKey(env.TURNSTILE_SITE_KEY)) {
		logger.error('Turnstile: a test site key is configured in production; treating as off');
		return 'off';
	}
	return mode;
}

export type VerifyOutcome = 'pass' | 'missing' | 'fail' | 'error';

export interface VerifyResult {
	outcome: VerifyOutcome;
	/** siteverify error codes (or ours: "test-secret-in-production", "no-secret") */
	codes: string[];
}

/** Checks one widget token with siteverify (or locally for the test secrets outside production). */
export async function verifyTurnstileToken(
	env: TurnstileEnv,
	token: string | null | undefined,
	opts: { ip?: string; fetcher?: typeof fetch } = {}
): Promise<VerifyResult> {
	if (!token) return { outcome: 'missing', codes: ['missing-input-response'] };
	if (token.length > 2048) return { outcome: 'fail', codes: ['invalid-input-response'] };
	const secret = await readSecret(env.TURNSTILE_SECRET);
	if (!secret) {
		logger.error('Turnstile: TURNSTILE_SECRET is not set');
		return { outcome: 'error', codes: ['no-secret'] };
	}
	if (isTestKey(secret)) {
		if (isProduction(env)) {
			logger.error('Turnstile: a test secret is configured in production');
			return { outcome: 'error', codes: ['test-secret-in-production'] };
		}
		if (secret === TEST_SECRETS.pass) return { outcome: 'pass', codes: [] };
		if (secret === TEST_SECRETS.spent) return { outcome: 'fail', codes: ['timeout-or-duplicate'] };
		return { outcome: 'fail', codes: ['invalid-input-response'] };
	}
	const body = new FormData();
	body.set('secret', secret);
	body.set('response', token);
	if (opts.ip && opts.ip !== 'unknown') body.set('remoteip', opts.ip);
	try {
		const res = await (opts.fetcher ?? fetch)(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
		if (!res.ok) return { outcome: 'error', codes: [`http-${res.status}`] };
		const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
		const codes = Array.isArray(data['error-codes']) ? data['error-codes'].map(String).slice(0, 5) : [];
		if (data.success) return { outcome: 'pass', codes };
		// Our own key or secret is wrong: a configuration fault, not a bot
		if (codes.some((c) => c === 'invalid-input-secret' || c === 'missing-input-secret')) return { outcome: 'error', codes };
		return { outcome: 'fail', codes };
	} catch (error) {
		logger.error('Turnstile: siteverify unreachable', { error: error instanceof Error ? error.message : String(error) });
		return { outcome: 'error', codes: ['siteverify-unreachable'] };
	}
}

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** The X-AUN-Bot-Bypass value for `now` (unix seconds): "v1.<ts>.<hmac-sha256 hex of 'v1.<ts>'>". */
export async function signBypass(secret: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
	const payload = `v1.${now}`;
	return `${payload}.${await hmacHex(secret, payload)}`;
}

/** True when the request carries a valid signed bypass and this is not production. */
export async function hasValidBypass(env: TurnstileEnv, request: Request, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
	if (isProduction(env)) return false;
	const value = request.headers.get(BYPASS_HEADER);
	if (!value) return false;
	const match = /^v1\.(\d{9,11})\.([0-9a-f]{64})$/.exec(value);
	if (!match) return false;
	if (Math.abs(now - Number(match[1])) > BYPASS_MAX_AGE_SECONDS) return false;
	const secret = await readSecret(env.BOT_BYPASS_SECRET);
	if (!secret) return false;
	return constantTimeEqual(await hmacHex(secret, `v1.${match[1]}`), match[2]);
}

export type AbuseKind =
	| 'turnstile_pass'
	| 'turnstile_fail'
	| 'turnstile_missing'
	| 'turnstile_error'
	| 'rate_limited'
	| 'bad_user_agent'
	| 'bypass';

/** One counter point: blobs = [app, endpoint, kind, environment]. Never personal data. */
export function recordAbuse(env: TurnstileEnv, endpoint: string, kind: AbuseKind, app = 'videos'): void {
	try {
		env.ABUSE_EVENTS?.writeDataPoint({ indexes: [app], blobs: [app, endpoint, kind, env.ENVIRONMENT ?? 'development'], doubles: [1] });
	} catch (error) {
		logger.warn('Abuse counter write failed', { error: error instanceof Error ? error.message : String(error) });
	}
}

export interface HumanCheck {
	/** False only in "enforce" mode when the token is missing or failed. */
	allowed: boolean;
	outcome: VerifyOutcome | 'off' | 'bypass';
}

/**
 * The whole check for one form post: mode, bypass, token. A siteverify outage
 * (outcome "error") is allowed through and counted: the rate limits still apply,
 * and an outage at Cloudflare must not stop every sign-up.
 */
export async function checkHuman(
	env: TurnstileEnv,
	request: Request,
	token: string | null | undefined,
	endpoint: string,
	opts: { ip?: string; fetcher?: typeof fetch; app?: string } = {}
): Promise<HumanCheck> {
	const mode = turnstileMode(env);
	if (mode === 'off') return { allowed: true, outcome: 'off' };
	if (await hasValidBypass(env, request)) {
		recordAbuse(env, endpoint, 'bypass', opts.app);
		return { allowed: true, outcome: 'bypass' };
	}
	const { outcome, codes } = await verifyTurnstileToken(env, token, opts);
	recordAbuse(env, endpoint, outcome === 'pass' ? 'turnstile_pass' : outcome === 'missing' ? 'turnstile_missing' : outcome === 'fail' ? 'turnstile_fail' : 'turnstile_error', opts.app);
	if (outcome !== 'pass') logger.warn('Turnstile check did not pass', { endpoint, outcome, codes, mode });
	return { allowed: outcome === 'pass' || outcome === 'error' || mode === 'monitor', outcome };
}

/**
 * Command-line and scripting clients. Browsers, our native apps (okhttp,
 * CFNetwork, Ktor, Dart), crawlers and Workers subrequests are not listed.
 */
const BAD_AGENT = /^(curl|wget|python-requests|python-urllib|python-httpx|aiohttp|go-http-client|java\/|libwww-perl|lwp-|scrapy|httpie|php\/|ruby|masscan|zgrab|nikto|sqlmap|nuclei)/i;

export function isBadUserAgent(userAgent: string | null): boolean {
	// No User-Agent is allowed here: the web app's server actions call this API from a Worker
	return BAD_AGENT.test((userAgent ?? '').trim());
}

/** Header the clients put the widget token in (allowed by CORS). */
export const TURNSTILE_HEADER = 'X-Turnstile-Token';
