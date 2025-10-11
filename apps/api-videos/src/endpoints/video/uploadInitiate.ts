import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { getAuthContext } from "../../middleware/auth";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";

export class UploadInitiateEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Videos"],
		summary: "Initiate Video Upload",
		description: "🔒 **Authentication Required**: Create a video record in Bunny.net Stream and get upload URL for direct upload.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							title: Str({ description: "Video title" }),
							description: Str({ description: "Video description" }).optional(),
							isPublic: z.boolean().optional().default(true),
							tags: z.string().optional().describe("Comma-separated tags"),
						}),
					},
				},
			},
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Upload initiated successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								videoId: z.string(),
								uploadUrl: z.string(),
								libraryId: z.number(),
								status: z.string(),
								message: z.string(),
							}),
						}),
					},
				},
			},
			"401": {
				description: "Unauthorized - authentication required",
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

	async handle(c) {
		// Get auth context
		const authContext = getAuthContext(c);
		const userId = authContext?.userId;

		if (!userId) {
			return c.json({
				success: false,
				error: "Authentication required"
			}, 401);
		}

		try {
			// Get validated data
			const request = await this.getValidatedData<typeof this.schema>();
			const { title, description, isPublic, tags } = request.body;

			const channelId = c.req.header('channelId') || userId;

			// Create video in Bunny Stream first to get video ID
			const bunnyKey = await env["bunny-stream-key"].get();
			if (!bunnyKey) {
				return c.json({
					success: false,
					error: "Bunny Stream not configured"
				}, 500);
			}

			const bunnyStream = new stream(bunnyKey);
			const libraryId = parseInt(await env.bunny_stream_library_id.get());

			// Create video in Bunny Stream
			const bunnyVideo = await bunnyStream.createVideo(libraryId, {
				title,
				thumbnailTime: 0,
			});

			const videoId = bunnyVideo.guid;

			// Create video metadata for R2 storage
			const video = {
				id: videoId,
				title,
				description: description || '',
				userId,
				channelId,
				dateCreated: new Date().toISOString(),
				dateModified: new Date().toISOString(),
				views: 0,
				availableResolutions: [],
				comments: [],
				likes: [],
				dislikes: [],
				isPublic: isPublic ?? true,
				isLive: false,
				tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
				uploadStatus: 'initiated' as const,
			};

			// Save metadata to R2
			const bucket = env.videos;
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(bucket);
			await repository.putObject(videoId, video);

			// Send analytics event for upload initiation
			const queue = new Queue();
			await queue.send(MessageType.VideoUploadStarted, {
				videoId,
				userId,
				channelId,
				title,
				timestamp: new Date().toISOString(),
			});

			// Return upload URL for direct upload to Bunny Stream
			const uploadUrl = `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`;

			return c.json({
				success: true,
				result: {
					videoId,
					uploadUrl,
					libraryId,
					status: 'initiated',
					message: 'Upload initiated successfully. Use the uploadUrl to upload your video file.',
				},
			});

		} catch (error) {
			console.error("Upload initiate error:", error);
			return c.json({
				success: false,
				error: "Failed to initiate upload"
			}, 500);
		}
	}
}
