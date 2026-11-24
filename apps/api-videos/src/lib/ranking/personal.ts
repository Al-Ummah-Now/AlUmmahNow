/**
 * Recommended for a signed-in viewer (wiki E07 "Discovery ranking").
 *
 * Personal only when the viewer's watch history is on: a paused history (the
 * privacy setting) means no personalisation at all, and the viewer gets the
 * same content-based "top" list as anyone (E21: intentional viewing, nothing
 * engagement-maximising). When on, candidates are the site's top list, the
 * newest videos of subscribed channels and videos like the recent history;
 * they are scored by similarity to that history, a subscription boost and the
 * site ranking, videos already watched are left out, and the list is mixed
 * across channels. Nothing is stored: the list is computed per request.
 */
import { ageRulesOn } from '../contentFlags';
import { buildProfile, recommendationScore, type DiscoveryVideo } from '../discovery';
import { indexedCandidates, indexedSeeds, loadRecentHistory } from '../recommendations';
import { subscribedChannelIds } from '../subscription-store';
import { subscriptionFeedIds } from '../feedIndex';
import { logger } from '../logger';
import { diversify } from './rank';
import { RAIL_LIMIT } from './job';
import type { SearchDb } from '@al-ummah/shared-types';

/** Most personal list kept (pages are read from it) */
export const PERSONAL_LIMIT = 200;
/** Newest videos read from subscribed channels */
const SUBSCRIPTION_CANDIDATES = 60;
/** D1 allows 100 bound parameters per statement */
const IDS_PER_QUERY = 90;

export const SUBSCRIPTION_BOOST = 3;
/** The site ranking's weight: position 1 of the top list adds this much, the last adds ~0 */
export const SITE_RANK_WEIGHT = 2;

export interface PersonalInputs {
	candidates: DiscoveryVideo[];
	/** Recent history, newest first (the profile's seeds) */
	seeds: DiscoveryVideo[];
	subscribed: ReadonlySet<string>;
	/** Position in the site's top list (1-based) */
	sitePosition: ReadonlyMap<string, number>;
	watched: ReadonlySet<string>;
	now: number;
	limit: number;
}

/** Pure: the personal order (ids), diversified across channels. */
export function rankPersonal(inputs: PersonalInputs): Array<{ id: string; score: number }> {
	const profile = buildProfile(inputs.seeds);
	const hasHistory = inputs.seeds.length > 0;
	const scored = inputs.candidates
		.filter((v) => !inputs.watched.has(v.id))
		.map((v) => {
			const similarity = hasHistory ? recommendationScore(v, profile, inputs.now) : 0;
			const subscribed = v.channelId && inputs.subscribed.has(v.channelId) ? SUBSCRIPTION_BOOST : 0;
			const position = inputs.sitePosition.get(v.id);
			const site = position ? SITE_RANK_WEIGHT * (1 - (position - 1) / RAIL_LIMIT) : 0;
			return { v: { id: v.id, channelId: v.channelId ?? null }, score: similarity + subscribed + site };
		});
	return diversify(scored, inputs.limit).map((s) => ({ id: s.v.id, score: Math.round(s.score * 1000) / 1000 }));
}

async function indexed(db: SearchDb, ids: string[]): Promise<Map<string, DiscoveryVideo>> {
	const out = new Map<string, DiscoveryVideo>();
	for (let i = 0; i < ids.length; i += IDS_PER_QUERY) {
		for (const [id, video] of await indexedSeeds(db, ids.slice(i, i + IDS_PER_QUERY))) out.set(id, video);
	}
	return out;
}

export interface PersonalEnv {
	SEARCH_DB?: unknown;
	NOTIFICATIONS_DB?: unknown;
	profiles?: R2Bucket;
	watch_history?: R2Bucket;
}

/**
 * The viewer's personal order, or null when it must not be personal (history
 * paused) or there is nothing to personalise from (no history, no subscriptions).
 */
export async function personalOrder(env: PersonalEnv, userId: string, topIds: readonly string[], now = Date.now()): Promise<Array<{ id: string; score: number }> | null> {
	const db = env.SEARCH_DB as SearchDb | undefined;
	if (!db) return null;
	const profile = await env.profiles
		?.get(userId)
		.then((o) => (o ? o.json<{ watchHistoryPaused?: boolean; subscribedTo?: string[] }>() : null))
		.catch(() => null);
	// The privacy setting: a paused history turns personalisation off entirely
	if (profile?.watchHistoryPaused === true) return null;
	const [history, subscribed] = await Promise.all([
		loadRecentHistory(env.watch_history, userId).catch(() => ({ watchedIds: [] as string[], seedIds: [] as string[] })),
		subscribedChannelIds(env.NOTIFICATIONS_DB as never, userId, profile?.subscribedTo).catch((error) => {
			logger.warn('[Discovery] Subscriptions unavailable for recommendations', { error: error instanceof Error ? error.message : String(error) });
			return [] as string[];
		}),
	]);
	if (history.seedIds.length === 0 && subscribed.length === 0) return null;

	const seedMap = await indexed(db, history.seedIds);
	// A video made for kids never shapes what is suggested, even one watched before it was marked (wiki E20 §5.5)
	const kidsRules = await ageRulesOn(env).catch(() => true);
	const seeds = history.seedIds.map((id) => seedMap.get(id)).filter((v): v is DiscoveryVideo => !!v && !(kidsRules && v.madeForKids === true));
	const fromSubscriptions = subscribed.length ? ((await subscriptionFeedIds(env, subscribed, SUBSCRIPTION_CANDIDATES, 0))?.ids ?? []) : [];
	const [similar, byId] = await Promise.all([
		seeds.length ? indexedCandidates(db, seeds) : Promise.resolve([] as DiscoveryVideo[]),
		indexed(db, [...new Set([...topIds, ...fromSubscriptions])]),
	]);
	for (const v of similar) byId.set(v.id, v);
	return rankPersonal({
		candidates: [...byId.values()],
		seeds,
		subscribed: new Set(subscribed),
		sitePosition: new Map(topIds.map((id, i) => [id, i + 1])),
		watched: new Set(history.watchedIds),
		now,
		limit: PERSONAL_LIMIT,
	});
}
