import { OpenAPIRoute, Str } from "chanfana";
import { AuthenticatedRoute, AppContext } from '../../base';
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository, { rethrowBusy } from "../../lib/r2Repo";
import { patchVideo } from '../../lib/videoWrites';
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';
import { startProcessingLoop } from '../../lib/processing/loop';

export class UploadCompleteEndpoint extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Complete Video Upload",
		description: "🔒 **Authentication Required**: Finalize video upload and update status to processing.",
		request: {
			headers: z.object({
          channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
        }),
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

	async handle(c: AppContext) {
		// Get auth context
		const userId = this.getUserId(c);


		let videoId: string | undefined;

		try {
			// Get validated data
			const request = await this.getValidatedData<typeof this.schema>();
			videoId = request.body.videoId;
			const { fileSize, duration } = request.body;

			// Get video from storage to verify ownership
			const bucket = c.env.videos;
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

			// Update video status to processing with a conditional write on the
			// fresh video (SCALABILITY-AUDIT AV-3). A video that processing already
			// marked ready keeps that status (it never goes back to processing).
			const saved = await patchVideo(repository, videoId, (fresh) => ({
				...(fresh.uploadStatus === 'ready' ? {} : { uploadStatus: 'processing' as const }),
				dateModified: new Date().toISOString(),
				...(fileSize && { fileSize }),
				...(duration && { duration }),
				// The proxy's durable session copy and the upload-side flags are
				// not needed once uploaded (lib/uploads/lifecycle.ts)
				tusUpload: undefined,
				uploadWatch: undefined,
				...(fresh.processingIssue?.kind === 'needs_reupload' ? { processingIssue: undefined } : {}),
			} as Partial<VideoType>), { ownerId: userId });
			if (saved.status === 'missing') {
				return c.json({ success: false, error: "Video not found" }, 404);
			}
			if (saved.status === 'forbidden') {
				return c.json({ success: false, error: "Forbidden - you can only complete uploads for your own videos" }, 403);
			}

			// Send analytics event for completed upload
			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.VideoUploadCompleted, {
				videoId,
				userId,
				channelId: video.channelId,
				title: video.title,
				fileSize,
				duration,
				timestamp: new Date().toISOString(),
			});

			// Check Bunny until the encode finishes (lib/processing/loop.ts)
			await startProcessingLoop(c.env as never, videoId, { reason: 'upload-complete' }).catch((error) =>
				logger.error('[UploadComplete] Could not start the processing check loop', { videoId, error: error instanceof Error ? error.message : String(error) }),
			);

			return c.json({
				success: true,
				result: {
					videoId,
					status: 'processing',
					message: 'Upload completed successfully. Video is now being processed.',
				},
			});

		} catch (error) {
			rethrowBusy(error);
			logger.error("Upload complete error:", error);

			// Try to update video status to failed if we have the videoId
			if (videoId) {
				try {
					const bucket = c.env.videos;
					type VideoType = z.infer<typeof BusinessVideo>;
					const repository = new R2Repository<VideoType>(bucket);
					// Conditional write; a video already processed (ready) is left alone
					const failed = await patchVideo(repository, videoId, (fresh) => fresh.uploadStatus === 'ready' ? false : {
						uploadStatus: 'failed' as const,
						dateModified: new Date().toISOString(),
					}, { ownerId: userId });

					if (failed.status === 'ok' && failed.changed) {
						// Send failure event
						const queue = new Queue(c.env.queue);
						await queue.send(MessageType.VideoUploadFailed, {
							videoId,
							userId,
							title: failed.video.title,
							error: error.message || 'Unknown error',
							timestamp: new Date().toISOString(),
						});
					}
				} catch (updateError) {
					logger.error("Failed to update video status:", updateError);
				}
			}

			return c.json({
				success: false,
				error: "Failed to complete upload"
			}, 500);
		}
	}
}
