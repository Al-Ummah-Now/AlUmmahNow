import type { ChannelTabCounts } from '@al-ummah/shared-types';
import { channelFormatCountsFromIndex, type OwnershipEnv } from './search/ownership';
import { logger } from './logger';

/** The buckets and database the counts read (api-videos env). */
export interface TabCountsEnv extends OwnershipEnv {
	channel_sections?: R2Bucket;
}

/** Section types whose content is channels (the Channels tab: featured + public subscriptions). */
const CHANNEL_SECTION_TYPES = new Set(['featured_channels', 'subscribed_channels']);
/** Sections read at most (a channel has a handful; the Channels tab reads the same list) */
const MAX_SECTIONS = 100;

async function indexedCount(env: TabCountsEnv, table: 'search_playlists' | 'search_posts', channelId: string): Promise<number> {
	const db = env.SEARCH_DB;
	if (!db) throw new Error('SEARCH_DB is not bound');
	// idx_search_playlists_channel / idx_search_posts_channel: only this channel's rows
	const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE channel_id = ? AND visible = 1`).bind(channelId).first<{ n: number }>();
	return Number(row?.n) || 0;
}

/** Channels the channel shows on its Channels tab: featured ids, plus a public subscriptions section. */
async function featuredChannelCount(env: TabCountsEnv, channelId: string): Promise<number> {
	const bucket = env.channel_sections;
	if (!bucket) throw new Error('channel_sections is not bound');
	const listed = await bucket.list({ prefix: `${channelId}/`, limit: MAX_SECTIONS });
	const ids = new Set<string>();
	let subscriptions = 0;
	for (const obj of listed.objects) {
		const section = (await (await bucket.get(obj.key))?.json().catch(() => null)) as { type?: string; channelIds?: string[]; content?: { channelIds?: string[] }; consent?: unknown; isDeleted?: boolean } | null;
		if (!section || section.isDeleted || !CHANNEL_SECTION_TYPES.has(String(section.type))) continue;
		if (section.type === 'subscribed_channels') {
			if (section.consent) subscriptions = 1;
			continue;
		}
		for (const id of section.channelIds ?? section.content?.channelIds ?? []) if (id && id !== channelId) ids.add(id);
	}
	return ids.size + subscriptions;
}

/**
 * What each channel tab holds for a visitor (#1669): the page hides empty Shorts, Live,
 * Playlists, Community and Channels tabs (no hollow pages). Indexed reads only (never a
 * table or bucket scan). Null when any count cannot be read: the page then shows every tab.
 */
export async function channelTabCounts(env: TabCountsEnv, channelId: string): Promise<ChannelTabCounts | null> {
	try {
		const [formats, playlists, community, channels] = await Promise.all([
			channelFormatCountsFromIndex(env, channelId),
			indexedCount(env, 'search_playlists', channelId),
			indexedCount(env, 'search_posts', channelId),
			featuredChannelCount(env, channelId),
		]);
		if (!formats) return null;
		return { ...formats, playlists, community, channels };
	} catch (error) {
		logger.warn('[channelTabCounts] counts unavailable; every tab shown', { channelId, error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}
