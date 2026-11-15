/**
 * X (spec §5.3, §6.3): OAuth 2.0 with PKCE (confidential client), tokens 2 h with rotating refresh tokens,
 * posts through POST /2/tweets, video through the v2 chunked media upload (5 MB segments, then processing).
 * Pay-per-use: the caller reserves the cost against the admin's cap before calling publish.
 */
import { call, failure, NetworkError, type Adapter, type AdapterContext, type PostRequest, type PostResult, type TokenSet } from './types';

export const X_AUTHORIZE = 'https://x.com/i/oauth2/authorize';
export const X_API = 'https://api.x.com';
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];
const SEGMENT = 4 * 1024 * 1024;

export interface XCredentials {
	clientId: string;
	clientSecret: string;
}

export function xAuthorizeUrl(creds: XCredentials, redirectUri: string, state: string, challenge: string): string {
	const u = new URL(X_AUTHORIZE);
	u.search = new URLSearchParams({
		response_type: 'code',
		client_id: creds.clientId,
		redirect_uri: redirectUri,
		scope: X_SCOPES.join(' '),
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
	}).toString();
	return u.toString();
}

function basic(creds: XCredentials): string {
	return `Basic ${btoa(`${encodeURIComponent(creds.clientId)}:${encodeURIComponent(creds.clientSecret)}`)}`;
}

async function tokenCall(f: typeof fetch, creds: XCredentials, body: Record<string, string>): Promise<TokenSet> {
	const res = await call(
		f,
		`${X_API}/2/oauth2/token`,
		{ method: 'POST', headers: { Authorization: basic(creds), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, client_id: creds.clientId }).toString() },
		'X',
		'token',
	);
	if (!res.ok) {
		const err = await failure('X', res, 'token');
		// invalid_grant on refresh: the person revoked us or the refresh token was already used
		throw res.status === 400 && body.grant_type === 'refresh_token' ? new NetworkError(err.message, 'auth') : err;
	}
	const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
	return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : null, scope: j.scope };
}

export function xExchangeCode(f: typeof fetch, creds: XCredentials, code: string, verifier: string, redirectUri: string): Promise<TokenSet> {
	return tokenCall(f, creds, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
}

export function xRefresh(f: typeof fetch, creds: XCredentials, refreshToken: string): Promise<TokenSet> {
	return tokenCall(f, creds, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

export async function xMe(f: typeof fetch, accessToken: string): Promise<{ id: string; username: string; name: string }> {
	const res = await call(f, `${X_API}/2/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } }, 'X', 'users/me');
	if (!res.ok) throw await failure('X', res, 'users/me');
	const j = (await res.json()) as { data: { id: string; username: string; name: string } };
	return j.data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function uploadVideo(ctx: AdapterContext, token: string, video: NonNullable<PostRequest['video']>): Promise<string> {
	const f = ctx.fetch;
	const auth = { Authorization: `Bearer ${token}` };
	const src = await call(f, video.url, { method: 'GET' }, 'X', 'media download');
	if (!src.ok || !src.body) throw new NetworkError(`X media download: HTTP ${src.status}`, src.status >= 500 ? 'retry' : 'fatal');
	const total = video.bytes ?? Number(src.headers.get('content-length'));
	if (!Number.isFinite(total) || total <= 0) throw new NetworkError('X media: the video size is unknown', 'fatal');

	const init = await call(f, `${X_API}/2/media/upload/initialize`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ media_type: 'video/mp4', total_bytes: total, media_category: 'tweet_video' }) }, 'X', 'media initialize');
	if (!init.ok) throw await failure('X', init, 'media initialize');
	const id = ((await init.json()) as { data: { id: string } }).data.id;

	const reader = src.body.getReader();
	let pending: Uint8Array[] = [];
	let size = 0;
	let index = 0;
	const flush = async () => {
		if (!size) return;
		const chunk = new Uint8Array(size);
		let at = 0;
		for (const p of pending) {
			chunk.set(p, at);
			at += p.byteLength;
		}
		pending = [];
		size = 0;
		const form = new FormData();
		form.append('segment_index', String(index));
		form.append('media', new Blob([chunk], { type: 'application/octet-stream' }), 'media');
		const res = await call(f, `${X_API}/2/media/upload/${encodeURIComponent(id)}/append`, { method: 'POST', headers: auth, body: form }, 'X', 'media append');
		if (!res.ok) throw await failure('X', res, 'media append');
		index++;
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		pending.push(value);
		size += value.byteLength;
		if (size >= SEGMENT) await flush();
	}
	await flush();

	const fin = await call(f, `${X_API}/2/media/upload/${encodeURIComponent(id)}/finalize`, { method: 'POST', headers: auth }, 'X', 'media finalize');
	if (!fin.ok) throw await failure('X', fin, 'media finalize');
	let info = ((await fin.json()) as { data?: { processing_info?: { state: string; check_after_secs?: number; error?: { message?: string } } } }).data?.processing_info;
	const deadline = Date.now() + 5 * 60_000;
	while (info && info.state !== 'succeeded') {
		if (info.state === 'failed') throw new NetworkError(`X media processing failed${info.error?.message ? `: ${info.error.message}` : ''}`, 'fatal');
		if (Date.now() > deadline) throw new NetworkError('X media processing took too long', 'retry', 120);
		await sleep(Math.min(30, Math.max(1, info.check_after_secs ?? 5)) * 1000);
		const st = await call(f, `${X_API}/2/media/upload?media_id=${encodeURIComponent(id)}&command=STATUS`, { headers: auth }, 'X', 'media status');
		if (!st.ok) throw await failure('X', st, 'media status');
		info = ((await st.json()) as { data?: { processing_info?: typeof info } }).data?.processing_info;
	}
	return id;
}

export const xAdapter: Adapter = {
	network: 'x',
	async publish(ctx, post): Promise<PostResult> {
		const token = ctx.tokens.accessToken;
		if (!token) throw new NetworkError('X: not connected', 'auth');
		const body: Record<string, unknown> = { text: post.text };
		if (post.video) body.media = { media_ids: [await uploadVideo(ctx, token, post.video)] };
		const res = await call(ctx.fetch, `${X_API}/2/tweets`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 'X', 'post');
		if (!res.ok) throw await failure('X', res, 'post');
		const id = ((await res.json()) as { data: { id: string } }).data.id;
		return { remoteId: id, url: `https://x.com/${encodeURIComponent(ctx.account.handle.replace(/^@/, '') || 'i')}/status/${id}` };
	},
};

export async function xRevoke(f: typeof fetch, creds: XCredentials, token: string): Promise<void> {
	await f(`${X_API}/2/oauth2/revoke`, {
		method: 'POST',
		headers: { Authorization: basic(creds), 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ token, token_type_hint: 'access_token', client_id: creds.clientId }).toString(),
	});
}
