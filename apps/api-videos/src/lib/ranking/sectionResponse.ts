/**
 * The shared item and metadata shape of every discovery feed (sections,
 * /api/trending, /api/discovery/home): what web and the native apps need on a
 * card without a second request per video (#408, #418): the title and
 * description per language, the channel's name per language, the upload
 * status and the play URL.
 */
import { CATEGORY_SLUG_PATTERN, isShortOrFlag, type VideoObject } from '@al-ummah/shared-types';
import { z } from 'zod';
import type { AppContext } from '../../base';
import { publicVideoFields } from '../transformations';
import { PUBLIC_DISLIKES_COUNT } from '../reactions';
import { railPage, type RailEntry, type RailPage } from './serve';
import type { RailId } from './job';

const Localized = z.record(z.string(), z.string());

/** Card fields every feed item carries (on top of each section's own extras). */
export const FeedVideoFields = {
	id: z.string(),
	title: z.string(),
	titleLocalized: Localized.optional().describe('Title per language (en, ar); a language without one shows `title`'),
	description: z.string().optional(),
	descriptionLocalized: Localized.optional(),
	thumbnailUrl: z.string().optional(),
	videoUrl: z.string().optional(),
	playUrl: z.string().optional(),
	channelId: z.string(),
	channelName: z.string().optional(),
	channelNameLocalized: Localized.optional().describe("The channel's name per language"),
	channelAvatarUrl: z.string().optional(),
	dateCreated: z.string(),
	publishedAt: z.string().optional().describe('Original publish date (imports keep theirs)'),
	views: z.number(),
	likesCount: z.number(),
	dislikesCount: z.number(),
	isShort: z.boolean().optional(),
	commentsCount: z.number(),
	duration: z.number().optional(),
	category: z.string().regex(CATEGORY_SLUG_PATTERN).optional(),
	isPublic: z.boolean().optional(),
	uploadStatus: z.string().optional().describe('Always "ready": feeds list only finished, public, released videos'),
	width: z.number().optional(),
	height: z.number().optional(),
};

/** What a ranked rail is showing now; clients choose the heading from `label`. */
export const RailInfoSchema = z
	.object({
		mode: z.enum(['trending', 'popular', 'new', 'featured', 'top']).describe('What the list is ordered by right now'),
		label: z
			.enum(['trending_today', 'trending_this_week', 'trending_this_month', 'popular', 'new_today', 'new_this_week', 'new_this_month', 'latest', 'featured', 'top'])
			.describe('Heading to show: with too little viewer signal Trending becomes new_today / new_this_week / new_this_month / latest and Popular becomes featured'),
		signalItems: z.number().describe('Videos in the list with enough qualified viewers to count'),
		computedAt: z.string().describe('When the ranking last ran'),
	})
	.describe('Discovery ranking (wiki E07): present when the list comes from the ranked rails');

function countOf(list: unknown, count: unknown): number {
	if (Array.isArray(list)) return list.length;
	const n = Number(count);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/** One feed item from a stored video (public fields only). */
export function feedItem(video: VideoObject & Record<string, any>): Record<string, unknown> {
	const v = publicVideoFields(video) as Record<string, any>;
	return {
		id: v.id,
		title: v.title || '',
		...(v.titleLocalized ? { titleLocalized: v.titleLocalized } : {}),
		description: v.description,
		...(v.descriptionLocalized ? { descriptionLocalized: v.descriptionLocalized } : {}),
		thumbnailUrl: v.thumbnailUrl,
		videoUrl: v.videoUrl,
		...(v.playUrl ? { playUrl: v.playUrl } : {}),
		channelId: v.channelId || '',
		channelName: v.channelName,
		...(v.channelNameLocalized ? { channelNameLocalized: v.channelNameLocalized } : {}),
		channelAvatarUrl: v.channelAvatarUrl,
		dateCreated: v.dateCreated || new Date(0).toISOString(),
		...(v.publishedAt ? { publishedAt: v.publishedAt } : {}),
		views: Number(v.views) || 0,
		likesCount: countOf(v.likes, v.likesCount),
		dislikesCount: PUBLIC_DISLIKES_COUNT,
		isShort: isShortOrFlag(v as never),
		commentsCount: Array.isArray(v.comments) ? v.comments.filter((c: { isDeleted?: boolean }) => !c?.isDeleted).length : countOf(undefined, v.commentsCount),
		duration: v.duration,
		category: v.category,
		isPublic: v.isPublic !== false,
		uploadStatus: v.uploadStatus || 'ready',
		...(Number(v.width) > 0 ? { width: Number(v.width) } : {}),
		...(Number(v.height) > 0 ? { height: Number(v.height) } : {}),
	};
}

export interface RailRequest {
	rail: RailId;
	scope: string;
	limit: number;
	cursor?: string | null;
}

/** A ranked rail page, or null (not ranked yet / unreadable: the caller serves its fallback). */
export async function readRail(c: AppContext, request: RailRequest): Promise<RailPage | null> {
	return railPage(c.env as never, request);
}

/** Pure: a feed item with a rank-specific extra built from the entry. */
export function railItems(page: RailPage, extra?: (entry: RailEntry) => Record<string, unknown>): Record<string, unknown>[] {
	return page.entries.map((entry) => ({ ...feedItem(entry.video as never), ...(extra ? extra(entry) : {}) }));
}
