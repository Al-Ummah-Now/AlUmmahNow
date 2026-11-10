/**
 * Channel visibility and About-tab helpers (Story 29.1).
 */

import { FALLBACK_SCAN_OBJECTS } from './scanBudget';
import { logger } from './logger';
import { isVideoPubliclyVisible } from './visibility';
import { countSubscribers } from './subscriptions';

export interface VisibleChannelFields {
	userId?: string;
	isDeleted?: boolean;
	isHidden?: boolean;
	isPrivate?: boolean;
}

/** Same rules as GET /api/channels/:id: deleted/hidden for everyone, private for non-owners. */
export function isChannelVisibleTo(channel: VisibleChannelFields | null | undefined, userId?: string | null): boolean {
	if (!channel) return false;
	if (channel.isDeleted || channel.isHidden) return false;
	if (channel.isPrivate && channel.userId !== userId) return false;
	return true;
}

export interface ChannelTotals {
	totalViews: number;
	videosCount: number;
	/** True when the scan stopped at its bound (totals are a lower bound). */
	partial: boolean;
}

interface ScannedVideo {
	channelId?: string;
	views?: number;
	isPublic?: boolean;
	isDeleted?: boolean;
	isHidden?: boolean;
	scheduledPublishStatus?: string;
}

/**
 * Sum views and count public videos of a channel. Video objects are keyed by
 * video id and channels don't keep a reliable list of their videos, so this
 * scans the videos bucket (bounded by `maxObjects`).
 */
export async function computeChannelTotals(videosBucket: R2Bucket, channelId: string, maxObjects = FALLBACK_SCAN_OBJECTS): Promise<ChannelTotals> {
	let totalViews = 0;
	let videosCount = 0;
	let scanned = 0;
	let cursor: string | undefined;
	let partial = false;

	do {
		const page = await videosBucket.list({ limit: 100, cursor });
		const objects = page.objects.slice(0, Math.max(0, maxObjects - scanned));
		scanned += objects.length;
		const videos = await Promise.all(objects.map(async (o) => {
			try {
				const obj = await videosBucket.get(o.key);
				return obj ? await obj.json<ScannedVideo>() : null;
			} catch (error) {
				logger.warn('[ChannelAbout] Unreadable video object', { key: o.key, error: error instanceof Error ? error.message : String(error) });
				return null;
			}
		}));
		for (const video of videos) {
			if (!video || video.channelId !== channelId) continue;
			if (!isVideoPubliclyVisible(video)) continue;
			if (video.scheduledPublishStatus && video.scheduledPublishStatus !== 'published') continue;
			videosCount++;
			totalViews += Number(video.views) || 0;
		}
		cursor = page.truncated ? page.cursor : undefined;
		if (cursor && scanned >= maxObjects) {
			partial = true;
			cursor = undefined;
		}
	} while (cursor);

	return { totalViews, videosCount, partial };
}

export interface ChannelAboutSource {
	id?: string;
	handle?: string;
	description?: string;
	descriptionLocalized?: Record<string, string>;
	links?: Array<{ title?: string; url?: string }>;
	contactEmail?: string;
	location?: string;
	dateCreated?: string;
	subscribers?: Array<{ channelId?: string }>;
}

/** Only http(s) links are ever returned (older records are filtered defensively). */
export function safeChannelLinks(links: ChannelAboutSource['links']): Array<{ title: string; url: string }> {
	return (links || [])
		.filter((l) => !!l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url) && typeof l.title === 'string')
		.map((l) => ({ title: l.title as string, url: l.url as string }));
}

export function buildChannelAbout(channel: ChannelAboutSource, totals: ChannelTotals) {
	return {
		channelId: channel.id,
		handle: channel.handle || null,
		description: channel.description || '',
		descriptionLocalized: channel.descriptionLocalized || {},
		links: safeChannelLinks(channel.links),
		contactEmail: channel.contactEmail || null,
		location: channel.location || null,
		joinedDate: channel.dateCreated,
		totalViews: totals.totalViews,
		videosCount: totals.videosCount,
		subscribersCount: countSubscribers(channel.subscribers as never),
		statsPartial: totals.partial,
	};
}
