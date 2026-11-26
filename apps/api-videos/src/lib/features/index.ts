/**
 * What the caller sees (GET /api/me/features; shared-types features.ts, wiki
 * "Product rules → Hidden when off"). One server-computed answer per feature:
 *
 *   config  — the admin switch is on AND what it needs is bound/configured
 *   tier    — the creator tier that applies includes it (the channel OWNER's
 *             tier for channel work, like uploads), and the caller's role on
 *             that channel may use it
 *
 * Quotas (live hours, caption minutes left, channel limit) never hide a
 * feature: they are said plainly at the moment of the action.
 *
 * Shared settings snapshots are cached per isolate. Channel roles, billing
 * history, and tier eligibility are evaluated for each request.
 *
 * The same `*Configured` readers gate the APIs (404 feature_off), so a hidden
 * entry point and its API always agree.
 */
import {
	NO_FEATURES,
	FEATURE_REGISTRY,
	applySwitchesToUserFeatures,
	featureGate,
	type FeatureKey,
	type FeatureStateReport,
	CATEGORIZE_VISIBILITY_KEY,
	SOCIAL_NETWORKS,
	captionPeriod,
	can,
	channelRoleOf,
	liveIneligibility,
	tierAllowsChannels,
	tierAllowsLive,
	tierAllowsLiveCapability,
	tierAllowsUploads,
	type ChannelCapability,
	type ChannelRole,
	type CreatorTier,
	type LiveProviderId,
	type UserFeatures,
} from '@al-ummah/shared-types';
import { loadChannelRecord, type AccessChannel } from '../channelAccess';
import { getCachedSecret } from '../env-helpers';
import { channelOwnerTier, resolveCreator } from '../creatorTiers';
import { cachedPendingUserDeletion } from '../admin/pendingUserDeletion';
import { memberUploadChannelIds } from '../../endpoints/creator/creatorAccess';
import { readCaptionSettings, type CaptionJobsEnv, type CaptionSettings } from '../captions/jobs';
import { LIVE_ADAPTERS, type LiveEnv } from '../live/providers';
import { readLiveRouting, readUsage } from '../live/store';
import { networkReadiness, type SocialEnv } from '../social/platform';
import { readPlatformSettings } from '../social/store';
import { UNSET_SECRET, googleClientSecret, readYtSettings, type YtSettingsEnv } from '../youtube-import/settings';
import { checkBulkScheduleAllowed } from '../studioLimits';
import { readSettings as readSiteSettings, type SitesEnv } from '../sites/store';
import { logger } from '../logger';
import { enabledProviders } from '../billing/config';
import { readQuranCurrent } from '../quran/copy';
import { forgetFeatureSwitches, overlaySwitch, readFeatureSwitches } from './switches';
import { readRequestsAllowed } from '../upgradeMode';
import { supportFeatureKeys } from '../support/eligibility';

export { featureOff } from './off';

export interface FeaturesEnv extends LiveEnv, CaptionJobsEnv, YtSettingsEnv {
	SEARCH_DB?: D1Database;
	NOTIFICATIONS_DB?: D1Database;
	channels?: R2Bucket;
	channel_sections?: unknown;
	channel_tabs?: unknown;
	global_settings?: R2Bucket;
	PROCESSOR?: unknown;
	MEDIA_ORIGINALS?: unknown;
	TRANSCODE_QUEUE?: CaptionJobsEnv['TRANSCODE_QUEUE'];
	QF_CLIENT_ID?: unknown;
	QF_CLIENT_SECRET?: unknown;
	QURAN_PROVIDER?: string;
	AI_CATEGORIZE_ENABLED?: string;
	ADMIN_API_URL?: string;
	INTERNAL_API_KEY?: unknown;
	/** Tests: SaaS readiness without admin-api */
	SITES_SAAS_AVAILABLE?: string;
	[binding: string]: unknown;
}

/** A secret's value; '' while it is not bound, can't be read, or holds the release's placeholder. */
async function secretValue(binding: unknown, name: string): Promise<string> {
	const value = (await getCachedSecret(binding, name)).trim();
	return value === UNSET_SECRET ? '' : value;
}

/**
 * Per-isolate memo with a TTL, keyed by what the answer depends on. It keeps
 * settled values only: a pending load belongs to the request that started it,
 * and Workers refuse to settle it for another request
 * (handle_cross_request_promise_resolution), so concurrent requests each load.
 */
