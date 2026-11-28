/**
 * Bluesky (spec §5.5): AT Protocol OAuth. We are a confidential client: the client metadata and our public key
 * are served by api-videos (/api/social/bluesky/client-metadata.json, /jwks.json) and the token endpoint is
 * called with a private_key_jwt assertion, so sessions last (a public client's end after two weeks). Requests are
 * PAR + PKCE, and every token is DPoP-bound: each session has its own P-256 key, stored encrypted with the tokens.
 * App passwords are never accepted (full account access, no scope).
 */
import { checkUrl } from '../../link-preview';
import { base64url, pkceChallenge, randomToken } from '../crypto';
import { call, download, failure, NetworkError, type Adapter, type AdapterContext, type PostResult, type TokenSet } from './types';

export const BLUESKY_SCOPE = 'atproto transition:generic';
export const BSKY_RESOLVER = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';
const enc = new TextEncoder();

/** Our client: its id (the metadata URL) and the private key behind jwks.json. */
export interface BlueskyClient {
	clientId: string;
	redirectUri: string;
	key: { privateJwk: JsonWebKey; kid: string };
}

const ES256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export async function generateEs256(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
	const pair = (await crypto.subtle.generateKey(ES256, true, ['sign', 'verify'])) as CryptoKeyPair;
	const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
	return { privateJwk, publicJwk: publicOf(privateJwk) };
}

export function publicOf(jwk: JsonWebKey): JsonWebKey {
	return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

async function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, privateJwk: JsonWebKey): Promise<string> {
	const key = await crypto.subtle.importKey('jwk', { ...privateJwk, key_ops: ['sign'] }, ES256, false, ['sign']);
	const input = `${base64url(enc.encode(JSON.stringify(header)))}.${base64url(enc.encode(JSON.stringify(payload)))}`;
	const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input)));
	return `${input}.${base64url(sig)}`;
}

const now = () => Math.floor(Date.now() / 1000);

export async function dpopProof(jwk: JsonWebKey, htm: string, htu: string, nonce?: string, accessToken?: string): Promise<string> {
	const url = new URL(htu);
	const payload: Record<string, unknown> = { jti: randomToken(16), htm, htu: `${url.origin}${url.pathname}`, iat: now() };
	if (nonce) payload.nonce = nonce;
	if (accessToken) payload.ath = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(accessToken))));
	return signJwt({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicOf(jwk) }, payload, jwk);
}

function clientAssertion(client: BlueskyClient, audience: string): Promise<string> {
	return signJwt({ alg: 'ES256', kid: client.key.kid }, { iss: client.clientId, sub: client.clientId, aud: audience, jti: randomToken(16), iat: now() }, client.key.privateJwk);
}

/** The client metadata document (served at clientId). */
export function clientMetadata(client: Pick<BlueskyClient, 'clientId' | 'redirectUri'>, jwksUri: string, clientUri: string): Record<string, unknown> {
	return {
		client_id: client.clientId,
		client_name: 'Al Ummah Now',
		client_uri: clientUri,
		application_type: 'web',
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		scope: BLUESKY_SCOPE,
		redirect_uris: [client.redirectUri],
		token_endpoint_auth_method: 'private_key_jwt',
		token_endpoint_auth_signing_alg: 'ES256',
		dpop_bound_access_tokens: true,
		jwks_uri: jwksUri,
	};
}

/**
 * A request with a DPoP proof; a server that answers use_dpop_nonce gets the request again with its nonce.
 * `nonces` remembers each origin's latest nonce for the rest of the call.
 */
async function dpopFetch(f: typeof fetch, jwk: JsonWebKey, nonces: Map<string, string>, url: string, init: RequestInit, what: string, accessToken?: string): Promise<Response> {
	const origin = new URL(url).origin;
	for (let attempt = 0; attempt < 2; attempt++) {
		const headers = new Headers(init.headers);
		headers.set('DPoP', await dpopProof(jwk, init.method ?? 'GET', url, nonces.get(origin), accessToken));
		if (accessToken) headers.set('Authorization', `DPoP ${accessToken}`);
		const res = await call(f, url, { ...init, headers }, 'Bluesky', what);
		const nonce = res.headers.get('dpop-nonce');
		if (nonce) nonces.set(origin, nonce);
		if ((res.status === 400 || res.status === 401) && nonce && attempt === 0) {
			const body = await res.clone().text();
			const www = res.headers.get('www-authenticate') ?? '';
			if (body.includes('use_dpop_nonce') || www.includes('use_dpop_nonce')) continue;
		}
		return res;
	}
	throw new NetworkError(`Bluesky ${what}: nonce refused`, 'retry');
}

