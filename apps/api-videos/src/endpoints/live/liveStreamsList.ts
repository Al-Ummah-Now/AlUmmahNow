import { OptionalAuthRoute, AppContext } from "../../base";
import { forManager, liveRecordingWithheld, recordingHidden } from './liveSession';
import { isPremiere } from '../../lib/live/premieres';
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
import { LIVE_EVENT_TYPES, LIVE_STREAM_KINDS, can } from "@al-ummah/shared-types";
import { memoChannels, ownedChannelIds, ownsRecord, roleOnChannel } from "../../lib/channelAccess";
import { featureOff } from '../../lib/features/off';
import { reminderCounts, shownEventType, switchOn } from '../../lib/live/events';

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
				kind: z.enum(LIVE_STREAM_KINDS).optional().describe("Live streams or premieres only"),
				eventType: z.enum(LIVE_EVENT_TYPES).optional().describe("Streams with this event tag (404 feature_off while event tags are off)"),
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
		const { cursor = "", limit = 9, status, channelId, kind, eventType } = request.query;

		const eventsOn = await switchOn(c, 'liveEvents');
		if (eventType && !eventsOn) return featureOff(c, 'liveEvents');

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
			// The streams of the channels the viewer owns now (checked on load; the index names candidates)
			const own = new Set<string>();
			const channels = memoChannels({ channels: c.env.channels });
			const owned = await ownedChannelIds(c.env as never, auth?.userId);
			const loadStream = async (key: string): Promise<LiveStreamType | null> => {
				try {
					const stream = await repository.getObject(key);
					if (stream && auth?.userId && (!owned || owned.has(stream.channelId) || stream.userId === auth.userId) && (await ownsRecord(channels, stream, auth.userId))) own.add(stream.id);
					return stream;
				} catch (error) {
					logger.error(`Error loading stream ${key}:`, error);
					return null;
				}
			};
			const managesStream = (stream: { id: string; channelId?: string | null }) =>
				!!auth && (own.has(stream.id) || (channelManager && stream.channelId === channelId));
			// A scheduled premiere is its team's only while premieres are off (wiki E17 §3.1)
			const premieresOn = await switchOn(c, 'livePremieres');
			const isListed = (stream: LiveStreamType | null): stream is LiveStreamType => {
				if (!stream) return false;
				if (status && stream.status !== status) return false;
				if (channelId && stream.channelId !== channelId) return false;
				if (kind && isPremiere(stream) !== (kind === 'premiere')) return false;
				if (eventType && shownEventType(stream, true) !== eventType) return false;
				const isOwner = managesStream(stream);
				// Hidden streams (suspended channel, banned owner, moderation) reach their owner only
				if ((stream as { isHidden?: boolean }).isHidden && !isOwner) return false;
				if (!isOwner && !premieresOn && isPremiere(stream) && stream.status === 'scheduled') return false;
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
					channelId: channelId || null, status, kind, eventType, limit: pageLimit, after, offset,
					viewerId: auth?.userId ?? null, manageChannel: channelManager,
				}),
				load: (id) => loadStream(`livestream:${id}`),
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
					load: loadStream,
					isListed,
					label: 'LiveStreamsList',
				});
				streams = scan.items;
				nextCursor = scan.cursor;
			}

			const reminders = await reminderCounts(c, streams.map((s) => s.id));
			// Transform to view models
			const streamViews = await Promise.all(streams.map(async ({ review, reviewShadow: _rs, reviewSessionId: _ri, liveAgainSessionId: _la, createdBy, ...stream }: LiveStreamType & { review?: unknown; reviewShadow?: unknown; reviewSessionId?: unknown; liveAgainSessionId?: unknown; createdBy?: string }) => ({
				...stream,
				eventType: shownEventType(stream, eventsOn),
				reminderCount: reminders.get(stream.id) ?? 0,
				// Which video a premiere shows is its team's unless it is on or over (wiki E17)
				...(!managesStream(stream) && stream.status !== 'live' && stream.status !== 'ended' ? { premiereVideoId: undefined } : {}),
				// Who created it (a channel member) is for those who manage the channel's live
				...(managesStream(stream) && createdBy ? { createdBy } : {}),
				// The recording's review is the owner's (Studio); a held recording's URL is theirs only (VR9)
				...(managesStream(stream) && review ? { review } : {}),
				// What is not open to everyone plays for its managers only, with a signed URL
				...(stream.playbackUrl ? { playbackUrl: await forManager(c, { ...stream, review, liveAgainSessionId: _la }, managesStream(stream), stream.playbackUrl) } : {}),
				...(recordingHidden({ review }, managesStream(stream)) ? { vodUrl: null } : stream.vodUrl ? { vodUrl: await forManager(c, { ...stream, review, liveAgainSessionId: _la }, managesStream(stream), stream.vodUrl) } : {}),
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
			})));

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