function memo<T>(ttlMs: number) {
	let entry: { key: unknown; at: number; value: T } | null = null;
	return {
		async get(key: unknown, load: () => Promise<T>, now = Date.now()): Promise<T> {
			if (entry && entry.key === key && now - entry.at < ttlMs) return entry.value;
			const value = await load();
			entry = { key, at: now, value };
			return value;
		},
		forget() {
			entry = null;
		},
	};
}

const FEATURE_SETTINGS_TTL_MS = 10_000;

/** Only settled settings are shared across requests. Replacing the map also
 * prevents a read started before invalidation from repopulating the cache. */
function settingsSnapshot<T>(load: (env: FeaturesEnv) => Promise<T>) {
	let entries = new WeakMap<FeaturesEnv, { value: T; expiresAt: number }>();
	return {
		async get(env: FeaturesEnv): Promise<T> {
			const snapshot = entries;
			const now = Date.now();
			const entry = snapshot.get(env);
			if (entry && now < entry.expiresAt) return entry.value;
			const value = await load(env);
			const expiresAt = now + FEATURE_SETTINGS_TTL_MS;
			if ((snapshot.get(env)?.expiresAt ?? 0) <= expiresAt) snapshot.set(env, { value, expiresAt });
			return value;
		},
		forget() {
			entries = new WeakMap();
		},
	};
}

const captionSnapshot = settingsSnapshot((env) => readCaptionSettings(env, { raw: true }));
const youtubeSecretSnapshot = settingsSnapshot(async (env) => !!(await googleClientSecret(env, { cacheBindings: true })));
const creatorSnapshot = settingsSnapshot(async (env) => {
	const [billing, social, youtube, categorize] = await Promise.all([
		enabledProviders(env).then((providers) => providers.length > 0).catch((error: unknown) => {
			logger.warn('[features] Payment providers not read', { error: error instanceof Error ? error.message : String(error) });
			return false;
		}),
		readSocialConfiguration(env, { raw: true }),
		readYtSettings(env, { raw: true }),
		categorizeVisibilityStored(env),
	]);
	return { billing, social, youtube, categorize };
});

// ---------------------------------------------------------------------------
// Config: switched on and configured
// ---------------------------------------------------------------------------

const liveMemo = memo<boolean>(60_000);

/**
 * A provider may take new streams: on, not draining, configured here, and not
 * over its monthly budget. A provider at its concurrency cap still counts (a
 * slot frees up within minutes; the create answers "at capacity").
 */
export function liveConfigured(env: FeaturesEnv, now = Date.now()): Promise<boolean> {
	const db = env.SEARCH_DB;
	if (!db) return Promise.resolve(false);
	return liveMemo.get(db, async () => {
		const settings = await readLiveRouting(db, now);
		const candidates = (['selfhosted', 'bunny'] as LiveProviderId[]).filter((p) => settings.providers[p].enabled && !settings.providers[p].draining);
		if (!candidates.length) return false;
		const usage = await readUsage(db, settings, now);
		for (const provider of candidates) {
			const available = await LIVE_ADAPTERS[provider].available(env);
			const why = liveIneligibility(settings.providers[provider], { ...usage[provider], available });
			if (why === null || why === 'concurrency') return true;
		}
		return false;
	}, now);
}

/** The writing isolate sees settings changes immediately. Other isolates use the TTL. */
export function forgetFeatureSettings(): void {
	captionSnapshot.forget();
	creatorSnapshot.forget();
	youtubeSecretSnapshot.forget();
}

export function forgetFeatureCaches(): void {
	forgetFeatureSettings();
	liveMemo.forget();
	saasMemo.forget();
	forgetFeatureSwitches();
}

/** Transcription can run: its queues and database are bound and the month's budget is above 0. */
export function transcribeConfigured(env: FeaturesEnv, settings: CaptionSettings): boolean {
	return !!(env.SEARCH_DB && env.queue && env.TRANSCODE_QUEUE) && settings.monthlyBudgetUsd > 0;
}

/** Caption translation: switched on, its queue bound and the budget above 0. */
export function captionTranslateConfigured(env: FeaturesEnv, settings: CaptionSettings): boolean {
	return !!(env.SEARCH_DB && env.queue) && settings.translation.enabled && settings.monthlyBudgetUsd > 0;
}

