/**
 * Subscription helpers (pure functions)
 */

import { isVideoPubliclyVisible, VisibilityFields } from './visibility';

export interface StoredSubscription {
	id?: string;
	userId?: string;
	channelId?: string;
}

/**
 * Whether the viewer is subscribed to the channel. Subscriptions are stored
 * per subscriber channel; when no channel is active, any subscription by the
 * user counts.
 */
export function isSubscribed(
	subscriptions: StoredSubscription[] | null | undefined,
	viewer: { userId: string; channelId?: string | null },
): boolean {
	const subs = subscriptions || [];
	if (viewer.channelId) {
		return subs.some((s) => s.channelId === viewer.channelId);
	}
	return subs.some((s) => s.userId === viewer.userId);
}

/** Number of distinct subscriber channels. */
export function countSubscribers(subscriptions: StoredSubscription[] | null | undefined): number {
	return new Set((subscriptions || []).map((s) => s.channelId)).size;
}

export interface FeedVideo extends VisibilityFields {
	id?: string;
	channelId?: string;
	dateCreated?: string;
	scheduledPublishStatus?: string;
}

export interface FeedPage<T> {
	items: T[];
	nextCursor: string | null;
	total: number;
}

/**
 * Select videos from subscribed channels that are publicly visible and
 * already published, newest first, and return one page (offset cursor).
 */
export function buildSubscriptionFeed<T extends FeedVideo>(
	videos: T[],
	subscribedChannelIds: string[],
	limit: number,
	cursor?: string | null,
): FeedPage<T> {
	const channelSet = new Set(subscribedChannelIds);
	const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 20), 100);
	const parsed = cursor ? parseInt(cursor, 10) : 0;
	const offset = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

	const seen = new Set<string>();
	const matching = videos
		.filter((v) => {
			if (!v || seen.has(v.id)) return false;
			seen.add(v.id);
			if (!channelSet.has(v.channelId)) return false;
			if (!isVideoPubliclyVisible(v)) return false;
			if (v.scheduledPublishStatus === 'scheduled' || v.scheduledPublishStatus === 'publishing') return false;
			return true;
		})
		.sort((a, b) => new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime());

	const items = matching.slice(offset, offset + safeLimit);
	const next = offset + items.length;
	return {
		items,
		nextCursor: next < matching.length ? String(next) : null,
		total: matching.length,
	};
}
