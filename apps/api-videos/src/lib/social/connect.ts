/**
 * Connecting and disconnecting accounts (spec §5): OAuth for X, Bluesky and Mastodon, a one-time code for
 * Telegram. The OAuth state is single use, bound to the person and the channel, and lives 10 minutes; its PKCE
 * verifier (and Bluesky's DPoP key) is stored encrypted. Nothing is stored as a connection until the network
 * has confirmed who signed in, and the signed-in person who started the flow has confirmed it in Studio (the
 * callback alone links nothing, so a link someone else sends you can't attach their account to your channel).
 */
import type { SocialLanguage, SocialNetwork } from '@al-ummah/shared-types';
import { openJson, pkceChallenge, randomToken, sealJson } from './crypto';
import { audit, changes, deleteAccount, readAccount, socialDb, SocialError, upsertAccount, type AccountRow } from './store';
import { apiOrigin, blueskyClient, callbackPath, readCredentials, writeCredentials, type SocialEnv } from './platform';
import { webOrigin } from './content';
import { NetworkError, type TokenSet } from './adapters/types';
import { xAuthorizeUrl, xExchangeCode, xMe, xRevoke } from './adapters/x';
import { mastodonCharLimit } from './limits';
import { mastodonAuthorizeUrl, mastodonExchange, mastodonRegisterApp, mastodonRevoke, mastodonVerify, normalizeInstance } from './adapters/mastodon';
import { blueskyFinish, blueskyRevoke, blueskyStart, normalizeHandle, resolveBluesky, type BlueskyPending } from './adapters/bluesky';
import { tgCall, tgGetMe, tgSetWebhook } from './adapters/telegram';
import { logger } from '../logger';

const OAUTH_TTL_MS = 10 * 60_000;
const TELEGRAM_CODE_TTL_MS = 30 * 60_000;
const CONFIRM_TTL_MS = 10 * 60_000;

interface PendingRow {
	id: string;
	/** oauth: waiting for the network; confirm: tokens back, waiting for the person in Studio; telegram: a code */
	kind: 'oauth' | 'confirm' | 'telegram';
	channel_id: string;
	user_id: string;
	network: SocialNetwork;
	language: SocialLanguage;
	data_ciphertext: string | null;
	expires_at: number;
}

interface OAuthPendingData {
	verifier?: string;
	redirectUri: string;
	instance?: string;
	bluesky?: BlueskyPending;
	returnLang: SocialLanguage;
}

interface ConfirmPendingData {
	tokens: TokenSet;
	identity: { remoteId: string; handle: string; displayName: string; instance?: string };
}

const pendingBound = (id: string) => `pending:${id}`;

