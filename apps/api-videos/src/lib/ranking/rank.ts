/**
 * Discovery ranking (wiki E07 "Discovery ranking"): pure scoring and rail
 * building. The hourly job (./job.ts) loads the inputs from D1 and writes the
 * rails this returns; endpoints only read them (./serve.ts).
 *
 * Cold start is the normal case: the library arrives by admin bulk import and
 * there are almost no viewers. So every rail starts from a prior that needs no
 * engagement at all:
 *
 *   prior   = quality (verified channel, captions, title in both languages, description)
 *           x freshness (when it arrived on the platform, and less so its original publish date)
 *           + an admin-featured boost
 *
 * Engagement (unique qualified viewers per day, likes, comments; owners,
 * staff, test accounts and autoplay never count) blends in by confidence
 * c = n / (n + K), n = unique viewer-days in the window. One or two views
 * barely move a video, and a rail only calls itself Trending or Popular once
 * enough videos have real signal; otherwise it relabels ("New this week",
 * "Featured") instead of showing noise.
 *
 * Every rail is re-ranked for channel diversity, so one channel's bulk import
 * can't fill it, and admin pins take their slots last.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** What the job knows about each listed (public, ready, released, review-cleared) video. */
export interface RankVideo {
	id: string;
	channelId: string | null;
	category: string | null;
	/** 'ar' | 'en' | other | null (unknown) */
	language: string | null;
	isShort: boolean;
	isLive: boolean;
	/** Seconds; 0 when unknown */
	duration: number;
	/** Epoch ms it arrived on the platform (record created; an import's arrival) */
	addedAt: number | null;
	/** Epoch ms of its original publish date (an import keeps its YouTube date) */
	publishedAt: number | null;
	hasThumbnail: boolean;
	/** Has its title in both site languages */
	bilingualTitle: boolean;
	hasDescription: boolean;
	hasCaptions: boolean;
	channelVerified: boolean;
	/** Uploaded by an E2E / throwaway test account, or excluded by an admin */
	excluded: boolean;
}

/** One day of qualified engagement; `age` 0 is today (UTC), 1 yesterday, ... */
export interface EngagementDay {
	age: number;
	/** Unique qualified viewers that day */
	viewers: number;
	/** New likes that day (one per member) */
	likes: number;
	/** Comment authors that day (one per member) */
	comments: number;
}

export type Engagement = ReadonlyArray<EngagementDay>;

export type TrendingWindow = 'day' | 'week' | 'month';

export const TRENDING_WINDOWS: readonly TrendingWindow[] = ['day', 'week', 'month'];

export interface WindowParams {
	/** Days of history the window covers */
	days: number;
	/** Engagement this many days old counts half */
	halfLife: number;
	/** Confidence constant: c = n / (n + K) */
	K: number;
	/** Unique viewer-days a video needs in the window to count as trending */
	minViewers: number;
}

export const WINDOW_PARAMS: Readonly<Record<TrendingWindow, WindowParams>> = {
	day: { days: 2, halfLife: 0.75, K: 5, minViewers: 3 },
	week: { days: 7, halfLife: 3.5, K: 10, minViewers: 5 },
	month: { days: 30, halfLife: 15, K: 20, minViewers: 8 },
};

/** Popular looks at the last 90 days of qualified engagement. */
export const POPULAR_PARAMS: WindowParams = { days: 90, halfLife: 90, K: 30, minViewers: 20 };

/** A rail calls itself Trending / Popular only with at least this many videos that have real signal. */
export const MIN_SIGNAL_ITEMS = 6;

/** Freshness half-lives: arrival on the platform, original publish date. */
export const ADDED_HALF_LIFE_DAYS = 7;
export const PUBLISHED_HALF_LIFE_DAYS = 180;

/** Engagement weights: a comment or like says more than a view. */
export const LIKE_WEIGHT = 3;
export const COMMENT_WEIGHT = 5;

/** The engagement value that maps to a full signal (1.0) */
const SIGNAL_REFERENCE = Math.log1p(100);

/** Each further video of a channel already in the rail counts this much less (diversity). */
export const CHANNEL_PENALTY = 0.7;

