import { OpenAPIRoute, Str } from "chanfana";
import { OptionalAuthRoute, AppContext } from '../../base';
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import { requireSecret } from "../../lib/env-helpers";
import { logger } from '../../lib/logger';
import { inBackground } from "../../lib/websocket-notify";
import { announceProcessingResult } from "../../lib/notification-events";

// Upload status type
const UploadStatus = z.object({
	videoId: z.string(),
	status: z.enum(["uploading", "processing", "ready", "failed", "deleted"]),
	progress: z.number().min(0).max(100).describe("Upload/processing progress percentage"),
	message: z.string().optional().describe("Status message or error description"),
	encodingStatus: z.object({
		isProcessing: z.boolean(),
		encodingProgress: z.number().min(0).max(100),
		availableResolutions: z.array(z.string()),
	}).optional(),
	metadata: z.object({
		title: z.string().optional(),
		duration: z.number().optional(),
		fileSize: z.number().optional(),
		originalFormat: z.string().optional(),
	}).optional(),
	timestamps: z.object({
		uploadStarted: z.string().optional(),
		uploadCompleted: z.string().optional(),
		processingStarted: z.string().optional(),
		processingCompleted: z.string().optional(),
	}).optional(),
});

export class VideoUploadStatus extends OptionalAuthRoute {
	schema = {
		tags: ["Videos"],
		summary: "Get Video Upload Status",
		description: "🔒 **Authentication Required**: Get the upload and processing status of a video.",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns video upload/processing status",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: UploadStatus,
						}),
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
			"403": {
				description: "Forbidden - user doesn't own this video",
				content: {
					"application/json": {
						schema: ResponseError,
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

		const { id } = request.params;
		const { channelId } = request.headers;
		// Get auth context for user information
		const effectiveUserId = this.getUserId(c);

		if (!effectiveUserId) {
			return c.json({
				success: false,
				error: "Authentication required"
			}, 401);
		}

		// Get video from storage
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		const video = await repository.getObject(id);

		if (!video) {
			return c.json({
				success: false,
				error: "Video not found",
			}, 404);
		}

		// Check ownership - user must own the video to check status
		if (video.userId !== effectiveUserId) {
			return c.json({
				success: false,
				error: "Forbidden - you can only check status of your own videos",
			}, 403);
		}

		// Get status from Bunny Stream if possible
		let bunnyStreamStatus = null;
		try {
			const key = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
			if (key) {
				const libraryIdStr = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
				const libraryId = parseInt(libraryIdStr);
				const bunnyStream = new stream(key);

				// Get video details from Bunny Stream
				bunnyStreamStatus = await bunnyStream.getVideo(libraryId, id);

				// Log transcoding messages if video failed or has warnings
				if (bunnyStreamStatus.status === 5 || bunnyStreamStatus.status === 6 || bunnyStreamStatus.transcodingMessages?.length) {
					logger.warn('[VideoUploadStatus] Bunny.net transcoding messages', {
						videoId: id,
						status: bunnyStreamStatus.status,
						messages: bunnyStreamStatus.transcodingMessages,
					});
				}
			}
		} catch (error) {
			logger.warn("Could not fetch Bunny Stream status:", error);
		}

		// Determine status based on video data and Bunny Stream info
		let status: "uploading" | "processing" | "ready" | "failed" | "deleted" = "ready";
		let progress = 100;
		let message = "Video is ready";
		
		if (bunnyStreamStatus) {
			// Map Bunny Stream status to our status (see lib/bunny/schema.json):
			// 0=Created, 1=Uploaded, 2=Processing, 3=Transcoding, 4=Finished,
			// 5=Error, 6=UploadFailed, 7=Transcribing (captions; playable), 8+ JIT states (playable)
			switch (bunnyStreamStatus.status) {
				case 0: // Created
					status = "uploading";
					progress = Math.max(10, bunnyStreamStatus.encodeProgress || 0);
					message = "Video upload queued";
					break;
				case 1: // Uploaded
				case 2: // Processing
					status = "processing";
					progress = Math.max(25, bunnyStreamStatus.encodeProgress || 25);
					message = "Video is being processed";
					break;
				case 3: // Transcoding
					status = "processing";
					progress = Math.max(50, bunnyStreamStatus.encodeProgress || 50);
					message = "Video is being encoded";
					break;
				case 5: // Error
				case 6: // UploadFailed
					status = "failed";
					progress = 0;
					message = "Video processing failed";
					break;
				default: // 4=Finished, 7=Transcribing and later states are playable
					status = "ready";
					progress = 100;
					message = "Video is ready";
					break;
			}
		} else if (video.uploadStatus === 'initiated' || video.uploadStatus === 'uploading') {
			status = "uploading";
			progress = 10;
			message = "Waiting for video upload";
		} else if (video.uploadStatus === 'processing') {
			status = "processing";
			progress = 50;
			message = "Video is being processed";
		} else if (video.uploadStatus === 'failed') {
			status = "failed";
			progress = 0;
			message = "Upload or processing failed";
		}

		// Update R2 object if status changed or resolutions need updating
		const needsUpdate = bunnyStreamStatus && (
			video.uploadStatus !== status ||
			(bunnyStreamStatus.availableResolutions && video.availableResolutions.length === 0) ||
			(bunnyStreamStatus.length && !video.duration)
		);

		if (needsUpdate) {
			const previousStatus = video.uploadStatus;
			try {
				logger.info('[VideoUploadStatus] Updating video status in R2', {
					videoId: id,
					oldStatus: video.uploadStatus,
					newStatus: status,
					bunnyStatus: bunnyStreamStatus.status,
				});

				video.uploadStatus = status as any;
				video.dateModified = new Date().toISOString();

				// Update available resolutions if Bunny.net has them
				if (bunnyStreamStatus.availableResolutions) {
					video.availableResolutions = bunnyStreamStatus.availableResolutions
						.split(',')
						.map(r => r.trim())
						.filter(r => r.length > 0);
				}

				// Update duration if available
				if (bunnyStreamStatus.length) {
					video.duration = bunnyStreamStatus.length;
				}

				// Update storage size if available
				if (bunnyStreamStatus.storageSize) {
					video.fileSize = bunnyStreamStatus.storageSize;
				}

				// Set playUrl for HLS streaming
				if (!video.playUrl && bunnyStreamStatus.guid) {
					video.playUrl = `https://${c.env.bunny_hostname}/${bunnyStreamStatus.guid}/playlist.m3u8`;
				}
				// Bunny's auto thumbnail sits next to the playlist
				if (!video.thumbnailUrl && video.playUrl?.endsWith('/playlist.m3u8')) {
					video.thumbnailUrl = video.playUrl.replace(/playlist\.m3u8$/, 'thumbnail.jpg');
				}

				await repository.putObject(id, video);
				logger.info('[VideoUploadStatus] Video status updated in R2', { videoId: id, status });

				// Terminal transition: uploader notification + subscriber fan-out (Story 29.10).
				// Repeated polls never reach here twice (status already stored); the
				// processor de-duplicates anyway.
				if (previousStatus !== status && (status === 'ready' || status === 'failed')) {
					const terminal = status;
					inBackground(c, 'processing-result', () => announceProcessingResult(c.env, { ...video, id }, terminal));
				}
			} catch (error) {
				logger.error('[VideoUploadStatus] Failed to update video status in R2', {
					videoId: id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		// Build response
		const uploadStatus: z.infer<typeof UploadStatus> = {
			videoId: id,
			status,
			progress,
			message,
			encodingStatus: bunnyStreamStatus ? {
				isProcessing: bunnyStreamStatus.status >= 1 && bunnyStreamStatus.status <= 3,
				encodingProgress: bunnyStreamStatus.encodeProgress || progress,
				availableResolutions: bunnyStreamStatus.availableResolutions 
					? bunnyStreamStatus.availableResolutions.split(',').map(r => r.trim()) 
					: [],
			} : undefined,
			metadata: {
				title: video.title,
				duration: bunnyStreamStatus?.length || video.duration || undefined,
				fileSize: bunnyStreamStatus?.storageSize || video.fileSize || undefined,
				originalFormat: video.originalFormat || undefined,
			},
			timestamps: {
				uploadStarted: video.dateCreated,
				uploadCompleted: video.dateModified !== video.dateCreated ? video.dateModified : undefined,
				processingStarted: undefined, // Could be tracked separately
				processingCompleted: status === "ready" ? video.dateModified : undefined,
			},
		};

		return {
			success: true,
			result: uploadStatus,
		};
	}
}
