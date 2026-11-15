/**
 * Admin settings of Move from YouTube (wiki AUN-YT-IMPORT): on/off and the
 * Google OAuth Web client id, in global_settings `youtube-import/settings.json`.
 * The client secret is the Secrets Store binding GOOGLE_OAUTH_CLIENT_SECRET
 * (google-oauth-client-secret[-qa|-stage]) and is never stored or shown here.
 *
 * Creators can connect only when the feature is on, a client id is set and
 * the secret is present ("ready").
 */
import {
	DEFAULT_YOUTUBE_IMPORT_SETTINGS,
	isGoogleClientId,
	youtubeImportScopes,
	type YoutubeImportSettings,
	type YoutubeImportSettingsView,
} from '@al-ummah/shared-types';
import { getSecret } from '../env-helpers';
import { logger } from '../logger';

export const YT_SETTINGS_KEY = 'youtube-import/settings.json';

/**
 * Value of a Secrets Store entry created before its real value is known (the
 * owner pastes Google's secret over it): counts as no secret.
 */
export const UNSET_SECRET = 'unset';

export interface YtSettingsEnv {
	global_settings?: R2Bucket;
	GOOGLE_OAUTH_CLIENT_SECRET?: unknown;
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

export async function readYtSettings(env: YtSettingsEnv): Promise<YoutubeImportSettings> {
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

/** The Google client secret, or '' when it is missing or still the placeholder. */
export async function googleClientSecret(env: YtSettingsEnv): Promise<string> {
	const value = (await getSecret(env.GOOGLE_OAUTH_CLIENT_SECRET, 'GOOGLE_OAUTH_CLIENT_SECRET')).trim();
	return value && value !== UNSET_SECRET ? value : '';
}

/** Where Google sends the creator back (register it in Google Cloud for each environment). */
export function ytRedirectUri(env: YtSettingsEnv): string {
	return `${(env.Audience ?? '').replace(/\/$/, '')}/api/youtube-import/oauth/callback`;
}

export async function ytSettingsView(env: YtSettingsEnv): Promise<YoutubeImportSettingsView> {
	const settings = await readYtSettings(env);
	const secretPresent = !!(await googleClientSecret(env));
	return {
		...settings,
		secretPresent,
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
	const previous = await readYtSettings(env);
	const settings: YoutubeImportSettings = {
		enabled: patch.enabled === undefined ? previous.enabled : (patch.enabled as boolean),
		clientId: clientId ?? previous.clientId,
		updatedAt: now,
		updatedBy: actorId,
	};
	await env.global_settings.put(YT_SETTINGS_KEY, JSON.stringify(settings), { httpMetadata: { contentType: 'application/json' } });
	return { previous, settings };
}