/** Language boost for a language-scoped rail: other-language videos stay, just lower. */
export const LANGUAGE_FACTOR = { match: 1, unknown: 0.85, other: 0.6 } as const;

/** Rails the job builds. */
export type RailKind = 'trending' | 'popular' | 'new' | 'featured' | 'top';

/** What a rail is showing right now; clients pick the label from it. */
export type RailMode = 'trending' | 'popular' | 'new' | 'featured' | 'top';

/** Label key a client shows (shared-types i18n `discovery.rails.*`). */
export type RailLabel =
	| 'trending_today'
	| 'trending_this_week'
	| 'trending_this_month'
	| 'popular'
	| 'new_today'
	| 'new_this_week'
	| 'new_this_month'
	| 'latest'
	| 'featured'
	| 'top';

export type ItemReason = 'pinned' | 'trending' | 'popular' | 'fresh' | 'quality' | 'top';

export interface RailItem {
	id: string;
	score: number;
	reason: ItemReason;
}

export interface Rail {
	mode: RailMode;
	label: RailLabel;
	/** Videos in the list that have qualified signal for this rail */
	signalItems: number;
	items: RailItem[];
}

/** An admin pin (discovery_pins), already filtered to this rail and its active window. */
export interface Pin {
	kind: 'video' | 'channel';
	targetId: string;
	/** 1-based slot */
	position: number;
}

export interface RankContext {
	now: number;
	/** Channels an admin featured (channel pins anywhere): they get the featured boost */
	featuredChannels: ReadonlySet<string>;
}

const round = (n: number) => Math.round(n * 10000) / 10000;

function halfLifeDecay(ageDays: number, halfLife: number): number {
	return Math.pow(0.5, Math.max(ageDays, 0) / halfLife);
}

/** Eligible for any rail: complete enough to look good on a card and not test/excluded content. */
export function isRailEligible(v: RankVideo): boolean {
	return !v.excluded && !v.isLive && v.hasThumbnail && v.duration > 0;
}

/** 0..1: how complete and trustworthy the video looks with no engagement at all. */
export function qualityScore(v: RankVideo): number {
	return round(
		0.35 +
			(v.channelVerified ? 0.25 : 0) +
			(v.hasCaptions ? 0.15 : 0) +
			(v.bilingualTitle ? 0.15 : 0) +
			(v.hasDescription ? 0.1 : 0),
	);
}

/** 0..1: arrival on the platform weighs most; an old import still counts as new this week. */
export function freshnessScore(v: RankVideo, now: number): number {
	const added = v.addedAt ?? v.publishedAt;
	const published = v.publishedAt ?? v.addedAt;
	const addedPart = added === null ? 0 : halfLifeDecay((now - added) / DAY_MS, ADDED_HALF_LIFE_DAYS);
	const publishedPart = published === null ? 0 : halfLifeDecay((now - published) / DAY_MS, PUBLISHED_HALF_LIFE_DAYS);
	return round(0.75 * addedPart + 0.25 * publishedPart);
}

/** 0..1: the engagement-free score every rail starts from. */
export function priorScore(v: RankVideo, ctx: RankContext): number {
	const featured = v.channelId && ctx.featuredChannels.has(v.channelId) ? 1 : 0;
	return round(0.5 * qualityScore(v) + 0.35 * freshnessScore(v, ctx.now) + 0.15 * featured);
}

export interface WindowSignal {
	/** Decayed engagement value in the window */
	value: number;
	/** Unique viewer-days in the window */
	viewers: number;
	/** 0..1 confidence n / (n + K) */
	confidence: number;
	/** Enough viewers to count as trending / popular */
	qualified: boolean;
}

/** Engagement inside a window, decayed by age, with its confidence. */
export function windowSignal(engagement: Engagement | undefined, params: WindowParams): WindowSignal {
	let value = 0;
	let viewers = 0;
	for (const day of engagement ?? []) {
		if (day.age < 0 || day.age >= params.days) continue;
		const weight = halfLifeDecay(day.age, params.halfLife);
		const v = Math.max(day.viewers, 0);
		value += weight * (v + LIKE_WEIGHT * Math.max(day.likes, 0) + COMMENT_WEIGHT * Math.max(day.comments, 0));
		viewers += v;
	}
	const confidence = viewers / (viewers + params.K);
	return { value: round(value), viewers, confidence: round(confidence), qualified: viewers >= params.minViewers };
}

