/**
 * Secrets of a YouTube import (wiki AUN-YT-IMPORT): the PKCE pair of a
 * consent, and the Google refresh token at rest.
 *
 * The refresh token is encrypted with AES-256-GCM under a key derived (HKDF-SHA256)
 * from the Google OAuth client secret, so a database copy alone opens nothing.
 * Rotating the client secret makes stored tokens unreadable: those imports show
 * "not connected" and the creator connects again (their rows stay).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array {
	const s = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4));
	return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

/** A random URL-safe token of `bytes` random bytes. */
export function randomToken(bytes = 32): string {
	return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE (RFC 7636, S256): a verifier kept server side and the challenge sent to Google. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
	const verifier = randomToken(48);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
	return { verifier, challenge: b64url(digest) };
}

const HKDF_INFO = enc.encode('al-ummah-now/youtube-import/refresh-token/v1');

async function tokenKey(clientSecret: string): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey('raw', enc.encode(clientSecret), 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: HKDF_INFO },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

/** The refresh token encrypted for storage (`importId` is bound in as associated data). */
export async function encryptToken(clientSecret: string, importId: string, token: string): Promise<{ ciphertext: string; iv: string }> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await tokenKey(clientSecret);
	const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(importId) }, key, enc.encode(token)));
	return { ciphertext: b64url(sealed), iv: b64url(iv) };
}

/** The stored refresh token, or null when it cannot be opened (another client secret, another import, damaged). */
export async function decryptToken(clientSecret: string, importId: string, sealed: { ciphertext: string; iv: string }): Promise<string | null> {
	try {
		const key = await tokenKey(clientSecret);
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: fromB64url(sealed.iv), additionalData: enc.encode(importId) },
			key,
			fromB64url(sealed.ciphertext),
		);
		return dec.decode(plain);
	} catch {
		return null;
	}
}
