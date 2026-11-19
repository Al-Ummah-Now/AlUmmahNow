/**
 * Mastodon (spec §5.5, §6.3): an app registered per instance on first use, OAuth with PKCE, tokens that don't
 * expire. Statuses carry an Idempotency-Key (the delivery id), so a retried post is not doubled. Video goes
 * through /api/v2/media (processed asynchronously; we wait for it).
 */
import { SOCIAL_NETWORK_RULES } from '@al-ummah/shared-types';
import { call, download, failure, NetworkError, type Adapter, type PostResult, type TokenSet } from './types';

export const MASTODON_SCOPES = 'read:accounts write:statuses write:media';

/** An instance host the person typed: a public DNS name, no scheme, path, port or IP. */
export function normalizeInstance(input: string): string | null {
	let host = input.trim().toLowerCase();
	host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
	if (host.startsWith('@')) host = host.split('@').pop() ?? '';
	if (host.includes('@')) host = host.split('@').pop() ?? '';
	if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) return null;
	if (/^\d+(\.\d+){3}$/.test(host) || /\.(local|localhost|internal|lan|arpa)$/.test(host)) return null;
	if (host === 'alummahnow.net' || host.endsWith('.alummahnow.net')) return null;
	return host;
}

export async function mastodonRegisterApp(f: typeof fetch, instance: string, redirectUri: string, website: string): Promise<{ clientId: string; clientSecret: string }> {
	const res = await call(
		f,
		`https://${instance}/api/v1/apps`,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Al Ummah Now', redirect_uris: redirectUri, scopes: MASTODON_SCOPES, website }) },
		'Mastodon',
		'app registration',
	);
	if (!res.ok) throw await failure('Mastodon', res, 'app registration');
	const j = (await res.json()) as { client_id: string; client_secret: string };
	return { clientId: j.client_id, clientSecret: j.client_secret };
}

export function mastodonAuthorizeUrl(instance: string, clientId: string, redirectUri: string, state: string, challenge: string): string {
	const u = new URL(`https://${instance}/oauth/authorize`);
	u.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: MASTODON_SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
	return u.toString();
}

export async function mastodonExchange(f: typeof fetch, instance: string, app: { clientId: string; clientSecret: string }, code: string, verifier: string, redirectUri: string): Promise<TokenSet> {
	const res = await call(
		f,
		`https://${instance}/oauth/token`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, code_verifier: verifier, scope: MASTODON_SCOPES }).toString(),
		},
		'Mastodon',
		'token',
	);
	if (!res.ok) throw await failure('Mastodon', res, 'token');
	const j = (await res.json()) as { access_token: string; scope?: string };
	return { accessToken: j.access_token, scope: j.scope, instance, expiresAt: null };
}

export async function mastodonVerify(f: typeof fetch, instance: string, token: string): Promise<{ id: string; username: string; acct: string; display_name: string }> {
	const res = await call(f, `https://${instance}/api/v1/accounts/verify_credentials`, { headers: { Authorization: `Bearer ${token}` } }, 'Mastodon', 'verify credentials');
	if (!res.ok) throw await failure('Mastodon', res, 'verify credentials');
	return (await res.json()) as { id: string; username: string; acct: string; display_name: string };
}

/** The instance's own limits (GET /api/v2/instance); maxChars is null when the instance doesn't say or can't be read. */
export async function mastodonInstanceLimits(f: typeof fetch, instance: string): Promise<{ maxChars: number | null; videoBytes: number }> {
	const fallback = { maxChars: null, videoBytes: SOCIAL_NETWORK_RULES.mastodon.maxVideoBytes };
	try {
		const res = await f(`https://${instance}/api/v2/instance`, { headers: { Accept: 'application/json' } });
		if (!res.ok) return fallback;
		const j = (await res.json()) as { configuration?: { statuses?: { max_characters?: number }; media_attachments?: { video_size_limit?: number } } };
		const max = Number(j.configuration?.statuses?.max_characters);
		return {
			maxChars: Number.isFinite(max) && max > 0 ? Math.floor(max) : null,
			videoBytes: j.configuration?.media_attachments?.video_size_limit || fallback.videoBytes,
		};
	} catch {
		return fallback;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mastodonAdapter: Adapter = {
	network: 'mastodon',
	async publish(ctx, post): Promise<PostResult> {
		const instance = ctx.tokens.instance || ctx.account.instance;
		const token = ctx.tokens.accessToken;
		if (!instance || !token) throw new NetworkError('Mastodon: not connected', 'auth');
		const auth = { Authorization: `Bearer ${token}` };
		const mediaIds: string[] = [];
		if (post.video) {
			const limits = await mastodonInstanceLimits(ctx.fetch, instance);
			const file = await download(ctx.fetch, post.video.url, limits.videoBytes, 'Mastodon');
			const form = new FormData();
			form.append('file', new Blob([file.bytes], { type: 'video/mp4' }), 'video.mp4');
			const up = await call(ctx.fetch, `https://${instance}/api/v2/media`, { method: 'POST', headers: auth, body: form }, 'Mastodon', 'media upload');
			if (!up.ok) throw await failure('Mastodon', up, 'media upload');
			let media = (await up.json()) as { id: string; url: string | null };
			const deadline = Date.now() + 5 * 60_000;
			while (up.status === 202 && !media.url) {
				if (Date.now() > deadline) throw new NetworkError('Mastodon media processing took too long', 'retry', 120);
				await sleep(3000);
				const st = await call(ctx.fetch, `https://${instance}/api/v1/media/${encodeURIComponent(media.id)}`, { headers: auth }, 'Mastodon', 'media status');
				if (st.status === 206) continue;
				if (!st.ok) throw await failure('Mastodon', st, 'media status');
				media = (await st.json()) as typeof media;
			}
			mediaIds.push(media.id);
		}
		const res = await call(
			ctx.fetch,
			`https://${instance}/api/v1/statuses`,
			{
				method: 'POST',
				headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': post.idempotencyKey },
				body: JSON.stringify({ status: post.text, language: post.lang, visibility: 'public', ...(mediaIds.length ? { media_ids: mediaIds } : {}) }),
			},
			'Mastodon',
			'post',
		);
		if (!res.ok) throw await failure('Mastodon', res, 'post');
		const j = (await res.json()) as { id: string; url?: string };
		return { remoteId: j.id, ...(j.url ? { url: j.url } : {}) };
	},
};

export async function mastodonRevoke(f: typeof fetch, instance: string, app: { clientId: string; clientSecret: string }, token: string): Promise<void> {
	await f(`https://${instance}/oauth/revoke`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, token }).toString(),
	});
}
