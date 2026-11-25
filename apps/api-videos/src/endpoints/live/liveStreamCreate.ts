import { forManager } from './liveSession';
import { AuthenticatedRoute, AppContext } from "../../base";
import { Bool, Str } from "../../lib/chanfana-params";
import { z } from "zod";
import { LiveStream as BusinessLiveStream, ResponseError } from "../../lib/types";
import { LiveStreamInput } from "../../lib/model/input";
import { LiveStreamView } from "../../lib/model/view";
import { NonVideoRepository } from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { attachSession, type LiveStreamRecord, type StreamsEnv } from "../../lib/live/streams";
import { uploadIdentity } from "../../lib/channelAccess";
import { LiveRefusedError } from "../../lib/live/service";
import { liveTierGate } from "./liveSession";
import { logger } from '../../lib/logger';
import { featureOff } from '../../lib/features/off';
import { eventTagRefused } from '../../lib/live/events';
import { PUBLIC_DISLIKES_COUNT } from "../../lib/reactions";

export class LiveStreamCreate extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Live Streams"],
		summary: "Create a new Live Stream",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token in the Authorization header (Bearer <token>).",
		request: {
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
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
			"402": {
				description: "This month's live streaming hours are used (code live_hours_used)",
				content: { "application/json": { schema: ResponseError } },
			},
			"403": {
				description: "Live streaming is not in the channel owner's creator tier (code live_not_in_tier)",
				content: { "application/json": { schema: ResponseError } },
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

	async handle(c: AppContext) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		const { channelId } = request.headers;
        const userId = this.getUserId(c);
		const { eventType, ...inputStream } = request.body;

		// The channel owner's creator tier must include live (lib/live/tier-gate.ts), before anything is stored
		const tier = await liveTierGate(c, { id: 'new', channelId, userId, sessionId: null }, 'create', userId);
		if (tier instanceof Response) return tier;

		// Create the business live stream object
		// A channel member creates the stream for the channel: it belongs to the
		// channel's owner and records the member in createdBy
		// (docs/specs/CHANNEL-ROLES.md §7; channelIdMiddleware checked live.manage)
		const { ownerId, uploadedBy: createdBy } = uploadIdentity(c, userId);
		const tagRefused = await eventTagRefused(c, ownerId, eventType);
		if (tagRefused) return tagRefused;
		const liveStream = {
			...inputStream,
			...(eventType ? { eventType } : {}),
			id: crypto.randomUUID(), // Generate a unique ID for the live stream
			userId: ownerId,
			...(createdBy ? { createdBy } : {}),
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

		// Save, then assign a provider (round-robin / weighted / override, lib/live/*)
		// and provision its first session. A refusal (no provider may take a
		// stream: off, at capacity or over budget) removes the record again.
		const bucket = c.env.videos;
		type LiveStreamType = z.infer<typeof BusinessLiveStream>;
		const repository = new NonVideoRepository<LiveStreamType>(bucket);
		const isTest = c.req.header('x-live-test') === '1' && (c.env as { ENVIRONMENT?: string }).ENVIRONMENT !== 'production';
		await repository.putObject(`livestream:${liveStream.id}`, { ...liveStream, ...(isTest ? { isTest: true } : {}) } as LiveStreamType);
		let attached: Awaited<ReturnType<typeof attachSession>>;
		try {
			attached = await attachSession(c.env as unknown as StreamsEnv, { ...(liveStream as unknown as LiveStreamRecord), isTest }, Date.now(), tier);
		} catch (error) {
			await repository.deleteObject(`livestream:${liveStream.id}`).catch(() => undefined);
			if (error instanceof LiveRefusedError) {
				// No provider may take streams (off, unconfigured or over budget): live is hidden
				if (error.code !== 'live_capacity') return featureOff(c, 'live');
				return c.json({ success: false, code: error.code, error: 'Live streaming is at capacity right now. Try again in a few minutes.' }, 503);
			}
			logger.error('[Live] Provisioning the first session failed', { streamId: liveStream.id, error: error instanceof Error ? error.message : String(error) });
			return c.json({ success: false, code: 'live_provider_error', error: 'The live service could not be reached. Try again.' }, 502);
		}
		Object.assign(liveStream, { provider: attached.session.provider, sessionId: attached.session.id, playbackUrl: attached.session.playback_url });

		// Send queue message for live stream creation
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.LiveStreamCreate, { // Using dedicated LiveStreamCreate message type
			liveStreamId: liveStream.id,
			userId: ownerId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
			title: liveStream.title,
			status: liveStream.status,
		});

		// Transform to view model for response
		const streamView = {
			...liveStream,
			playbackUrl: await forManager(c, liveStream, true, attached.session.playback_url),
			likesCount: liveStream.likes.length,
			dislikesCount: PUBLIC_DISLIKES_COUNT,
			commentsCount: liveStream.comments.length,
		};

		// Return the created live stream
		return {
			success: true,
			result: { stream: streamView },
		};
	}
}