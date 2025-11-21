import { OpenAPIRoute, Str, Num } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { getAuthContext } from "../../middleware/auth";
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret } from "../../lib/env-helpers";
import { generateTUSConfig } from "../../lib/bunny/tus";
import { addAuthToSchema } from "../../lib/openapi-auth";

const BatchVideoSchema = z.object({
	title: Str({ description: "Video title" }),
	description: Str({ description: "Video description" }).optional(),
	fileSize: Num({ description: "File size in bytes", required: true }),
	mimeType: Str({ description: "MIME type of the video file", required: true }),
	isPublic: z.boolean().optional().default(true),
	tags: z.string().optional().describe("Comma-separated tags"),
});

const SharedMetadataSchema = z.object({
	channelId: z.string().optional().describe("Channel ID for all videos"),
	category: z.string().optional().describe("Category for all videos"),
	isPublic: z.boolean().optional().describe("Visibility for all videos"),
});

export class UploadBatchInitiateEndpoint extends OpenAPIRoute {
	schema = addAuthToSchema({
		tags: ["Videos"],
		summary: "Initiate Batch Video Upload",
		description: "🔒 **Authentication Required**: Initiate upload for multiple videos (up to 15) with TUS support for concurrent resumable uploads.",
		request: {
			headers: z.object({
          userId: z.string().optional().nullable(),
          channelId: z.string().optional().nullable(),
        }),
        body: {
				content: {
					"application/json": {
						schema: z.object({
							videos: z.array(BatchVideoSchema).min(1).max(15).describe("Array of video metadata (1-15 videos)"),
							sharedMetadata: SharedMetadataSchema.optional().describe("Shared metadata applied to all videos"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Batch upload initiated successfully with TUS configurations",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.array(z.object({
								videoId: z.string().describe("Video GUID for upload"),
								tusEndpoint: z.string().describe("TUS upload endpoint"),
								tusHeaders: z.object({
									AuthorizationSignature: z.string().describe("TUS authorization signature"),
									AuthorizationExpire: z.string().describe("Unix timestamp when signature expires"),
									LibraryId: z.string().describe("Bunny.net Stream library ID"),
									VideoId: z.string().describe("Video GUID"),
								}).describe("Headers required for TUS upload"),
								expiresAt: z.string().describe("ISO 8601 datetime when authorization expires"),
								chunkSize: z.number().describe("Recommended chunk size in bytes"),
								resumable: z.boolean().describe("Whether upload supports resume"),
							})),
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
	}, 'required');

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
			const { videos, sharedMetadata } = request.body;

			// Validate batch size
			if (!videos || videos.length === 0) {
				return c.json({
					success: false,
					error: "At least one video is required"
				}, 400);
			}

			if (videos.length > 15) {
				return c.json({
					success: false,
					error: "Maximum 15 videos allowed per batch"
				}, 400);
			}

			// Get Bunny.net credentials
			const bunnyKey = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
			const libraryIdRaw = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
			const libraryId = parseInt(libraryIdRaw, 10);

			if (isNaN(libraryId)) {
				return c.json({
					success: false,
					error: "Bunny Stream library ID is invalid"
				}, 500);
			}

			const bunnyStream = new stream(bunnyKey);
			const bucket = c.env.videos;
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(bucket);
			const queue = new Queue(c.env.queue);

			// Process each video in parallel
			const initiatePromises = videos.map(async (videoData) => {
				// Validate required fields
				if (!videoData.fileSize || videoData.fileSize <= 0) {
					throw new Error(`Invalid file size for "${videoData.title}": must be a positive number`);
				}

				if (!videoData.mimeType || !videoData.mimeType.startsWith('video/')) {
					throw new Error(`Invalid MIME type for "${videoData.title}": must be a video format (e.g., video/mp4)`);
				}

				// Determine channel ID
				const channelId = sharedMetadata?.channelId || userId;

				// Create video in Bunny Stream
				const bunnyVideo = await bunnyStream.createVideo(libraryId, {
					title: videoData.title,
					thumbnailTime: 0,
				});

				const videoId = bunnyVideo.guid;

				// Create video metadata for R2 storage
				const video = {
					id: videoId,
					title: videoData.title,
					description: videoData.description || '',
					userId,
					channelId,
					dateCreated: new Date().toISOString(),
					dateModified: new Date().toISOString(),
					views: 0,
					availableResolutions: [],
					comments: [],
					likes: [],
					dislikes: [],
					isPublic: videoData.isPublic ?? sharedMetadata?.isPublic ?? true,
					isLive: false,
					tags: videoData.tags ? videoData.tags.split(',').map(tag => tag.trim()) : [],
					category: sharedMetadata?.category,
					uploadStatus: 'uploading' as const,
					fileSize: videoData.fileSize,
					originalFormat: videoData.mimeType,
				};

				// Save metadata to R2
				await repository.putObject(videoId, video);

				// Send analytics event for upload initiation
				await queue.send(MessageType.VideoUploadStarted, {
					videoId,
					userId,
					channelId,
					title: videoData.title,
					fileSize: videoData.fileSize,
					mimeType: videoData.mimeType,
					timestamp: new Date().toISOString(),
					batchUpload: true,
				});

				// Generate TUS configuration for resumable upload
				const tusConfig = await generateTUSConfig(
					libraryId,
					bunnyKey,
					videoId,
					1 // 1 hour expiration
				);

				return {
					videoId,
					tusEndpoint: tusConfig.tusEndpoint,
					tusHeaders: tusConfig.tusHeaders,
					expiresAt: tusConfig.expiresAt,
					chunkSize: tusConfig.chunkSize,
					resumable: tusConfig.resumable,
				};
			});

			// Wait for all videos to be initiated
			const results = await Promise.all(initiatePromises);

			// Send batch upload started analytics event
			await queue.send(MessageType.VideoUploadStarted, {
				type: 'batch_upload_started',
				userId,
				videoCount: videos.length,
				totalSize: videos.reduce((sum, v) => sum + v.fileSize, 0),
				timestamp: new Date().toISOString(),
			});

			return c.json({
				success: true,
				result: results,
			});

		} catch (error) {
			console.error("Batch upload initiate error:", error);
			return c.json({
				success: false,
				error: error instanceof Error ? error.message : "Failed to initiate batch upload"
			}, 500);
		}
	}
}