/**
 * Blend engagement into the prior by confidence: with no viewers the score is
 * the prior; with many it is mostly the (log-scaled) engagement.
 */
export function blendedScore(signal: WindowSignal, prior: number): number {
	const s = Math.log1p(signal.value) / SIGNAL_REFERENCE;
	return round(signal.confidence * (1 + s) + (1 - signal.confidence) * prior);
}

export function languageFactor(v: RankVideo, language: string | null | undefined): number {
	if (!language) return 1;
	if (!v.language) return LANGUAGE_FACTOR.unknown;
	return v.language === language ? LANGUAGE_FACTOR.match : LANGUAGE_FACTOR.other;
}

interface Scored {
	v: RankVideo;
	score: number;
	reason: ItemReason;
}

/**
 * Greedy diversity re-rank: at each slot take the best video after a penalty
 * of CHANNEL_PENALTY per video its channel already has in the rail. With one
 * channel only, the rail still fills (in score order).
 */
export function diversify<T extends { v: { id: string; channelId: string | null }; score: number }>(scored: T[], limit: number): T[] {
	const queues = new Map<string, T[]>();
	for (const item of [...scored].sort((a, b) => b.score - a.score || a.v.id.localeCompare(b.v.id))) {
		const key = item.v.channelId ?? `__${item.v.id}`;
		const queue = queues.get(key);
		if (!queue) queues.set(key, [item]);
		else if (queue.length < limit) queue.push(item);
	}
	const picked = new Map<string, number>();
	const out: T[] = [];
	while (out.length < limit && queues.size > 0) {
		let bestKey: string | null = null;
		let best = -Infinity;
		let bestId = '';
		for (const [key, queue] of queues) {
			const head = queue[0];
			const adjusted = head.score * Math.pow(CHANNEL_PENALTY, picked.get(key) ?? 0);
			if (adjusted > best || (adjusted === best && head.v.id < bestId)) {
				best = adjusted;
				bestKey = key;
				bestId = head.v.id;
			}
		}
		if (bestKey === null) break;
		const queue = queues.get(bestKey)!;
		out.push(queue.shift()!);
		picked.set(bestKey, (picked.get(bestKey) ?? 0) + 1);
		if (queue.length === 0) queues.delete(bestKey);
	}
	return out;
}

/**
 * Put admin pins in their slots (1-based, in position order). A video pin
 * needs the video to be eligible; a channel pin takes that channel's best
 * video in `pool` (the rail's candidates) that isn't already pinned.
 */
export function applyPins(items: RailItem[], pins: readonly Pin[], pool: ReadonlyMap<string, RankVideo>, ranked: readonly Scored[], limit: number): RailItem[] {
	if (pins.length === 0) return items.slice(0, limit);
	const pinnedIds: string[] = [];
	const slots: Array<{ position: number; id: string }> = [];
	for (const pin of [...pins].sort((a, b) => a.position - b.position)) {
		let id: string | undefined;
		if (pin.kind === 'video') {
			id = pool.has(pin.targetId) ? pin.targetId : undefined;
		} else {
			id = ranked.find((s) => s.v.channelId === pin.targetId && !pinnedIds.includes(s.v.id))?.v.id;
			if (!id) {
				// Not in the rail's list: the channel's best eligible video in the pool
				let bestScore = -Infinity;
				for (const v of pool.values()) {
					if (v.channelId !== pin.targetId || pinnedIds.includes(v.id)) continue;
					const s = v.addedAt ?? 0;
					if (s > bestScore) {
						bestScore = s;
						id = v.id;
					}
				}
			}
		}
		if (!id || pinnedIds.includes(id)) continue;
		pinnedIds.push(id);
		slots.push({ position: Math.max(1, Math.trunc(pin.position)), id });
	}
	const rest = items.filter((item) => !pinnedIds.includes(item.id));
	const out: RailItem[] = [];
	let restIndex = 0;
	let slotIndex = 0;
	while (out.length < limit && (restIndex < rest.length || slotIndex < slots.length)) {
		const slot = slots[slotIndex];
		if (slot && (slot.position <= out.length + 1 || restIndex >= rest.length)) {
			const original = items.find((i) => i.id === slot.id);
			out.push({ id: slot.id, score: original?.score ?? 0, reason: 'pinned' });
			slotIndex += 1;
		} else {
			out.push(rest[restIndex]);
			restIndex += 1;
		}
	}
	return out;
}

