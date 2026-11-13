/**
 * White-label scholar sites: storage (wiki AUN-SCHOLAR-SITES §6.2, SS4). Reuses api-videos'
 * existing R2 buckets, no new database:
 *   channel_sections  site/{channelId}/settings.json         SiteSettings (ETag-guarded writes)
 *                     site/{channelId}/previews/{token}.json  Studio previews, 10 minutes
 *   channel_tabs      site-hosts/{host}.json                  SiteHostEntry, create-only (like channel-handles/)
 * Every read is "this channel's site" or "this host": never a list or a scan.
 */
import {
	SITE_PREVIEW_TTL_MS,
	siteHostKey,
	sitePreviewKey,
	siteSettingsKey,
	type SiteEnvironment,
	type SiteHostEntry,
	type SiteSettings,
	type SiteSettingsUpdate,
} from '@al-ummah/shared-types';

export interface SitesBucket {
	get(key: string): Promise<{ etag: string; json<T>(): Promise<T> } | null>;
	put(key: string, value: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }; httpMetadata?: unknown }): Promise<{ etag: string } | null>;
	delete(key: string | string[]): Promise<void>;
}

export interface SitesEnv {
	channel_sections: SitesBucket;
	channel_tabs: SitesBucket;
	channels?: SitesBucket;
	/** production | stage | qa | local (wrangler vars). Missing = local. */
	SITES_ENV?: string;
	[binding: string]: unknown;
}

export class SiteError extends Error {
	constructor(readonly status: 400 | 403 | 404 | 409 | 412, readonly code: string, message?: string) {
		super(message ?? code);
	}
}

export function siteEnvironment(env: Pick<SitesEnv, 'SITES_ENV'>): SiteEnvironment {
	const v = env.SITES_ENV;
	return v === 'production' || v === 'stage' || v === 'qa' ? v : 'local';
}

export const CHANNEL_ID = /^[A-Za-z0-9_-]{1,80}$/;

export async function readSettings(env: SitesEnv, channelId: string): Promise<{ settings: SiteSettings; etag: string } | null> {
	if (!CHANNEL_ID.test(channelId)) return null;
	const object = await env.channel_sections.get(siteSettingsKey(channelId));
	if (!object) return null;
	return { settings: await object.json<SiteSettings>(), etag: object.etag };
}

/**
 * Writes settings. `etag` null = create only; otherwise only over that exact version, so a second
 * editor saving at the same time gets 412 "changed by someone else" instead of losing the first save.
 */
export async function writeSettings(env: SitesEnv, settings: SiteSettings, etag: string | null): Promise<string> {
	const result = await env.channel_sections.put(siteSettingsKey(settings.channelId), JSON.stringify(settings), {
		onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
		httpMetadata: { contentType: 'application/json' },
	});
	if (!result) throw new SiteError(412, etag ? 'changed_elsewhere' : 'site_exists');
	return result.etag;
}

export async function readHost(env: SitesEnv, host: string): Promise<SiteHostEntry | null> {
	const object = await env.channel_tabs.get(siteHostKey(host));
	return object ? object.json<SiteHostEntry>() : null;
}

/**
 * Claims a host for a channel. Create-only: a host attached to another site is refused (409).
 * Claiming a host the same channel already holds succeeds (idempotent) and rewrites its kind.
 */
export async function claimHost(env: SitesEnv, entry: SiteHostEntry): Promise<void> {
	const key = siteHostKey(entry.host);
	const created = await env.channel_tabs.put(key, JSON.stringify(entry), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } });
	if (created) return;
	const existing = await env.channel_tabs.get(key);
	if (!existing) throw new SiteError(409, 'host_taken');
	const held = await existing.json<SiteHostEntry>();
	if (held.channelId !== entry.channelId) throw new SiteError(409, 'host_taken');
	const rewritten = await env.channel_tabs.put(key, JSON.stringify({ ...entry, createdAt: held.createdAt }), { onlyIf: { etagMatches: existing.etag } });
	if (!rewritten) throw new SiteError(409, 'host_taken');
}

/** Frees a host, only when this channel holds it. */
export async function releaseHost(env: SitesEnv, host: string, channelId: string): Promise<void> {
	const held = await readHost(env, host);
	if (held && held.channelId === channelId) await env.channel_tabs.delete(siteHostKey(host));
}

interface PreviewObject {
	channelId: string;
	update: SiteSettingsUpdate;
	expiresAt: number;
}

/** 128 random bits, hex: unguessable, and the object holds the expiry. */
export function newPreviewToken(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function writePreview(env: SitesEnv, channelId: string, update: SiteSettingsUpdate, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
	const token = newPreviewToken();
	const expiresAt = now + SITE_PREVIEW_TTL_MS;
	const body: PreviewObject = { channelId, update, expiresAt };
	await env.channel_sections.put(sitePreviewKey(channelId, token), JSON.stringify(body), { httpMetadata: { contentType: 'application/json' } });
	return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export async function readPreview(env: SitesEnv, channelId: string, token: string, now = Date.now()): Promise<SiteSettingsUpdate | null> {
	if (!/^[0-9a-f]{32}$/.test(token)) return null;
	const object = await env.channel_sections.get(sitePreviewKey(channelId, token));
	if (!object) return null;
	const preview = await object.json<PreviewObject>();
	if (preview.channelId !== channelId || preview.expiresAt < now) return null;
	return preview.update;
}