/** Viewers may download captions from the player: switched on by an admin (off by default). */
export function viewerCaptionDownloadConfigured(settings: CaptionSettings): boolean {
	return settings.viewerDownload.enabled;
}

/** The Translate button: switched on, the processor bound, a daily allowance and a budget. */
export function inlineTranslateConfigured(env: FeaturesEnv, settings: CaptionSettings): boolean {
	return !!env.PROCESSOR && settings.inline.enabled && settings.inline.dailyItems > 0 && settings.inline.monthlyBudgetUsd > 0;
}

/** Viewer-side translated titles: on site-wide, with the processor to translate them. */
export function viewerTitlesConfigured(env: FeaturesEnv, settings: CaptionSettings): boolean {
	return !!env.PROCESSOR && settings.viewerTitles.enabled && settings.inline.monthlyBudgetUsd > 0;
}

/** Quran Foundation editions: the credentials are bound (the local stack serves fixtures). */
export async function quranEditionsConfigured(env: FeaturesEnv): Promise<boolean> {
	if (env.QURAN_PROVIDER === 'fixture') return true;
	const [id, secret] = await Promise.all([secretValue(env.QF_CLIENT_ID, 'QF_CLIENT_ID'), secretValue(env.QF_CLIENT_SECRET, 'QF_CLIENT_SECRET')]);
	return !!id && !!secret;
}

/**
 * The official Quran text: our Quran Foundation copy is synced and fresh. The pointer read is
 * cached per isolate (lib/quran/copy.ts, 5 minutes).
 */
