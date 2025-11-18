import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { getAuthContext } from "../../middleware/auth";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import { requireSecret } from "../../lib/env-helpers";

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

export class VideoUploadStatus extends OpenAPIRoute {
	schema = {
		tags: ["Videos"],
		summary: "Get Video Upload Status",
		description: "🔒 **Authentication Required**: Get the upload and processing status of a video.",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
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

	async handle(c) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		const { id } = request.params;
		// Get auth context for user information
		const authContext = getAuthContext(c);
		const userId = authContext?.userId;

		if (!userId) {
			return c.json({
				success: false,
				error: "Authentication required"
			}, 401);
		}

		// Get video from storage
		const bucket = env.videos;
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
		if (video.userId !== userId) {
			return c.json({
				success: false,
				error: "Forbidden - you can only check status of your own videos",
			}, 403);
		}

		// Get status from Bunny Stream if possible
		let bunnyStreamStatus = null;
		try {
			const key = await requireSecret(env["bunny-stream-key"], 'bunny-stream-key');
			if (key) {
				const libraryIdStr = await requireSecret(env.bunny_stream_library_id, 'bunny_stream_library_id');
				const libraryId = parseInt(libraryIdStr);
				const bunnyStream = new stream(key);
				
				// Get video details from Bunny Stream
				bunnyStreamStatus = await bunnyStream.getVideo(libraryId, id);
			}
		} catch (error) {
			console.warn("Could not fetch Bunny Stream status:", error);
		}

		// Determine status based on video data and Bunny Stream info
		let status: "uploading" | "processing" | "ready" | "failed" | "deleted" = "ready";
		let progress = 100;
		let message = "Video is ready";
		
		if (bunnyStreamStatus) {
			// Map Bunny Stream status to our status
			// Status: 0=Queued, 1=Processing, 2=Encoding, 3=Finished, 4=Error, 5=Deleted
			switch (bunnyStreamStatus.status) {
				case 0: // Queued
					status = "uploading";
					progress = Math.max(10, bunnyStreamStatus.encodeProgress || 0);
					message = "Video upload queued";
					break;
				case 1: // Processing
					status = "processing";
					progress = Math.max(25, bunnyStreamStatus.encodeProgress || 25);
					message = "Video is being processed";
					break;
				case 2: // Encoding
					status = "processing";
					progress = Math.max(50, bunnyStreamStatus.encodeProgress || 50);
					message = "Video is being encoded";
					break;
				case 3: // Finished
					status = "ready";
					progress = 100;
					message = "Video is ready";
					break;
				case 4: // Error
					status = "failed";
					progress = 0;
					message = "Video processing failed";
					break;
				case 5: // Deleted
					status = "deleted";
					progress = 0;
					message = "Video has been deleted";
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

		// Build response
		const uploadStatus: z.infer<typeof UploadStatus> = {
			videoId: id,
			status,
			progress,
			message,
			encodingStatus: bunnyStreamStatus ? {
				isProcessing: bunnyStreamStatus.status === 1 || bunnyStreamStatus.status === 2,
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