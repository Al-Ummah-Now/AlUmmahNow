/**
 * Media providers (docs/media-delivery/PROVIDERS.md): upload, streaming and thumbnails behind one
 * abstraction. A provider is an adapter (api-videos lib/media/providers/*); this module holds what
 * every app shares: the provider ids, the admin settings (on/off, ingest targets, playback rules,
 * health, overrides) and the pure playback planner.
 *
 *   settings ─► effectiveRules(settings, channel override, video override)
 *   video's ready providers + health ─► planSources ─► ordered source list (first = play, rest = fallbacks)
 *
 * Nothing here talks to a provider. Clients only ever see provider ids as labels and the signed
 * URLs the API issues.
 */
import { deliveryBucket, type DeliverySettings } from './media-delivery';

/** Every provider an adapter exists for. A new provider = a new id here + its adapter. */
export const MEDIA_PROVIDER_IDS = ['bunny', 'r2'] as const;
export type MediaProviderId = (typeof MEDIA_PROVIDER_IDS)[number];

export function isMediaProviderId(value: unknown): value is MediaProviderId {
	return typeof value === 'string' && (MEDIA_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Human labels for admin pages and logs (never shown to viewers). */
export const MEDIA_PROVIDER_LABELS: Record<MediaProviderId, string> = { bunny: 'Bunny Stream', r2: 'Cloudflare R2' };

// ---------------------------------------------------------------------------
// Per-video provider records
// ---------------------------------------------------------------------------

export type ProviderMediaStatus = 'pending' | 'processing' | 'ready' | 'failed';

/**
 * One provider's copy of one video. Records are read by each provider's adapter from where that
 * provider keeps its state; rows written before providers existed read as Bunny (ref = video id)
 * plus R2 when `video.r2` exists, so old videos need no backfill.
 */
export interface VideoProviderRecord {
	provider: MediaProviderId;
	/** Provider-side id (Bunny video GUID; R2: our video id). Server-only: never sent to clients. */
	ref: string;
	status: ProviderMediaStatus;
	/** Renditions the provider holds (360p, 720p, …) */
	renditions: string[];
	readyAt?: string;
	error?: string;
	/** Read from a row written before provider records existed */
	legacy?: boolean;
}

/** Stored on a video record (new videos): which providers hold it and their provider-side ids. */
export interface VideoMediaProviders {
	/** Providers this video was ingested to, in ingest order */
	providers: Partial<Record<MediaProviderId, StoredProviderRef>>;
}

export interface StoredProviderRef {
	ref: string;
	/** Provider-side status as the provider last reported it */
	status?: ProviderMediaStatus;
	/** Bunny: the Stream library the video lives in */
	libraryId?: number;
	addedAt: string;
	readyAt?: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Settings (admin, per environment): global_settings/ops/media-delivery.json
// ---------------------------------------------------------------------------

export type PlaybackStrategy = 'priority' | 'weighted';
export type PlaybackAssign = 'video' | 'view';

export interface PlaybackRules {
	/** priority: always the first ready provider of `order`; weighted: draw by `weights`, the rest as fallbacks */
	strategy: PlaybackStrategy;
	/** Providers that serve playback, best first. Also the fallback order. A provider not listed never plays. */
	order: MediaProviderId[];
	/** weighted: share of plays per provider in `order`, whole percents (renormalised over the ready ones) */
	weights: Partial<Record<MediaProviderId, number>>;
	/** weighted: one draw per video (stable, cache-friendly) or per view */
	assign: PlaybackAssign;
}

export interface ProviderHealthSettings {
	/** Move playback off a provider that is failing (it stays as the last fallback) */
	enabled: boolean;
	/** Player fallbacks away from a provider within `windowMinutes` that mark it unhealthy */
	failureThreshold: number;
	windowMinutes: number;
	/** Consecutive failed probes (one a minute) that mark it unhealthy */
	probeFailures: number;
	/** How long an unhealthy provider stays out of first place */
	cooldownMinutes: number;
}

/** Channel or video override: each field present replaces the global one. */
export interface MediaOverride {
	/** Ingest targets for new uploads (channel overrides only) */
	ingest?: MediaProviderId[];
	strategy?: PlaybackStrategy;
	order?: MediaProviderId[];
	weights?: Partial<Record<MediaProviderId, number>>;
	note?: string;
	updatedAt?: string;
	updatedBy?: string;
}

export interface MediaSettings {
	version: 2;
	/** Provider master switches: an off provider takes no uploads and plays nothing */
	providers: Record<MediaProviderId, { enabled: boolean }>;
	/** Where new uploads go (one or more, enabled only). */
	ingest: MediaProviderId[];
	playback: PlaybackRules;
	health: ProviderHealthSettings;
	/** Where custom thumbnails (uploaded images) are stored */
	thumbnails: { store: MediaProviderId };
	/** Per-channel overrides, by channel id */
	channels: Record<string, MediaOverride>;
	updatedAt?: string;
	updatedBy?: string;
}

/** Overrides kept per environment (the settings object stays small). */
export const MAX_CHANNEL_OVERRIDES = 200;
const NOTE_MAX = 200;

export const DEFAULT_HEALTH_SETTINGS: ProviderHealthSettings = {
	enabled: true,
	failureThreshold: 10,
	windowMinutes: 5,
	probeFailures: 3,
	cooldownMinutes: 10,
};

/**
 * Day one = today: uploads to Bunny and R2, playback from Bunny only (the legacy switch's default,
 * mode bunny), custom thumbnails in Bunny image storage.
 */
export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
	version: 2,
	providers: { bunny: { enabled: true }, r2: { enabled: true } },
	ingest: ['bunny', 'r2'],
	playback: { strategy: 'priority', order: ['bunny'], weights: { bunny: 100 }, assign: 'video' },
	health: DEFAULT_HEALTH_SETTINGS,
	thumbnails: { store: 'bunny' },
	channels: {},
};

/**
 * The legacy delivery switch ({ mode, r2Percent, assign, transcode }) as provider settings, with the
 * same primary source for every play:
 * - bunny: Bunny only;
 * - r2: R2 first, Bunny when R2 is not ready or fails;
 * - split: weighted R2 r2Percent / Bunny the rest, by video or by view, the other as the fallback;
 * - transcode: R2 is an ingest target.
 */
export function settingsFromLegacy(legacy: Partial<DeliverySettings> | null | undefined): MediaSettings {
	const l = legacy ?? {};
	const pct = Math.round(Number(l.r2Percent));
	const r2Percent = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 10;
	const assign: PlaybackAssign = l.assign === 'view' ? 'view' : 'video';
	const playback: PlaybackRules =
		l.mode === 'r2'
			? { strategy: 'priority', order: ['r2', 'bunny'], weights: { r2: 100, bunny: 0 }, assign }
			: l.mode === 'split'
				? { strategy: 'weighted', order: ['r2', 'bunny'], weights: { r2: r2Percent, bunny: 100 - r2Percent }, assign }
				: { strategy: 'priority', order: ['bunny'], weights: { bunny: 100 }, assign };
	return {
		...DEFAULT_MEDIA_SETTINGS,
		ingest: l.transcode === false ? ['bunny'] : ['bunny', 'r2'],
		playback,
		...(l.updatedAt ? { updatedAt: l.updatedAt } : {}),
		...(l.updatedBy ? { updatedBy: l.updatedBy } : {}),
	};
}

/**
 * The legacy switch derived from provider settings. Written beside them so a Worker version that
 * still reads the legacy shape (a rollback) plays and transcodes the same way.
 */
export function legacyFromSettings(s: MediaSettings): DeliverySettings {
	const rules = s.playback;
	const r2Plays = s.providers.r2.enabled && rules.order.includes('r2');
	const bunnyPlays = s.providers.bunny.enabled && rules.order.includes('bunny');
	let mode: DeliverySettings['mode'] = 'bunny';
	let r2Percent = 10;
	if (r2Plays && !bunnyPlays) mode = 'r2';
	else if (r2Plays && bunnyPlays) {
		if (rules.strategy === 'weighted') {
			const w = (p: MediaProviderId) => Math.max(0, rules.weights[p] ?? 0);
			const total = w('r2') + w('bunny');
			r2Percent = total > 0 ? Math.round((w('r2') * 100) / total) : 0;
			mode = r2Percent >= 100 ? 'r2' : r2Percent <= 0 ? 'bunny' : 'split';
		} else mode = rules.order.indexOf('r2') < rules.order.indexOf('bunny') ? 'r2' : 'bunny';
	}
	return {
		mode,
		r2Percent,
		assign: rules.assign,
		transcode: s.providers.r2.enabled && s.ingest.includes('r2'),
		...(s.updatedAt ? { updatedAt: s.updatedAt } : {}),
		...(s.updatedBy ? { updatedBy: s.updatedBy } : {}),
	};
}

function providerList(value: unknown): MediaProviderId[] | null {
	if (!Array.isArray(value)) return null;
	const out: MediaProviderId[] = [];
	for (const v of value) if (isMediaProviderId(v) && !out.includes(v)) out.push(v);
	return out;
}

function weightMap(value: unknown): Partial<Record<MediaProviderId, number>> {
	const out: Partial<Record<MediaProviderId, number>> = {};
	if (!value || typeof value !== 'object') return out;
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		const n = Math.round(Number(v));
		if (isMediaProviderId(k) && Number.isFinite(n)) out[k] = Math.min(100, Math.max(0, n));
	}
	return out;
}

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = Math.round(Number(value));
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** A stored or submitted override with only known, meaningful fields; null when nothing is left. */
export function normaliseMediaOverride(input: unknown): MediaOverride | null {
	if (!input || typeof input !== 'object') return null;
	const o = input as Record<string, unknown>;
	const out: MediaOverride = {};
	const ingest = providerList(o.ingest);
	if (ingest?.length) out.ingest = ingest;
	if (o.strategy === 'priority' || o.strategy === 'weighted') out.strategy = o.strategy;
	const order = providerList(o.order);
	if (order?.length) out.order = order;
	if (o.weights !== undefined) {
		const weights = weightMap(o.weights);
		if (Object.keys(weights).length) out.weights = weights;
	}
	if (typeof o.note === 'string' && o.note.trim()) out.note = o.note.trim().slice(0, NOTE_MAX);
	if (typeof o.updatedAt === 'string') out.updatedAt = o.updatedAt;
	if (typeof o.updatedBy === 'string') out.updatedBy = o.updatedBy;
	const meaningful = out.ingest || out.strategy || out.order || out.weights;
	return meaningful ? out : null;
}

const CHANNEL_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Any stored or submitted settings object as valid provider settings. A legacy object (no
 * `version: 2`) is migrated. Lists keep only known, unique providers; an empty ingest or playback
 * list falls back to the enabled providers so nothing can end up unplayable by a typo.
 */
export function normaliseMediaSettings(input: unknown): MediaSettings {
	const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
	if (raw.version !== 2) return settingsFromLegacy(raw as Partial<DeliverySettings>);
	const base = DEFAULT_MEDIA_SETTINGS;
	const providersIn = (raw.providers && typeof raw.providers === 'object' ? raw.providers : {}) as Record<string, { enabled?: unknown }>;
	const providers = Object.fromEntries(
		MEDIA_PROVIDER_IDS.map((id) => [id, { enabled: providersIn[id] ? providersIn[id]!.enabled !== false : base.providers[id].enabled }]),
	) as MediaSettings['providers'];
	const enabled = MEDIA_PROVIDER_IDS.filter((id) => providers[id].enabled);
	const playIn = (raw.playback && typeof raw.playback === 'object' ? raw.playback : {}) as Record<string, unknown>;
	const order = providerList(playIn.order) ?? base.playback.order;
	const healthIn = (raw.health && typeof raw.health === 'object' ? raw.health : {}) as Record<string, unknown>;
	const thumbStore = (raw.thumbnails as { store?: unknown } | undefined)?.store;
	const channels: Record<string, MediaOverride> = {};
	if (raw.channels && typeof raw.channels === 'object') {
		for (const [id, o] of Object.entries(raw.channels as Record<string, unknown>)) {
			if (!CHANNEL_ID.test(id) || Object.keys(channels).length >= MAX_CHANNEL_OVERRIDES) continue;
			const override = normaliseMediaOverride(o);
			if (override) channels[id] = override;
		}
	}
	const ingest = providerList(raw.ingest) ?? base.ingest;
	return {
		version: 2,
		providers,
		ingest: ingest.length ? ingest : enabled.slice(0, 1),
		playback: {
			strategy: playIn.strategy === 'weighted' ? 'weighted' : 'priority',
			order: order.length ? order : enabled,
			weights: weightMap(playIn.weights),
			assign: playIn.assign === 'view' ? 'view' : 'video',
		},
		health: {
			enabled: healthIn.enabled !== false,
			failureThreshold: boundedInt(healthIn.failureThreshold, 1, 10_000, base.health.failureThreshold),
			windowMinutes: boundedInt(healthIn.windowMinutes, 1, 60, base.health.windowMinutes),
			probeFailures: boundedInt(healthIn.probeFailures, 1, 60, base.health.probeFailures),
			cooldownMinutes: boundedInt(healthIn.cooldownMinutes, 1, 24 * 60, base.health.cooldownMinutes),
		},
		thumbnails: { store: isMediaProviderId(thumbStore) ? thumbStore : base.thumbnails.store },
		channels,
		...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
		...(typeof raw.updatedBy === 'string' ? { updatedBy: raw.updatedBy } : {}),
	};
}

export type SettingsProblem =
	| 'no_provider_enabled'
	| 'ingest_empty'
	| 'ingest_disabled'
	| 'playback_empty'
	| 'ingest_not_playable'
	| 'weights_zero'
	| 'thumbnail_store_disabled'
	| 'override_ingest_disabled'
	| 'override_not_playable';

/**
 * What would make settings unsafe to save, worst first (empty: fine). An admin can never leave new
 * uploads with no playable copy: every ingest target set must reach at least one playback provider.
 */
export function settingsProblems(s: MediaSettings): { problem: SettingsProblem; detail?: string }[] {
	const out: { problem: SettingsProblem; detail?: string }[] = [];
	const on = (p: MediaProviderId) => s.providers[p].enabled;
	if (!MEDIA_PROVIDER_IDS.some(on)) out.push({ problem: 'no_provider_enabled' });
	if (!s.ingest.length) out.push({ problem: 'ingest_empty' });
	for (const p of s.ingest) if (!on(p)) out.push({ problem: 'ingest_disabled', detail: p });
	const playable = s.playback.order.filter(on);
	if (!playable.length) out.push({ problem: 'playback_empty' });
	// A provider that is off may stay in the order (skipped while off, back in place when switched on)
	if (s.ingest.length && !s.ingest.some((p) => playable.includes(p))) out.push({ problem: 'ingest_not_playable' });
	if (s.playback.strategy === 'weighted' && !playable.some((p) => (s.playback.weights[p] ?? 0) > 0)) out.push({ problem: 'weights_zero' });
	if (!on(s.thumbnails.store)) out.push({ problem: 'thumbnail_store_disabled', detail: s.thumbnails.store });
	for (const [channelId, o] of Object.entries(s.channels)) {
		if (o.ingest?.some((p) => !on(p))) out.push({ problem: 'override_ingest_disabled', detail: channelId });
		const rules = effectiveRules(s, o);
		const ingest = o.ingest ?? s.ingest;
		if (!ingest.some((p) => rules.order.includes(p) && on(p))) out.push({ problem: 'override_not_playable', detail: channelId });
	}
	return out;
}

/** Ingest targets for a new upload: the channel's override, else the global list; enabled only. */
export function ingestTargets(s: MediaSettings, channelId?: string | null): MediaProviderId[] {
	const list = (channelId ? s.channels[channelId]?.ingest : undefined) ?? s.ingest;
	return list.filter((p) => s.providers[p].enabled);
}

/** Global rules with a channel's and then a video's override applied (each field replaces). */
export function effectiveRules(s: MediaSettings, ...overrides: (MediaOverride | null | undefined)[]): PlaybackRules {
	let rules: PlaybackRules = { ...s.playback, weights: { ...s.playback.weights } };
	for (const o of overrides) {
		if (!o) continue;
		rules = {
			...rules,
			...(o.strategy ? { strategy: o.strategy } : {}),
			...(o.order?.length ? { order: [...o.order] } : {}),
			...(o.weights ? { weights: { ...o.weights } } : {}),
		};
	}
	return rules;
}

// ---------------------------------------------------------------------------
// Planner (pure): which providers a play uses, in order
// ---------------------------------------------------------------------------

export type PlanReason =
	| 'priority'
	| 'weighted'
	| 'weighted_zero_weights'
	| 'unhealthy_moved'
	| 'none_ready';

export interface PlanInput {
	rules: PlaybackRules;
	/** Providers switched on */
	enabled: readonly MediaProviderId[];
	/** Providers whose copy of this video is ready to play */
	ready: readonly MediaProviderId[];
	/** Providers the health check holds out of first place */
	unhealthy?: readonly MediaProviderId[];
	/** Providers that already failed for this player */
	exclude?: readonly MediaProviderId[];
	/** 0..99: the video's bucket (assign = video) or this view's draw (assign = view); weighted only */
	bucket: number;
}

export interface SourcePlan {
	/** Providers to try, in order: the first plays, the rest are fallbacks */
	order: MediaProviderId[];
	reason: PlanReason;
	/** Unhealthy providers moved behind healthy ones */
	demoted?: MediaProviderId[];
}

/**
 * Ordered providers for one play. Only enabled, ready, listed and not excluded providers take part.
 * Health never removes the last way to play: unhealthy providers move to the end, they are not dropped.
 * Weighted: the bucket picks the first provider by weight over the healthy candidates (cumulative in
 * `order`), the rest follow in `order`. With legacy split settings (order r2, bunny; weights r2 = p)
 * a bucket below p plays R2 and any other Bunny, exactly the old rule.
 */
export function planSources(input: PlanInput): SourcePlan {
	const { rules } = input;
	const exclude = new Set(input.exclude ?? []);
	const unhealthy = new Set(input.unhealthy ?? []);
	const candidates = rules.order.filter((p) => input.enabled.includes(p) && input.ready.includes(p) && !exclude.has(p));
	if (!candidates.length) return { order: [], reason: 'none_ready' };
	const healthy = candidates.filter((p) => !unhealthy.has(p));
	const demoted = healthy.length ? candidates.filter((p) => unhealthy.has(p)) : [];
	const head = healthy.length ? healthy : candidates;
	const withDemoted = (order: MediaProviderId[], reason: PlanReason): SourcePlan =>
		demoted.length ? { order: [...order, ...demoted], reason: 'unhealthy_moved', demoted } : { order, reason };

	if (rules.strategy !== 'weighted' || head.length === 1) return withDemoted(head, rules.strategy === 'weighted' ? 'weighted' : 'priority');
	const weights = head.map((p) => Math.max(0, rules.weights[p] ?? 0));
	const total = weights.reduce((a, b) => a + b, 0);
	if (total <= 0) return withDemoted(head, 'weighted_zero_weights');
	const point = (Math.min(99, Math.max(0, Math.floor(input.bucket))) * total) / 100;
	let acc = 0;
	let pick = head[head.length - 1]!;
	for (let i = 0; i < head.length; i++) {
		acc += weights[i]!;
		if (point < acc) {
			pick = head[i]!;
			break;
		}
	}
	return withDemoted([pick, ...head.filter((p) => p !== pick)], 'weighted');
}

/** The bucket of a play: stable per video (assign = video) or drawn per view. */
export function playBucket(rules: PlaybackRules, videoId: string, draw: () => number): number {
	return rules.assign === 'view' ? draw() : deliveryBucket(videoId);
}

// ---------------------------------------------------------------------------
// Health (written by the api-videos cron, read by the planner and the admin page)
// ---------------------------------------------------------------------------

export type ProviderHealthState = 'healthy' | 'unhealthy';

export interface ProviderHealth {
	state: ProviderHealthState;
	/** When the state last changed */
	since: string;
	/** unhealthy: not moved back before this */
	until?: string;
	reason?: string;
	/** Player fallbacks away from it in the last window */
	recentFailures: number;
	consecutiveProbeFailures: number;
	lastProbeAt?: string;
	lastProbeOk?: boolean;
	lastProbeMs?: number;
}

export interface MediaHealthSnapshot {
	providers: Partial<Record<MediaProviderId, ProviderHealth>>;
	checkedAt: string;
}

/** Providers held out of first place right now. */
export function unhealthyProviders(snapshot: MediaHealthSnapshot | null | undefined, health: ProviderHealthSettings, nowMs = Date.now()): MediaProviderId[] {
	if (!snapshot || !health.enabled) return [];
	return MEDIA_PROVIDER_IDS.filter((p) => {
		const h = snapshot.providers[p];
		if (!h || h.state !== 'unhealthy') return false;
		return !h.until || Date.parse(h.until) > nowMs || h.consecutiveProbeFailures > 0;
	});
}

/**
 * The next health of one provider (pure; the cron applies it each minute). Unhealthy when player
 * fallbacks in the window reach the threshold or probes fail `probeFailures` times in a row; healthy
 * again once the cooldown has passed, probes pass and fallbacks are back under the threshold.
 */
export function nextProviderHealth(
	prev: ProviderHealth | undefined,
	obs: { recentFailures: number; probeOk: boolean | null; probeMs?: number },
	health: ProviderHealthSettings,
	now: Date,
): ProviderHealth {
	const at = now.toISOString();
	const consecutive = obs.probeOk === false ? (prev?.consecutiveProbeFailures ?? 0) + 1 : obs.probeOk === true ? 0 : (prev?.consecutiveProbeFailures ?? 0);
	const base = {
		recentFailures: obs.recentFailures,
		consecutiveProbeFailures: consecutive,
		...(obs.probeOk !== null ? { lastProbeAt: at, lastProbeOk: obs.probeOk } : prev?.lastProbeAt ? { lastProbeAt: prev.lastProbeAt, lastProbeOk: prev.lastProbeOk } : {}),
		...(obs.probeMs !== undefined ? { lastProbeMs: Math.round(obs.probeMs) } : prev?.lastProbeMs !== undefined ? { lastProbeMs: prev.lastProbeMs } : {}),
	};
	const tooManyFallbacks = obs.recentFailures >= health.failureThreshold;
	const probesDown = consecutive >= health.probeFailures;
	const until = new Date(now.getTime() + health.cooldownMinutes * 60_000).toISOString();
	if (tooManyFallbacks || probesDown) {
		const reason = probesDown ? `probe failed ${consecutive} times in a row` : `${obs.recentFailures} player fallbacks in ${health.windowMinutes} min`;
		if (prev?.state === 'unhealthy') return { ...base, state: 'unhealthy', since: prev.since, until, reason };
		return { ...base, state: 'unhealthy', since: at, until, reason };
	}
	if (prev?.state === 'unhealthy' && prev.until && Date.parse(prev.until) > now.getTime()) {
		return { ...base, state: 'unhealthy', since: prev.since, until: prev.until, ...(prev.reason ? { reason: prev.reason } : {}) };
	}
	return { ...base, state: 'healthy', since: prev?.state === 'healthy' ? prev.since : at };
}

// ---------------------------------------------------------------------------
// What clients get
// ---------------------------------------------------------------------------

/** One playable source in a video response: signed by the API, tried in list order. */
export interface PlaybackSourceView {
	/** Provider label (never a provider-side id) */
	provider: MediaProviderId;
	/** Signed HLS master playlist */
	src: string;
	type: 'application/x-mpegURL';
}