export async function quranTextAvailable(env: FeaturesEnv): Promise<boolean> {
	try {
		return !!(await readQuranCurrent(env.MEDIA_PRIVATE as never));
	} catch (error) {
		logger.warn('[Features] Quran copy pointer unreadable', { error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

async function readSocialConfiguration(env: FeaturesEnv, opts: { raw?: boolean } = {}) {
	try {
		const socialEnv = env as unknown as SocialEnv;
		const [settings, readiness] = await Promise.all([
			readPlatformSettings(socialEnv, opts),
			opts.raw
				? getCachedSecret(env.SOCIAL_TOKEN_KEK, 'SOCIAL_TOKEN_KEK').then((key) =>
					networkReadiness({ ...socialEnv, SOCIAL_TOKEN_KEK: key }))
				: networkReadiness(socialEnv),
		]);
		return { enabled: settings.enabled, ready: SOCIAL_NETWORKS.some((n) => readiness[n].configured && settings.networks[n].enabled) };
	} catch (error) {
		logger.warn('[Features] Social settings unreadable; hidden', { error: error instanceof Error ? error.message : String(error) });
		return { enabled: false, ready: false };
	}
}

/** Social auto-post: switched on, and at least one network configured and switched on. */
export async function socialConfigured(env: FeaturesEnv): Promise<boolean> {
	const { enabled, ready } = await readSocialConfiguration(env);
	return enabled && ready;
}

/** Move from YouTube: switched on, with a Google client id and secret. */
export async function youtubeImportConfigured(env: FeaturesEnv): Promise<boolean> {
	const settings = await readYtSettings(env);
	if (!settings.enabled || !settings.clientId) return false;
	return !!(await googleClientSecret(env));
}


/** AI category suggestions: the admin switch (mirrored; no file = on, its default) and the env kill switch. */
export async function aiCategoryConfigured(env: FeaturesEnv): Promise<boolean> {
	if (env.AI_CATEGORIZE_ENABLED === 'false' || !env.queue) return false;
	try {
		return await overlaySwitch(env, 'aiCategorySuggest', await categorizeVisibilityStored(env));
	} catch {
		return false;
	}
}

/** The categorize visibility file's own value (no file: on, its default; unreadable: off). */
export async function categorizeVisibilityStored(env: FeaturesEnv): Promise<boolean> {
	try {
		const stored = await env.global_settings?.get(CATEGORIZE_VISIBILITY_KEY);
		if (!stored) return true;
		const value = (await stored.json()) as { enabled?: unknown };
		return value?.enabled !== false;
	} catch {
		return false;
	}
}

const saasMemo = memo<boolean>(10 * 60_000);

/**
 * Cloudflare for SaaS is set up for own domains: admin-api holds the token and
 * probes the zone (GET /internal/site-domains-status), cached here 10 minutes.
 */
export function saasConfigured(env: FeaturesEnv, fetchImpl: typeof fetch = fetch): Promise<boolean> {
	if (env.SITES_SAAS_AVAILABLE !== undefined) return Promise.resolve(env.SITES_SAAS_AVAILABLE === 'true');
	const base = (env.ADMIN_API_URL ?? '').replace(/\/$/, '');
	if (!base) return Promise.resolve(false);
	return saasMemo.get(base, async () => {
		try {
			const key = await secretValue(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY');
			if (!key) return false;
			const res = await fetchImpl(`${base}/internal/site-domains-status`, { headers: { 'X-API-Key': key } });
			if (!res.ok) return false;
			const body = (await res.json().catch(() => null)) as { result?: { available?: unknown } } | null;
			return body?.result?.available === true;
		} catch (error) {
			logger.warn('[Features] SaaS readiness unreachable; own domains hidden', { error: error instanceof Error ? error.message : String(error) });
			return false;
		}
	});
}

// ---------------------------------------------------------------------------
// Tier and role
// ---------------------------------------------------------------------------

export interface FeaturesWho {
	userId?: string | null;
	roles?: readonly string[] | null;
}

interface ChannelScope {
	channelId: string;
	ownerId: string | null;
	role: ChannelRole | null;
}

/** Caption minutes in the plan of `subjectId`: the tier's, or an admin grant this month or until used. */
async function hasCaptionMinutes(db: D1Database, subjectId: string, tier: CreatorTier | null, unlimited: boolean): Promise<boolean> {
	if (unlimited) return true;
	if (tier && tier.captionMinutesMonth > 0) return true;
	const row = await db
		.prepare(
			`SELECT 1 AS ok FROM caption_minute_grants WHERE user_id = ? AND revoked_at IS NULL
			 AND ((scope = 'month' AND period = ?) OR (scope = 'until_used' AND used < minutes)) LIMIT 1`,
		)
		.bind(subjectId, captionPeriod(new Date()))
		.first<{ ok: number }>();
	return !!row;
}

const roleMay = (scope: ChannelScope | null, ...capabilities: ChannelCapability[]) => !scope || capabilities.some((cap) => can(scope.role, cap));

/**
 * Every feature for `who` (signed out: only the viewer-facing config ones).
 * With `channelId`, channel work is judged on that channel's owner's tier and
 * the caller's role there; a caller without a role sees none of it.
 */
export async function computeFeatures(env: FeaturesEnv, who: FeaturesWho, channelId?: string | null, request: FeaturesRequest = {}): Promise<UserFeatures> {
	let channel: Promise<AccessChannel | null> | undefined;
	const readChannel = () => channel ??= channelId ? loadChannelRecord(env, channelId) : Promise.resolve(null);
	const switchesPromise = readFeatureSwitches(env, NEUTRAL_LEGACY);
	const [features, switches, support] = await Promise.all([
		computeConfiguredFeatures(env, who, channelId, readChannel, switchesPromise),
		switchesPromise,
		// The Support button is also visible to viewers while its switch is on.
		switchesPromise.then(({ effective }) => effective.creatorSupport
			? supportKeysFor(env, who, channelId ?? null, request, readChannel)
			: null),
	]);
	if (support) Object.assign(features, support);
	// The Features page switches (FEAT-4): a switch that is off, or blocked by one, hides its keys
	return applySwitchesToUserFeatures(features, switches.effective);
}

/** What the request says about where it comes from (support's country and app checks). */
export interface FeaturesRequest {
	/** cf.country of the request */
	country?: string | null;
	/** X-AUN-Client (native apps) */
	client?: string | null;
	/** X-AUN-Storefront (native apps: the store's storefront country, MEM-D15) */
	storefront?: string | null;
}

async function supportKeysFor(env: FeaturesEnv, who: FeaturesWho, channelId: string | null, request: FeaturesRequest, readChannel: () => Promise<AccessChannel | null>): Promise<{ support: boolean; supportReceive: boolean }> {
	try {
		const db = env.SEARCH_DB;
		if (!db) return { support: false, supportReceive: false };
		const record = await readChannel();
		const channel = channelId && record
			? {
					channelId,
					ownerId: record.userId ?? null,
					deleted: !!(record as { isDeleted?: boolean }).isDeleted,
					suspended: !!(record as { isSuspended?: boolean }).isSuspended,
					callerRole: who.userId ? channelRoleOf(record, who.userId) : null,
				}
			: null;
		const ownerTierAllows = async (ownerId: string) => (await channelOwnerTier(db, ownerId))?.supportReceive === true;
		return await supportFeatureKeys(env as never, { userId: who.userId ?? null, country: request.country ?? null, client: request.client ?? null, storefront: request.storefront ?? null }, channel, ownerTierAllows);
	} catch (error) {
		logger.warn('[features] Support keys not computed; hidden', { error: error instanceof Error ? error.message : String(error) });
		return { support: false, supportReceive: false };
	}
}

/**
 * Switches with an old setting are already decided inside the old readers (overlaySwitch), so they
 * count as on here unless a row or a required switch says otherwise.
 */
const NEUTRAL_LEGACY: Partial<Record<FeatureKey, boolean>> = Object.fromEntries(
	FEATURE_REGISTRY.filter((d) => d.legacy).map((d) => [d.key, true]),
);

async function computeConfiguredFeatures(
	env: FeaturesEnv,
	who: FeaturesWho,
	channelId: string | null | undefined,
	readChannel: () => Promise<AccessChannel | null>,
	switchesPromise: ReturnType<typeof readFeatureSwitches>,
): Promise<UserFeatures> {
	const userId = who.userId ?? null;
	const db = env.SEARCH_DB;
	const [raw, quran, quranText, switches, channel] = await Promise.all([
		captionSnapshot.get(env), quranEditionsConfigured(env), quranTextAvailable(env), switchesPromise,
		userId && db && channelId ? readChannel() : null,
	]);
	const enabled = (key: FeatureKey, legacy: boolean) => switches.effective[key] && (switches.rows.has(key) || legacy);
	const settings: CaptionSettings = {
		...raw,
		translation: { ...raw.translation, enabled: enabled('captionsTranslate', raw.translation.enabled) },
		inline: { ...raw.inline, enabled: enabled('inlineTranslate', raw.inline.enabled) },
		viewerTitles: { ...raw.viewerTitles, enabled: enabled('viewerTranslatedTitles', raw.viewerTitles.enabled) },
		viewerDownload: { ...raw.viewerDownload, enabled: enabled('viewerCaptionDownload', raw.viewerDownload.enabled) },
	};
	const features: UserFeatures = {
		...NO_FEATURES,
		viewerTranslatedTitles: viewerTitlesConfigured(env, settings),
		viewerCaptionDownload: viewerCaptionDownloadConfigured(settings),
		quranEditions: quran,
		quranText,
		eventCalendar: true,
		parentsGuide: true,
		// E21.6: finite viewing and the daily reminder need no provider (wiki Epic 21 §6)
		intentionalViewing: true,
		// Viewers follow the switch alone: no tier, and no provider (streams on air and recordings go on).
		// With a channel these say what the caller may set up there (below), so they start off
		liveChat: !channelId,
		livePremieres: !channelId,
		liveEvents: !channelId,
		liveReminders: true,
		recitationTools: quranText,
		// E21: anonymous, so signed-out viewers get them once the admin switch is on (wiki Epic 21 §3)
		prayerTimes: true,
		qibla: true,
		hijriCalendar: true,
		// Seasons are public; with no published season the season route answers season: null
		ramadanMode: true,
	};
	if (!userId || !db) return features;
	// Moving one's own channel is open to every tier once its switch is on (wiki AUN-CHANNEL-CLAIM CC-D2)
	features.channelMove = true;

	let scope: ChannelScope | null = null;
	if (channelId) {
		if (!channel || channel.isDeleted) return features;
		scope = { channelId, ownerId: channel.userId ?? null, role: channelRoleOf(channel, userId) };
		// Not on this channel's team: none of its Studio features
		if (!scope.role) return features;
	}

	const roles = who.roles ?? null;
	const configPromise = creatorSnapshot.get(env);
	const eligibility = resolveCreator(db, { userId, roles, channelOwnerId: scope?.ownerId ?? null }).then(async ({ tier, via, subjectId }) => {
		const unlimited = via === 'super_admin' || !!tier?.unlimited;
		const [live, minutes, uploadElsewhere] = await Promise.all([
			tierAllowsLive(tier) && roleMay(scope, 'live.manage', 'live.moderate') ? liveConfigured(env) : false,
			roleMay(scope, 'video.edit') ? hasCaptionMinutes(db, subjectId, tier, unlimited) : false,
			// Without a channel: channels whose owner's tier lets this member upload.
			!scope && !tierAllowsUploads(tier) ? memberUploadChannelIds(db, userId, roles).then((ids) => ids.length > 0) : false,
		]);
		return { tier, unlimited, live, minutes, uploadElsewhere };
	});
	const [config, billingRecord, { tier, unlimited, live, minutes, uploadElsewhere }, deletion, bulk, siteDomains, youtube] = await Promise.all([
		configPromise,
		// Billing records belong to the caller even while there are no enabled providers.
		db.prepare('SELECT 1 AS x FROM billing_subscriptions WHERE user_id = ? UNION ALL SELECT 1 AS x FROM billing_payments WHERE user_id = ? LIMIT 1')
			.bind(userId, userId).first().catch(() => null),
		eligibility,
		cachedPendingUserDeletion(db, userId),
		roleMay(scope, 'video.schedule') ? checkBulkScheduleAllowed(env, userId).then((refusal) => refusal === null) : false,
		scope && can(scope.role, 'channel.edit') ? siteDomainsFor(env, scope.channelId) : false,
		configPromise.then(({ youtube }) =>
			!!youtube.clientId && enabled('youtubeImport', youtube.enabled) ? youtubeSecretSnapshot.get(env).catch(() => false) : false),
	]);
	features.billing = config.billing || !!billingRecord;
	const pending = !!deletion;

	// The tier's own flags: Free (where accounts without a stored tier land) has neither uploads nor channels
	features.upload = !pending && (scope ? tierAllowsUploads(tier) && can(scope.role, 'video.upload') : tierAllowsUploads(tier) || uploadElsewhere);
	features.createChannel = !pending && !scope && tierAllowsChannels(tier);
	features.live = !pending && live;
	if (scope) {
		// Studio: what the caller may set up on this channel
		features.liveChat = !pending && tierAllowsLiveCapability(tier, 'liveChat') && roleMay(scope, 'live.manage', 'live.moderate');
		features.livePremieres = !pending && tierAllowsLiveCapability(tier, 'livePremieres') && roleMay(scope, 'live.manage');
		features.liveEvents = !pending && tierAllowsLiveCapability(tier, 'liveEvents') && roleMay(scope, 'live.manage');
	}
	features.captionsTranscribe = transcribeConfigured(env, settings) && minutes;
	features.captionsTranslate = captionTranslateConfigured(env, settings) && minutes;
	features.inlineTranslate = inlineTranslateConfigured(env, settings);
	features.audioTracks = !!env.MEDIA_ORIGINALS && !!env.TRANSCODE_QUEUE && roleMay(scope, 'video.edit') && (unlimited || (tier?.audioTracksPerVideo ?? 0) > 0);
	features.recitationMetadata = (unlimited || tier?.recitationMetadata === true) && roleMay(scope, 'video.edit');
	features.siteDomains = siteDomains;
	features.socialAutopost = config.social.ready && enabled('socialAutopost', config.social.enabled) && roleMay(scope, 'channel.edit');
	features.youtubeImport = youtube;
	features.aiCategorySuggest = env.AI_CATEGORIZE_ENABLED !== 'false' && !!env.queue && enabled('aiCategorySuggest', config.categorize);
	features.bulkSchedule = bulk;
	// Signed-in viewers get Listen mode and Downloads equally regardless of tier (wiki E14-D2, E14-D3)
	features.listenMode = !pending;
	features.offlineDownloads = !pending;
	// Private notes (E21-D9): every signed-in account; the note limit is the tier's
	features.studyNotes = !pending;
	features.quietHours = !pending;
	return features;
}

/** Own domains on a channel's site: the site allows at least one and SaaS is set up. */
export async function siteDomainsFor(env: FeaturesEnv, channelId: string): Promise<boolean> {
	if (!env.channel_sections) return false;
	const site = await readSiteSettings(env as unknown as SitesEnv, channelId).catch(() => null);
	if (!site || (site.settings.limits?.customDomainsMax ?? 0) <= 0 || site.settings.status === 'revoked') return false;
	return saasConfigured(env);
}

/**
 * Transcription or caption translation for work on a video owned by `channelOwnerId`: configured
 * here, and the owner's plan has caption minutes at all (running out is a quota, answered 402).
 */
export async function captionFeatureFor(env: FeaturesEnv, kind: 'transcribe' | 'translate', who: { userId: string; roles?: readonly string[] | null; channelOwnerId?: string | null }): Promise<boolean> {
	const db = env.SEARCH_DB;
	if (!db) return false;
	// The Features page switch first (the route gate can't read the job's kind from the body)
	if (!(await featureGate(env, kind === 'transcribe' ? 'captionsTranscribe' : 'captionsTranslate').catch(() => ({ on: true as const }))).on) return false;
	const settings = await readCaptionSettings(env);
	if (kind === 'transcribe' ? !transcribeConfigured(env, settings) : !captionTranslateConfigured(env, settings)) return false;
	const creator = await resolveCreator(db, who);
	return hasCaptionMinutes(db, creator.subjectId, creator.tier, creator.via === 'super_admin' || !!creator.tier?.unlimited);
}

/**
 * The Features page's view from here (GET /internal/admin/features/state): each switch's old
 * setting, read raw (not overlaid), and whether the feature is set up enough to work when on.
 * The set-up checks are the `*Configured` readers with the switch itself taken as on.
 */
export async function featureSwitchState(env: FeaturesEnv): Promise<FeatureStateReport> {
	const settled = <T>(p: Promise<T>, fallback: T) => p.catch((error: unknown) => {
		logger.warn('[Features] State read failed', { error: error instanceof Error ? error.message : String(error) });
		return fallback;
	});
	const raw = await readCaptionSettings(env, { raw: true });
	const on = {
		...raw,
		translation: { ...raw.translation, enabled: true },
		inline: { ...raw.inline, enabled: true },
		viewerTitles: { ...raw.viewerTitles, enabled: true },
	};
	const db = env.SEARCH_DB;
	// Ramadan mode is ready once a season is published (idx_islamic_seasons_state_start)
	const ramadanReady = db
		? await settled(db.prepare("SELECT 1 AS x FROM islamic_seasons WHERE state = 'published' AND deleted_at IS NULL LIMIT 1").first().then((r) => !!r), false)
		: false;
	const [yt, ytSecret, social, networks, categorize, requests, live, quran, quranText, saas] = await Promise.all([
		settled(readYtSettings(env, { raw: true }), null),
		settled(googleClientSecret(env).then((v) => !!v), false),
		settled(readPlatformSettings(env as never, { raw: true }), null),
		settled(networkReadiness(env as unknown as SocialEnv), null),
		categorizeVisibilityStored(env),
		db ? settled(readRequestsAllowed(db, { raw: true }).then((r) => r.allowed), true) : Promise.resolve(true),
		settled(liveConfigured(env), false),
		settled(quranEditionsConfigured(env), false),
		settled(quranTextAvailable(env), false),
		settled(saasConfigured(env), false),
	]);
	return {
		legacy: {
			youtubeImport: yt?.enabled ?? false,
			captionsTranslate: raw.translation.enabled,
			inlineTranslate: raw.inline.enabled,
			viewerTranslatedTitles: raw.viewerTitles.enabled,
			viewerCaptionDownload: raw.viewerDownload.enabled,
			socialAutopost: social?.enabled ?? false,
			aiCategorySuggest: categorize,
			tierRequests: requests,
		},
		ready: {
			youtubeImport: !!yt?.clientId && ytSecret,
			audioTracks: !!env.MEDIA_ORIGINALS && !!env.TRANSCODE_QUEUE,
			live,
			captionsTranscribe: transcribeConfigured(env, raw),
			captionsTranslate: captionTranslateConfigured(env, on),
			inlineTranslate: inlineTranslateConfigured(env, on),
			viewerTranslatedTitles: viewerTitlesConfigured(env, on),
			quranEditions: quran,
			recitationTools: quranText,
			socialAutopost: !!social && !!networks && SOCIAL_NETWORKS.some((n) => networks[n].configured && social.networks[n].enabled),
			aiCategorySuggest: env.AI_CATEGORIZE_ENABLED !== 'false' && !!env.queue,
			siteDomains: saas,
			newsletter: null,
			listenMode: true,
			intentionalViewing: true,
			prayerTimes: true,
			qibla: true,
			hijriCalendar: true,
			ramadanMode: ramadanReady,
			offlineDownloads: !!env.SEARCH_DB,
			studyNotes: !!env.SEARCH_DB,
			quietHours: !!env.NOTIFICATIONS_DB,
		},
	};
}
