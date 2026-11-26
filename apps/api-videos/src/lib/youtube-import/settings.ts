/**
 * Admin settings of Move from YouTube (wiki AUN-YT-IMPORT): on/off and the
 * Google OAuth Web client id, in global_settings `youtube-import/settings.json`.
 *
 * The client secret is set on the admin page (write only) and sealed the way
 * the cost dashboard seals its keys (COST-1): AES-256-GCM under a key derived
 * (HKDF-SHA256) from INTERNAL_API_KEY, in global_settings
 * `youtube-import/client-secret.json`. Only api-videos can open it, and it is
 * never returned: the view says only whether one is present and who set it.
 * Without one, the Secrets Store binding GOOGLE_OAUTH_CLIENT_SECRET
 * (google-oauth-client-secret[-qa|-stage]) is read instead.
 *
 * Creators can connect only when the feature is on, a client id is set and
 * the secret is present ("ready").
 */
import {
	DEFAULT_YOUTUBE_IMPORT_SETTINGS,
	isGoogleClientId,
	isGoogleClientSecret,
	youtubeImportScopes,
	type YoutubeImportSettings,
	type YoutubeImportSettingsView,
} from '@al-ummah/shared-types';
import { getCachedSecret, getSecret } from '../env-helpers';
import { logger } from '../logger';
import { overlaySwitch } from '../features/switches';

export const YT_SETTINGS_KEY = 'youtube-import/settings.json';
export const YT_SECRET_KEY = 'youtube-import/client-secret.json';

/**
 * Value of a Secrets Store entry created before its real value is known (the
 * owner pastes Google's secret over it): counts as no secret.
 */
export const UNSET_SECRET = 'unset';

export interface YtSettingsEnv {
	global_settings?: R2Bucket;
	GOOGLE_OAUTH_CLIENT_SECRET?: unknown;
	/** The master the admin-set client secret is sealed with */
	INTERNAL_API_KEY?: unknown;
	Audience?: string;
	/** Local stack only: the defaults while no settings file exists ("true" / a client id) */
	YOUTUBE_IMPORT_DEFAULT_ENABLED?: string;
	YOUTUBE_IMPORT_DEFAULT_CLIENT_ID?: string;
}

export class YtSettingsError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
	}
}

function defaults(env: YtSettingsEnv): YoutubeImportSettings {
	const clientId = env.YOUTUBE_IMPORT_DEFAULT_CLIENT_ID ?? '';
	return {
		...DEFAULT_YOUTUBE_IMPORT_SETTINGS,
		enabled: env.YOUTUBE_IMPORT_DEFAULT_ENABLED === 'true',
		clientId: isGoogleClientId(clientId) ? clientId : '',
	};
}

export async function readYtSettings(env: YtSettingsEnv, opts: { raw?: boolean } = {}): Promise<YoutubeImportSettings> {
	const settings = await readStoredYtSettings(env);
	if (opts.raw) return settings;
	// The Features page switch decides `enabled` once set (lib/features/switches.ts)
	return { ...settings, enabled: await overlaySwitch(env as never, 'youtubeImport', settings.enabled) };
}

async function readStoredYtSettings(env: YtSettingsEnv): Promise<YoutubeImportSettings> {
	const fallback = defaults(env);
	try {
		const stored = await env.global_settings?.get(YT_SETTINGS_KEY);
		if (!stored) return fallback;
		const raw = JSON.parse(await stored.text()) as Partial<YoutubeImportSettings>;
		return {
			enabled: raw.enabled === true,
			clientId: typeof raw.clientId === 'string' && isGoogleClientId(raw.clientId) ? raw.clientId : '',
			updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
			updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
		};
	} catch (error) {
		// Unreadable settings switch the feature off, never on
		logger.warn('[YouTubeImport] Settings unreadable; feature off', { error: error instanceof Error ? error.message : String(error) });
		return { ...DEFAULT_YOUTUBE_IMPORT_SETTINGS };
	}
}

// ---------------------------------------------------------------------------
// The admin-set client secret, sealed
// ---------------------------------------------------------------------------

