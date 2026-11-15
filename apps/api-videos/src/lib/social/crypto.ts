/**
 * Encryption at rest for social tokens, webhook secrets and platform credentials (wiki AUN-SOCIAL, spec §5.6).
 *
 * AES-256-GCM through WebCrypto. Key: SOCIAL_TOKEN_KEK (Secrets Store `social-token-kek[-qa|-stage]`),
 * `<version>:<base64 32 bytes>[,<version>:<base64>…]`. New values use the highest version; older versions stay
 * readable after a rotation (append a version, never replace).
 *
 * Every ciphertext is bound to where it is stored (additional data, e.g. `account:<id>:tokens`), so a value
 * copied to another row fails to decrypt. Stored form: `v<version>.<base64 iv>.<base64 ciphertext+tag>`.
 */
import { getSecret } from '../env-helpers';

export class SocialKeyError extends Error {}

interface Keys {
	current: { version: number; key: CryptoKey };
	byVersion: Map<number, CryptoKey>;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const cache = new Map<string, Promise<Keys>>();

export async function parseSocialKeys(secret: string | null | undefined): Promise<Keys> {
	const byVersion = new Map<number, CryptoKey>();
	for (const entry of (secret ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
		const match = /^(\d{1,4}):([A-Za-z0-9+/=]+)$/.exec(entry);
		if (!match) throw new SocialKeyError('SOCIAL_TOKEN_KEK: entries are <version>:<base64>');
		const raw = unb64(match[2]!);
		if (raw.byteLength !== 32) throw new SocialKeyError('SOCIAL_TOKEN_KEK: each key is 32 bytes');
		byVersion.set(Number(match[1]), await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
	}
	if (!byVersion.size) throw new SocialKeyError('SOCIAL_TOKEN_KEK is not configured');
	const version = Math.max(...byVersion.keys());
	return { current: { version, key: byVersion.get(version)! }, byVersion };
}

export interface SocialCryptoEnv {
	SOCIAL_TOKEN_KEK?: unknown;
}

async function keys(env: SocialCryptoEnv): Promise<Keys> {
	const secret = env.SOCIAL_TOKEN_KEK ? await getSecret(env.SOCIAL_TOKEN_KEK, 'SOCIAL_TOKEN_KEK') : '';
	let k = cache.get(secret);
	if (!k) {
		k = parseSocialKeys(secret);
		k.catch(() => cache.delete(secret));
		cache.set(secret, k);
	}
	return k;
}

/** Whether the key is configured (Studio and admin show "not configured" instead of failing later). */
export async function socialCryptoReady(env: SocialCryptoEnv): Promise<boolean> {
	try {
		await keys(env);
		return true;
	} catch {
		return false;
	}
}

export async function sealText(env: SocialCryptoEnv, plain: string, bound: string): Promise<string> {
	const k = await keys(env);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(bound) }, k.current.key, new TextEncoder().encode(plain)));
	return `v${k.current.version}.${b64(iv)}.${b64(sealed)}`;
}

export async function openText(env: SocialCryptoEnv, stored: string, bound: string): Promise<string> {
	const m = /^v(\d{1,4})\.([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]+)$/.exec(stored);
	if (!m) throw new SocialKeyError('malformed ciphertext');
	const k = await keys(env);
	const key = k.byVersion.get(Number(m[1]));
	if (!key) throw new SocialKeyError(`SOCIAL_TOKEN_KEK version ${m[1]} is missing`);
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m[2]!), additionalData: new TextEncoder().encode(bound) }, key, unb64(m[3]!));
	return new TextDecoder().decode(plain);
}

export async function sealJson(env: SocialCryptoEnv, value: unknown, bound: string): Promise<string> {
	return sealText(env, JSON.stringify(value), bound);
}

export async function openJson<T>(env: SocialCryptoEnv, stored: string, bound: string): Promise<T> {
	return JSON.parse(await openText(env, stored, bound)) as T;
}

/** URL-safe random token (OAuth state, PKCE verifier, webhook secrets). */
export function randomToken(bytes = 32): string {
	return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkceChallenge(verifier: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
	return b64(digest).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const base64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
