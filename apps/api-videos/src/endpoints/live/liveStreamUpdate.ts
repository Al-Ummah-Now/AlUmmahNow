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
import { inBackground } from "../../lib/websocket-notify";
import { announceLiveStarted } from "../../lib/notification-events";

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
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
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

			// Update the stream on the fresh copy with a conditional write
			// (SCALABILITY-AUDIT AV-3)
			let previousStatus = existingStream.status;
			const { data: updatedStream, rejected } = await repository.updateObjectOrReject<true>(`livestream:${id}`, (fresh) => {
				if (fresh.userId !== userId) return { reject: true };
				previousStatus = fresh.status;
				Object.assign(fresh, updateData, { dateModified: new Date().toISOString() });

				// Handle status changes
				if (updateData.status === 'live' && !fresh.actualStartTime) {
					fresh.actualStartTime = new Date().toISOString();
				}
				if (updateData.status === 'ended' && !fresh.actualEndTime) {
					fresh.actualEndTime = new Date().toISOString();
				}
				return true;
			});
			if (!updatedStream) {
				return c.json({ success: false, error: "Live stream not found" }, 404);
			}
			if (rejected) {
				return c.json({ success: false, error: "Insufficient permissions to modify this stream" }, 403);
			}

			// Went live: tell subscribers (Story 29.10; processor de-duplicates per stream)
			if (updatedStream.status === 'live' && previousStatus !== 'live') {
				inBackground(c, 'live-started', () =>
					announceLiveStarted(c.env, { id, channelId: updatedStream.channelId || channelId, userId, title: updatedStream.title }),
				);
			}

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