async function getJson<T>(f: typeof fetch, url: string, what: string): Promise<T> {
	const res = await call(f, url, { headers: { Accept: 'application/json' } }, 'Bluesky', what);
	if (!res.ok) throw await failure('Bluesky', res, what);
	return (await res.json()) as T;
}

export interface BlueskyIdentity {
	did: string;
	handle: string;
	pds: string;
	authServer: { issuer: string; par: string; authorize: string; token: string; revoke?: string };
}

/** A handle like `name.bsky.social` (or `@name.bsky.social`), as typed. */
export function normalizeHandle(input: string): string | null {
	const h = input.trim().replace(/^@/, '').toLowerCase();
	return /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(h) ? h : null;
}

const httpsOrigin = (raw: string): string => {
	const u = checkUrl(raw);
	if (u.protocol !== 'https:' || u.port) throw new NetworkError('Bluesky: the account server is not on https', 'fatal');
	return u.origin;
};

/** Handle → DID → PDS → authorization server. */
export async function resolveBluesky(f: typeof fetch, handle: string): Promise<BlueskyIdentity> {
	const { did } = await getJson<{ did: string }>(f, `${BSKY_RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, 'resolve handle');
	let doc: { alsoKnownAs?: string[]; service?: Array<{ id: string; type: string; serviceEndpoint: string }> };
	if (did.startsWith('did:plc:')) doc = await getJson(f, `${PLC_DIRECTORY}/${encodeURIComponent(did)}`, 'DID document');
	else if (did.startsWith('did:web:')) doc = await getJson(f, `https://${did.slice(8)}/.well-known/did.json`, 'DID document');
	else throw new NetworkError('Bluesky: unsupported account type', 'fatal');
	if (!(doc.alsoKnownAs ?? []).includes(`at://${handle}`)) throw new NetworkError('Bluesky: the handle does not match its account', 'fatal');
	const service = (doc.service ?? []).find((s) => s.id.endsWith('#atproto_pds'));
	if (!service) throw new NetworkError('Bluesky: the account has no server', 'fatal');
	const pds = httpsOrigin(service.serviceEndpoint);
	const pr = await getJson<{ authorization_servers?: string[] }>(f, `${pds}/.well-known/oauth-protected-resource`, 'protected resource');
	const as = pr.authorization_servers?.[0];
	if (!as) throw new NetworkError('Bluesky: the server has no OAuth', 'fatal');
	const meta = await getJson<{ issuer: string; pushed_authorization_request_endpoint: string; authorization_endpoint: string; token_endpoint: string; revocation_endpoint?: string }>(
		f,
		`${httpsOrigin(as)}/.well-known/oauth-authorization-server`,
		'authorization server',
	);
	const issuerOrigin = httpsOrigin(as);
	if (httpsOrigin(meta.issuer) !== issuerOrigin) throw new NetworkError('Bluesky: authorization server issuer mismatch', 'fatal');
	for (const endpoint of [meta.authorization_endpoint, meta.pushed_authorization_request_endpoint, meta.token_endpoint, meta.revocation_endpoint]) {
		if (endpoint !== undefined && httpsOrigin(endpoint) !== issuerOrigin) {
			throw new NetworkError('Bluesky: endpoint is outside the authorization server origin', 'fatal');
		}
	}
	return {
		did,
		handle,
		pds,
		authServer: { issuer: meta.issuer, par: meta.pushed_authorization_request_endpoint, authorize: meta.authorization_endpoint, token: meta.token_endpoint, revoke: meta.revocation_endpoint },
	};
}

export interface BlueskyPending {
	verifier: string;
	dpopJwk: JsonWebKey;
	identity: BlueskyIdentity;
}

/** Pushed authorization request; returns the URL to send the person to and what the callback needs. */
export async function blueskyStart(f: typeof fetch, client: BlueskyClient, identity: BlueskyIdentity, state: string): Promise<{ authorizeUrl: string; pending: BlueskyPending }> {
	const verifier = randomToken(48);
	const { privateJwk: dpopJwk } = await generateEs256();
	const nonces = new Map<string, string>();
	const body = new URLSearchParams({
		client_id: client.clientId,
		response_type: 'code',
		code_challenge: await pkceChallenge(verifier),
		code_challenge_method: 'S256',
		state,
		redirect_uri: client.redirectUri,
		scope: BLUESKY_SCOPE,
		login_hint: identity.handle,
		client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
		client_assertion: await clientAssertion(client, identity.authServer.issuer),
	});
	const res = await dpopFetch(f, dpopJwk, nonces, identity.authServer.par, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, 'authorization request');
	if (!res.ok) throw await failure('Bluesky', res, 'authorization request');
	const { request_uri } = (await res.json()) as { request_uri: string };
	const u = new URL(identity.authServer.authorize);
	u.search = new URLSearchParams({ client_id: client.clientId, request_uri }).toString();
	return { authorizeUrl: u.toString(), pending: { verifier, dpopJwk, identity } };
}

async function tokenRequest(f: typeof fetch, client: BlueskyClient, jwk: JsonWebKey, authServer: { issuer: string; token: string }, params: Record<string, string>): Promise<TokenSet & { sub: string }> {
	const body = new URLSearchParams({
		...params,
		client_id: client.clientId,
		client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
		client_assertion: await clientAssertion(client, authServer.issuer),
	});
	const res = await dpopFetch(f, jwk, new Map(), authServer.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, 'token');
	if (!res.ok) {
		const err = await failure('Bluesky', res, 'token');
		throw res.status === 400 && params.grant_type === 'refresh_token' ? new NetworkError(err.message, 'auth') : err;
	}
	const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; sub: string; scope?: string; token_type?: string };
	if ((j.token_type ?? 'DPoP').toLowerCase() !== 'dpop') throw new NetworkError('Bluesky: token is not DPoP-bound', 'fatal');
	return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : null, scope: j.scope, sub: j.sub };
}

