import { Bool, Str } from "chanfana";
import R2Repository from "../../lib/r2Repo";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { z } from "zod";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";

export class ChannelDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Delete a Channel",
		request: {
			params: z.object({
				id: Str({ description: "Channel ID" }),
			}),
		},
		responses: {
			"200": {
				description: "Returns if the Channel was deleted successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
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

		// Retrieve the validated id
		const { id } = request.params;
		const userId = this.getUserId(c);

		// Get the channel before deletion
		const bucket = c.env.channels;
		type ChannelType = z.infer<typeof BusinessChannel>;
		const repository = new R2Repository<ChannelType>(bucket);
		
		let channel = await repository.getObject(id);
		if (!channel) {
			return c.json({
				success: false,
				error: "Channel not found",
			}, 404);
		}

		// Send queue message for channel deletion
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.ChannelDelete, {
			channelId: id,
			userId: userId,
			timestamp: new Date().toISOString(),
		});

		// Delete the channel
		await repository.deleteObject(id);

		// Return the deleted task for confirmation
		return {
			success: true,
		};
	}
}
