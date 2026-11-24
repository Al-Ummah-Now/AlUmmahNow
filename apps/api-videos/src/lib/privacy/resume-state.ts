/**
 * Where a multi-pass export or erase continues (lib/privacy/user-data.ts).
 *
 * The client carries the progress of a pass to the next one, sealed
 * (AES-256-GCM): it can only hand it back. A sealed state opens for the
 * account, the kind of run, the environment and the format it was made for,
 * until it expires. Anything else starts the run over, which is always safe:
 * every phase is idempotent.
 *
 * The key is derived (HKDF-SHA256, its own salt and info) from
 * INTERNAL_API_KEY, which every environment binds with its own value, as
 * lib/youtube-import/settings.ts does. After a rotation open runs start over.
 * Without a readable key (or with a state past RESUME_TOKEN_MAX) a run that
 * needs another pass stops with ResumeUnavailableError: it never looks finished.
 */
import { getSecret } from '../env-helpers';
import { logger } from '../logger';

export type ResumePurpose = 'export' | 'erase';

export interface ResumeScope {
	purpose: ResumePurpose;
	userId: string;
	/** Format of the state: a state of another format starts over. */
	version: number;
}

export interface ResumeEnv {
	INTERNAL_API_KEY?: unknown;
	ENVIRONMENT?: string;
}

export type OpenedResume = { state: Record<string, unknown> } | { restart: 'unusable' | 'expired' };

/** A run cannot be carried to another pass right now; `code` goes to the client. */
export class ResumeUnavailableError extends Error {
	readonly code = 'resume_unavailable';
	constructor(reason: 'no_key' | 'too_long') {
		super(`The run cannot be continued (${reason})`);
		this.name = 'ResumeUnavailableError';
	}
}

/** A run is continued right away by its client; a day covers an interrupted one. */
export const RESUME_TTL_MS = 24 * 60 * 60 * 1000;

/** The longest token made, accepted and documented (OpenAPI): it travels in a query string. */
export const RESUME_TOKEN_MAX = 8192;

const PREFIX = 'r1.';
const IV_BYTES = 12;
const SALT = new TextEncoder().encode('al-ummah-privacy-resume');

const toB64url = (bytes: Uint8Array): string => {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (text: string): Uint8Array<ArrayBuffer> => {
	const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
};

async function keyOf(env: ResumeEnv, purpose: ResumePurpose): Promise<CryptoKey> {
	const master = (await getSecret(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY')).trim();
	if (master.length < 16) {
		logger.error('[Privacy] INTERNAL_API_KEY is missing or unreadable: a run cannot be continued', { purpose });
		throw new ResumeUnavailableError('no_key');
	}
	const info = new TextEncoder().encode(JSON.stringify(['privacy-resume:aes-gcm:v1', purpose, env.ENVIRONMENT ?? '']));
	const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(master), 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const boundTo = (env: ResumeEnv, scope: ResumeScope) =>
	new TextEncoder().encode(JSON.stringify([scope.purpose, scope.version, env.ENVIRONMENT ?? '', scope.userId]));

/** The sealed state. Throws ResumeUnavailableError when it cannot be made or would be too long. */
export async function sealResume(env: ResumeEnv, scope: ResumeScope, state: object, now = Date.now()): Promise<string> {
	const key = await keyOf(env, scope.purpose);
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const plain = new TextEncoder().encode(JSON.stringify({ e: now + RESUME_TTL_MS, s: state }));
	const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: boundTo(env, scope) }, key, plain));
	const out = new Uint8Array(IV_BYTES + sealed.length);
	out.set(iv);
	out.set(sealed, IV_BYTES);
	const token = PREFIX + toB64url(out);
	if (token.length > RESUME_TOKEN_MAX) {
		logger.error('[Privacy] The state of a run is too long to be continued', { purpose: scope.purpose, userId: scope.userId, length: token.length });
		throw new ResumeUnavailableError('too_long');
	}
	return token;
}

/**
 * The state of a token this server sealed for exactly this scope, or why the run starts over.
 * Throws ResumeUnavailableError when there is no key to open it with: the same token works later.
 */
export async function openResume(env: ResumeEnv, scope: ResumeScope, token: string, now = Date.now()): Promise<OpenedResume> {
	if (!token.startsWith(PREFIX) || token.length > RESUME_TOKEN_MAX) return { restart: 'unusable' };
	const key = await keyOf(env, scope.purpose);
	try {
		const bytes = fromB64url(token.slice(PREFIX.length));
		const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: boundTo(env, scope) }, key, bytes.slice(IV_BYTES));
		const { e, s } = JSON.parse(new TextDecoder().decode(plain)) as { e?: unknown; s?: unknown };
		if (typeof e !== 'number' || !s || typeof s !== 'object') return { restart: 'unusable' };
		if (e <= now) return { restart: 'expired' };
		return { state: s as Record<string, unknown> };
	} catch {
		return { restart: 'unusable' };
	}
}