export async function blueskyFinish(f: typeof fetch, client: BlueskyClient, pending: BlueskyPending, code: string, iss: string | null): Promise<TokenSet> {
	if (iss && iss !== pending.identity.authServer.issuer) throw new NetworkError('Bluesky: the answer came from another server', 'fatal');
	const t = await tokenRequest(f, client, pending.dpopJwk, pending.identity.authServer, { grant_type: 'authorization_code', code, redirect_uri: client.redirectUri, code_verifier: pending.verifier });
	if (t.sub !== pending.identity.did) throw new NetworkError('Bluesky: signed in as another account', 'fatal');
	if (!(t.scope ?? '').split(' ').includes('atproto')) throw new NetworkError('Bluesky: posting was not allowed', 'fatal');
	return {
		accessToken: t.accessToken,
		refreshToken: t.refreshToken,
		expiresAt: t.expiresAt,
		scope: t.scope,
		dpopJwk: pending.dpopJwk,
		authServer: pending.identity.authServer.issuer,
		tokenEndpoint: pending.identity.authServer.token,
		...(pending.identity.authServer.revoke ? { revocationEndpoint: pending.identity.authServer.revoke } : {}),
		pds: pending.identity.pds,
	};
}

export async function blueskyRefresh(f: typeof fetch, client: BlueskyClient, tokens: TokenSet): Promise<TokenSet> {
	if (!tokens.refreshToken || !tokens.dpopJwk || !tokens.authServer || !tokens.tokenEndpoint) throw new NetworkError('Bluesky: session cannot be refreshed', 'auth');
	const t = await tokenRequest(f, client, tokens.dpopJwk, { issuer: tokens.authServer, token: tokens.tokenEndpoint }, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
	return { ...tokens, accessToken: t.accessToken, refreshToken: t.refreshToken ?? tokens.refreshToken, expiresAt: t.expiresAt, scope: t.scope ?? tokens.scope };
}

function utf8Facet(text: string, uri: string) {
	const at = text.lastIndexOf(uri);
	if (at < 0) return [];
	const byteStart = enc.encode(text.slice(0, at)).byteLength;
	return [{ index: { byteStart, byteEnd: byteStart + enc.encode(uri).byteLength }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] }];
}

