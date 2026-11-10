import { canOnVideo } from "../../lib/channelAccess";
import { applyFormatChoice } from "@al-ummah/shared-types";
import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { VideoUpdateInput } from "../../lib/model/input";
import { VideoView } from "../../lib/model/view";
import { transformVideoToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import { BunnyStreamClient as stream } from "../../lib/bunny/stream";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret } from "../../lib/env-helpers";
import { logger } from '../../lib/logger';
import { inBackground } from "../../lib/websocket-notify";
import { announceNewVideo } from "../../lib/notification-events";
import { AuthenticatedRoute, AppContext } from '../../base';
import { scanInBackground, videoScanText } from '../../lib/moderation-scan';
import { recordOwnerCategory, requestVideoSuggestion } from '../../lib/categorySuggestions';

export class VideoUpdate extends AuthenticatedRoute {
	schema = {
		tags: ["Videos"],
		summary: "Update a Video",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token in the Authorization header (Bearer <token>).",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
			body: {
				content: {
					"application/json": {
						schema: VideoUpdateInput,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the updated video",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								video: VideoView,
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
			"404": {
				description: "Video not found",
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

		const { id } = request.params;
		const { channelId } = request.headers;
		const videoUpdateInput = request.body;

		// Get authenticated user ID
		const effectiveUserId = this.getUserId(c);

		// Get existing video from storage
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		const existingVideo = await repository.getObject(id);

		if (!existingVideo) {
			return c.json(
				{
					success: false,
					error: "Video not found",
				},
				404
			);
		}

		// Check ownership - user must own the video to update it
		if (!(await canOnVideo(c.env as never, existingVideo, effectiveUserId, 'video.edit'))) {
			return c.json(
				{
					success: false,
					error: "Forbidden - you can only update your own videos",
				},
				403
			);
		}

		// Update the video with new values (applied to the fresh copy on every
		// compare-and-swap attempt, SCALABILITY-AUDIT AV-3)
		const { category, tags, format, ...restInput } = videoUpdateInput;
		const applyUpdate = (base: VideoType): VideoType => {
			const next: VideoType = {
			...base,
			...restInput,
			dateModified: new Date().toISOString(),
			// Preserve localized fields if provided
			titleLocalized: videoUpdateInput.titleLocalized ?? base.titleLocalized,
			descriptionLocalized: videoUpdateInput.descriptionLocalized ?? base.descriptionLocalized,
			// Tags replace the existing list (deduplicated); omitted keeps current tags
			tags: tags !== undefined ? Array.from(new Set(tags)) : base.tags,
			// Category: undefined keeps current value, null clears it. A category the owner
			// sends is theirs (confirming or replacing an AI suggestion).
			category: category === undefined ? base.category : (category ?? undefined),
			categorySource: category === undefined ? base.categorySource : category ? 'uploader' : undefined,
			};
			// "Upload as Short / as video" wins over detection; 'auto' clears the choice.
			// A choice also resolves an open format issue (admin flag).
			if (format) applyFormatChoice(next, format, { by: 'owner', userId: effectiveUserId, at: next.dateModified });
			return next;
		};

		logger.info('[VideoUpdate] Updating video', {
			videoId: id,
			userId: effectiveUserId,
			fields: Object.keys(videoUpdateInput),
		});

		// Update the video in Bunny Stream if title changed
		if (videoUpdateInput.title && videoUpdateInput.title !== existingVideo.title) {
			try {
				const key = await requireSecret(c.env["bunny-stream-key"], 'bunny-stream-key');
				const libraryIdStr = await requireSecret(c.env.bunny_stream_library_id, 'bunny_stream_library_id');
				const libraryId = parseInt(libraryIdStr);
				const bunnyStream = new stream(key).forEnv(c.env);

				await bunnyStream.updateVideo(libraryId, id, {
					title: videoUpdateInput.title,
				});
			} catch (error) {
				logger.error("Error updating video in Bunny Stream:", error);
				// Continue with local update even if Bunny Stream update fails
			}
		}

		// Save the updated video: a conditional write on the fresh copy, so a
		// concurrent comment, like or view flush is not overwritten
		let previous = existingVideo;
		const { data: updatedVideo, rejected } = await repository.updateObjectOrReject<true>(id, (fresh) => {
			if (fresh.userId !== existingVideo.userId) return { reject: true };
			previous = { ...fresh };
			const next = applyUpdate(fresh);
			// Fields the update removed (format 'auto' clears the uploader's
			// choice) must go from the stored copy too: Object.assign only adds
			for (const key of Object.keys(fresh)) {
				if (!(key in next)) delete (fresh as Record<string, unknown>)[key];
			}
			Object.assign(fresh, next);
			return true;
		});
		if (!updatedVideo) {
			return c.json({ success: false, error: "Video not found" }, 404);
		}
		if (rejected) {
			return c.json({ success: false, error: "Forbidden - you can only update your own videos" }, 403);
		}

		// Made public after processing: tell subscribers (processor de-duplicates per video)
		if (previous.isPublic === false && updatedVideo.isPublic !== false) {
			inBackground(c, 'video-published', () => announceNewVideo(c.env, { ...updatedVideo, id }));
		}

		// Send queue message for video update
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoEdit, {
			videoId: id,
			userId: effectiveUserId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		// Re-scan only when the scanned text changed (title, description, tags, localized variants)
		const textChanged = videoScanText(updatedVideo) !== videoScanText(previous);
		if (textChanged) {
			scanInBackground(c, { surface: 'video_metadata', event: 'edit', subjectId: id, authorId: effectiveUserId, channelId, text: videoScanText(updatedVideo) });
		}

		// AI category: record what the owner kept; re-suggest when the text changed and no
		// person has chosen a category (queued, never blocks the save)
		if (category !== undefined) recordOwnerCategory(c, id, category ?? null, effectiveUserId);
		const personChose = !!updatedVideo.category && updatedVideo.categorySource !== 'ai';
		if (textChanged && !personChose) {
			requestVideoSuggestion(c, { videoId: id, userId: effectiveUserId, channelId: updatedVideo.channelId, reason: 'edit' });
		}

		// Transform to view model for response
		const videoView = transformVideoToView(updatedVideo);

		// Return the updated video
		return {
			success: true,
			result: { video: videoView },
		};
	}
}