export interface BuildOptions {
	limit: number;
	/** Language the rail is scoped to (boost, never a filter) */
	language?: string | null;
	/** Category the rail is limited to */
	category?: string | null;
	/** Content language the rail is limited to (Explore's language filter) */
	onlyLanguage?: string | null;
	/** Leave Shorts out (home rails show videos; Shorts have their own shelf) */
	excludeShorts?: boolean;
	pins?: readonly Pin[];
}

export interface RankInputs {
	videos: readonly RankVideo[];
	engagement: ReadonlyMap<string, Engagement>;
	ctx: RankContext;
}

function candidates(inputs: RankInputs, options: BuildOptions): RankVideo[] {
	return inputs.videos.filter(
		(v) =>
			isRailEligible(v) &&
			(!options.excludeShorts || !v.isShort) &&
			(!options.category || v.category === options.category) &&
			(!options.onlyLanguage || v.language === options.onlyLanguage),
	);
}

function finish(scored: Scored[], options: BuildOptions, pool: RankVideo[]): RailItem[] {
	const ranked = diversify(scored, options.limit);
	const items = ranked.map((s) => ({ id: s.v.id, score: round(s.score), reason: s.reason }));
	return applyPins(items, options.pins ?? [], new Map(pool.map((v) => [v.id, v])), ranked, options.limit);
}

const NEW_LABELS: ReadonlyArray<{ days: number; label: RailLabel }> = [
	{ days: 1, label: 'new_today' },
	{ days: 7, label: 'new_this_week' },
	{ days: 30, label: 'new_this_month' },
];

const TRENDING_LABEL: Readonly<Record<TrendingWindow, RailLabel>> = {
	day: 'trending_today',
	week: 'trending_this_week',
	month: 'trending_this_month',
};

const WINDOW_DAYS: Readonly<Record<TrendingWindow, number>> = { day: 1, week: 7, month: 30 };

/** Score for "new" lists: arrival order, nudged by quality. */
function freshScore(v: RankVideo, ctx: RankContext): number {
	return 0.75 * freshnessScore(v, ctx.now) + 0.25 * qualityScore(v);
}

/**
 * New: newest first, diversified. The heading is the narrowest window with
 * enough arrivals (day → week → month → "Latest"); with `windowOnly` (Trending
 * standing in) the list holds only that window's videos.
 */
export function buildNew(inputs: RankInputs, options: BuildOptions, fromDays = 1, windowOnly = false): Rail {
	const pool = candidates(inputs, options);
	const arrived = (v: RankVideo) => v.addedAt ?? v.publishedAt ?? 0;
	let chosen: { label: RailLabel; videos: RankVideo[] } | null = null;
	for (const window of NEW_LABELS) {
		if (window.days < fromDays) continue;
		const since = inputs.ctx.now - window.days * DAY_MS;
		const videos = pool.filter((v) => arrived(v) >= since);
		if (videos.length >= MIN_SIGNAL_ITEMS) {
			chosen = { label: window.label, videos };
			break;
		}
	}
	chosen ??= { label: 'latest', videos: pool };
	const lang = options.language;
	// The New rail runs on into older uploads (its heading names where it starts); a Trending
	// rail standing in as "New this week" holds only that week's uploads
	const listed = windowOnly ? chosen.videos : pool;
	const scored = listed.map((v) => ({ v, score: freshScore(v, inputs.ctx) * languageFactor(v, lang), reason: 'fresh' as const }));
	return { mode: 'new', label: chosen.label, signalItems: 0, items: finish(scored, options, pool) };
}

