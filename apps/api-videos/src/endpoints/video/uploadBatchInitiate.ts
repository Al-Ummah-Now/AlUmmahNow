import { Str, Num } from "chanfana";
import { AuthenticatedRoute, AppContext } from '../../base';
import { z } from "zod";
import { VideoCategory } from "@al-ummah/shared-types";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret } from "../../lib/env-helpers";
import { generateTUSConfig, createTusProxySession } from "../../lib/bunny/tus";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { logger } from '../../lib/logger';

const MAX_BATCH_SIZE = 15;

const BatchVideoSchema = z.object({
	title: Str({ description: "Video title" }),
	description: Str({ description: "Video description" }).optional(),
	fileSize: Num({ description: "File size in bytes", required: true }),
	mimeType: Str({ description: "MIME type of the video file", required: true }),
	isPublic: z.boolean().optional(),
	tags: z.string().optional().describe("Comma-separated tags"),
});

const SharedMetadataSchema = z.object({
	channelId: z.string().optional().describe("Channel ID for all videos (defaults to the channelId header)"),
	category: z.nativeEnum(VideoCategory).optional().describe("Category for all videos"),
	isPublic: z.boolean().optional().describe("Visibility for all videos"),
});

type BatchVideo = z.infer<typeof BatchVideoSchema>;

/**
 * Validate a single batch entry. Returns an error message or null.
 */
function validateBatchVideo(video: BatchVideo): string | null {
	if (!video.fileSize || video.fileSize <= 0) {
		return `Invalid file size for "${video.title}": must be a positive number`;
	}
	if (!video.mimeType || !video.mimeType.startsWith('video/')) {
		return `Invalid MIME type for "${video.title}": must be a video format (e.g., video/mp4)`;
	}
	return null;
}

export class UploadBatchInitiateEndpoint extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Videos"],
		summary: "Initiate Batch Video Upload",
		description: "🔒 **Authentication Required**: Initiate upload for multiple videos (up to 15). Each video gets a TUS proxy session; upload each file to /api/videos/tus with `tusSessionId` in the upload metadata (same flow as single upload).",
		request: {
			headers: z.object({
				channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
			}),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							videos: z.array(BatchVideoSchema).min(1).max(MAX_BATCH_SIZE).describe("Array of video metadata (1-15 videos)"),
							sharedMetadata: SharedMetadataSchema.optional().describe("Shared metadata applied to all videos"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Batch upload initiated successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.array(z.object({
								videoId: z.string().describe("Video GUID for upload"),
								tusSessionId: z.string().describe("Session ID for the TUS proxy (send as tusSessionId upload metadata)"),
								expiresAt: z.string().describe("ISO 8601 datetime when the session expires"),
								chunkSize: z.number().describe("Recommended chunk size in bytes"),
								resumable: z.boolean().describe("Whether upload supports resume"),
							})),
						}),
					},
				},
			},
			"400": {
				description: "Bad request - invalid input data",
				content: { "application/json": { schema: ResponseError } },
			},
			"401": {
				description: "Unauthorized - authentication required",
				content: { "application/json": { schema: ResponseError } },
			},
			"500": {
				description: "Internal server error",
				content: { "application/json": { schema: ResponseError } },
			},
		},
	}, 'required');

	async handle(c: AppContext) {
		const userId = this.getUserId(c);

		try {
			const request = await this.getValidatedData<typeof this.schema>();
			const { videos, sharedMetadata } = request.body;

			// Validate every entry before creating anything in Bunny/R2
			for (const video of videos) {
				const validationError = validateBatchVideo(video);
				if (validationError) {
					return c.json({ success: false, error: validationError }, 400);
				}
			}

			// channelIdMiddleware already verified the header belongs to this user.
			// A body channelId is only accepted when it matches the header.
			const headerChannelId = request.headers.channelId || undefined;
			if (sharedMetadata?.channelId && headerChannelId && sharedMetadata.channelId !== headerChannelId) {
				return c.json({ success: false, error: "sharedMetadata.channelId must match the channelId header" }, 400);
			}
			const channelId = headerChannelId || userId;

			const bunnyKey = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
			const libraryIdRaw = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
			const libraryId = parseInt(libraryIdRaw, 10);

			if (isNaN(libraryId)) {
				return c.json({ success: false, error: "Bunny Stream library ID is invalid" }, 500);
			}

			const bunnyStream = new stream(bunnyKey);
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(c.env.videos);
			const queue = new Queue(c.env.queue);

			logger.info('[UploadBatchInitiate] Initiating batch', {
				userId,
				channelId,
				videoCount: videos.length,
			});

			const results = await Promise.all(videos.map(async (videoData) => {
				const bunnyVideo = await bunnyStream.createVideo(libraryId, {
					title: videoData.title,
					thumbnailTime: 0,
				});
				const videoId = bunnyVideo.guid;
				const now = new Date().toISOString();

				const video: VideoType = {
					id: videoId,
					title: videoData.title,
					description: videoData.description || '',
					userId,
					channelId,
					playUrl: `https://${c.env.bunny_hostname}/${videoId}/playlist.m3u8`,
					thumbnailType: 'auto',
					dateCreated: now,
					dateModified: now,
					views: 0,
					availableResolutions: [],
					comments: [],
					likes: [],
					dislikes: [],
					isPublic: videoData.isPublic ?? sharedMetadata?.isPublic ?? true,
					isLive: false,
					tags: videoData.tags ? videoData.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [],
					category: sharedMetadata?.category,
					uploadStatus: 'uploading',
					fileSize: videoData.fileSize,
					originalFormat: videoData.mimeType,
				};

				await repository.putObject(videoId, video);

				await queue.send(MessageType.VideoUploadStarted, {
					videoId,
					userId,
					channelId,
					title: videoData.title,
					fileSize: videoData.fileSize,
					mimeType: videoData.mimeType,
					timestamp: now,
					batchUpload: true,
				});

				const tusConfig = await generateTUSConfig(libraryId, bunnyKey, videoId, 1);
				const tusSessionId = await createTusProxySession(c.env.TUS_SESSIONS, {
					videoId,
					userId,
					channelId,
					tusConfig,
				});

				return {
					videoId,
					tusSessionId,
					expiresAt: tusConfig.expiresAt,
					chunkSize: tusConfig.chunkSize,
					resumable: tusConfig.resumable,
				};
			}));

			logger.info('[UploadBatchInitiate] Batch initiated', {
				userId,
				channelId,
				videoIds: results.map(r => r.videoId),
			});

			return c.json({ success: true, result: results });
		} catch (error) {
			logger.error("[UploadBatchInitiate] Batch upload initiate error", {
				userId,
				error: error instanceof Error ? error.message : String(error),
			});
			return c.json({
				success: false,
				error: error instanceof Error ? error.message : "Failed to initiate batch upload"
			}, 500);
		}
	}
}