async function putPending(env: SocialEnv, row: Omit<PendingRow, 'data_ciphertext'>, data: unknown): Promise<void> {
	const db = socialDb(env);
	await db.prepare('DELETE FROM social_pending WHERE expires_at < ?').bind(Date.now()).run();
	await db
		.prepare('INSERT INTO social_pending (id, kind, channel_id, user_id, network, language, data_ciphertext, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(row.id, row.kind, row.channel_id, row.user_id, row.network, row.language, data === undefined ? null : await sealJson(env, data, pendingBound(row.id)), row.expires_at)
		.run();
}

/** Reads and deletes a pending row (single use). With `owner`, only that person's row for that channel matches. */
async function takePending(env: SocialEnv, id: string, kind: PendingRow['kind'], owner?: { userId: string; channelId: string }): Promise<PendingRow | null> {
	const db = socialDb(env);
	const row = owner
		? await db.prepare('SELECT * FROM social_pending WHERE id = ? AND kind = ? AND user_id = ? AND channel_id = ?').bind(id, kind, owner.userId, owner.channelId).first<PendingRow>()
		: await db.prepare('SELECT * FROM social_pending WHERE id = ? AND kind = ?').bind(id, kind).first<PendingRow>();
	if (!row) return null;
	const r = await db.prepare('DELETE FROM social_pending WHERE id = ?').bind(id).run();
	if (!changes(r)) return null;
	return row.expires_at < Date.now() ? null : row;
}

export interface ConnectStart {
	network: SocialNetwork;
	channelId: string;
	userId: string;
	language: SocialLanguage;
	/** Studio's language, for the page the person comes back to */
	returnLang: SocialLanguage;
	/** Bluesky handle */
	handle?: string;
	/** Mastodon instance */
	instance?: string;
}

export type ConnectStartResult = { kind: 'redirect'; authorizeUrl: string } | { kind: 'telegram'; code: string; botUsername: string; expiresAt: string };

export async function startConnect(env: SocialEnv, s: ConnectStart, fetchImpl: typeof fetch = fetch): Promise<ConnectStartResult> {
	const state = randomToken(32);
	const redirectUri = `${apiOrigin(env)}${callbackPath(s.network)}`;
	const base = { id: state, kind: 'oauth' as const, channel_id: s.channelId, user_id: s.userId, network: s.network, language: s.language, expires_at: Date.now() + OAUTH_TTL_MS };

	switch (s.network) {
		case 'x': {
			const creds = await readCredentials(env, 'x');
			if (!creds?.clientId) throw new SocialError(503, 'network_not_configured');
			const verifier = randomToken(48);
			await putPending(env, base, { verifier, redirectUri, returnLang: s.returnLang } satisfies OAuthPendingData);
			return { kind: 'redirect', authorizeUrl: xAuthorizeUrl(creds, redirectUri, state, await pkceChallenge(verifier)) };
		}
		case 'mastodon': {
			const instance = normalizeInstance(s.instance ?? '');
			if (!instance) throw new SocialError(400, 'invalid_instance');
			const app = await mastodonApp(env, instance, redirectUri, fetchImpl);
			const verifier = randomToken(48);
			await putPending(env, base, { verifier, redirectUri, instance, returnLang: s.returnLang } satisfies OAuthPendingData);
			return { kind: 'redirect', authorizeUrl: mastodonAuthorizeUrl(instance, app.clientId, redirectUri, state, await pkceChallenge(verifier)) };
		}
		case 'bluesky': {
			const handle = normalizeHandle(s.handle ?? '');
			if (!handle) throw new SocialError(400, 'invalid_handle');
			const client = await blueskyClient(env);
			let started;
			try {
				started = await blueskyStart(fetchImpl, client, await resolveBluesky(fetchImpl, handle), state);
			} catch (error) {
				throw networkToSocial(error);
			}
			await putPending(env, base, { redirectUri, bluesky: started.pending, returnLang: s.returnLang } satisfies OAuthPendingData);
			return { kind: 'redirect', authorizeUrl: started.authorizeUrl };
		}
		case 'telegram': {
			const creds = await readCredentials(env, 'telegram');
			if (!creds?.botToken) throw new SocialError(503, 'network_not_configured');
			const ready = await ensureTelegramWebhook(env, fetchImpl);
			const code = telegramCode();
			const expiresAt = Date.now() + TELEGRAM_CODE_TTL_MS;
			await putPending(env, { ...base, id: code, kind: 'telegram', expires_at: expiresAt }, undefined);
			return { kind: 'telegram', code, botUsername: ready.botUsername, expiresAt: new Date(expiresAt).toISOString() };
		}
	}
}

function networkToSocial(error: unknown): SocialError {
	if (error instanceof SocialError) return error;
	if (error instanceof NetworkError) return new SocialError(error.kind === 'retry' ? 502 : 422, error.kind === 'retry' ? 'network_unavailable' : 'network_refused', error.message);
	return new SocialError(502, 'network_unavailable', error instanceof Error ? error.message : String(error));
}

async function mastodonApp(env: SocialEnv, instance: string, redirectUri: string, f: typeof fetch): Promise<{ clientId: string; clientSecret: string }> {
	const db = socialDb(env);
	const row = await db.prepare('SELECT client_id, client_secret_ciphertext FROM social_instance_apps WHERE instance = ?').bind(instance).first<{ client_id: string; client_secret_ciphertext: string }>();
	if (row) return { clientId: row.client_id, clientSecret: await openJson<string>(env, row.client_secret_ciphertext, `instance:${instance}`) };
	let app;
	try {
		app = await mastodonRegisterApp(f, instance, redirectUri, webOrigin(env));
	} catch (error) {
		throw networkToSocial(error);
	}
	await db
		.prepare('INSERT INTO social_instance_apps (instance, client_id, client_secret_ciphertext, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (instance) DO NOTHING')
		.bind(instance, app.clientId, await sealJson(env, app.clientSecret, `instance:${instance}`), Date.now())
		.run();
	return mastodonApp(env, instance, redirectUri, f);
}

export const tokenBound = (accountId: string) => `account:${accountId}:tokens`;

/** Where the browser goes after a callback: the channel's Social page in Studio, with the outcome. */
export function studioReturnUrl(env: SocialEnv, lang: SocialLanguage, channelId: string | null, outcome: { connected?: SocialNetwork; confirm?: string; error?: string }): string {
	const u = new URL(channelId ? `${webOrigin(env)}/${lang}/studio/${encodeURIComponent(channelId)}/social` : `${webOrigin(env)}/${lang}/studio`);
	if (outcome.connected) u.searchParams.set('connected', outcome.connected);
	if (outcome.confirm) u.searchParams.set('confirm', outcome.confirm);
	if (outcome.error) u.searchParams.set('error', outcome.error);
	return u.toString();
}

export interface CallbackResult {
	channelId: string | null;
	lang: SocialLanguage;
	/** The id Studio sends back to confirm the connection (POST /channel/:id/connect/confirm) */
	confirm?: string;
	error?: string;
}

/**
 * The network sent the person back. `currentUserId` is whoever is signed in on api-videos for this request, when
 * known; the state already binds the person, so a callback opened in another browser still completes only the
 * connection that person started.
 */
export async function finishOAuth(
	env: SocialEnv,
	network: SocialNetwork,
	params: URLSearchParams,
	canStillConnect: (userId: string, channelId: string) => Promise<boolean>,
	fetchImpl: typeof fetch = fetch,
): Promise<CallbackResult> {
	const state = params.get('state') ?? '';
	const pending = state ? await takePending(env, state, 'oauth') : null;
	if (!pending || pending.network !== network) return { channelId: null, lang: 'en', error: 'expired' };
	const data = await openJson<OAuthPendingData>(env, pending.data_ciphertext!, pendingBound(pending.id));
	const lang = data.returnLang;
	const fail = (error: string): CallbackResult => ({ channelId: pending.channel_id, lang, error });
	if (params.get('error')) return fail(params.get('error') === 'access_denied' ? 'denied' : 'network_refused');
	const code = params.get('code');
	if (!code) return fail('network_refused');
	if (!(await canStillConnect(pending.user_id, pending.channel_id))) return fail('forbidden');

	try {
		let tokens: TokenSet;
		let identity: { remoteId: string; handle: string; displayName: string; instance?: string };
		if (network === 'x') {
			const creds = await readCredentials(env, 'x');
			if (!creds) return fail('network_not_configured');
			tokens = await xExchangeCode(fetchImpl, creds, code, data.verifier!, data.redirectUri);
			const me = await xMe(fetchImpl, tokens.accessToken!);
			identity = { remoteId: me.id, handle: me.username, displayName: me.name };
		} else if (network === 'mastodon') {
			const app = await mastodonApp(env, data.instance!, data.redirectUri, fetchImpl);
			tokens = await mastodonExchange(fetchImpl, data.instance!, app, code, data.verifier!, data.redirectUri);
			const me = await mastodonVerify(fetchImpl, data.instance!, tokens.accessToken!);
			identity = { remoteId: me.id, handle: `${me.username}@${data.instance}`, displayName: me.display_name || me.username, instance: data.instance };
			// The instance's own character limit, for posts and Studio's preview (#1593); never blocks connecting
			await mastodonCharLimit(env, data.instance, fetchImpl).catch(() => null);
		} else if (network === 'bluesky') {
			const client = await blueskyClient(env);
			const b = data.bluesky!;
			tokens = await blueskyFinish(fetchImpl, client, b, code, params.get('iss'));
			identity = { remoteId: b.identity.did, handle: b.identity.handle, displayName: b.identity.handle, instance: b.identity.pds };
		} else {
			return fail('network_refused');
		}
		// Nothing is linked yet: the tokens wait, sealed, for the person who started this to confirm in Studio
		const confirm = randomToken(24);
		await putPending(
			env,
			{ id: confirm, kind: 'confirm', channel_id: pending.channel_id, user_id: pending.user_id, network, language: pending.language, expires_at: Date.now() + CONFIRM_TTL_MS },
			{ tokens, identity } satisfies ConfirmPendingData,
		);
		return { channelId: pending.channel_id, lang, confirm };
	} catch (error) {
		logger.warn('[Social] Connect failed', { network, channelId: pending.channel_id, error: error instanceof Error ? error.message : String(error) });
		return fail(error instanceof NetworkError && error.kind === 'retry' ? 'network_unavailable' : 'network_refused');
	}
}

/**
 * Studio confirms a connection the network sent back. Only the signed-in person who started the flow, on the same
 * channel, can; anyone else's confirm id simply isn't found. Single use.
 */
export async function confirmConnect(
	env: SocialEnv,
	confirmId: string,
	who: { userId: string; channelId: string },
): Promise<AccountRow> {
	const pending = confirmId ? await takePending(env, confirmId, 'confirm', who) : null;
	if (!pending) throw new SocialError(404, 'connect_expired');
	const { tokens, identity } = await openJson<ConfirmPendingData>(env, pending.data_ciphertext!, pendingBound(pending.id));
	// Sealed against a placeholder first, then re-sealed against the row id once we know it
	const account = await upsertAccount(env, {
		channelId: pending.channel_id,
		network: pending.network,
		remoteId: identity.remoteId,
		handle: identity.handle,
		displayName: identity.displayName,
		instance: identity.instance ?? null,
		language: pending.language,
		tokenCiphertext: await sealJson(env, tokens, `pending-${pending.id}`),
		tokenExpiresAt: tokens.expiresAt ?? null,
		connectedBy: pending.user_id,
	});
	await socialDb(env)
		.prepare('UPDATE social_accounts SET token_ciphertext = ? WHERE id = ?')
		.bind(await sealJson(env, tokens, tokenBound(account.id)), account.id)
		.run();
	await audit(env, pending.channel_id, pending.user_id, 'account.connect', account.id, { network: pending.network, handle: identity.handle });
	return account;
}

// --- Telegram ------------------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `AUN-XXXX-XXXX`, no look-alike letters. */
export function telegramCode(): string {
	const b = crypto.getRandomValues(new Uint8Array(8));
	// 32 letters, so the low 5 bits pick one evenly
	const chars = [...b].map((x) => CODE_ALPHABET[x & 31]).join('');
	return `AUN-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

const CODE_IN_TEXT = /\bAUN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\b/;

/** The Telegram webhook (registered once per bot and URL; the secret header proves a call is Telegram's). */
export async function ensureTelegramWebhook(env: SocialEnv, f: typeof fetch = fetch): Promise<{ botUsername: string; secret: string }> {
	const creds = await readCredentials(env, 'telegram');
	if (!creds?.botToken) throw new SocialError(503, 'network_not_configured');
	const url = `${apiOrigin(env)}/api/social/webhooks/telegram`;
	if (creds.webhookSecret && creds.webhookUrl === url && creds.botUsername) return { botUsername: creds.botUsername, secret: creds.webhookSecret };
	try {
		const me = await tgGetMe(f, creds.botToken);
		const secret = randomToken(32);
		await tgSetWebhook(f, creds.botToken, url, secret);
		await writeCredentials(env, 'telegram', { ...creds, botUsername: me.username, webhookSecret: secret, webhookUrl: url }, 'system');
		return { botUsername: me.username, secret };
	} catch (error) {
		throw networkToSocial(error);
	}
}

interface TgChat {
	id: number;
	type: string;
	title?: string;
	username?: string;
}
interface TgUpdate {
	update_id: number;
	channel_post?: { message_id: number; chat: TgChat; text?: string };
	message?: { message_id: number; chat: TgChat; text?: string; from?: { id: number; is_bot?: boolean } };
	my_chat_member?: { chat: TgChat; new_chat_member: { status: string; can_post_messages?: boolean } };
}

/**
 * A Telegram update. A post containing a pending code connects that chat to the channel that asked for it (after
 * checking that the bot may post there); the bot losing its admin rights marks the chat's connections revoked.
 */
export async function handleTelegramUpdate(env: SocialEnv, update: TgUpdate, f: typeof fetch = fetch): Promise<{ connected?: string; revoked?: number }> {
	const creds = await readCredentials(env, 'telegram');
	if (!creds?.botToken) return {};
	const db = socialDb(env);

	if (update.my_chat_member) {
		const { chat, new_chat_member: m } = update.my_chat_member;
		const lost = ['left', 'kicked'].includes(m.status) || (m.status === 'administrator' && chat.type === 'channel' && m.can_post_messages === false) || m.status === 'restricted';
		if (lost) {
			const r = await db
				.prepare(`UPDATE social_accounts SET status = 'revoked', status_reason = 'bot_removed', updated_at = ? WHERE network = 'telegram' AND remote_id = ? AND status = 'active'`)
				.bind(Date.now(), String(chat.id))
				.run();
			return { revoked: changes(r) };
		}
		return {};
	}

	const msg = update.channel_post ?? update.message;
	const code = msg?.text?.match(CODE_IN_TEXT)?.[0];
	if (!msg || !code) return {};
	const pending = await takePending(env, code, 'telegram');
	if (!pending) return {};
	const chat = msg.chat;
	try {
		const me = await tgGetMe(f, creds.botToken);
		const member = await tgCall<{ status: string; can_post_messages?: boolean }>(f, creds.botToken, 'getChatMember', { chat_id: chat.id, user_id: me.id });
		let canPost = member.status === 'administrator' && (chat.type !== 'channel' || member.can_post_messages !== false);
		// In a group, anyone can post a message: the code only counts from one of the group's admins. (In a
		// channel only its admins can post at all.)
		if (canPost && !update.channel_post) {
			const sender = update.message?.from;
			const role = sender ? await tgCall<{ status: string }>(f, creds.botToken, 'getChatMember', { chat_id: chat.id, user_id: sender.id }) : null;
			canPost = !!role && ['creator', 'administrator'].includes(role.status);
		}
		// Without the right to post, the code stays usable: Studio's steps say to make the bot an admin and post it again
		if (!canPost) {
			await putPending(env, { id: pending.id, kind: 'telegram', channel_id: pending.channel_id, user_id: pending.user_id, network: 'telegram', language: pending.language, expires_at: pending.expires_at }, undefined);
			return {};
		}
		// The code was for us only: remove it from the chat
		await tgCall(f, creds.botToken, 'deleteMessage', { chat_id: chat.id, message_id: msg.message_id }).catch(() => undefined);
	} catch (error) {
		logger.warn('[Social] Telegram link check failed', { error: error instanceof Error ? error.message : String(error) });
		return {};
	}
	const account = await upsertAccount(env, {
		channelId: pending.channel_id,
		network: 'telegram',
		remoteId: String(chat.id),
		handle: chat.username ?? '',
		displayName: chat.title ?? chat.username ?? String(chat.id),
		instance: null,
		language: pending.language,
		tokenCiphertext: null,
		tokenExpiresAt: null,
		connectedBy: pending.user_id,
	});
	await audit(env, pending.channel_id, pending.user_id, 'account.connect', account.id, { network: 'telegram', chat: chat.username ?? String(chat.id) });
	return { connected: account.id };
}

/** Whether a Telegram code is still waiting (Studio polls while the person posts it). */
export async function telegramCodePending(env: SocialEnv, code: string, channelId: string): Promise<boolean> {
	const row = await socialDb(env).prepare('SELECT expires_at FROM social_pending WHERE id = ? AND kind = ? AND channel_id = ?').bind(code, 'telegram', channelId).first<{ expires_at: number }>();
	return !!row && row.expires_at > Date.now();
}

// --- Disconnect ----------------------------------------------------------------------------------

/** Revokes at the network (best effort, never blocks) and removes the connection and its tokens. */
export async function disconnect(env: SocialEnv, accountId: string, actorId: string, f: typeof fetch = fetch): Promise<void> {
	const account = await readAccount(env, accountId);
	if (!account) throw new SocialError(404, 'account_not_found');
	try {
		const tokens = account.token_ciphertext ? await openJson<TokenSet>(env, account.token_ciphertext, tokenBound(account.id)) : null;
		if (account.network === 'x' && tokens?.accessToken) {
			const creds = await readCredentials(env, 'x');
			if (creds) await xRevoke(f, creds, tokens.accessToken);
		} else if (account.network === 'mastodon' && tokens?.accessToken && account.instance) {
			await mastodonRevoke(f, account.instance, await mastodonApp(env, account.instance, `${apiOrigin(env)}${callbackPath('mastodon')}`, f), tokens.accessToken);
		} else if (account.network === 'bluesky' && tokens) {
			await blueskyRevoke(f, await blueskyClient(env), tokens);
		} else if (account.network === 'telegram') {
			const creds = await readCredentials(env, 'telegram');
			const others = await socialDb(env).prepare(`SELECT COUNT(*) AS n FROM social_accounts WHERE network = 'telegram' AND remote_id = ? AND id != ?`).bind(account.remote_id, account.id).first<{ n: number }>();
			// The bot leaves only when no other channel posts to this chat
			if (creds?.botToken && !others?.n) await tgCall(f, creds.botToken, 'leaveChat', { chat_id: account.remote_id });
		}
	} catch (error) {
		logger.warn('[Social] Revoke at the network failed; disconnecting anyway', { accountId, network: account.network, error: error instanceof Error ? error.message : String(error) });
	}
	await deleteAccount(env, accountId);
	await audit(env, account.channel_id, actorId, 'account.disconnect', accountId, { network: account.network, handle: account.handle });
}

/** Erasure hook (account deletion, admin erasure, run-user sweep): a deleted channel's social rows go too. Never throws. */
export async function eraseChannelSocial(env: unknown, channelId: string, actorId = 'system'): Promise<void> {
	try {
		await disconnectChannel(env as SocialEnv, channelId, actorId);
	} catch (error) {
		logger.warn('[Social] Could not erase a deleted channel\'s social rows', { channelId, error: error instanceof Error ? error.message : String(error) });
	}
}

/** Every connection of a channel and all its social rows (channel deleted or purged). */
export async function disconnectChannel(env: SocialEnv, channelId: string, actorId: string, f: typeof fetch = fetch): Promise<number> {
	// A worker without the search database has no social rows to erase
	if (!env.SEARCH_DB) return 0;
	const { results } = await socialDb(env).prepare('SELECT id FROM social_accounts WHERE channel_id = ?').bind(channelId).all<{ id: string }>();
	for (const r of results ?? []) await disconnect(env, r.id, actorId, f);
	// The channel is gone: nothing of its social setup or history stays (posts, webhooks, codes, audit)
	const db = socialDb(env);
	await db.batch(
		['social_deliveries', 'social_templates', 'social_webhook_deliveries', 'social_webhooks', 'social_pending', 'social_audit'].map((table) =>
			db.prepare(`DELETE FROM ${table} WHERE channel_id = ?`).bind(channelId),
		),
	);
	return results?.length ?? 0;
}
