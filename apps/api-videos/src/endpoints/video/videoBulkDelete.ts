import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { enqueueBunnyDelete } from "../../lib/uploads/bunnyDelete";
import { AuthenticatedRoute, AppContext } from '../../base';

export class VideoBulkDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Delete multiple videos",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							videoIds: z.array(Str({ description: "Array of video IDs to delete" })).min(1).max(50),
						}),
					},
				},
			},
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
		},
		responses: {
			"200": {
				description: "Returns the result of bulk deletion",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							results: z.array(z.object({
								videoId: Str(),
								success: Bool(),
								error: Str().optional(),
							})),
							summary: z.object({
								total: z.number(),
								succeeded: z.number(),
								failed: z.number(),
							}),
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

		const { videoIds } = request.body;
		const userId = this.getUserId(c);
		const { channelId } = request.headers;

		// Get the repository
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		const queue = new Queue(c.env.queue);

		// Process each video deletion
		const results = await Promise.allSettled(
			videoIds.map(async (videoId) => {
				try {
					// Get the video before deletion to verify it exists
					const video = await repository.getObject(videoId);

					if (!video) {
						return {
							videoId,
							success: false,
							error: "Video not found",
						};
					}

					// Only the owner may delete a video
					if (!userId || video.userId !== userId) {
						return {
							videoId,
							success: false,
							error: "Forbidden - you can only delete your own videos",
						};
					}

					// Send queue message for video deletion
					await queue.send(MessageType.VideoDelete, {
						videoId: videoId,
						userId: userId,
						channelId: channelId,
						timestamp: new Date().toISOString(),
					});

					// Delete the video, then its Bunny video (queued; lib/uploads/bunnyDelete.ts)
					await repository.deleteObject(videoId);
					await enqueueBunnyDelete(c.env.PROCESSING_CHECK_QUEUE, videoId, 'bulk-delete');

					return {
						videoId,
						success: true,
					};
				} catch (error) {
					return {
						videoId,
						success: false,
						error: error instanceof Error ? error.message : "Unknown error",
					};
				}
			})
		);

		// Process results
		const processedResults = results.map((result, index) => {
			if (result.status === "fulfilled") {
				return result.value;
			} else {
				return {
					videoId: videoIds[index],
					success: false,
					error: result.reason instanceof Error ? result.reason.message : "Deletion failed",
				};
			}
		});

		// Calculate summary
		const succeeded = processedResults.filter(r => r.success).length;
		const failed = processedResults.filter(r => !r.success).length;

		return {
			success: true,
			results: processedResults,
			summary: {
				total: videoIds.length,
				succeeded,
				failed,
			},
		};
	}
}
