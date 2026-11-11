import { Bool, Str } from "chanfana";
import { z } from "zod";
import { ResponseError } from "../../lib/types";
import { softDeleteForCreator, type CreatorDeletionResult } from "../../lib/creatorDeletions";
import { BulkItemResult } from "./videoTrashSchemas";
import { AuthenticatedRoute, AppContext } from '../../base';

export class VideoBulkDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Delete multiple videos (soft: restorable for 30 days)",
		description:
			"Moves up to 50 videos to the channel trash (owner, or a channel role with video.delete; an editor only their own uploads). Each successful result carries `restorableUntil`; a video already in the trash counts as deleted. Undo with POST /api/videos/bulk-restore or POST /api/videos/{id}/restore.",
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
							results: z.array(BulkItemResult),
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

		// Soft deletes, restorable for 30 days (lib/creatorDeletions.ts)
		const results = await Promise.allSettled(
			videoIds.map((videoId) => userId
				? softDeleteForCreator(c.env as never, videoId, userId)
				: Promise.resolve({ videoId, success: false, error: "Forbidden - you can only delete your own videos" })),
		);

		// Process results
		const processedResults = results.map((result, index) => {
			if (result.status === "fulfilled") {
				const { videoId, success, error, code, restorableUntil } = result.value as CreatorDeletionResult;
				return { videoId, success, ...(error ? { error } : {}), ...(code ? { code } : {}), ...(restorableUntil ? { restorableUntil } : {}) };
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
