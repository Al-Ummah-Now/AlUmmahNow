/**
 * White-label scholar sites: the rules (wiki AUN-SCHOLAR-SITES §4, §5, §6.4, §8).
 *
 * - grant / admin update / revoke / restore: called by admin-api (/internal/sites), which records
 *   the add-on and the audit in its D1; this side keeps the site's own data (settings, hosts).
 * - Studio update and preview: the channel's owner and admins (channel roles, SS2).
 * - publicSiteForHost: what the sites Worker renders for a Host header.
 */
import {
	SITE_RESTORE_DAYS,
	SITE_TIER_SEEDS,
	SITE_LOCALES,
	SITE_PLATFORM_MARKS,
	SITE_STATUSES,
	SITE_TIERS,
	currentThemeRef,
	isChoosableThemeRef,
	isPlatformHost,
	normalizeSiteHost,
	primarySiteHost,
	siteSubdomainHost,
	validateSiteSettingsUpdate,
	validateSiteSlug,
	type PublicSite,
	type PublicSiteChannel,
	type SiteLimits,
	type SiteLocale,
	type SiteSettings,
	type SiteSettingsUpdate,
	type SiteStatus,
	type SiteTier,
} from '@al-ummah/shared-types';
import { CHANNEL_ID, SiteError, claimHost, readHost, readPreview, readSettings, releaseHost, siteEnvironment, writeSettings, type SitesEnv } from './store';

/** A renamed subdomain keeps redirecting for 12 months (SS12, recommended). */
export const RENAME_REDIRECT_MS = 365 * 24 * 60 * 60 * 1000;

interface ChannelRecord {
	id: string;
	name?: string;
	nameLocalized?: Record<string, string>;
	description?: string;
	descriptionLocalized?: Record<string, string>;
	avatarUrl?: string;
	handle?: string;
	links?: { title?: string; url: string }[];
	isDeleted?: boolean;
	isSuspended?: boolean;
}

async function loadChannel(env: SitesEnv, channelId: string): Promise<ChannelRecord | null> {
	if (!env.channels || !CHANNEL_ID.test(channelId)) return null;
	const object = await env.channels.get(channelId);
	if (!object) return null;
	const channel = await object.json<ChannelRecord>();
	return channel.isDeleted ? null : channel;
}

function validateLimits(input: unknown): SiteLimits {
	const l = input as Partial<SiteLimits> | null;
	const whole = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
	if (
		!l ||
		!whole(l.customDomainsMax, 50) ||
		!whole(l.pagesMax, 1000) ||
		!whole(l.navigationMax, 30) ||
		!SITE_PLATFORM_MARKS.includes(l.platformMark as never) ||
		typeof l.analytics !== 'boolean' ||
		typeof l.brandedSignIn !== 'boolean'
	) {
		throw new SiteError(400, 'limits_invalid');
	}
	return {
		customDomainsMax: l.customDomainsMax as number,
		platformMark: l.platformMark as SiteLimits['platformMark'],
		pagesMax: l.pagesMax as number,
		navigationMax: l.navigationMax as number,
		analytics: l.analytics,
		brandedSignIn: l.brandedSignIn,
	};
}

function checkSlug(slug: unknown): string {
	if (typeof slug !== 'string') throw new SiteError(400, 'slug_invalid');
	const problem = validateSiteSlug(slug);
	if (problem) throw new SiteError(400, `slug_${problem}`);
	return slug;
}

export interface GrantInput {
	slug: string;
	tier: SiteTier;
	limits?: SiteLimits;
	/** The platform's current theme as a pinned ref; defaults to Fawanees at its current version. */
	themeRef?: string;
	locales?: SiteLocale[];
	actor: string;
}

/** Is this slug free in this environment? (format, reserved words, host index) */
export async function slugAvailability(env: SitesEnv, slug: string, channelId?: string): Promise<{ available: boolean; reason: string | null; host: string }> {
	const host = siteSubdomainHost(slug, siteEnvironment(env));
	const problem = validateSiteSlug(slug);
	if (problem) return { available: false, reason: problem, host };
	const held = await readHost(env, host);
	if (held && held.channelId !== channelId) return { available: false, reason: 'taken', host };
	return { available: true, reason: null, host };
}

