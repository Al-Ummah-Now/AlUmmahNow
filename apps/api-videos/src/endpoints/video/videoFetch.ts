import { withPlayback } from '../../lib/media/playback';
import { canOnVideo } from "../../lib/channelAccess";
import { Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import { transformVideoToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from '../../base';
import { GONE_BODY, isPurged } from '../../lib/gone';

export class VideoFetch extends OptionalAuthRoute {
	schema = {
		tags: ["Videos"],
		summary: "Get a single video by id",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			query: z.object({
				for: z.enum(["edit"]).optional().describe("edit: the editor's view. playUrl stays Bunny's, whose files (encoding frames, thumbnails) the editor offers; not for playback"),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a single video if found",
				content: {
					"application/json": {
						schema: VideoView,
					},
				},
			},
			"404": {
				description: "Video not found",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"410": {
				description: "Video was deleted and purged (no longer restorable)",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"400": {
				description: "Bad request - invalid input data",
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
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Retrieve the validated slug
		const { id } = request.params;
		const userId = this.getUserId(c);

		// Implement your own object fetch here
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		let video = await repository.getObject(id);

		const exists = video !== null;

		if (!exists) {
			// Purged (deleted, then removed for good): 410, so search engines drop it (lib/gone.ts)
			if (await isPurged(c.env as never, 'video', id)) return c.json(GONE_BODY, 410);
			return c.json(
				{
					success: false,
					error: "Object not found",
				},
				404
			);
		}

		// Check if video is deleted (soft delete)
		if (video.isDeleted) {
			logger.debug('[VideoFetch] Video is deleted', { videoId: id });
			return c.json(
				{
					success: false,
					error: "Object not found",
				},
				404
			);
		}

		// Check if video is hidden (moderation) - blocks everyone
		if (video.isHidden) {
			logger.debug('[VideoFetch] Video is hidden', { videoId: id });
			return c.json(
				{
					success: false,
					error: "Object not found",
				},
				404
			);
		}

		// Check privacy permissions
		// Private videos: the owner, or a channel member allowed to see them (lib/channelAccess.ts)
		if (video.isPublic === false && !(await canOnVideo(c.env as never, video, userId, 'video.view_private'))) {
			return c.json(
				{
					success: false,
					error: "Object not found", // Don't reveal that private video exists
				},
				404
			);
		}

		// Fetch channel data to populate channelName, channelAvatarUrl, and channelCoverUrl
		let channel = null;
		if (video.channelId) {
			try {
				const channelBucket = c.env.channels;
				type ChannelType = z.infer<typeof BusinessChannel>;
				const channelRepository = new R2Repository<ChannelType>(channelBucket);
				channel = await channelRepository.getObject(video.channelId);

				if (channel) {
					logger.debug('[VideoFetch] Channel fetched successfully', {
						videoId: video.id,
						channelId: video.channelId,
						channelName: channel.name
					});
				} else {
					logger.debug('[VideoFetch] Channel not found', {
						videoId: video.id,
						channelId: video.channelId
					});
				}
			} catch (error) {
				logger.error('[VideoFetch] Error fetching channel data', {
					videoId: video.id,
					channelId: video.channelId,
					error: error instanceof Error ? error.message : String(error)
				});
				// Continue without channel data - transformation will use empty values
			}
		}

		// Transform to view model for response with channel data
		// R2 beside Bunny (epic #687): the API picks the source; playUrl/thumbnailUrl are that source's
		// and delivery.source labels it (lib/media/playback.ts). Players never choose.
		const forEdit = request.query?.for === 'edit';
		const videoView = forEdit
			? Object.assign(transformVideoToView(video, channel), { delivery: { source: 'bunny' as const } })
			: await withPlayback(c.env as never, video as never, transformVideoToView(video, channel), 'video');

		// No queue message: a fetch is not a view (POST /videos/:id/view records views),
		// and per-read messages only cost queue operations and processor invocations.

		return videoView;
	}
}