/** global_settings youtube-import/client-secret.json */
export interface SealedYtSecret {
	ciphertext: string;
	iv: string;
	/** Which master sealed it ('ik1' = INTERNAL_API_KEY) */
	keyId: 'ik1';
	updatedAt: string;
	updatedBy: string;
}

const SEAL_SALT = new TextEncoder().encode('al-ummah-youtube-import-client-secret');
const SEAL_INFO = new TextEncoder().encode('youtube-import:client-secret:aes-gcm:v1');
/** Bound in as associated data, so the ciphertext opens only as this secret */
const SEAL_AD = new TextEncoder().encode('google-oauth-client-secret');

const toB64 = (bytes: Uint8Array) => {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
};
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function sealMaster(env: YtSettingsEnv, readSecret = getSecret): Promise<string | null> {
	const master = (await readSecret(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY')).trim();
	return master.length >= 16 ? master : null;
}

async function sealKey(master: string): Promise<CryptoKey> {
	const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(master), 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SEAL_SALT, info: SEAL_INFO }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealYtSecret(master: string, value: string, actorId: string, now: string): Promise<SealedYtSecret> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: SEAL_AD }, await sealKey(master), new TextEncoder().encode(value));
	return { ciphertext: toB64(new Uint8Array(sealed)), iv: toB64(iv), keyId: 'ik1', updatedAt: now, updatedBy: actorId };
}

/** The sealed value, or null when it cannot be opened (master rotated, damaged). */
export async function openYtSecret(master: string, sealed: Pick<SealedYtSecret, 'ciphertext' | 'iv'>): Promise<string | null> {
	try {
		const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv), additionalData: SEAL_AD }, await sealKey(master), fromB64(sealed.ciphertext));
		return new TextDecoder().decode(plain);
	} catch {
		return null;
	}
}

