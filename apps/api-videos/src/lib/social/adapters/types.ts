/**
 * Network adapters (spec §10.4): one per network, the same shape, so planning, retries, the cap and errors are
 * written once. Adapters only talk to the network; storage stays in store.ts.
 */
import { checkUrl } from '../../link-preview';
import type { SocialLanguage, SocialNetwork } from '@al-ummah/shared-types';

/** Why a network call failed, so the queue knows whether to retry. */
export class NetworkError extends Error {
	constructor(
		message: string,
		readonly kind: 'retry' | 'auth' | 'fatal',
		readonly retryAfterSeconds?: number,
	) {
		super(message);
	}
}

export interface PostMedia {
	url: string;
	/** Known size, bytes; the adapter asks the server when absent */
	bytes?: number;
	durationSeconds?: number;
	width?: number | null;
	height?: number | null;
}

export interface PostRequest {
	text: string;
	lang: SocialLanguage;
	/** The page the post points to (link cards, facets) */
	link?: string;
	/** Link card / photo */
	card?: { title: string; description?: string; imageUrl?: string };
	video?: PostMedia;
	/** Stable per delivery: the network drops a repeat where it supports it (Mastodon Idempotency-Key) */
	idempotencyKey: string;
}

export interface PostResult {
	remoteId: string;
	url?: string;
}

export interface TokenSet {
	accessToken?: string;
	refreshToken?: string;
	/** ms */
	expiresAt?: number | null;
	scope?: string;
	/** Bluesky: DPoP key (private JWK) and the auth server / PDS the session belongs to */
	dpopJwk?: JsonWebKey;
	authServer?: string;
	tokenEndpoint?: string;
	revocationEndpoint?: string;
	pds?: string;
	/** Mastodon: instance host */
	instance?: string;
	/** Telegram: chat id */
	chatId?: string;
}

export interface AdapterAccount {
	id: string;
	network: SocialNetwork;
	remoteId: string;
	handle: string;
	instance?: string | null;
}

export interface AdapterContext {
	fetch: typeof fetch;
	account: AdapterAccount;
	tokens: TokenSet;
	/** Persist refreshed tokens (rotating refresh tokens must be saved before anything else) */
	saveTokens(tokens: TokenSet): Promise<void>;
}

export interface Adapter {
	network: SocialNetwork;
	publish(ctx: AdapterContext, post: PostRequest): Promise<PostResult>;
	/** Best effort; a failure is logged, the connection is removed anyway */
	revoke?(ctx: AdapterContext): Promise<void>;
}

/** Retry-After as seconds (number or HTTP date), or x-rate-limit-reset (epoch seconds). */
export function retryAfter(res: Response): number | undefined {
	const ra = res.headers.get('retry-after');
	if (ra) {
		const n = Number(ra);
		if (Number.isFinite(n)) return Math.max(1, Math.ceil(n));
		const at = Date.parse(ra);
		if (Number.isFinite(at)) return Math.max(1, Math.ceil((at - Date.now()) / 1000));
	}
	const reset = Number(res.headers.get('x-rate-limit-reset') ?? res.headers.get('x-ratelimit-reset'));
	if (Number.isFinite(reset) && reset > 0) {
		const s = reset > 1e9 ? reset - Date.now() / 1000 : reset;
		return Math.max(1, Math.ceil(s));
	}
	return undefined;
}

/** Turns a failed response into a NetworkError with the network's own reason (no tokens, no bodies of ours). */
export async function failure(network: string, res: Response, what: string): Promise<NetworkError> {
	let reason = '';
	try {
		const text = (await res.text()).slice(0, 2000);
		try {
			const j = JSON.parse(text) as Record<string, unknown>;
			const first = (Array.isArray(j.errors) ? (j.errors[0] as Record<string, unknown>) : null) ?? j;
			reason = String(first.detail ?? first.message ?? first.description ?? first.error_description ?? first.error ?? j.title ?? '').slice(0, 300);
		} catch {
			reason = text.replace(/\s+/g, ' ').slice(0, 200);
		}
	} catch {
		reason = '';
	}
	const message = `${network} ${what}: HTTP ${res.status}${reason ? ` ${reason}` : ''}`;
	if (res.status === 401) return new NetworkError(message, 'auth');
	if (res.status === 429 || res.status >= 500 || res.status === 408) return new NetworkError(message, 'retry', retryAfter(res));
	return new NetworkError(message, 'fatal');
}

/** A fetch that turns network-level failures (DNS, reset) into retryable errors. */
export async function call(f: typeof fetch, input: string, init: RequestInit, network: string, what: string): Promise<Response> {
	let url: URL;
	try {
		url = checkUrl(input);
		if (url.protocol !== 'https:' || url.port) throw new Error('Expected HTTPS');
	} catch {
		throw new NetworkError(`${network} ${what}: Invalid destination`, 'fatal');
	}
	try {
		return await f(url.href, { ...init, redirect: 'error' });
	} catch (error) {
		throw new NetworkError(`${network} ${what}: ${error instanceof Error ? error.message : String(error)}`, 'retry');
	}
}

/** Downloads media we host (thumbnail, MP4), refusing anything bigger than `maxBytes`. */
export async function download(f: typeof fetch, url: string, maxBytes: number, network: string): Promise<{ bytes: Uint8Array; type: string }> {
	const res = await call(f, url, { method: 'GET' }, network, 'media download');
	if (!res.ok) throw new NetworkError(`${network} media download: HTTP ${res.status}`, res.status >= 500 ? 'retry' : 'fatal');
	const declared = Number(res.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) throw new NetworkError(`media is ${Math.round(declared / 1048576)} MB; ${network} takes up to ${Math.round(maxBytes / 1048576)} MB`, 'fatal');
	const buf = new Uint8Array(await res.arrayBuffer());
	if (buf.byteLength > maxBytes) throw new NetworkError(`media is ${Math.round(buf.byteLength / 1048576)} MB; ${network} takes up to ${Math.round(maxBytes / 1048576)} MB`, 'fatal');
	return { bytes: buf, type: res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
}

/** Size of hosted media without downloading it (HEAD, then a 1-byte range). */
export async function mediaSize(f: typeof fetch, url: string): Promise<number | null> {
	try {
		const head = await call(f, url, { method: 'HEAD' }, 'Social', 'media size');
		const n = Number(head.headers.get('content-length'));
		if (head.ok && Number.isFinite(n) && n > 0) return n;
		const range = await call(f, url, { method: 'GET', headers: { Range: 'bytes=0-0' } }, 'Social', 'media size');
		const total = /\/(\d+)$/.exec(range.headers.get('content-range') ?? '')?.[1];
		await range.body?.cancel();
		return total ? Number(total) : null;
	} catch {
		return null;
	}
}
