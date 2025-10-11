import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { getAuthContext } from "../../middleware/auth";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";

export class UploadCompleteEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Videos"],
		summary: "Complete Video Upload",
		description: "🔒 **Authentication Required**: Finalize video upload and update status to processing.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							videoId: Str({ description: "Video ID from initiate endpoint" }),
							fileSize: z.number().optional().describe("Uploaded file size in bytes"),
							duration: z.number().optional().describe("Video duration in seconds"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Upload completed successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								videoId: z.string(),
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
			const { videoId, fileSize, duration } = request.body;

			// Get video from storage to verify ownership
			const bucket = env.videos;
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(bucket);
			const video = await repository.getObject(videoId);

			if (!video) {
				return c.json({
					success: false,
					error: "Video not found",
				}, 404);
			}

			// Check ownership
			if (video.userId !== userId) {
				return c.json({
					success: false,
					error: "Forbidden - you can only complete uploads for your own videos",
				}, 403);
			}

			// Update video status to processing
			const updatedVideo = {
				...video,
				uploadStatus: 'processing' as const,
				dateModified: new Date().toISOString(),
				...(fileSize && { fileSize }),
				...(duration && { duration }),
			};

			await repository.putObject(videoId, updatedVideo);

			// Send analytics event for completed upload
			const queue = new Queue();
			await queue.send(MessageType.VideoUploadCompleted, {
				videoId,
				userId,
				channelId: video.channelId,
				title: video.title,
				fileSize,
				duration,
				timestamp: new Date().toISOString(),
			});

			return c.json({
				success: true,
				result: {
					videoId,
					status: 'processing',
					message: 'Upload completed successfully. Video is now being processed.',
				},
			});

		} catch (error) {
			console.error("Upload complete error:", error);
			
			// Try to update video status to failed if we have the videoId
			try {
				const request = await this.getValidatedData<typeof this.schema>();
				const { videoId } = request.body;
				
				const bucket = env.videos;
				type VideoType = z.infer<typeof BusinessVideo>;
				const repository = new R2Repository<VideoType>(bucket);
				const video = await repository.getObject(videoId);
				
				if (video && video.userId === userId) {
					await repository.putObject(videoId, {
						...video,
						uploadStatus: 'failed' as const,
						dateModified: new Date().toISOString(),
					});

					// Send failure event
					const queue = new Queue();
					await queue.send(MessageType.VideoUploadFailed, {
						videoId,
						userId,
						error: error.message || 'Unknown error',
						timestamp: new Date().toISOString(),
					});
				}
			} catch (updateError) {
				console.error("Failed to update video status:", updateError);
			}

			return c.json({
				success: false,
				error: "Failed to complete upload"
			}, 500);
		}
	}
}