/** Grants the add-on: creates settings (status `setup`) and claims the subdomain. */
export async function grantSite(env: SitesEnv, channelId: string, input: GrantInput, now = new Date()): Promise<SiteSettings> {
	const channel = await loadChannel(env, channelId);
	if (!channel) throw new SiteError(404, 'channel_not_found');
	if (!SITE_TIERS.includes(input.tier)) throw new SiteError(400, 'tier_invalid');
	const slug = checkSlug(input.slug);
	const limits = input.limits ? validateLimits(input.limits) : SITE_TIER_SEEDS[input.tier].limits;
	const themeRef = input.themeRef ?? currentThemeRef('fawanees');
	if (!themeRef || !isChoosableThemeRef(themeRef)) throw new SiteError(400, 'theme_not_available');
	const locales = input.locales ?? ['en', 'ar'];
	if (validateSiteSettingsUpdate({ locales }, limits)) throw new SiteError(400, 'locales_invalid');

	const existing = await readSettings(env, channelId);
	if (existing && existing.settings.status !== 'revoked') throw new SiteError(409, 'site_exists');

	const host = siteSubdomainHost(slug, siteEnvironment(env));
	const at = now.toISOString();
	await claimHost(env, { host, channelId, kind: 'subdomain', createdAt: at });
	const settings: SiteSettings = {
		schemaVersion: 1,
		channelId,
		slug,
		status: 'setup',
		tier: input.tier,
		limits,
		themeRef,
		name: {},
		logoUrl: null,
		faviconUrl: null,
		locales,
		navigation: [
			{ id: 'videos', kind: 'videos' },
			{ id: 'posts', kind: 'posts' },
			{ id: 'about', kind: 'about' },
		].slice(0, limits.navigationMax) as SiteSettings['navigation'],
		about: {},
		hosts: [{ host, kind: 'subdomain', primary: true }],
		redirectHosts: [],
		configVersion: (existing?.settings.configVersion ?? 0) + 1,
		revokedAt: null,
		statusBeforeRevoke: null,
		grantedAt: at,
		grantedBy: input.actor,
		updatedAt: at,
		updatedBy: input.actor,
	};
	try {
		await writeSettings(env, settings, existing?.etag ?? null);
	} catch (error) {
		// A re-grant that lost a race keeps nothing half-made
		if (!existing) await releaseHost(env, host, channelId);
		throw error;
	}
	// A re-grant on a new slug frees the revoked site's old subdomain
	if (existing && existing.settings.slug !== slug) await releaseHost(env, siteSubdomainHost(existing.settings.slug, siteEnvironment(env)), channelId);
	return settings;
}

export interface AdminUpdateInput {
	status?: SiteStatus;
	tier?: SiteTier;
	limits?: SiteLimits;
	slug?: string;
	actor: string;
}

/** Admin changes: status (setup/live/suspended), tier and limits, subdomain rename. */
export async function adminUpdateSite(env: SitesEnv, channelId: string, input: AdminUpdateInput, now = new Date()): Promise<{ before: SiteSettings; after: SiteSettings }> {
	const current = await readSettings(env, channelId);
	if (!current) throw new SiteError(404, 'site_not_found');
	const before = current.settings;
	if (before.status === 'revoked') throw new SiteError(409, 'site_revoked');
	const after: SiteSettings = { ...before, hosts: [...before.hosts], redirectHosts: [...before.redirectHosts] };
	if (input.status !== undefined) {
		if (!SITE_STATUSES.includes(input.status) || input.status === 'revoked') throw new SiteError(400, 'status_invalid');
		after.status = input.status;
	}
	if (input.tier !== undefined) {
		if (!SITE_TIERS.includes(input.tier)) throw new SiteError(400, 'tier_invalid');
		after.tier = input.tier;
	}
	if (input.limits !== undefined) after.limits = validateLimits(input.limits);
	if (after.navigation.length > after.limits.navigationMax) after.navigation = after.navigation.slice(0, after.limits.navigationMax);

	const env_ = siteEnvironment(env);
	let claimed: string | null = null;
	if (input.slug !== undefined && input.slug !== before.slug) {
		const slug = checkSlug(input.slug);
		const oldHost = siteSubdomainHost(before.slug, env_);
		const newHost = siteSubdomainHost(slug, env_);
		await claimHost(env, { host: newHost, channelId, kind: 'subdomain', createdAt: now.toISOString() });
		claimed = newHost;
		const until = new Date(now.getTime() + RENAME_REDIRECT_MS).toISOString();
		after.slug = slug;
		const wasPrimary = before.hosts.find((h) => h.host === oldHost)?.primary ?? true;
		after.hosts = [...after.hosts.filter((h) => h.host !== oldHost), { host: newHost, kind: 'subdomain', primary: wasPrimary }];
		after.redirectHosts = [...after.redirectHosts.filter((r) => r.host !== newHost && r.host !== oldHost), { host: oldHost, until }];
		// The old subdomain stays claimed (as a redirect) for 12 months, so nobody else takes it
		await claimHost(env, { host: oldHost, channelId, kind: 'redirect', until, createdAt: now.toISOString() });
	}
	after.configVersion = before.configVersion + 1;
	after.updatedAt = now.toISOString();
	after.updatedBy = input.actor;
	try {
		await writeSettings(env, after, current.etag);
	} catch (error) {
		if (claimed) await releaseHost(env, claimed, channelId);
		throw error;
	}
	return { before, after };
}

