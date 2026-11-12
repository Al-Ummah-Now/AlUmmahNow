import { canOnVideo } from "../../lib/channelAccess";
import { OpenAPIRoute, Str } from "chanfana";
import { OptionalAuthRoute, AppContext } from '../../base';
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import { requireSecret } from "../../lib/env-helpers";
import { logger } from '../../lib/logger';
import { syncVideoFromBunny } from "../../lib/processing/loop";
import { bunnyPhase, uploadStatusView } from "../../lib/processing/sync";
import { ownerR2View } from "../../lib/media/r2-delivery";

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
	r2: z.object({
		status: z.enum(["queued", "transcoding", "ready", "failed"]),
		access: z.enum(["pub", "priv"]),
		rev: z.string(),
		attempts: z.number(),
		queuedAt: z.string(),
		startedAt: z.string().optional(),
		readyAt: z.string().optional(),
		failedAt: z.string().optional(),
		error: z.string().optional(),
		renditions: z.array(z.string()).describe("Rungs the transcode wrote (720p, 480p, ...)"),
		playUrl: z.string().optional().describe("R2 master playlist (signed when private); ready only"),
	}).optional().describe("R2 delivery beside Bunny (epic #687): the transcode's state; absent where there is no dual write"),
});

async function ownerR2Field(env: unknown, video: unknown): Promise<{ r2?: z.infer<typeof UploadStatus>["r2"] }> {
	const r2 = await ownerR2View(env as never, video as never);
	return r2 ? { r2 } : {};
}

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
		if (!(await canOnVideo(c.env as never, video, effectiveUserId, 'video.view_private'))) {
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

		// One mapping for the status endpoint and the processing-check loop
		// (lib/processing/sync.ts): playable at the first encoded resolution
		// counts as ready. The record is written (and ready/failed announced
		// once) by the same code the loop uses.
		let status: "uploading" | "processing" | "ready" | "failed" | "deleted" = "ready";
		let progress = 100;
		let message = "Video is ready";

		if (bunnyStreamStatus) {
			({ status, progress, message } = uploadStatusView(bunnyPhase(bunnyStreamStatus), bunnyStreamStatus, video as never));
			try {
				await syncVideoFromBunny(c.env as never, id, { bunny: bunnyStreamStatus });
			} catch (error) {
				logger.error('[VideoUploadStatus] Failed to sync the video from Bunny', {
					videoId: id,
					error: error instanceof Error ? error.message : String(error),
				});
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
			...(await ownerR2Field(c.env, video)),
		};

		return {
			success: true,
			result: uploadStatus,
		};
	}
}
