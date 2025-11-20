import { OpenAPIRoute, Str, Num } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { getAuthContext } from "../../middleware/auth";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret } from "../../lib/env-helpers";
import { generateTUSConfig } from "../../lib/bunny/tus";

export class UploadInitiateEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Videos"],
		summary: "Initiate Video Upload with TUS Support",
		description: "🔒 **Authentication Required**: Create a video record in Bunny.net Stream and get TUS configuration for resumable upload.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							title: Str({ description: "Video title" }),
							description: Str({ description: "Video description" }).optional(),
							fileSize: Num({ description: "File size in bytes", required: true }),
							mimeType: Str({ description: "MIME type of the video file", required: true }),
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
				description: "Upload initiated successfully with TUS configuration",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
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
								// Legacy fields for backward compatibility
								uploadUrl: z.string().optional().describe("Legacy upload URL (deprecated)"),
								libraryId: z.number().optional().describe("Library ID (deprecated)"),
								status: z.string().optional().describe("Upload status"),
								message: z.string().optional().describe("Status message"),
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
			const { title, description, fileSize, mimeType, isPublic, tags } = request.body;

			// Validate required fields
			if (!fileSize || fileSize <= 0) {
				return c.json({
					success: false,
					error: "Invalid file size: must be a positive number"
				}, 400);
			}

			if (!mimeType || !mimeType.startsWith('video/')) {
				return c.json({
					success: false,
					error: "Invalid MIME type: must be a video format (e.g., video/mp4)"
				}, 400);
			}

			const channelId = c.req.header('channelId') || userId;

			// Create video in Bunny Stream first to get video ID
			const bunnyKey = await requireSecret(env["bunny-stream-key"], 'bunny-stream-key');
			const libraryIdRaw = await requireSecret(env.bunny_stream_library_id, 'bunny_stream_library_id');
			const libraryId = parseInt(libraryIdRaw, 10);

			if (isNaN(libraryId)) {
				return c.json({
					success: false,
					error: "Bunny Stream library ID is invalid"
				}, 500);
			}

			const bunnyStream = new stream(bunnyKey);

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
				uploadStatus: 'uploading' as const,
				fileSize: fileSize,  // Store file size directly
				originalFormat: mimeType,  // Store MIME type as original format
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
				fileSize,
				mimeType,
				timestamp: new Date().toISOString(),
			});

			// Generate TUS configuration for resumable upload
			const tusConfig = await generateTUSConfig(
				libraryId,
				bunnyKey,
				videoId,
				1 // 1 hour expiration
			);

			// Return TUS configuration for direct upload to Bunny Stream
			return c.json({
				success: true,
				result: {
					videoId,
					tusEndpoint: tusConfig.tusEndpoint,
					tusHeaders: tusConfig.tusHeaders,
					expiresAt: tusConfig.expiresAt,
					chunkSize: tusConfig.chunkSize,
					resumable: tusConfig.resumable,
					// Legacy fields for backward compatibility
					uploadUrl: `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`,
					libraryId,
					status: 'uploading',
					message: 'Upload initiated successfully. Use the TUS configuration for resumable upload.',
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
