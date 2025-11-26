import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { VideoInput } from "../../lib/model/input";
import { VideoView } from "../../lib/model/view";
import { transformVideoToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret } from "../../lib/env-helpers";
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from '../../base';

export class VideoCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Create a new Video",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token in the Authorization header (Bearer <token>).",
		request: {
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
			body: {
				content: {
					"application/json": {
						schema: VideoInput,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the created video",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								video: VideoView,
							}),
						}),
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
			"401": {
				description: "Unauthorized - missing or invalid authentication token",
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

		const { channelId } = request.headers;
		const inputVideo = request.body;

		// Get authenticated user ID
		const effectiveUserId = this.getUserId(c);

		// Create the business video object
		const video = {
			...inputVideo,
			id: crypto.randomUUID(), // Generate a unique ID for the video
			userId: effectiveUserId,
			channelId,
			dateCreated: new Date().toISOString(),
			dateModified: new Date().toISOString(),
			views: 0,
			availableResolutions: inputVideo.availableResolutions || [],
			comments: [],
			likes: [],
			dislikes: [],
			isPublic: inputVideo.isPublic ?? true,
			isLive: inputVideo.isLive ?? false,
			// Ensure localized fields are stored
			titleLocalized: inputVideo.titleLocalized,
			descriptionLocalized: inputVideo.descriptionLocalized,
		};

		// create the video in Bunny Stream
		const key = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
		const libraryIdStr = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
		const libraryId = parseInt(libraryIdStr);
		const bunnyStream = new stream(key);

		let collectionId = null;
		// check if collection exists
		try {
			const collection = await bunnyStream.getCollection(libraryId, video.channelId);
			collectionId = collection.guid;
		} catch (e) {
			if (e.statusCode === 404) {
				// create the collection
				var result = await bunnyStream.createCollection(libraryId, { name: video.channelId });
				collectionId = result.guid;
			} else {
				// Handle other errors
				logger.error("Error fetching collection:", e);
				return c.json(
					{
						success: false,
						error: "Error fetching collection",
					},
					500
				);
			}
		}

		const videoId = await bunnyStream.createVideo(libraryId, {
			title: video.title,
			collectionId: collectionId,
		});

		// Save the video to the repository
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		await repository.putObject(video.id, video);

		// Send queue message for video creation
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoCreate, {
			videoId: video.id,
			userId: effectiveUserId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		// Transform to view model for response
		const videoView = transformVideoToView(video);

		// Return the created video
		return {
			success: true,
			result: { video: videoView },
		};
	}
}
