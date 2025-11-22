import { OpenAPIRoute, Str, Num } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { Channel } from "@al-ummah/shared-types";
import { getAuthContext } from "../../middleware/auth";
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret } from "../../lib/env-helpers";
import { generateTUSConfig } from "../../lib/bunny/tus";
import { thumbnailProcessor, thumbnailStorage } from "../../lib/thumbnail";
import { logger } from '../../lib/logger';

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
							thumbnail: z.object({
								type: z.enum(['auto', 'custom']).describe("Thumbnail type: auto-generated or custom"),
								data: z.string().optional().describe("Base64 encoded image data for custom thumbnails"),
								position: z.number().min(0).max(100).optional().describe("Frame position (0-100%) for auto-generated thumbnails"),
								filename: z.string().optional().describe("Original filename"),
							}).optional().describe("Thumbnail configuration"),
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
								tusSessionId: z.string().describe("Secure session ID for TUS proxy (client sends this to /api/videos/tus)"),
								chunkSize: z.number().describe("Recommended chunk size in bytes"),
								resumable: z.boolean().describe("Whether upload supports resume"),
								// Thumbnail fields
								thumbnailUrl: z.string().optional().describe("Primary thumbnail URL"),
								thumbnailSizes: z.object({
									hd: z.string().optional(),
									sd: z.string().optional(),
									mobile: z.string().optional(),
									thumb: z.string().optional(),
								}).optional().describe("Thumbnail URLs for different sizes"),
								// Legacy fields for backward compatibility
								libraryId: z.number().optional().describe("Library ID"),
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
			const { title, description, fileSize, mimeType, isPublic, tags, thumbnail } = request.body;

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
			logger.info('[DEBUG] Extracting Bunny secrets...', {
				hasKeyBinding: !!c.env["bunny-stream-key"],
				keyBindingType: typeof c.env["bunny-stream-key"],
				hasLibraryBinding: !!c.env.bunny_stream_library_id,
				libraryBindingType: typeof c.env.bunny_stream_library_id,
			});

			const bunnyKey = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
			const libraryIdRaw = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');

			logger.info('[DEBUG] Bunny secrets extracted', {
				keyLength: bunnyKey?.length || 0,
				keyPrefix: bunnyKey?.substring(0, 8) || 'none',
				libraryId: libraryIdRaw,
			});

			const libraryId = parseInt(libraryIdRaw, 10);

			if (isNaN(libraryId)) {
				return c.json({
					success: false,
					error: "Bunny Stream library ID is invalid"
				}, 500);
			}

			const bunnyStream = new stream(bunnyKey);

			// Fetch channel and ensure it has a Bunny.net collection
			let collectionId: string | undefined;

			// Only create/check collection if channelId is not the userId (i.e., a real channel)
			if (channelId !== userId) {
				const channelBucket = c.env.channels;
				const channelRepo = new R2Repository<Channel>(channelBucket);
				const channel = await channelRepo.getObject(channelId);

				if (!channel) {
					logger.warn('[UploadInitiate] Channel not found, skipping collection', {
						channelId,
						userId,
					});
				} else {
					collectionId = channel.bunnyCollectionId;

					// Create collection if it doesn't exist
					if (!collectionId) {
						logger.info('[UploadInitiate] Creating Bunny.net collection for channel', {
							channelId,
							channelName: channel.name,
						});

						try {
							const collection = await bunnyStream.createCollection(libraryId, {
								name: channel.name || `Channel ${channelId}`,
							});

							collectionId = collection.guid;

							// Save collection ID to channel object
							channel.bunnyCollectionId = collectionId;
							channel.dateModified = new Date().toISOString();
							await channelRepo.putObject(channelId, channel);

							logger.info('[UploadInitiate] Collection created and saved to channel', {
								channelId,
								collectionId,
							});
						} catch (error) {
							logger.error('[UploadInitiate] Failed to create collection', {
								channelId,
								error: error instanceof Error ? error.message : String(error),
							});
							// Continue without collection - video will be created without collectionId
						}
					} else {
						logger.info('[UploadInitiate] Using existing collection for channel', {
							channelId,
							collectionId,
						});
					}
				}
			}

			// Create video in Bunny Stream
			const bunnyVideo = await bunnyStream.createVideo(libraryId, {
				title,
				collectionId, // Add to collection if available
				thumbnailTime: 0,
			});

			const videoId = bunnyVideo.guid;

			// Process thumbnail if provided
			let thumbnailUrl = '';
			let thumbnailType: 'auto' | 'custom' = 'auto';
			let thumbnailSizes: Record<string, string> | undefined;

			if (thumbnail) {
				if (thumbnail.type === 'custom' && thumbnail.data) {
					try {
						// Process custom thumbnail
						const processed = await thumbnailProcessor.processBase64(
							thumbnail.data,
							thumbnail.filename || 'thumbnail.jpg'
						);

						// Store in R2 (using videos bucket for now, should be separate thumbnail bucket)
						const cdnBaseUrl = 'https://cdn.alummahnow.net'; // Configure as environment variable
						const storageResult = await thumbnailStorage.storeInR2(
							videoId,
							processed.original,
							processed.mimeType,
							c.env.videos,
							cdnBaseUrl
						);

						thumbnailUrl = storageResult.cdnUrl;
						thumbnailType = 'custom';
						thumbnailSizes = storageResult.thumbnailSizes;
					} catch (error) {
						logger.error('Thumbnail processing failed:', error);
						// Continue without custom thumbnail, will fall back to auto-generated
					}
				} else if (thumbnail.type === 'auto' && thumbnail.position !== undefined) {
					// Store auto-thumbnail preference for later use
					thumbnailType = 'auto';
					// Note: Bunny.net will generate thumbnail based on thumbnailTime set during video creation
					// The position preference will be stored in metadata for later processing
				}
			}

			// Create video metadata for R2 storage
			const video = {
				id: videoId,
				title,
				description: description || '',
				userId,
				channelId,
				thumbnailUrl,
				thumbnailType,
				thumbnailSizes,
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
			logger.info('[UploadInitiate] Preparing to save video metadata to R2', {
				videoId,
				bucketBinding: 'videos',
				videoData: {
					title: video.title,
					userId: video.userId,
					channelId: video.channelId,
					uploadStatus: video.uploadStatus
				}
			});

			const bucket = c.env.videos;

			if (!bucket) {
				logger.error('[UploadInitiate] R2 bucket binding not available', { videoId });
				throw new Error('R2 bucket binding "videos" is not configured');
			}

			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(bucket);

			try {
				await repository.putObject(videoId, video);
				logger.info('[UploadInitiate] Video metadata saved successfully to R2', { videoId });
			} catch (error) {
				logger.error('[UploadInitiate] Failed to save video metadata to R2', {
					videoId,
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});
				throw error; // Re-throw so the endpoint returns an error
			}

			// Send analytics event for upload initiation
			const queue = new Queue(c.env.queue);
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

			// Generate UUID for TUS session
			const tusSessionId = crypto.randomUUID();

			// Store TUS session in KV with UUID as key
			const tusSessionData = {
				videoId,
				userId,
				channelId,
				tusEndpoint: tusConfig.tusEndpoint,
				tusHeaders: tusConfig.tusHeaders,
				expiresAt: tusConfig.expiresAt,
				createdAt: new Date().toISOString(),
			};

			await c.env.TUS_SESSIONS.put(
				`tus:session:${tusSessionId}`,
				JSON.stringify(tusSessionData),
				{ expirationTtl: 3600 } // 1 hour expiration
			);

			logger.info('[UploadInitiate] TUS session created', {
				tusSessionId,
				videoId,
				userId,
			});

			// Return session ID to client (no TUS credentials exposed)
			return c.json({
				success: true,
				result: {
					videoId,
					tusSessionId, // Client uses this to access TUS proxy
					chunkSize: tusConfig.chunkSize,
					resumable: tusConfig.resumable,
					// Thumbnail fields
					thumbnailUrl,
					thumbnailSizes,
					// Legacy fields for backward compatibility
					libraryId,
					status: 'uploading',
					message: 'Upload initiated successfully. Use tusSessionId with TUS proxy.',
				},
			});

		} catch (error) {
			// Enhanced error logging
			logger.error("Upload initiate error:", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				name: error instanceof Error ? error.name : undefined,
				errorObject: error,
			});

			// Return more detailed error message for debugging
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;

			return c.json({
				success: false,
				error: "Failed to initiate upload",
				details: errorMessage,
				stack: errorStack,
			}, 500);
		}
	}
}