/** Takes the add-on away. Hosts stay reserved (they redirect to the channel) for the restore window. */
export async function revokeSite(env: SitesEnv, channelId: string, actor: string, now = new Date()): Promise<SiteSettings> {
	const current = await readSettings(env, channelId);
	if (!current) throw new SiteError(404, 'site_not_found');
	if (current.settings.status === 'revoked') return current.settings;
	const after: SiteSettings = {
		...current.settings,
		status: 'revoked',
		statusBeforeRevoke: current.settings.status,
		revokedAt: now.toISOString(),
		configVersion: current.settings.configVersion + 1,
		updatedAt: now.toISOString(),
		updatedBy: actor,
	};
	await writeSettings(env, after, current.etag);
	return after;
}

export async function restoreSite(env: SitesEnv, channelId: string, actor: string, now = new Date()): Promise<SiteSettings> {
	const current = await readSettings(env, channelId);
	if (!current) throw new SiteError(404, 'site_not_found');
	const s = current.settings;
	if (s.status !== 'revoked') return s;
	if (s.revokedAt && now.getTime() - Date.parse(s.revokedAt) > SITE_RESTORE_DAYS * 86_400_000) throw new SiteError(409, 'restore_window_passed');
	const after: SiteSettings = {
		...s,
		status: s.statusBeforeRevoke && s.statusBeforeRevoke !== 'revoked' ? s.statusBeforeRevoke : 'setup',
		statusBeforeRevoke: null,
		revokedAt: null,
		configVersion: s.configVersion + 1,
		updatedAt: now.toISOString(),
		updatedBy: actor,
	};
	await writeSettings(env, after, current.etag);
	return after;
}

/** Studio → Site (owner and channel admins). `etag` guards against two editors overwriting each other. */
export async function updateSiteSettings(env: SitesEnv, channelId: string, update: SiteSettingsUpdate, actor: string, etag: string | null, now = new Date()): Promise<{ settings: SiteSettings; etag: string }> {
	const current = await readSettings(env, channelId);
	if (!current || current.settings.status === 'revoked') throw new SiteError(404, 'site_not_found');
	if (etag && etag !== current.etag) throw new SiteError(412, 'changed_elsewhere');
	const clean = pickUpdate(update);
	const problem = validateSiteSettingsUpdate(clean, current.settings.limits);
	if (problem) throw new SiteError(400, problem);
	const settings: SiteSettings = {
		...current.settings,
		...clean,
		configVersion: current.settings.configVersion + 1,
		updatedAt: now.toISOString(),
		updatedBy: actor,
	};
	const newEtag = await writeSettings(env, settings, current.etag);
	return { settings, etag: newEtag };
}

/** Only the fields Studio may change; anything else in the body is ignored. */
export function pickUpdate(update: SiteSettingsUpdate | null | undefined): SiteSettingsUpdate {
	const u = update ?? {};
	const out: SiteSettingsUpdate = {};
	if (u.themeRef !== undefined) out.themeRef = u.themeRef;
	if (u.name !== undefined) out.name = trimLocales(u.name);
	if (u.logoUrl !== undefined) out.logoUrl = u.logoUrl || null;
	if (u.faviconUrl !== undefined) out.faviconUrl = u.faviconUrl || null;
	if (u.locales !== undefined) out.locales = u.locales;
	if (u.navigation !== undefined) out.navigation = u.navigation;
	if (u.about !== undefined) out.about = trimLocales(u.about);
	return out;
}