/**
 * Trending in a window: videos with enough qualified viewers, ranked by
 * blended score. Too few of them → the rail becomes "New today / this week /
 * this month" (never an empty or noisy Trending).
 */
export function buildTrending(inputs: RankInputs, window: TrendingWindow, options: BuildOptions): Rail {
	const params = WINDOW_PARAMS[window];
	const pool = candidates(inputs, options);
	const qualified: Scored[] = [];
	for (const v of pool) {
		const signal = windowSignal(inputs.engagement.get(v.id), params);
		if (!signal.qualified) continue;
		const score = blendedScore(signal, priorScore(v, inputs.ctx)) * languageFactor(v, options.language);
		qualified.push({ v, score, reason: 'trending' });
	}
	if (qualified.length < MIN_SIGNAL_ITEMS) {
		const fallback = buildNew(inputs, options, WINDOW_DAYS[window], true);
		return { ...fallback, signalItems: qualified.length };
	}
	return { mode: 'trending', label: TRENDING_LABEL[window], signalItems: qualified.length, items: finish(qualified, options, pool) };
}

/**
 * Popular (global): 90 days of qualified engagement blended into the prior.
 * Too little signal → "Featured": the same list ordered by the prior
 * (verified, complete, admin-featured, fresh).
 */
export function buildPopular(inputs: RankInputs, options: BuildOptions): Rail {
	const pool = candidates(inputs, options);
	let signalItems = 0;
	const scored: Scored[] = pool.map((v) => {
		const signal = windowSignal(inputs.engagement.get(v.id), POPULAR_PARAMS);
		if (signal.qualified) signalItems += 1;
		const prior = priorScore(v, inputs.ctx);
		return {
			v,
			score: blendedScore(signal, prior) * languageFactor(v, options.language),
			reason: signal.qualified ? ('popular' as const) : ('quality' as const),
		};
	});
	if (signalItems < MIN_SIGNAL_ITEMS) {
		return { ...buildFeatured(inputs, options), signalItems };
	}
	return { mode: 'popular', label: 'popular', signalItems, items: finish(scored, options, pool) };
}

/** Featured: admin pins first, then the prior (quality-led). */
export function buildFeatured(inputs: RankInputs, options: BuildOptions): Rail {
	const pool = candidates(inputs, options);
	const scored = pool.map((v) => {
		const featured = v.channelId && inputs.ctx.featuredChannels.has(v.channelId) ? 1 : 0;
		const score = (0.6 * qualityScore(v) + 0.25 * featured + 0.15 * freshnessScore(v, inputs.ctx.now)) * languageFactor(v, options.language);
		return { v, score, reason: 'quality' as const };
	});
	return { mode: 'featured', label: 'featured', signalItems: 0, items: finish(scored, options, pool) };
}

/**
 * Top: the default order for Explore, categories and anonymous
 * recommendations. Week trend and 90-day popularity blended into the prior;
 * with no engagement it is the prior alone.
 */
export function buildTop(inputs: RankInputs, options: BuildOptions): Rail {
	const pool = candidates(inputs, options);
	let signalItems = 0;
	const scored = pool.map((v) => {
		const engagement = inputs.engagement.get(v.id);
		const week = windowSignal(engagement, WINDOW_PARAMS.week);
		const popular = windowSignal(engagement, POPULAR_PARAMS);
		if (week.qualified || popular.qualified) signalItems += 1;
		const prior = priorScore(v, inputs.ctx);
		const score = (0.4 * blendedScore(week, prior) + 0.3 * blendedScore(popular, prior) + 0.3 * prior) * languageFactor(v, options.language);
		return { v, score, reason: 'top' as const };
	});
	return { mode: 'top', label: 'top', signalItems, items: finish(scored, options, pool) };
}

/** A stable fingerprint of a rail, so the job rewrites only rails that changed. */
export function railHash(rail: Rail): string {
	const text = JSON.stringify([rail.mode, rail.label, rail.items.map((i) => [i.id, i.reason])]);
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}
