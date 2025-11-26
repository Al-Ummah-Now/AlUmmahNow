import { AuthenticatedRoute, AppContext } from "../../base";
import { Str } from "chanfana";
import { z } from "zod";
import { LiveStream as BusinessLiveStream, ResponseError } from "../../lib/types";
import { LiveStreamUpdateInput } from "../../lib/model/input";
import { LiveStreamView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { addAuthToSchema } from "../../lib/openapi-auth";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';

export class LiveStreamUpdate extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Live Streams"],
		summary: "Update Live Stream Status",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token. Update live stream status, start/stop streaming, or modify stream settings.",
		request: {
			params: z.object({
				id: Str({ description: "Live Stream ID" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional(),
			}),
			body: {
				content: {
					"application/json": {
						schema: LiveStreamUpdateInput,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the updated live stream",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean().default(true),
							result: z.object({
								stream: LiveStreamView,
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
			"401": {
				description: "Unauthorized - missing or invalid authentication token",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"403": {
				description: "Forbidden - insufficient permissions to modify this stream",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"404": {
				description: "Live stream not found",
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
	});

	async handle(c: AppContext) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		const { id } = request.params;
		const { channelId } = request.headers;
        const userId = this.getUserId(c);
		const updateData = request.body;

		try {
			const bucket = c.env.videos;
			type LiveStreamType = z.infer<typeof BusinessLiveStream>;
			const repository = new R2Repository<LiveStreamType>(bucket);

			// Get existing live stream
			const existingStream = await repository.getObject(`livestream:${id}`);
			if (!existingStream) {
				return c.json(
					{
						success: false,
						error: "Live stream not found",
					},
					404
				);
			}

			// Check if user owns the stream
			if (existingStream.userId !== userId) {
				return c.json(
					{
						success: false,
						error: "Insufficient permissions to modify this stream",
					},
					403
				);
			}

			// Update the stream
			const updatedStream = {
				...existingStream,
				...updateData,
				dateModified: new Date().toISOString(),
			};

			// Handle status changes
			if (updateData.status) {
				switch (updateData.status) {
					case 'live':
						if (!updatedStream.actualStartTime) {
							updatedStream.actualStartTime = new Date().toISOString();
						}
						break;
					case 'ended':
						if (!updatedStream.actualEndTime) {
							updatedStream.actualEndTime = new Date().toISOString();
						}
						break;
				}
			}

			// Save updated stream
			await repository.putObject(`livestream:${id}`, updatedStream);

			// Send queue message for live stream update
			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.LiveStreamUpdate, {
				liveStreamId: id,
				userId,
				channelId,
				timestamp: new Date().toISOString(),
				status: updatedStream.status,
			});

			// Transform to view model for response
			const streamView = {
				...updatedStream,
				likesCount: updatedStream.likes?.length || 0,
				dislikesCount: updatedStream.dislikes?.length || 0,
				commentsCount: updatedStream.comments?.length || 0,
				duration: updatedStream.actualEndTime && updatedStream.actualStartTime 
					? Math.floor((new Date(updatedStream.actualEndTime).getTime() - new Date(updatedStream.actualStartTime).getTime()) / 1000)
					: undefined,
				// Keep streaming credentials for owner
				streamKey: updatedStream.streamKey, // Keep for owner
				rtmpUrl: updatedStream.rtmpUrl, // Keep for owner
			};

			return {
				success: true,
				result: { stream: streamView },
			};
		} catch (error) {
			logger.error("Error updating live stream:", error);
			return c.json(
				{
					success: false,
					error: "Failed to update live stream",
				},
				500
			);
		}
	}
}