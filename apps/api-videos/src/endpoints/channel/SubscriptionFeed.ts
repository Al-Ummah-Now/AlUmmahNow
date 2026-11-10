import { Num, Str } from "chanfana";
import { z } from "zod";
import { Channel, Profile, Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from "../../base";
import { buildSubscriptionFeed } from "../../lib/subscriptions";
import { subscribedChannelIds } from "../../lib/subscription-store";
import { transformVideoToView } from "../../lib/transformations";
import { subscriptionFeedIds } from "../../lib/feedIndex";
import { FALLBACK_SCAN_OBJECTS } from "../../lib/scanBudget";

/**
 * Upper bound on stored videos scanned per request. Videos live in R2 as
 * individual objects without a per-channel index, so the feed scans the
 * bucket the same way search does and filters in memory.
 */
/** Fallback scan while the search index is unavailable (SCALABILITY-AUDIT AV-16) */
const MAX_SCAN_PAGES = FALLBACK_SCAN_OBJECTS / 100;
const SCAN_PAGE_SIZE = 100;

export class SubscriptionFeed extends AuthenticatedRoute {
	schema = {
		tags: ["Subscriptions"],
		summary: "Videos from channels the current user is subscribed to",
		description: "Returns publicly visible, published videos from subscribed channels, newest first.",
		request: {
			query: z.object({
				limit: Num({ description: "Page size (max 100)", default: 20 }).optional(),
				cursor: Str({ description: "Cursor returned by the previous page", required: false }),
			}),
		},
		responses: {
			"200": {
				description: "A page of feed videos",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							data: z.array(z.any()),
							cursor: z.string().nullable(),
							total: z.number(),
						}),
					},
				},
			},
			"404": {
				description: "Profile not found",
				content: { "application/json": { schema: ResponseError } },
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const limit = data.query.limit ?? 20;
		const cursor = data.query.cursor;

		type ProfileType = z.infer<typeof Profile>;
		type ChannelType = z.infer<typeof Channel>;
		type VideoType = z.infer<typeof Video>;

		const profile = await new R2Repository<ProfileType>(c.env.profiles).getObject(userId);
		if (!profile) {
			return c.json({ success: false, error: "Profile not found" }, 404);
		}

		// D1 subscriptions plus legacy entries of channels not imported yet (AV-4/AV-6)
		const subscribedTo = await subscribedChannelIds(c.env.NOTIFICATIONS_DB, userId, profile.subscribedTo);
		if (subscribedTo.length === 0) {
			return { success: true, data: [], cursor: null, total: 0 };
		}

		const videoRepo = new R2Repository<VideoType>(c.env.videos);
		// From the search index: the page's ids, then those videos (R2 decides visibility)
		const pageSize = Math.min(Math.max(1, Math.floor(limit) || 20), 100);
		const parsedCursor = cursor ? parseInt(cursor, 10) : 0;
		const offset = Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0;
		const indexed = await subscriptionFeedIds(c.env, subscribedTo, pageSize, offset);
		let scanned: VideoType[] = [];
		let feed: ReturnType<typeof buildSubscriptionFeed<VideoType>>;
		if (indexed) {
			const loaded = (await Promise.all(indexed.ids.map((id) => videoRepo.getObject(id)))).filter((v): v is VideoType => v !== null);
			const end = offset + indexed.ids.length;
			feed = {
				items: buildSubscriptionFeed(loaded, subscribedTo, pageSize).items,
				nextCursor: indexed.ids.length > 0 && end < indexed.total ? String(end) : null,
				total: indexed.total,
			};
		} else {
			let scanCursor: string | undefined;
			for (let page = 0; page < MAX_SCAN_PAGES; page++) {
				const result = await videoRepo.listObjects(SCAN_PAGE_SIZE, scanCursor);
				scanned.push(...(result.items || []));
				if (!result.cursor) break;
				scanCursor = result.cursor;
			}
			feed = buildSubscriptionFeed(scanned, subscribedTo, limit, cursor);
		}

		const channelRepo = new R2Repository<ChannelType>(c.env.channels);
		const channels = new Map<string, ChannelType | null>();
		await Promise.all([...new Set(feed.items.map((v) => v.channelId))].map(async (cid) => {
			try {
				channels.set(cid, await channelRepo.getObject(cid));
			} catch (error) {
				logger.warn('[SubscriptionFeed] Failed to load channel', { channelId: cid, error: error instanceof Error ? error.message : String(error) });
				channels.set(cid, null);
			}
		}));

		const videos = feed.items.map((v) => {
			// Strip embedded engagement arrays from the response; counts are computed by the view transform
			const { comments: _comments, likes: _likes, dislikes: _dislikes, ...view } = transformVideoToView(v, channels.get(v.channelId)) as ReturnType<typeof transformVideoToView> & { likes?: unknown; dislikes?: unknown };
			return view;
		});

		logger.debug('[SubscriptionFeed] Built feed', { userId, subscriptions: subscribedTo.length, source: indexed ? 'index' : 'scan', scanned: scanned.length, returned: videos.length });

		return {
			success: true,
			data: videos,
			cursor: feed.nextCursor,
			total: feed.total,
		};
	}
}
