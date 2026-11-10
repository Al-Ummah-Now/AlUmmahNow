import { OptionalAuthRoute, AppContext } from "../../base";
import { liveRecordingWithheld, recordingHidden } from './liveSession';
import { Num, Str } from "../../lib/chanfana-params";
import { z } from "zod";
import { LiveStream as BusinessLiveStream, PaginationResponse, ResponseError } from "../../lib/types";
import { LiveStreamView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { scanFill } from '../../lib/listFill';
import { scheduleOwnershipHeal, streamListIds, waitUntilOf } from '../../lib/search/ownership';
import { isIndexPageCursor, pageFromIndex } from '../../lib/search/indexPage';
import { PUBLIC_DISLIKES_COUNT } from "../../lib/reactions";
import { can } from "@al-ummah/shared-types";
import { roleOnChannel } from "../../lib/channelAccess";

export class LiveStreamsList extends OptionalAuthRoute {
	schema = {
		tags: ["Live Streams"],
		summary: "List Live Streams",
		description: "Get a paginated list of live streams. Public endpoint that returns both scheduled and active streams.",
		request: {
			headers: z.object({
				channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
			}),
			query: z.object({
				cursor: z.string().optional().openapi({ example: "" }),
				limit: Num({ default: 9 }).openapi({ example: 9 }),
				status: z.enum(['scheduled', 'live', 'ended', 'cancelled']).optional().describe("Filter by stream status"),
				channelId: z.string().optional().describe("Filter by channel ID"),
			}),
		},
		responses: {
			"200": {
				description: "Returns paginated list of live streams",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean().default(true),
							result: PaginationResponse.extend({
								data: z.array(LiveStreamView),
							}),
						}),
					},
				},
			},
			"400": {
				description: "Bad request - invalid query parameters",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"500": {
				description: "Internal server error",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { cursor = "", limit = 9, status, channelId } = request.query;

		try {
			const bucket = c.env.videos;
			type LiveStreamType = z.infer<typeof BusinessLiveStream>;
			const repository = new R2Repository<LiveStreamType>(bucket);

			// Filled page of live streams (lib/listFill.ts): filtering a cut listing
			// returned empty pages with a cursor when the first streams were private,
			// hidden or of another status/channel.
			const auth = c.get('auth');
			// Listing one channel: a member with live.manage on it sees its streams
			// as the owner does (docs/specs/CHANNEL-ROLES.md). Resolved once.
			let channelManager = false;
			if (auth?.userId && channelId) {
				try {
					channelManager = can(await roleOnChannel(c.env as never, channelId, auth.userId), 'live.manage');
				} catch (error) {
					logger.warn('[LiveStreamsList] Channel read failed; listed as a visitor', { channelId, error: error instanceof Error ? error.message : String(error) });
				}
			}
			const managesStream = (stream: { userId?: string; channelId?: string | null }) =>
				!!auth && (stream.userId === auth.userId || (channelManager && stream.channelId === channelId));
			const isListed = (stream: LiveStreamType | null): stream is LiveStreamType => {
				if (!stream) return false;
				if (status && stream.status !== status) return false;
				if (channelId && stream.channelId !== channelId) return false;
				const isOwner = managesStream(stream);
				// Hidden streams (suspended channel, banned owner, moderation) reach their owner only
				if ((stream as { isHidden?: boolean }).isHidden && !isOwner) return false;
				// Private streams only for their owner
				if (stream.isPrivate && !isOwner) return false;
				// A recording held for review or rejected (VR9) is listed for its owner only
				if (!isOwner && liveRecordingWithheld(stream as never)) return false;
				return true;
			};
			// Live first, then newest: one keyset page of the ownership index (kind 'stream').
			// Visibility is filtered in SQL and re-checked on each loaded stream (isListed).
			const indexed = await pageFromIndex<LiveStreamType>({
				cursor,
				sort: 'live-first',
				limit,
				fetch: (after, pageLimit, offset) => streamListIds(c.env as never, {
					channelId: channelId || null, status, limit: pageLimit, after, offset,
					viewerId: auth?.userId ?? null, manageChannel: channelManager,
				}),
				load: async id => {
					try {
						return await repository.getObject(`livestream:${id}`);
					} catch (error) {
						logger.error(`Error loading stream ${id}:`, error);
						return null;
					}
				},
				isListed,
			});
			let streams: LiveStreamType[];
			let nextCursor: string;
			if (indexed) {
				streams = indexed.items;
				nextCursor = indexed.cursor;
			} else {
				// Index unavailable: the filled bucket scan; the index rebuild is queued, never run here
				if (!cursor) scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), 'stream');
				const scan = await scanFill<LiveStreamType>({
					bucket,
					// An index cursor (the index became unusable mid-scroll) cannot resume a scan: start over
					cursor: isIndexPageCursor(cursor) ? null : cursor,
					limit,
					prefix: "livestream:",
					load: async key => {
						try {
							return await repository.getObject(key);
						} catch (error) {
							logger.error(`Error loading stream ${key}:`, error);
							return null;
						}
					},
					isListed,
					label: 'LiveStreamsList',
				});
				streams = scan.items;
				nextCursor = scan.cursor;
			}

			// Transform to view models
			const streamViews = streams.map(({ review, reviewShadow: _rs, reviewSessionId: _ri, liveAgainSessionId: _la, createdBy, ...stream }: LiveStreamType & { review?: unknown; reviewShadow?: unknown; reviewSessionId?: unknown; liveAgainSessionId?: unknown; createdBy?: string }) => ({
				...stream,
				// Who created it (a channel member) is for those who manage the channel's live
				...(managesStream(stream) && createdBy ? { createdBy } : {}),
				// The recording's review is the owner's (Studio); a held recording's URL is theirs only (VR9)
				...(managesStream(stream) && review ? { review } : {}),
				...(recordingHidden({ review }, managesStream(stream)) ? { vodUrl: null } : {}),
				likesCount: stream.likes?.length || 0,
				dislikes: [],
				dislikesCount: PUBLIC_DISLIKES_COUNT,
				commentsCount: stream.comments?.length || 0,
				// Calculate duration if stream has ended
				duration: stream.actualEndTime && stream.actualStartTime 
					? Math.floor((new Date(stream.actualEndTime).getTime() - new Date(stream.actualStartTime).getTime()) / 1000)
					: undefined,
				// Remove sensitive data for public view
				streamKey: undefined,
				rtmpUrl: managesStream(stream) ? stream.rtmpUrl : undefined,
			}));

			// Sort by date created (newest first) and status (live streams first)
			streamViews.sort((a, b) => {
				// Live streams first
				if (a.status === 'live' && b.status !== 'live') return -1;
				if (b.status === 'live' && a.status !== 'live') return 1;
				// Then by date created (newest first)
				return new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime();
			});

			return {
				success: true,
				result: {
					cursor: nextCursor,
					limit,
					data: streamViews,
				},
			};
		} catch (error) {
			logger.error("Error listing live streams:", error);
			return c.json(
				{
					success: false,
					error: "Failed to fetch live streams",
				},
				500
			);
		}
	}
}