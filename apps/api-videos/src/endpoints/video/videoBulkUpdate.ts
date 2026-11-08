import { Bool, Str } from "chanfana";
import { z } from "zod";
import { VideoCategory } from "@al-ummah/shared-types";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';
import { inBackground } from "../../lib/websocket-notify";
import { announceNewVideo } from "../../lib/notification-events";
import { applyBulkChanges, isEmptyChange, MAX_BULK_VIDEOS, MAX_TAG_LENGTH, MAX_TAGS } from "../../lib/bulkEdit";
import { AuthenticatedRoute, AppContext } from '../../base';

const ERRORS = {
	not_found: "Video not found",
	forbidden: "Forbidden - you can only edit your own videos",
	scheduled: "Visibility of a scheduled video follows its schedule",
	too_many_tags: `A video can have at most ${MAX_TAGS} tags`,
} as const;

/**
 * POST /api/videos/bulk-update (Epic 5.3): change visibility, category and
 * tags of several of the caller's videos at once. Each video is checked for
 * ownership on its own; results are per video, like bulk-delete.
 */
export class VideoBulkUpdate extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Edit metadata of multiple videos",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							videoIds: z.array(Str()).min(1).max(MAX_BULK_VIDEOS),
							changes: z.object({
								isPublic: z.boolean().optional(),
								category: z.nativeEnum(VideoCategory).nullable().optional(),
								addTags: z.array(z.string().trim().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS).optional(),
								removeTags: z.array(z.string().trim().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS).optional(),
							}),
						}),
					},
				},
			},
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Per-video results",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							results: z.array(z.object({ videoId: Str(), success: Bool(), changed: Bool().optional(), error: Str().optional() })),
							summary: z.object({ total: z.number(), succeeded: z.number(), failed: z.number() }),
						}),
					},
				},
			},
			"400": { description: "No change requested or invalid input", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { body, headers } = await this.getValidatedData<typeof this.schema>();
		const { changes } = body;
		const videoIds = Array.from(new Set(body.videoIds));
		if (isEmptyChange(changes)) {
			return c.json({ success: false, error: "No change requested" }, 400);
		}
		const userId = this.getUserId(c);
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(c.env.videos);
		const queue = new Queue(c.env.queue);
		const now = new Date().toISOString();

		const results = await Promise.all(videoIds.map(async (videoId) => {
			try {
				const video = await repository.getObject(videoId);
				if (!video) return { videoId, success: false, error: ERRORS.not_found };
				if (!userId || video.userId !== userId) return { videoId, success: false, error: ERRORS.forbidden };

				const applied = applyBulkChanges(video, changes, now);
				// 'in' narrows the union (this package compiles without strictNullChecks)
				if ('error' in applied) return { videoId, success: false, error: ERRORS[applied.error] };
				if (!applied.changed) return { videoId, success: true, changed: false };

				await repository.putObject(videoId, applied.video);
				if (video.isPublic === false && applied.video.isPublic !== false) {
					inBackground(c, 'video-published', () => announceNewVideo(c.env, { ...applied.video, id: videoId }));
				}
				await queue.send(MessageType.VideoEdit, { videoId, userId, channelId: headers.channelId ?? video.channelId, timestamp: now });
				return { videoId, success: true, changed: true };
			} catch (error) {
				logger.error('[VideoBulkUpdate] Video update failed', { videoId, error: error instanceof Error ? error.message : String(error) });
				return { videoId, success: false, error: "Update failed" };
			}
		}));

		const succeeded = results.filter((r) => r.success).length;
		logger.info('[VideoBulkUpdate] Bulk edit', { userId, total: videoIds.length, succeeded, fields: Object.keys(changes) });
		return {
			success: true,
			results,
			summary: { total: videoIds.length, succeeded, failed: videoIds.length - succeeded },
		};
	}
}