async function uploadBlob(ctx: AdapterContext, nonces: Map<string, string>, bytes: Uint8Array, type: string): Promise<unknown> {
	const { pds, dpopJwk, accessToken } = ctx.tokens;
	const res = await dpopFetch(ctx.fetch, dpopJwk!, nonces, `${pds}/xrpc/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { 'Content-Type': type }, body: bytes }, 'upload', accessToken);
	if (!res.ok) throw await failure('Bluesky', res, 'upload');
	return ((await res.json()) as { blob: unknown }).blob;
}

export const blueskyAdapter: Adapter = {
	network: 'bluesky',
	async publish(ctx, post): Promise<PostResult> {
		const { pds, dpopJwk, accessToken } = ctx.tokens;
		if (!pds || !dpopJwk || !accessToken) throw new NetworkError('Bluesky: not connected', 'auth');
		const nonces = new Map<string, string>();
		const record: Record<string, unknown> = {
			$type: 'app.bsky.feed.post',
			text: post.text,
			createdAt: new Date().toISOString(),
			langs: [post.lang],
		};
		if (post.link) {
			const facets = utf8Facet(post.text, post.link);
			if (facets.length) record.facets = facets;
		}
		if (post.video) {
			const file = await download(ctx.fetch, post.video.url, 100 * 1024 * 1024, 'Bluesky');
			const blob = await uploadBlob(ctx, nonces, file.bytes, 'video/mp4');
			record.embed = {
				$type: 'app.bsky.embed.video',
				video: blob,
				...(post.video.width && post.video.height ? { aspectRatio: { width: post.video.width, height: post.video.height } } : {}),
			};
		} else if (post.link && post.card) {
			let thumb: unknown;
			if (post.card.imageUrl) {
				try {
					// Our share image, scaled so it fits Bluesky's 1 MB blob limit
					const src = post.card.imageUrl.includes('/thumb/') ? `${post.card.imageUrl}${post.card.imageUrl.includes('?') ? '&' : '?'}w=640` : post.card.imageUrl;
					const img = await download(ctx.fetch, src, 1_000_000, 'Bluesky');
					thumb = await uploadBlob(ctx, nonces, img.bytes, img.type.startsWith('image/') ? img.type : 'image/jpeg');
				} catch (error) {
					if (error instanceof NetworkError && error.kind === 'auth') throw error;
					thumb = undefined;
				}
			}
			record.embed = { $type: 'app.bsky.embed.external', external: { uri: post.link, title: post.card.title.slice(0, 300), description: (post.card.description ?? '').slice(0, 1000), ...(thumb ? { thumb } : {}) } };
		}
		const res = await dpopFetch(
			ctx.fetch,
			dpopJwk,
			nonces,
			`${pds}/xrpc/com.atproto.repo.createRecord`,
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: ctx.account.remoteId, collection: 'app.bsky.feed.post', record }) },
			'post',
			accessToken,
		);
		if (!res.ok) throw await failure('Bluesky', res, 'post');
		const { uri } = (await res.json()) as { uri: string };
		const rkey = uri.split('/').pop() ?? '';
		return { remoteId: uri, url: `https://bsky.app/profile/${encodeURIComponent(ctx.account.handle || ctx.account.remoteId)}/post/${encodeURIComponent(rkey)}` };
	},
};

export async function blueskyRevoke(f: typeof fetch, client: BlueskyClient, tokens: TokenSet): Promise<void> {
	const revokeEndpoint = tokens.revocationEndpoint;
	if (!revokeEndpoint || !tokens.refreshToken || !tokens.dpopJwk || !tokens.authServer) return;
	const body = new URLSearchParams({
		token: tokens.refreshToken,
		client_id: client.clientId,
		client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
		client_assertion: await clientAssertion(client, tokens.authServer),
	});
	await dpopFetch(f, tokens.dpopJwk, new Map(), revokeEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, 'revoke');
}