async function readSealedYtSecret(env: YtSettingsEnv): Promise<SealedYtSecret | null> {
	try {
		const stored = await env.global_settings?.get(YT_SECRET_KEY);
		if (!stored) return null;
		const raw = JSON.parse(await stored.text()) as Partial<SealedYtSecret>;
		if (typeof raw.ciphertext !== 'string' || typeof raw.iv !== 'string') return null;
		return {
			ciphertext: raw.ciphertext,
			iv: raw.iv,
			keyId: 'ik1',
			updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
			updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : '',
		};
	} catch (error) {
		logger.warn('[YouTubeImport] Stored client secret unreadable', { error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

export interface YtSecretState {
	/** The secret in use, '' when none */
	value: string;
	source: 'admin' | 'binding' | null;
	updatedAt: string | null;
	updatedBy: string | null;
	/** An admin-set secret is stored but does not open */
	unreadable: boolean;
}

/** The secret in use: the admin-set one first, then the Secrets Store binding (unless it still holds the placeholder). */
async function readYtSecretState(env: YtSettingsEnv, readSecret: typeof getSecret): Promise<YtSecretState> {
	const sealed = await readSealedYtSecret(env);
	let unreadable = false;
	if (sealed) {
		const master = await sealMaster(env, readSecret);
		const value = master ? ((await openYtSecret(master, sealed)) ?? '').trim() : '';
		if (value) return { value, source: 'admin', updatedAt: sealed.updatedAt || null, updatedBy: sealed.updatedBy || null, unreadable: false };
		unreadable = true;
		logger.warn('[YouTubeImport] The admin-set client secret no longer opens; set it again', { updatedAt: sealed.updatedAt });
	}
	const bound = (await readSecret(env.GOOGLE_OAUTH_CLIENT_SECRET, 'GOOGLE_OAUTH_CLIENT_SECRET')).trim();
	const value = bound && bound !== UNSET_SECRET ? bound : '';
	return { value, source: value ? 'binding' : null, updatedAt: sealed?.updatedAt || null, updatedBy: sealed?.updatedBy || null, unreadable };
}

export function ytSecretState(env: YtSettingsEnv): Promise<YtSecretState> {
	return readYtSecretState(env, getSecret);
}

/** The Google client secret, or '' when there is none. */
export async function googleClientSecret(env: YtSettingsEnv, opts: { cacheBindings?: boolean } = {}): Promise<string> {
	return (await readYtSecretState(env, opts.cacheBindings ? getCachedSecret : getSecret)).value;
}

/**
 * Seals and stores the client secret set on the admin page (it replaces any earlier one). Returns
 * whether one was set before. The value is never logged or returned.
 */
export async function saveYtClientSecret(
	env: YtSettingsEnv,
	value: unknown,
	actorId: string,
	now = new Date().toISOString(),
): Promise<{ hadAdminSecret: boolean }> {
	if (!env.global_settings) throw new YtSettingsError('unavailable', 'Settings storage is not configured');
	if (!isGoogleClientSecret(value)) throw new YtSettingsError('invalid_secret', 'The client secret must be 16 to 256 characters with no spaces');
	const master = await sealMaster(env);
	if (!master) throw new YtSettingsError('unavailable', 'No key to seal the secret with (INTERNAL_API_KEY is not bound)');
	const hadAdminSecret = !!(await readSealedYtSecret(env));
	const sealed = await sealYtSecret(master, value.trim(), actorId, now);
	await env.global_settings.put(YT_SECRET_KEY, JSON.stringify(sealed), { httpMetadata: { contentType: 'application/json' } });
	logger.info('[YouTubeImport] Client secret replaced', { actorId, hadAdminSecret });
	return { hadAdminSecret };
}

/** Where Google sends the creator back (register it in Google Cloud for each environment). */
export function ytRedirectUri(env: YtSettingsEnv): string {
	return `${(env.Audience ?? '').replace(/\/$/, '')}/api/youtube-import/oauth/callback`;
}

export async function ytSettingsView(env: YtSettingsEnv): Promise<YoutubeImportSettingsView> {
	const settings = await readYtSettings(env);
	const secret = await ytSecretState(env);
	const secretPresent = !!secret.value;
	return {
		...settings,
		secretPresent,
		secretSource: secret.source,
		secretUpdatedAt: secret.updatedAt,
		secretUpdatedBy: secret.updatedBy,
		secretUnreadable: secret.unreadable,
		redirectUri: ytRedirectUri(env),
		scopes: youtubeImportScopes(true),
		ready: settings.enabled && !!settings.clientId && secretPresent,
	};
}

/** Everything a connection needs, or null when creators cannot connect. */
export async function ytReadyConfig(env: YtSettingsEnv): Promise<{ clientId: string; clientSecret: string; redirectUri: string } | null> {
	const settings = await readYtSettings(env);
	if (!settings.enabled || !settings.clientId) return null;
	const clientSecret = await googleClientSecret(env);
	if (!clientSecret) return null;
	return { clientId: settings.clientId, clientSecret, redirectUri: ytRedirectUri(env) };
}

/** Applies an admin change ({ enabled?, clientId? }); returns the previous and new settings. */
export async function saveYtSettings(
	env: YtSettingsEnv,
	patch: { enabled?: unknown; clientId?: unknown },
	actorId: string,
	now = new Date().toISOString(),
): Promise<{ previous: YoutubeImportSettings; settings: YoutubeImportSettings }> {
	if (!env.global_settings) throw new YtSettingsError('unavailable', 'Settings storage is not configured');
	if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new YtSettingsError('invalid_settings', 'enabled must be true or false');
	let clientId: string | undefined;
	if (patch.clientId !== undefined) {
		if (typeof patch.clientId !== 'string') throw new YtSettingsError('invalid_settings', 'clientId must be a string');
		clientId = patch.clientId.trim();
		if (!isGoogleClientId(clientId)) throw new YtSettingsError('invalid_settings', 'clientId must be a Google OAuth Web client id (…apps.googleusercontent.com)');
	}
	const previous = await readYtSettings(env, { raw: true });
	const settings: YoutubeImportSettings = {
		enabled: patch.enabled === undefined ? previous.enabled : (patch.enabled as boolean),
		clientId: clientId ?? previous.clientId,
		updatedAt: now,
		updatedBy: actorId,
	};
	await env.global_settings.put(YT_SETTINGS_KEY, JSON.stringify(settings), { httpMetadata: { contentType: 'application/json' } });
	return { previous, settings };
}
