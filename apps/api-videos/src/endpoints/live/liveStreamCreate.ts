import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { LiveStream as BusinessLiveStream, ResponseError } from "../../lib/types";
import { LiveStreamInput } from "../../lib/model/input";
import { LiveStreamView } from "../../lib/model/view";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { addAuthToSchema } from "../../lib/openapi-auth";

export class LiveStreamCreate extends OpenAPIRoute {
	schema = addAuthToSchema({
		tags: ["Live Streams"],
		summary: "Create a new Live Stream",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token in the Authorization header (Bearer <token>).",
		request: {
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional(),
				userId: Str({ description: "User ID (automatically set from JWT token)" }).optional(),
			}),
			body: {
				content: {
					"application/json": {
						schema: LiveStreamInput,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the created live stream",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
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

	async handle(c) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		const { channelId, userId } = request.headers;
		const inputStream = request.body;

		// Create the business live stream object
		const liveStream = {
			...inputStream,
			id: crypto.randomUUID(), // Generate a unique ID for the live stream
			userId,
			channelId,
			dateCreated: new Date().toISOString(),
			dateModified: new Date().toISOString(),
			status: 'scheduled' as const,
			currentViewers: 0,
			peakViewers: 0,
			views: 0,
			isPrivate: inputStream.isPrivate ?? false,
			allowChat: inputStream.allowChat ?? true,
			tags: inputStream.tags || [],
			likes: [],
			dislikes: [],
			comments: [],
		};

		// Generate stream key and RTMP URL for the live stream
		const streamKey = crypto.randomUUID();
		const rtmpUrl = `rtmp://ingest.bunny.net/live/${streamKey}`;
		
		liveStream.streamKey = streamKey;
		liveStream.rtmpUrl = rtmpUrl;

		// Create the live stream in Bunny Stream if possible
		try {
			const key = await env["bunny-stream-key"].get();
			if (key) {
				const bunnyStream = new stream(key);
				const libraryId = parseInt(await env.bunny_stream_library_id.get());
				
				// Create a video entry for the live stream
				const videoId = await bunnyStream.createVideo(libraryId, {
					title: liveStream.title,
					collectionId: liveStream.channelId,
				});
				
				liveStream.streamUrl = `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}`;
			}
		} catch (error) {
			console.error("Error creating Bunny stream:", error);
			// Continue without Bunny integration - the stream will still work with basic functionality
		}

		// Save the live stream to the repository
		const bucket = env.videos; // Using videos bucket for now, could be separate livestreams bucket
		type LiveStreamType = z.infer<typeof BusinessLiveStream>;
		const repository = new R2Repository<LiveStreamType>(bucket);
		await repository.putObject(`livestream:${liveStream.id}`, liveStream);

		// Send queue message for live stream creation
		const queue = new Queue();
		await queue.send(MessageType.LiveStreamCreate, { // Using dedicated LiveStreamCreate message type
			liveStreamId: liveStream.id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
			title: liveStream.title,
			status: liveStream.status,
		});

		// Transform to view model for response
		const streamView = {
			...liveStream,
			likesCount: liveStream.likes.length,
			dislikesCount: liveStream.dislikes.length,
			commentsCount: liveStream.comments.length,
		};

		// Return the created live stream
		return {
			success: true,
			result: { stream: streamView },
		};
	}
}