function trimLocales(value: unknown): Partial<Record<SiteLocale, string>> {
	const out: Partial<Record<SiteLocale, string>> = {};
	if (!value || typeof value !== 'object') return out;
	for (const l of SITE_LOCALES) {
		const v = (value as Record<string, unknown>)[l];
		if (typeof v === 'string' && v.trim()) out[l] = v.trim();
	}
	return out;
}

function publicChannel(channel: ChannelRecord): PublicSiteChannel {
	return {
		id: channel.id,
		name: channel.name ?? '',
		nameLocalized: channel.nameLocalized as PublicSiteChannel['nameLocalized'],
		handle: channel.handle ?? null,
		avatarUrl: channel.avatarUrl ?? null,
		description: channel.description ?? null,
		descriptionLocalized: channel.descriptionLocalized as PublicSiteChannel['descriptionLocalized'],
		links: (channel.links ?? []).filter((l) => typeof l?.url === 'string' && /^https?:\/\//.test(l.url)).slice(0, 20),
	};
}

export type HostLookup =
	| { kind: 'site'; site: PublicSite }
	| { kind: 'redirect'; location: string }
	| { kind: 'not_found' };

/**
 * What a Host serves. Unknown hosts, platform hosts and sites still in `setup` (without a valid
 * preview token) are `not_found`. A non-primary host or an old subdomain redirects to the primary.
 * A revoked site's hosts redirect to the channel on the videos site (§4.4 "losing the tier").
 */
export async function publicSiteForHost(env: SitesEnv & { VIDEOS_WEB_URL?: string }, rawHost: string, previewToken: string | null, now = new Date()): Promise<HostLookup> {
	const host = normalizeSiteHost(rawHost);
	if (!host || isPlatformHost(host)) return { kind: 'not_found' };
	const entry = await readHost(env, host);
	if (!entry) return { kind: 'not_found' };
	const current = await readSettings(env, entry.channelId);
	if (!current) return { kind: 'not_found' };
	const s = current.settings;
	const primary = primarySiteHost(s, siteEnvironment(env));

	if (s.status === 'revoked') {
		const channel = await loadChannel(env, s.channelId);
		const base = (env.VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
		if (!channel || !base) return { kind: 'not_found' };
		return { kind: 'redirect', location: `${base}/${channel.handle ? `@${channel.handle}` : `channel/${channel.id}`}` };
	}
	if (entry.kind === 'redirect') {
		if (entry.until && Date.parse(entry.until) < now.getTime()) return { kind: 'not_found' };
		return { kind: 'redirect', location: `https://${primary.host}` };
	}
	if (!s.hosts.some((h) => h.host === host)) return { kind: 'not_found' };

	const preview = previewToken ? await readPreview(env, s.channelId, previewToken, now.getTime()) : null;
	if (s.status === 'setup' && !preview) return { kind: 'not_found' };
	if (host !== primary.host && !preview) return { kind: 'redirect', location: `https://${primary.host}` };

	const channel = await loadChannel(env, s.channelId);
	if (!channel) return { kind: 'not_found' };
	const merged: SiteSettings = preview && !validateSiteSettingsUpdate(preview, s.limits) ? { ...s, ...pickUpdate(preview) } : s;
	return {
		kind: 'site',
		site: {
			host,
			redirectTo: null,
			preview: !!preview,
			site: {
				channelId: s.channelId,
				slug: s.slug,
				status: channel.isSuspended ? 'suspended' : s.status,
				themeRef: merged.themeRef,
				name: merged.name,
				logoUrl: merged.logoUrl,
				faviconUrl: merged.faviconUrl,
				locales: merged.locales,
				navigation: merged.navigation,
				about: merged.about,
				platformMark: s.limits.platformMark,
				primaryHost: primary.host,
				primaryKind: primary.kind,
				configVersion: s.configVersion,
			},
			channel: publicChannel(channel),
		},
	};
}
