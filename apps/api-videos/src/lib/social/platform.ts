/**
 * Platform side of social: the environment's origins, the platform credentials an admin enters in the videos
 * admin (X app, Telegram bot), stored encrypted in social_settings, and our Bluesky client key.
 *
 * Credentials live in D1 (encrypted with SOCIAL_TOKEN_KEK) rather than as Worker secrets so that the owner can
 * create the X app and the Telegram bot and switch them on without a deploy, and replace them the same way.
 */
import { webhookUrlProblem, type ErrorReporterEnv, type SocialNetwork } from '@al-ummah/shared-types';
import { openJson, sealJson, socialCryptoReady, type SocialCryptoEnv } from './crypto';
import { deleteSetting, readSetting, writeSetting, type SocialDbEnv } from './store';
import type { SocialContentEnv } from './content';
import { generateEs256, publicOf, type BlueskyClient } from './adapters/bluesky';
import type { XCredentials } from './adapters/x';
import type { TelegramCredentials } from './adapters/telegram';

export interface SocialEnv extends SocialDbEnv, SocialCryptoEnv, SocialContentEnv, ErrorReporterEnv {
	queue?: { send(message: unknown, options?: { delaySeconds?: number }): Promise<unknown> };
	/** This API's public origin (OAuth callbacks, Bluesky client metadata, Telegram webhook) */
	VIDEOS_API_URL?: string;
	/** Local stack / tests: webhook receiver hosts allowed although not public https */
	SOCIAL_WEBHOOK_ALLOW_HOSTS?: string;
	ENVIRONMENT?: string;
}

export function socialWebhookUrlProblem(env: SocialEnv, raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return 'invalid_url';
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'https_required';
	if (url.username || url.password) return 'credentials_not_allowed';
	if (raw.length > 2000) return 'too_long';
	url.hostname = url.hostname.replace(/\.$/, '');
	const allowed = (env.SOCIAL_WEBHOOK_ALLOW_HOSTS ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
	return webhookUrlProblem(url.toString(), allowed);
}

export function apiOrigin(env: Pick<SocialEnv, 'VIDEOS_API_URL'>, fallback?: string): string {
	return (env.VIDEOS_API_URL || fallback || 'https://videos.api.alummahnow.net').replace(/\/+$/, '');
}

export const callbackPath = (network: SocialNetwork) => `/api/social/oauth/${network}/callback`;

export type CredentialNetwork = 'x' | 'telegram';

interface CredentialMap {
	x: XCredentials;
	telegram: TelegramCredentials & { webhookSecret?: string; webhookUrl?: string };
}

const credKey = (n: CredentialNetwork) => `credentials:${n}`;

export async function readCredentials<N extends CredentialNetwork>(env: SocialEnv, network: N): Promise<CredentialMap[N] | null> {
	const stored = await readSetting(env, credKey(network));
	if (!stored) return null;
	try {
		return await openJson<CredentialMap[N]>(env, stored, credKey(network));
	} catch {
		return null;
	}
}

export async function writeCredentials<N extends CredentialNetwork>(env: SocialEnv, network: N, value: CredentialMap[N], by: string): Promise<void> {
	await writeSetting(env, credKey(network), await sealJson(env, value, credKey(network)), by);
}

export async function clearCredentials(env: SocialEnv, network: CredentialNetwork): Promise<void> {
	await deleteSetting(env, credKey(network));
}

/** What each network still needs before channels can connect it (admin page, Studio's connect list). */
export async function networkReadiness(env: SocialEnv): Promise<Record<SocialNetwork, { configured: boolean; missing?: string }>> {
	const crypto = await socialCryptoReady(env);
	if (!crypto) {
		const missing = 'token_key';
		return { x: { configured: false, missing }, telegram: { configured: false, missing }, bluesky: { configured: false, missing }, mastodon: { configured: false, missing } };
	}
	const [x, tg] = await Promise.all([readCredentials(env, 'x'), readCredentials(env, 'telegram')]);
	return {
		x: x?.clientId && x.clientSecret ? { configured: true } : { configured: false, missing: 'x_app' },
		telegram: tg?.botToken ? { configured: true } : { configured: false, missing: 'telegram_bot' },
		bluesky: { configured: true },
		mastodon: { configured: true },
	};
}

const BLUESKY_KEY = 'bluesky:client-key';

/** Our Bluesky client: made once per environment (the key is generated on first use and kept encrypted). */
export async function blueskyClient(env: SocialEnv): Promise<BlueskyClient> {
	const origin = apiOrigin(env);
	let key: { privateJwk: JsonWebKey; kid: string } | null = null;
	const stored = await readSetting(env, BLUESKY_KEY);
	if (stored) key = await openJson(env, stored, BLUESKY_KEY);
	if (!key) {
		const pair = await generateEs256();
		key = { privateJwk: pair.privateJwk, kid: `aun-${Date.now().toString(36)}` };
		await writeSetting(env, BLUESKY_KEY, await sealJson(env, key, BLUESKY_KEY), 'system');
		// Another request may have made one at the same moment: everyone uses what is stored
		const again = await readSetting(env, BLUESKY_KEY);
		if (again) key = await openJson(env, again, BLUESKY_KEY);
	}
	return { clientId: `${origin}/api/social/bluesky/client-metadata.json`, redirectUri: `${origin}${callbackPath('bluesky')}`, key: key! };
}

export async function blueskyJwks(env: SocialEnv): Promise<{ keys: JsonWebKey[] }> {
	const client = await blueskyClient(env);
	return { keys: [{ ...publicOf(client.key.privateJwk), kid: client.key.kid, use: 'sig', alg: 'ES256' } as JsonWebKey] };
}
